'use strict';

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


describe('mongoose.Connection', function() {
    beforeEach(function() {
        mongoose = new Mongoose();
    });

    afterEach(function(done) {
        // safety in the face of assertion failure
        mongoose.unmock(function() {
            // AFTER we've put back any spys & stubs
            sandbox.restore();

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
                        expect(openSpy.callCount).to.equal(1);
                        expect(openSpy.args[0].slice(0, 3)).to.deep.equal(HOST_DB_PORT);

                        expect(openSpy.callCount).to.equal(1);
                        expect(_openState[0]).to.deep.equal(MOCK_DB_PORT);

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
                        mongoose.unmock(next);
                    },
                    function(next) {
                        expect(openSpy.callCount).to.equal(2);
                        expect(openSpy.args[0].slice(0, 3)).to.deep.equal(HOST_DB_PORT);
                        expect(openSpy.args[1].slice(0, 3)).to.deep.equal(HOST_DB2_PORT);

                        expect(openSpy.callCount).to.equal(2);
                        expect(_openState[0]).to.deep.equal(MOCK_DB_PORT);
                        expect(_openState[1]).to.deep.equal(MOCK_DB2_PORT);

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

                            next();
                        },
                    ], done);
                });
            });
        }
    });
});
