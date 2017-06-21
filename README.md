# rethinkdb-nodash

## About

This little library was born as a response to the realization that
[rethinkdbdash][rethinkdbdash], the advanced RethinkDB database driver, contains
too many complex/advanced features that in a lot of cases may not really be
necessary, and in some cases may even be harmful.

*rethinkdbdash* obsoletes the need for manual connection management. It also
introduced connection pools, automatic reconnect, promise based interface (this
has since been integrated into the original driver), Node.js stream API,
automatic conversion from cursors to arrays, and a few other features.

Some of these features have been amazingly useful, and working with RethinkDB
would not be the same without them. Yet some of them seem like overkill, and
have caused the occasional headache.


### Connection Pools

One of the overkill features concerns connection pools. Are they really
necessary? In production RethinkDB recommends running a [proxy node][proxy] on
all application servers. Supposedly then, from the application's point of view,
the connection to DB is localhost only to a single endpoint, and the proxy would
take care of managing connections to the DB cluster.

Ever since [this issue][parallel] (and related issues) have been closed, there
does not seem to be a need for having multiple connections. Yet *rethinkdbdash*,
at the time of writing this, would only run one query per connection. Which
means that the connection count must be increased to some crazy number, and you
may even run into default file descriptor limits.

Thus the idea that there's any benefit to having multiple connections is
suspect. In the past I've run into situations where a connection pool would not
release connections in case of database/proxy restarts, and the application
would remain in an unusable state.


### Exponential Back-off

Slowing down reconnection retries with exponential increase in reconnect
interval duration is useful, but only if you have thousands of clients
attempting to reconnect. It is unlikely that a typical application cluster would
ever grow to that proportion. The DB clients are your applications here, so why
there would be so many is unclear.

Therefore a simple constant, predictable reconnect interval seems much better.
The default setting in *rethinkdbdash* can make the app take a *long* time to
reconnect, and so is pretty counter-productive.


## Usage

### Connect and Run a Query

```js
const rethinkdb_init = require('rethinkdb-nodash');

rethinkdb_init({
    host: 'localhost',
    port: 28015,
    db:   'rethinkdb',
    reconnect_interval: 5000,   // this is the default
})
.then(function (r) {
    global.r = r;

    return r
        .tableList()
        .run()
})
.then(console.log)              // prints tables in the 'rethinkdb' system db
.catch(function (err) {
    console.error(err);
    process.exit(1);
});

```


### Streams

Unlike *rethinkdbdash*, the stream is produced asynchronously (I don't know how
*rethinkdbdash* does the synchronous streams, but it seems like more trouble
than it's worth).


```js
r
.table('SomeTable')
.changes({ includeInitial: true })
.toStream()
.then(function (stream) {
    // do something with the stream
    stream.pipe(somewhere);
});
```

### Raw Cursors

```js
r
.table('SomeTable')
.run({ cursor: true })
.then(function (cursor) {
    // do something with the cursor
    cursor.each(function (err, row) {
        // ...
    });
});
```

[rethinkdbdash]: https://github.com/neumino/rethinkdbdash
[proxy]: https://www.rethinkdb.com/docs/sharding-and-replication/#running-a-proxy-node
[parallel]: https://github.com/rethinkdb/rethinkdb/issues/3754
