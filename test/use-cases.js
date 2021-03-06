'use strict';

var expect = require('chai').expect;
var async = require('async');

var Mongoose = require('mongoose').Mongoose;
var mockgoose = require('../Mockgoose');

var mongoose;
var Cat;

// localhost:27017 is likely to conflict with `process.env.MOCKGOOSE_LIVE`
//   which makes for an excellent Test Scenario
var HOST = 'localhost';
var PORT = 27017;
var DB = 'DB';

// FIXME: patiently wait for mongod to shut down
var FIXME_INTER_TEST_DELAY = 1000;


describe('mockgoose', function() {
    beforeEach(function() {
        mongoose = new Mongoose();

        mockgoose(mongoose);
    });

    afterEach(function(done) {
        // safety in the face of assertion failure
        mongoose.unmock(function() {
            setTimeout(done, FIXME_INTER_TEST_DELAY);
        });
    });


    describe('reset', function() {
        describe('after Mongoose#connect', function() {
            it('resets a Collection', function(done) {
                var cat;

                async.waterfall([
                    function(next) {
                        mongoose.connect(HOST, DB, PORT, next);
                    },
                    function(next) {
                        Cat = mongoose.model('Cat', { name: String });

                        Cat.create({ name: 'Disco' }, next);
                    },
                    function(_cat, next) {
                        cat = _cat;

                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        expect(_cat.name).to.equal('Disco'); // good girl!

                        mockgoose.reset(next);
                    },
                    function(next) {
                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        // kitty was reset
                        expect(_cat).to.equal(null);

                        next();
                    },
                ], done);
            });
        });

        describe('after Mongoose#createConnection + Connection#open', function() {
            it('resets a Collection', function(done) {
                var connection;
                var cat;

                async.waterfall([
                    function(next) {
                        connection = mongoose.createConnection();
                        connection.open(HOST, DB, PORT, next);
                    },
                    function(next) {
                        Cat = connection.model('Cat', { name: String });

                        cat = (new Cat({ name: 'Warhol' }));
                        cat.save(next);
                    },
                    function(_cat, status, next) {
                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        expect(_cat.name).to.equal('Warhol'); // good boy!

                        mockgoose.reset(next);
                    },
                    function(next) {
                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        // kitty was reset
                        expect(_cat).to.equal(null);

                        next();
                    },
                ], done);
            });
        });
    });


    describe('unmock + re-mock', function() {
        describe('after Mongoose#connect', function() {
            it('gets a fresh empty database', function(done) {
                var cat;

                async.waterfall([
                    function(next) {
                        mongoose.connect(HOST, DB, PORT, next);
                    },
                    function(next) {
                        Cat = mongoose.model('Cat', { name: String });

                        Cat.create({ name: 'Disco' }, next);
                    },
                    function(_cat, next) {
                        cat = _cat;

                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        expect(_cat.name).to.equal('Disco'); // good girl!

                        mongoose.unmock(next);
                    },
                    function(next) {
                        mockgoose(mongoose);

                        mongoose.connect(HOST, DB, PORT, next);
                    },
                    function(next) {
                        // // "Cannot overwrite `Cat` model once compiled."
                        // Cat = mongoose.model('Cat', { name: String });

                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        // kitty was left in the prior mock database
                        expect(_cat).to.equal(null);

                        next();
                    },
                ], done);
            });
        });

        describe('after Mongoose#createConnection + Connection#open', function() {
            it('gets a fresh empty database', function(done) {
                var connection;
                var cat;

                async.waterfall([
                    function(next) {
                        connection = mongoose.createConnection();
                        connection.open(HOST, DB, PORT, next);
                    },
                    function(next) {
                        Cat = connection.model('Cat', { name: String });

                        cat = (new Cat({ name: 'Warhol' }));
                        cat.save(next);
                    },
                    function(_cat, status, next) {
                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        expect(_cat.name).to.equal('Warhol'); // good boy!

                        mongoose.unmock(next);
                    },
                    function(next) {
                        mockgoose(mongoose);

                        connection = mongoose.createConnection();
                        connection.open(HOST, DB, PORT, next);
                    },
                    function(next) {
                        Cat = connection.model('Cat', { name: String });

                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        // kitty was left in the prior mock database
                        expect(_cat).to.equal(null);

                        next();
                    },
                ], done);
            });
        });
    });


    describe('unmockAndReconnect', function() {
        if (! process.env.MOCKGOOSE_LIVE) {
            return;
        }


        describe('after Mongoose#connect', function() {
            it('finds nothing in the "real" database', function(done) {
                var cat;

                async.waterfall([
                    function(next) {
                        mongoose.connect(HOST, DB, PORT, next);
                    },
                    function(next) {
                        Cat = mongoose.model('Cat', { name: String });

                        Cat.create({ name: 'Disco' }, next);
                    },
                    function(_cat, next) {
                        cat = _cat;

                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        expect(_cat.name).to.equal('Disco'); // good girl!

                        mongoose.unmockAndReconnect(next);
                    },
                    function(next) {
                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        // kitty was never saved to the "real" database
                        expect(_cat).to.equal(null);

                        next();
                    },
                ], done);
            });
        });

        describe('after Mongoose#createConnection + Connection#open', function() {
            it('finds nothing in the "real" database', function(done) {
                var connection;
                var cat;

                async.waterfall([
                    function(next) {
                        connection = mongoose.createConnection();
                        connection.open(HOST, DB, PORT, next);
                    },
                    function(next) {
                        Cat = connection.model('Cat', { name: String });

                        cat = (new Cat({ name: 'Warhol' }));
                        cat.save(next);
                    },
                    function(_cat, status, next) {
                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        expect(_cat.name).to.equal('Warhol'); // good boy!

                        mongoose.unmockAndReconnect(next);
                    },
                    function(next) {
                        Cat.findById(cat._id, next);
                    },
                    function(_cat, next) {
                        // kitty was never saved to the "real" database
                        expect(_cat).to.equal(null);

                        next();
                    },
                ], done);
            });
        });
    });
});
