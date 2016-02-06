'use strict';

var assert = require('assert');
var expect = require('chai').expect;
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
var HOST = '127.0.0.1'; // because MOCKGOOSE_LIVE
var DB = 'DB';
var DB2 = 'DB2';
var PORT = 27017;
var MOCK_OPTIONS = {
    port: 27027
};
var HOST_DB_PORT = [ HOST, DB, PORT ];
var HOST_DB2_PORT = [ HOST, DB2, PORT ];
var MOCK_DB_PORT = [ 'localhost', DB, MOCK_OPTIONS.port ];
var MOCK_DB2_PORT = [ 'localhost', DB2, MOCK_OPTIONS.port ];


describe('mockgoose', function() {
    beforeEach(function() {
console.log('---')
        mongoose = new Mongoose();
    });

    afterEach(function(done) {
        sandbox.restore();

        // safety in the face of assertion failure
        mongoose.unmock(function() {
            // patiently wait for mongod to shut down
            //   or else we can't guarantee :27017 across tests
            setTimeout(done, 200);
        });
    });


    describe.only('reset', function() {
        var Collection = mongooseLib.Collection;
        var collections;
        var connection;

        beforeEach(function() {
            mockgoose(mongoose);

            collections = [];
            sandbox.spy(Collection.prototype, 'deleteMany');
        });


        // it('exists on `mongoose`', function() {
        //     expect(mongoose.reset).to.be.instanceof(Function);
        // });

        it('works without any Connections', function(done) {
            async.series([
                function(next) {
                    mockgoose.reset(next);
                },
                function(next) {
                    expect(Collection.prototype.deleteMany.called).to.equal(false);

                    next();
                },
            ], done);
        });

        it('works with one Connection', function(done) {
            async.series([
                function(next) {
                    connection = new Connection(CONNECTION_BASE);
                    connection.open(HOST, DB, PORT, next);
                },
                function(next) {
                    collections.push[connection.collection('MOE')];

                    mockgoose.reset(next);
                },
                function(next) {
                    expect(Collection.prototype.deleteMany.callCount).to.equal(1);

                    expect(collections.every(function(collection) {
                        return collection.called;
                    })).to.equal(true);

                    next();
                },
            ], done);
        });

        it('works with more than one Connection', function(done) {
            async.series([
                function(next) {
                    connection = new Connection(CONNECTION_BASE);
                    connection.open(HOST, DB, PORT, next);
                },
                function(next) {
                    collections.push[connection.collection('MOE')];

                    connection = new Connection(CONNECTION_BASE);
                    connection.open(HOST, DB2, PORT, next);
                },
                function(next) {
                    collections.push[connection.collection('JOE')];
                    collections.push[connection.collection('FLO')];

                    mockgoose.reset(next);
                },
                function(next) {
                    expect(Collection.prototype.deleteMany.callCount).to.equal(3);

                    expect(collections.every(function(collection) {
                        return collection.called;
                    })).to.equal(true);

                    next();
                },
            ], done);
        });

        it('does nothing outside of mock-hood', function(done) {
            async.series([
                function(next) {
                    connection = new Connection(CONNECTION_BASE);
                    connection.open(HOST, DB, PORT, next);
                },
                function(next) {
console.log('?')
                    mongoose.unmockAndReconnect(next);
console.log('.')
                },
                function(next) {
console.log('.')
                    collections.push[connection.collection('MOE')];

console.log('.')
                    mockgoose.reset(next);
console.log('.')
                },
                function(next) {
console.log('.')
                    expect(Collection.prototype.deleteMany.callCount).to.equal(0);

console.log('.')
                    next();
                },
            ], function(err) {
                console.log('!', err)
                done(err)
            });
        });
    });
});


