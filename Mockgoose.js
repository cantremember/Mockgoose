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

            prepare_server(db_opts);

            var Promise = PromiseProvider.get();
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
        this.host = db_opts.bind_ip;
        this.port = db_opts.port;

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
                        emitter.emit("mongodbStopped", db_opts);
                    });
                }
            });
        });

        return origOpenPrivate.apply(this, arguments);
    }


    mongoose.isMocked = true;

    emitter.once("mongodbStarted", function(db_opts) {
        debug("started server as %s:%d", db_opts.bind_ip, db_opts.port);
        server_started = true;
    });
    emitter.once("mongodbStopped", function(db_opts) {
        debug("stopped server as %s:%d", db_opts.bind_ip, db_opts.port);
        server_started = false;
    });

    if (!db_opts) db_opts = {};

    var db_version;
    if (! db_opts.version ) {
        db_version = mongod.active_version();
    } else {
        db_version = db_opts.version;
    }

    delete db_opts.version;

    if (! db_opts.storageEngine ) {
        var parsed_version = db_version.split('.');
        if ( parsed_version[0] >= 3 && parsed_version[1] >= 2 ) {
            db_opts.storageEngine = "ephemeralForTest";
        } else {
            db_opts.storageEngine = "inMemoryExperiment";
        }
    }

    if (! db_opts.bind_ip ) {
        db_opts.bind_ip = MONGOD_HOST;
    }

    if (! db_opts.port ) {
        db_opts.port = MONGOD_PORT;
    } else {
        db_opts.port = Number(db_opts.port);
    }

    if (! db_opts.dbpath ) {
        db_opts.dbpath = path.join(__dirname, ".mongooseTempDB");
        debug("dbpath: %s", db_opts.dbpath);
    }

    try {
        fs.mkdirSync(db_opts.dbpath);
    } catch (e) {
        if (e.code !== "EEXIST" ) throw e;
    }

    function prepare_server(db_opts) {
      // "preparing" happens before a successful "launch"
      //   we only need to do the preparation once
      if ((server_preparing) || (mongod_emitter !== undefined)) {
console.log('ATTEMPT TO RELAUNCH')
          return;
      }
      server_preparing = true;

      debug("identifying available port, base = %s:%d", db_opts.bind_ip, db_opts.port);

      portfinder.getPort({
        host: db_opts.bind_ip,
        port: db_opts.port,
      }, function(err, freePort) {
        if (err) {
          throw err;
        }

        db_opts.port = freePort;
        start_server(db_opts);
      });
    }

    var orig_dbpath = db_opts.dbpath;
    function start_server(db_opts) {
        debug("attempting to start server as %s:%d", db_opts.bind_ip, db_opts.port);
        db_opts.dbpath = path.join(orig_dbpath, db_opts.port.toString());

        try {
            fs.mkdirSync(db_opts.dbpath);
        } catch (e) {
            if (e.code !== "EEXIST" ) throw e;
        }

        // no longer preparing, now launching
        server_preparing = false;
        mongod_emitter = mongod.start_server({args: db_opts, auto_shutdown: true}, function(err) {
            // vs. `mongod_emitter.once('mongoStarted', function(err) { ... })`
            if (!err) {
                emitter.emit('mongodbStarted', db_opts);
            } else {
                db_opts.port++;
                start_server(db_opts);
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
            obj.deleteMany(null, function() {
                remaining--;
                if (remaining === 0) {
                    done(null);
                }
            });
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
            var isConnected = call.isConnected;
            if (isConnected) {
                // no need to wait on a callback;
                //    #on('disconnected') will do the trick
                call.connection.close();
            }
            return isConnected;
        });

        if (connected.length === 0) {
            // we never managed to get anywhere
            restore();
        }
        else {
            mongod_emitter.once('mongoShutdown', restore);
        }
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
