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
var debug = require('debug')('Mockgoose');
var EventEmitter = require('events').EventEmitter;
var emitter = new EventEmitter();
var mongod_emitter;

module.exports = function(mongoose, db_opts) {
    var ConnectionPrototype = mongoose.Connection.prototype;
    var origOpen = ConnectionPrototype.open;
console.log('***', origOpen.toString())
    var origOpenPrivate = ConnectionPrototype._open;
    var openCallList = [];

    ConnectionPrototype.open = function() {
        var connection = this;
        var args = arguments;
        openCallList.push({
            connection: connection,
            args: args,
            isConnected: false,
        });

        function resume() {
            origOpen.apply(connection, args);
        }
        if (mongod_emitter === undefined) {
            start_server(db_opts);
            emitter.once("mongodbStarted", resume);
        }
        else {
            resume();
        }
    }

    ConnectionPrototype._open = function() {
        if (mongod_emitter === undefined) {
console.log('_o X')
            origOpenPrivate.apply(this, arguments);
            return;
        }

        this.host = 'localhost';
        this.port = db_opts.port;

        var connection = this;
        openCallList.filter(function(call, index) {
            if (call.connection !== connection) {
                return false;
            }

            connection.once('connected', function() {
                call.isConnected = true;
                debug('Mongoose connected %d', index);
            });
            connection.once('disconnected', function() {
                call.isConnected = false;
                debug('Mongoose disconnected %d', index);

                if (! openCallList.some(function(_call) {
                    return _call.isConnected;
                }) && (mongod_emitter !== undefined)) {
                    mongod_emitter.emit('mongoShutdown');
                }
            });
            return true;
        });

        origOpenPrivate.apply(this, arguments);
    }


    mongoose.isMocked = true;

    emitter.once("mongodbStarted", function(db_opts) {
        debug("started server on port: %d", db_opts.port);
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

    if (! db_opts.port ) {
        db_opts.port = 27017;
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

    var orig_dbpath = db_opts.dbpath;

    function start_server(db_opts) {
        debug("attempting to start server on port: %d", db_opts.port);
        db_opts.dbpath = path.join(orig_dbpath, db_opts.port.toString());

        try {
            fs.mkdirSync(db_opts.dbpath);
        } catch (e) {
            if (e.code !== "EEXIST" ) throw e;
        }

        mongod_emitter = mongod.start_server({args: db_opts, auto_shutdown: true}, function(err) {
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
console.log('r X')
            return done(null);
        }

        var collections = openCallList.reduce(function(total, call) {
            var objs = call.connection.collections;
            for (var key in objs) {
console.log('r +', key)
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
console.log('r DM')
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
console.log('V', ConnectionPrototype.open.toString())
            ConnectionPrototype._open = origOpenPrivate;
            openCallList = [];

console.log('v')
            emitter.removeAllListeners();
console.log('v')
            mongod_emitter = undefined;
console.log('v')

            callback && callback();
        }

        if ((! this.isMocked) || (openCallList.length === 0)) {
            return restore();
        }

        openCallList.forEach(function(call) {
            call.connection.close();
        });
        mongod_emitter.once('mongoShutdown', restore);
	}

	mongoose.unmockAndReconnect = function(callback) {
        var reconnectCallList = openCallList;
        var remaining = openCallList.length;

		mongoose.unmock(function() {
console.log('|')
            if (remaining === 0) {
console.log("' x")
                called = true;
                callback && callback();
                return;
            }

console.log('|')
            var called = false;
            reconnectCallList.forEach(function(call, index) {
                var connection = call.connection;
                var args = Array.prototype.slice.call(call.args);
                var cb = args.pop();
                if (typeof cb !== 'function') {
                    args.push(cb);
                }

console.log('|', index)
                args.push(function(err) {
console.log('|', index)
                    debug('Mongoose reconnected %d', index);

                    remaining--;
                    if ((! called) && (err || (remaining === 0))) {
console.log("'", index)
                        called = true;
                        callback && callback(err);
                    }
                });
console.log('|', connection.open.toString())
                connection.open.apply(connection, args);
            });
		});
	}


    return emitter;
}