describe('mongoose.Connection', function() {
    beforeEach(function() {
        mongoose = new Mongoose();
    });

    afterEach(function(done) {
        sandbox.restore();

        // safety in the face of assertion failure
        mongoose.unmock(function() {
            // patiently wait for mongod to shut down
            //   or else we can't guarantee :27017 across tests
            setTimeout(done, 200);
        });
    });


    describe('#open', function() {
        var connections;
        var openSpy, _openStub;
        var _openState;

        beforeEach(function() {
            connections = [];
            _openState = [];

            // #open (eg. to the mock DB) as usual
            openSpy = sandbox.spy(ConnectionPrototype, 'open');

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
            mockgoose(mongoose, MOCK_OPTIONS);

            expect(mongoose.isMocked).to.equal(true);
            expect(ConnectionPrototype.open).to.not.equal(openSpy);
            expect(ConnectionPrototype._open).to.not.equal(_openStub);
        });


        describe('followed by #unmock', function() {
            it('fakes out a single call', function(done) {
                async.series([
                    function(next) {
                        connections.push(new Connection(CONNECTION_BASE));
                        connections[0].open(HOST, DB, PORT, next);
                    },
                    function(next) {
                        expect(connections.every(function(connection) {
                            return (connection.readyState === mongoose.STATES.connected);
                        })).to.equal(true);

                        mongoose.unmock(next);
                    },
                    function(next) {
                        expect(openSpy.callCount).to.equal(1);
                        expect(openSpy.args[0].slice(0, 3)).to.deep.equal(HOST_DB_PORT);

                        expect(openSpy.callCount).to.equal(1);
                        expect(_openState[0]).to.deep.equal(MOCK_DB_PORT);

                        expect(connections.every(function(connection) {
                            return (connection.readyState === mongoose.STATES.disconnected);
                        })).to.equal(true);

                        next();
                    },
                ], done);
            });

            it('fakes out more than one call', function(done) {
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
                        expect(connections.every(function(connection) {
                            return (connection.readyState === mongoose.STATES.connected);
                        })).to.equal(true);

                        mongoose.unmock(next);
                    },
                    function(next) {
                        expect(openSpy.callCount).to.equal(2);
                        expect(openSpy.args[0].slice(0, 3)).to.deep.equal(HOST_DB_PORT);
                        expect(openSpy.args[1].slice(0, 3)).to.deep.equal(HOST_DB2_PORT);

                        expect(openSpy.callCount).to.equal(2);
                        expect(_openState[0]).to.deep.equal(MOCK_DB_PORT);
                        expect(_openState[1]).to.deep.equal(MOCK_DB2_PORT);

                        expect(connections.every(function(connection) {
                            return (connection.readyState === mongoose.STATES.disconnected);
                        })).to.equal(true);


                        // look!  back to normal
                        expect(mongoose.isMocked).to.equal(undefined);
                        expect(ConnectionPrototype.open).to.equal(openSpy);
                        expect(ConnectionPrototype._open).to.equal(_openStub);

                        next();
                    },
                ], done);
            });
        });


        if ( process.env.MOCKGOOSE_LIVE ) {
            describe('with a reconnect', function() {
                it('reconnects a single call', function(done) {
                    async.series([
                        function(next) {
                            connections.push(new Connection(CONNECTION_BASE));
                            connections[0].open(HOST, DB, PORT, next);
                        },
                        function(next) {
                            expect(connections.every(function(connection) {
                                return (connection.readyState === mongoose.STATES.connected);
                            })).to.equal(true);

                            mongoose.unmockAndReconnect(next);
                        },
                        function(next) {
                            expect(openSpy.callCount).to.equal(2);
                            expect(openSpy.args[0].slice(0, 3)).to.deep.equal(HOST_DB_PORT);
                            // reconnect
                            expect(openSpy.args[1].slice(0, 3)).to.deep.equal(HOST_DB_PORT);

                            expect(openSpy.callCount).to.equal(2);
                            expect(_openState[0]).to.deep.equal(MOCK_DB_PORT);
                            // reconnect
                            expect(_openState[1]).to.deep.equal(HOST_DB_PORT);

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
                            expect(connections.every(function(connection) {
                                return (connection.readyState === mongoose.STATES.connected);
                            })).to.equal(true);

                            mongoose.unmockAndReconnect(next);
                        },
                        function(next) {
                            expect(openSpy.callCount).to.equal(4);
                            expect(openSpy.args[0].slice(0, 3)).to.deep.equal(HOST_DB_PORT);
                            expect(openSpy.args[1].slice(0, 3)).to.deep.equal(HOST_DB2_PORT);
                            // reconnect
                            expect(openSpy.args[2].slice(0, 3)).to.deep.equal(HOST_DB_PORT);
                            expect(openSpy.args[3].slice(0, 3)).to.deep.equal(HOST_DB2_PORT);

                            expect(openSpy.callCount).to.equal(4);
                            expect(_openState[0]).to.deep.equal(MOCK_DB_PORT);
                            expect(_openState[1]).to.deep.equal(MOCK_DB2_PORT);
                            // reconnect
                            expect(_openState[2]).to.deep.equal(HOST_DB_PORT);
                            expect(_openState[3]).to.deep.equal(HOST_DB2_PORT);


                            // look!  back to normal
                            expect(mongoose.isMocked).to.equal(undefined);
                            expect(ConnectionPrototype.open).to.equal(openSpy);
                            expect(ConnectionPrototype._open).to.equal(_openStub);

                            next();
                        },
                    ], done);
                });
            });
        }
    });
});
