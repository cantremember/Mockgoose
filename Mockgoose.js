'use strict';

var mongod;
if ( process.env.MONGODB_LOCAL_BUILD ) {
    console.log("WARNING: USING ../mongodb-prebuilt, this option is for development only");
    mongod = require('../mongodb-prebuilt');
} else {
    mongod = require('mongodb-prebuilt');
}
var path = require('path');
var fs = require('fs');
var portfinder = require('portfinder');
var debug = require('debug')('Mockgoose');
var EventEmitter = require('events').EventEmitter;
var emitter = new EventEmitter();

var server_preparing = false;
var server_started = false;
var mongod_emitter;
var mongod_opts;

var MONGOD_HOST = '127.0.0.1';
var MONGOD_PORT = 27017;


module.exports = function(mongoose, db_opts) {
    var ConnectionPrototype = mongoose.Connection.prototype;
    var PromiseProvider = mongoose.PromiseProvider;

    var origOpen = ConnectionPrototype.open;
    var origOpenSet = ConnectionPrototype.openSet;
    var origOpenPrivate = ConnectionPrototype._open;
    var openCallList = [];

    function openProxy(methodName, origMethod) {
        return function() {
            var connection = this;
            var args = arguments;
            openCallList.push({
                connection: connection,
                methodName: methodName,
                args: args,
                isConnected: false,
            });

            prepare_server();

            // are we being invoked in callback-style?
            var cb = args[args.length - 1];
            if (typeof cb === 'function') {
                var resume = function() {
                    debug("proxying to original call");

                    origMethod.apply(connection, args);
                }

                if (server_started) {
                    resume();
                }
                else {
                    emitter.once("mongodbStarted", resume);
                }

                return;
            }

            var Promise = PromiseProvider && PromiseProvider.get();
            if (! Promise) {
              throw new Error('`mongoose` provides no Promises');
            }

            return new Promise.ES6(function(resolve, reject) {
                // resume once the mock server has started
                function resume() {
                    debug("proxying to original call");

                    var promise = origMethod.apply(connection, args);
                    promise && promise.then(resolve).catch(reject);
                }

                if (server_started) {
                    resume();
                }
                else {
                    emitter.once("mongodbStarted", resume);
                }
            });
        };
    }
    ConnectionPrototype.open = openProxy('open', origOpen);
    ConnectionPrototype.openSet = openProxy('openSet', origOpenSet);

    ConnectionPrototype._open = function() {
        if (! server_started) {
            // we are not actively mocking
            return origOpenPrivate.apply(this, arguments);
        }

        if (this.replica) {
            // emulating replSet behavior is entirely too complicated
            //     so we act as a single connection
            this.replica = false;
            this.hosts = null;
        }

        // this Connection should connect to the *mock server*
        this.host = mongod_opts.bind_ip;
        this.port = mongod_opts.port;

        var connection = this;
        openCallList.forEach(function(call, index) {
            if (call.connection !== connection) {
                return;
            }

            connection.once('connected', function() {
                call.isConnected = true;
                debug('Mongoose connected #%d', index);
            });
            connection.once('disconnected', function() {
                call.isConnected = false;
                debug('Mongoose disconnected #%d', index);

                var anyConnected = openCallList.some(function(_call) {
                    return _call.isConnected;
                });
                if ((! anyConnected) && (mongod_emitter !== undefined)) {
                    // trigger a MongoDB shutdown when there are no active Connections
                    mongod_emitter.emit('mongoShutdown');

                    setImmediate(function() {
                        // we can't know when the *real* shutdown will complete
                        //   but we know that our job here is done
                        emitter.emit("mongodbStopped", mongod_opts);
                    });
                }
            });
        });

        return origOpenPrivate.apply(this, arguments);
    }


    mongoose.isMocked = true;

    emitter.once("mongodbStarted", function() {
        debug("started server as %s:%d", mongod_opts.bind_ip, mongod_opts.port);
        server_started = true;
    });
    emitter.once("mongodbStopped", function() {
        debug("stopped server as %s:%d", mongod_opts.bind_ip, mongod_opts.port);
        server_started = false;
    });

    // NOTE:  if you mock multiple instances of Mongoose,
    //   only one global singleton mock server gets started (for efficiency's sake),
    //   and it uses the `db_opts` from the first `mockgoose(...)` call
    mongod_opts = mongod_opts || db_opts || {};

    var db_version;
    if (! mongod_opts.version ) {
        db_version = mongod.active_version();
    } else {
        db_version = mongod_opts.version;
    }

    delete mongod_opts.version;

    if (! mongod_opts.storageEngine ) {
        var parsed_version = db_version.split('.');
        if ( parsed_version[0] >= 3 && parsed_version[1] >= 2 ) {
            mongod_opts.storageEngine = "ephemeralForTest";
        } else {
            mongod_opts.storageEngine = "inMemoryExperiment";
        }
    }

    if (! mongod_opts.bind_ip ) {
        mongod_opts.bind_ip = MONGOD_HOST;
    }

    if (! mongod_opts.port ) {
        mongod_opts.port = MONGOD_PORT;
    } else {
        mongod_opts.port = Number(mongod_opts.port);
    }

    if (! mongod_opts.dbpath ) {
        mongod_opts.dbpath = path.join(__dirname, ".mongooseTempDB");
        debug("dbpath: %s", mongod_opts.dbpath);
    }

    try {
        fs.mkdirSync(mongod_opts.dbpath);
    } catch (e) {
        if (e.code !== "EEXIST" ) throw e;
    }

    function prepare_server() {
      // "preparing" happens before a successful "launch"
      //   we only need to do the preparation once
      if ((server_preparing) || (mongod_emitter !== undefined)) {
          return;
      }
      server_preparing = true;

      debug("identifying available port, base = %s:%d", mongod_opts.bind_ip, mongod_opts.port);

      portfinder.getPort({
        host: mongod_opts.bind_ip,
        port: mongod_opts.port,
      }, function(err, freePort) {
        if (err) {
          throw err;
        }

        mongod_opts.port = freePort;
        start_server();
      });
    }

    var orig_dbpath = mongod_opts.dbpath;
    function start_server() {
        debug("attempting to start server as %s:%d", mongod_opts.bind_ip, mongod_opts.port);
        mongod_opts.dbpath = path.join(orig_dbpath, mongod_opts.port.toString());

        try {
            fs.mkdirSync(mongod_opts.dbpath);
        } catch (e) {
            if (e.code !== "EEXIST" ) throw e;
        }

        // no longer preparing, now launching
        server_preparing = false;
        mongod_emitter = mongod.start_server({args: mongod_opts, auto_shutdown: true}, function(err) {
            // vs. `mongod_emitter.once('mongoStarted', function(err) { ... })`
            if (!err) {
                emitter.emit('mongodbStarted', mongod_opts);
            } else {
                mongod_opts.port++;
                start_server();
            }
        });
    }

    module.exports.reset = function(done) {
        if (! mongoose.isMocked) {
            return done(null);
        }

        var collections = openCallList.reduce(function(total, call) {
            var objs = call.connection.collections;
            for (var key in objs) {
                total.push(objs[key]);
            }
            return total;
        }, []);

        var remaining = collections.length;
        if (remaining === 0) {
            return done(null);
        }

        collections.forEach(function(obj) {
            function onReset() {
                remaining--;
                if (remaining === 0) {
                    done(null);
                }
            }
            if (typeof obj.deleteMany === 'function') {
              obj.deleteMany(null, onReset);
            }
            else {
              obj.remove({}, onReset);
            }
        });
    };

      mongoose.unmock = function(callback) {
        function restore() {
            delete mongoose.isMocked;

            ConnectionPrototype.open = origOpen;
            ConnectionPrototype.openSet = origOpenSet;
            ConnectionPrototype._open = origOpenPrivate;
            openCallList = [];

            emitter.removeAllListeners();

            if (mongod_emitter !== undefined) {
                mongod_emitter.removeAllListeners();
                mongod_emitter = undefined;
            }
            server_preparing = false;
            server_started = false;

            callback && callback();
        }

        if (! this.isMocked) {
            return restore();
        }

        var connected = openCallList.filter(function(call) {
          return call.isConnected;
        });

        if (connected.length === 0) {
            // we never managed to get anywhere
            restore();
            return;
        }

        // *before* we start #close's, which may appear synchronous
        mongod_emitter.once('mongoShutdown', restore);

        connected.forEach(function(call) {
            // no need to wait on a callback;
            //    #on('disconnected') will do the trick
            //    and ultimately trigger 'mongoShutdown'
            call.connection.close();
        });
    }

    mongoose.unmockAndReconnect = function(callback) {
        var reconnectCallList = openCallList;
        var remaining = openCallList.length;

            mongoose.unmock(function() {
            if (remaining === 0) {
                callback && callback();
                return;
            }

            var anyError;
            reconnectCallList.forEach(function(call, index) {
                var connection = call.connection;
                var methodName = call.methodName;

                if (methodName === 'openSet') {
                    // undo the "single connection" fakery from _open
                    delete connection.host;
                    delete connection.port;
                }

                var args = Array.prototype.slice.call(call.args);
                var cb = args.pop();
                if (typeof cb !== 'function') {
                    args.push(cb);
                }

                args.push(function(err) {
                    debug('Mongoose reconnected #%d', index);

                    anyError = anyError || err;

                    remaining--;
                    if ((remaining === 0)) {
                        callback && callback(anyError);
                    }
                });

                connection[methodName].apply(connection, args);
            });
        });
    }


    return emitter;
}
