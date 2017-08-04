'use strict';

const r = require('rethinkdb');
const { Cursor } = require('rethinkdb/cursor');
const { isConnection } = require('rethinkdb/net');
const { Readable } = require('readable-stream');

let conn = null;
let reconnect_timer = null;

const DEFAULT_RECONNECT_INTERVAL = 5000;

const schedule_reconnect = function (cfg) {
    if (!reconnect_timer) {
        const timeout = cfg.reconnect_interval || DEFAULT_RECONNECT_INTERVAL;
        console.error(`[rethinkdb] reconnect in ${timeout} ms`);
        reconnect_timer = setTimeout(function () {
            reconnect_timer = null;
            reconnect(cfg);
        }, timeout);
    }
}

const reconnect = function (cfg) {
    return r.connect(cfg)
    .then(function (_conn) {
        conn = _conn;
        console.error('[rethinkdb] connection success');

        conn.on('close', function () {
            conn = null;
            console.error('[rethinkdb] connection closed, reconnect');

            schedule_reconnect(cfg);
        });
        conn.on('error', function (err) {
            console.error('[rethinkdb] connection error event', err);
        });
    })
    .catch(function (err) {
        conn = null;
        console.error('[rethinkdb] connection error', err);

        schedule_reconnect(cfg);
    });
}

module.exports = function (cfg) {
    const TermBase = r.table('xoxoxo').__proto__.__proto__.__proto__.__proto__;
    const real_run = TermBase.run;

    // Modify the .run() method to pick a connection automatically if not
    // supplied as first argument. Also convert results from cursor to array
    // unless the {cursor:true} option is specified.
    TermBase.run = function (_conn, options) {
        if (!isConnection(_conn)) {
            options = _conn;
            _conn = conn;       // pick global connection
        }

        // do not pass the "cursor" option through to RethinkDB driver because
        // it will cause errors
        const opts = Object.assign({}, options);
        const no_cursor = !opts.cursor;
        if ('cursor' in opts)
            delete opts.cursor;

        return real_run.call(this, _conn, opts)
        .then(function (cursor) {
            // if we get a cursor, then convert to array unless options.cursor
            // says otherwise
            if (no_cursor && cursor instanceof Cursor)
                return cursor.toArray();

            // this may also be a final single value (not a cursor)
            return cursor;
        });
    }

    // users can call this method to close the stream's underlying cursor
    const close_stream = function () {
        if (this.__closed__)
            return;
        this.__closed__ = true;

        if (this._cursor) {
            this._cursor.close()
            .then(() => {
                this._cursor = null;
                this.emit('close');
            })
            .catch(err => {
                this._cursor = null;
                this.emit('error', err);
                this.emit('close');
            });
        } else {
            this.emit('close');
        }
    }

    // ReadableStream _read() implementation
    const _read = function (size) {
        // if cursor is not available, then there's nothing we can do
        const cursor = this._cursor;
        if (!cursor) {
            this.emit('error', new Error('db cursor not available'));
            return;
        }

        const fetch_next = () => {
            cursor.next((err, row) => {
                if (err) {
                    // check for normal end of data (do not emit error)
                    if (err.name === 'ReqlDriverError'
                      && err.message === 'No more rows in the cursor.') {
                        this.emit('end');   // no more data
                        this.close();
                        return;
                    }

                    // unknown error, emit it
                    this.emit('error', err);
                    this.close();
                    return;
                }

                // keep fetching until consumers can no longer consume
                if (this.push(row))
                    fetch_next();
            });
        }

        fetch_next();
    }

    // run query and produce a readable stream with the results
    TermBase.toStream = function (options) {
        const stream_conn = conn;
        return real_run.call(this, stream_conn, options)
        .then(function (cursor) {
            const stream = new Readable({
                objectMode: true,
                read: _read
            });
            stream.close = close_stream;
            stream._cursor = cursor;

            // if connection is already gone here, throw exception
            if (!stream_conn.open || stream_conn.closing) {
                stream.close();
                throw new Error('db disconnect during stream setup');
            }

            // close stream in case the connection goes away at some point
            stream_conn.once('close', function () {
                stream.close();
            });

            return stream;
        });
    }

    return reconnect(cfg)
    .then(function () {
        return r;
    });
}
