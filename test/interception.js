'use strict';

var expect = require('chai').expect;
var assert = require('assert');
var sinon = require('sinon');
var async = require('async');

var mongooseLib = require('mongoose');
var Connection = mongooseLib.Connection;
var ConnectionPrototype = Connection.prototype;
var Mongoose = mongooseLib.Mongoose;
var mockgoose = require('../Mockgoose');

var sandbox = sinon.sandbox.create();
var mongoose;

var CONNECTION_BASE = { options: {} };

// localhost:27017 is likely to conflict with `process.env.MOCKGOOSE_LIVE`
//   which makes for an excellent Test Scenario
var HOST = 'localhost';
var PORT = 27017;
var DB = 'DB';
var DB2 = 'DB2';
var USER_HOST_DB_PORT = [ HOST, DB, PORT ];
var USER_HOST_DB2_PORT = [ HOST, DB2, PORT ];

var URI = 'mongodb://' + HOST + ':' + PORT;
var OPTIONS = {
    options: true
};
var USER_URI_OPTIONS = [ URI, OPTIONS ];

// assumed by Mockgoose, with adaptive port
var MONGOD_HOST = '127.0.0.1';
var MONGOD_HOST_DB = [ MONGOD_HOST, DB ];
var MONGOD_HOST_DB2 = [ MONGOD_HOST, DB2 ];

// FIXME: patiently wait for mongod to shut down
var FIXME_INTER_TEST_DELAY = 1000;


describe('mongoose.Connection', function() {
    var Promise;

    beforeEach(function() {
        mongoose = new Mongoose();

        // ES6 Promises from our fresh Mongoose instance
        Promise = mongoose.PromiseProvider.get().ES6;
    });

    afterEach(function(done) {
        // safety in the face of assertion failure
        mongoose.unmock(function() {
            // AFTER we've put back any spys & stubs
            sandbox.restore();

            setTimeout(done, FIXME_INTER_TEST_DELAY);
        });
    });


    describe('#open', function() {
        var connections;
        var openOriginal, openStub;
        var _openStub;
        var _openState;

        beforeEach(function() {
            connections = [];
            _openState = [];

            // #open (eg. to the mock DB) as usual
            openOriginal = ConnectionPrototype.open;
            openStub = sandbox.stub(ConnectionPrototype, 'open', function() {
                return openOriginal.apply(this, arguments);
            });

            var _openOriginal = ConnectionPrototype._open;
            _openStub = sandbox.stub(ConnectionPrototype, '_open', function() {
                // the host & port get faked out
                _openState.push([
                    this.host, this.name, this.port,
                ]);

                // other than that, #_open as usual
                _openOriginal.apply(this, arguments);
            });

            // AFTER we apply the spys & stubs
            mockgoose(mongoose);
        });


        describe('followed by #unmock', function() {
            it('fakes out a single call', function(done) {
                async.series([
                    function(next) {
                        connections.push(new Connection(CONNECTION_BASE));
                        connections[0].open(HOST, DB, PORT, next);
                    },
                    function(next) {
                        mongoose.unmock(next);
                    },
                    function(next) {
                        expect(openStub.callCount).to.equal(1);
                        // connect
                        expect(openStub.args[0].slice(0, 3)).to.deep.equal(USER_HOST_DB_PORT);

                        expect(_openStub.callCount).to.equal(1);

                        // connect (+ mock)
                        //   at which point we are connected to the host + database
                        //   yet we can't be sure what port we're connected to
                        expect(_openState[0].slice(0, 2)).to.deep.equal(MONGOD_HOST_DB);

                        next();
                    },
                ], done);
            });

            it.only('fakes out more than one call', function(done) {
                async.series([
                    function(next) {
                        // 2 in parallel
                        connections.push(new Connection(CONNECTION_BASE));
                        connections.push(new Connection(CONNECTION_BASE));
                        async.parallel(connections.map(function(connection) {
                            return function(_next) {
                                connection.open(HOST, DB, PORT, _next);
                            };
                        }), next);

                        // the server has not started for either of them
                        expect(_openStub.callCount).to.equal(0);
                    },
                    function(next) {
                        expect(_openStub.callCount).to.equal(2);

                        var connection = new Connection(CONNECTION_BASE);
                        connections.push(connection);
                        connection.open(HOST, DB2, PORT, next);

                        // the server has started
                        expect(_openStub.callCount).to.equal(3);
                    },
                    function(next) {
                        mongoose.unmock(next);
                    },
                    function(next) {
                        expect(openStub.callCount).to.equal(3);

                        // connect
                        expect(openStub.args[0].slice(0, 3)).to.deep.equal(USER_HOST_DB_PORT);
                        expect(openStub.args[2].slice(0, 3)).to.deep.equal(USER_HOST_DB2_PORT);

                        // connect (+ mock)
                        //   at which point we are connected to the host + database
                        //   yet we can't be sure what port we're connected to
                        expect(_openState[0].slice(0, 2)).to.deep.equal(MONGOD_HOST_DB);
                        expect(_openState[2].slice(0, 2)).to.deep.equal(MONGOD_HOST_DB2);
                        //   but it's the same port for both
                        expect(_openState[0][2]).to.equal(_openState[2][2]);

                        next();
                    },
                ], done);
            });

            it('handles an Error', function(done) {
                openOriginal = function(host, db, port, cb) {
                    cb(new Error('BOOM'));
                };

                async.series([
                    function(next) {
                        connections.push(new Connection(CONNECTION_BASE));
                        connections[0].open(HOST, DB, PORT, next);
                    },
                ], function(err) {
                    expect(err.message).to.equal('BOOM');

                    expect(openStub.callCount).to.equal(1);
                    expect(_openStub.callCount).to.equal(0);

                    // it('unmocks with no successful connections')
                    mongoose.unmock(done);
                });
            });
        });


        describe('Promised, followed by #unmock', function() {
            it('fakes out a single call', function() {
                var connection = new Connection(CONNECTION_BASE);
                var promise = connection.open(HOST, DB, PORT)
                .then(function() {
                    expect(openStub.callCount).to.equal(1);
                    expect(_openStub.callCount).to.equal(1);

                    return new Promise(function(resolve, reject) {
                        mongoose.unmock(function(err) {
                            return (err ? reject(err) : resolve());
                        });
                    });
                });

                expect(_openStub.callCount).to.equal(0);

                expect(promise.then).to.be.a('function');
                return promise;
            });

            it('handles an Error', function() {
                openOriginal = function() {
                    return new Promise(function(resolve, reject) {
                        reject(new Error('BOOM'));
                    });
                };

                var connection = new Connection(CONNECTION_BASE);
                var promise = connection.open(HOST, DB, PORT)
                .then(assert.fail, function(err) {
                    expect(err.message).to.equal('BOOM');

                    expect(openStub.callCount).to.equal(1);
                    expect(_openStub.callCount).to.equal(0);

                    return new Promise(function(resolve, reject) {
                        mongoose.unmock(function(err) {
                            return (err ? reject(err) : resolve());
                        });
                    });
                });

                expect(_openStub.callCount).to.equal(0);

                expect(promise.then).to.be.a('function');
                return promise;
            });
        });


        describe('with a reconnect', function() {
            if (! process.env.MOCKGOOSE_LIVE) {
                return;
            }


            it('reconnects a single call', function(done) {
                async.series([
                    function(next) {
                        connections.push(new Connection(CONNECTION_BASE));
                        connections[0].open(HOST, DB, PORT, next);
                    },
                    function(next) {
                        mongoose.unmockAndReconnect(next);
                    },
                    function(next) {
                        expect(openStub.callCount).to.equal(2);
                        // connect
                        expect(openStub.args[0].slice(0, 3)).to.deep.equal(USER_HOST_DB_PORT);
                        // reconnect
                        expect(openStub.args[1].slice(0, 3)).to.deep.equal(USER_HOST_DB_PORT);

                        expect(openStub.callCount).to.equal(2);

                        // connect (+ mock)
                        //   at which point we are connected to the host + database
                        //   yet we can't be sure what port we're connected to
                        expect(_openState[0].slice(0, 2)).to.deep.equal(MONGOD_HOST_DB);
                        // reconnect
                        expect(_openState[1]).to.deep.equal(USER_HOST_DB_PORT);

                        next();
                    },
                ], done);
            });

            it('reconnects more than one call', function(done) {
                async.series([
                    function(next) {
                        connections.push(new Connection(CONNECTION_BASE));
                        connections[0].open(HOST, DB, PORT, next);
                    },
                    function(next) {
                        connections.push(new Connection(CONNECTION_BASE));
                        connections[1].open(HOST, DB2, PORT, next);
                    },
                    function(next) {
                        mongoose.unmockAndReconnect(next);
                    },
                    function(next) {
                        expect(openStub.callCount).to.equal(4);
                        // connect
                        expect(openStub.args[0].slice(0, 3)).to.deep.equal(USER_HOST_DB_PORT);
                        expect(openStub.args[1].slice(0, 3)).to.deep.equal(USER_HOST_DB2_PORT);
                        // reconnect
                        expect(openStub.args[2].slice(0, 3)).to.deep.equal(USER_HOST_DB_PORT);
                        expect(openStub.args[3].slice(0, 3)).to.deep.equal(USER_HOST_DB2_PORT);

                        expect(openStub.callCount).to.equal(4);

                        // connect (+ mock)
                        //   at which point we are connected to the host + database
                        //   yet we can't be sure what port we're connected to
                        expect(_openState[0].slice(0, 2)).to.deep.equal(MONGOD_HOST_DB);
                        expect(_openState[1].slice(0, 2)).to.deep.equal(MONGOD_HOST_DB2);
                        //   but it's the same port for both
                        expect(_openState[0][2]).to.equal(_openState[1][2]);
                        // reconnect
                        expect(_openState[2]).to.deep.equal(USER_HOST_DB_PORT);
                        expect(_openState[3]).to.deep.equal(USER_HOST_DB2_PORT);

                        next();
                    },
                ], done);
            });
        });
    });


    describe('#openSet', function() {
        var connection;
        var openSetOriginal, openSetStub;
        var _openSpy;

        beforeEach(function() {
            // #open (eg. to the mock DB) as usual
            openSetOriginal = ConnectionPrototype.openSet;
            openSetStub = sandbox.stub(ConnectionPrototype, 'openSet', function() {
                return openSetOriginal.apply(this, arguments);
            });

            _openSpy = sandbox.spy(ConnectionPrototype, '_open');

            // AFTER we apply the spys & stubs
            mockgoose(mongoose);
        });


        describe('followed by #unmock', function() {
            it('fakes out a single call', function(done) {
                async.series([
                    function(next) {
                        connection = new Connection(CONNECTION_BASE);
                        connection.openSet(URI, OPTIONS, next);
                    },
                    function(next) {
                        mongoose.unmock(next);
                    },
                    function(next) {
                        expect(openSetStub.callCount).to.equal(1);
                        expect(openSetStub.args[0].slice(0, 2)).to.deep.equal(USER_URI_OPTIONS);

                        expect(_openSpy.callCount).to.equal(1);

                        next();
                    },
                ], done);
            });

            it('handles an Error', function(done) {
                openSetOriginal = function(uri, options, cb) {
                    cb(new Error('BOOM'));
                };

                async.series([
                    function(next) {
                        connection = new Connection(CONNECTION_BASE);
                        connection.openSet(URI, OPTIONS, next);
                    },
                ], function(err) {
                    expect(err.message).to.equal('BOOM');

                    expect(openSetStub.callCount).to.equal(1);
                    expect(_openSpy.callCount).to.equal(0);

                    // it('unmocks with no successful connections')
                    mongoose.unmock(done);
                });
            });
        });


        describe('Promised, followed by #unmock', function() {
            it('fakes out a single call', function() {
                var connection = new Connection(CONNECTION_BASE);
                var promise = connection.openSet(URI, OPTIONS)
                .then(function() {
                    expect(openSetStub.callCount).to.equal(1);
                    expect(_openSpy.callCount).to.equal(1);

                    return new Promise(function(resolve, reject) {
                        mongoose.unmock(function(err) {
                            return (err ? reject(err) : resolve());
                        });
                    });
                });

                expect(_openSpy.callCount).to.equal(0);

                expect(promise.then).to.be.a('function');
                return promise;
            });

            it('handles an Error', function() {
                openSetOriginal = function() {
                    return new Promise(function(resolve, reject) {
                        reject(new Error('BOOM'));
                    });
                };

                var connection = new Connection(CONNECTION_BASE);
                var promise = connection.openSet(URI, OPTIONS)
                .then(assert.fail, function(err) {
                    expect(err.message).to.equal('BOOM');

                    expect(openSetStub.callCount).to.equal(1);
                    expect(_openSpy.callCount).to.equal(0);

                    return new Promise(function(resolve, reject) {
                        mongoose.unmock(function(err) {
                            return (err ? reject(err) : resolve());
                        });
                    });
                });

                expect(_openSpy.callCount).to.equal(0);

                expect(promise.then).to.be.a('function');
                return promise;
            });
        });


        describe('with a reconnect', function() {
            if (! process.env.MOCKGOOSE_LIVE) {
                return;
            }
            if (! process.env.MOCKGOOSE_REPLSET) {
                return;
            }


            it('reconnects a single call', function(done) {
                async.series([
                    function(next) {
                        connection = new Connection(CONNECTION_BASE);
                        connection.openSet(URI, OPTIONS, next);
                    },
                    function(next) {
                        mongoose.unmockAndReconnect(next);
                    },
                    function(next) {
                        expect(openSetStub.callCount).to.equal(2);
                        // connect
                        expect(openSetStub.args[0].slice(0, 2)).to.deep.equal(USER_URI_OPTIONS);
                        // reconnect
                        expect(openSetStub.args[1].slice(0, 2)).to.deep.equal(USER_URI_OPTIONS);

                        expect(_openSpy.callCount).to.equal(2);

                        next();
                    },
                ], done);
            });
        });
    });
});
