var should = require('chai').should();
var expect = require('chai').expect;

var Mongoose = require('mongoose').Mongoose;
var mongoose = new Mongoose();

var mockgoose = require('../Mockgoose');

var Cat = mongoose.model('Cat', { name: String });


function _connect(done) {
    mockgoose(mongoose);

    mongoose.connect('mongodb://127.0.0.1:27017/TestingDB', function(err) {
        done && done(err);
        done = undefined;
    });
}

describe('User functions', function() {
    before(function(done) {
        _connect(done);
    });
    after(function(done) {
        mongoose.unmock(done);
    });

    it("isMocked", function(done) {
		expect(mongoose.isMocked).to.be.true;
		done();
    });
	it("should create a cat foo", function(done) {
		Cat.create({name: "foo"}, function(err, cat) {
			expect(err).to.be.falsy;
            done(err);
		});
    });

    it("should find cat foo", function(done) {
    	Cat.findOne({name: "foo"}, function(err, cat) {
			expect(err).to.be.falsy;
    		done(err);
    	});
    });

    it("should remove cat foo", function(done) {
    	Cat.remove({name: "foo"}, function(err, cat) {
			expect(err).to.be.falsy;
    		done(err);
    	});
    });

    it("reset", function(done) {
    	mockgoose.reset(function() {
    		done();
    	});
    });
});


describe('unmock', function() {
    before(function(done) {
        _connect(done);
    });

    it("un-mocks", function(done) {
        mongoose.unmock(function(err) {
            expect(mongoose.isMocked).to.be.undefined;
            expect(err).to.be.falsy;
            done(err);
        });
    });
})


if ( process.env.MOCKGOOSE_LIVE ) {
    describe('unmockAndReconnect', function() {
        before(function(done) {
            _connect(done);
        });

        it("un-mocks", function(done) {
            mongoose.unmockAndReconnect(function(err) {
                expect(mongoose.isMocked).to.be.undefined;
                expect(err).to.be.falsy;
                done(err);
            });
        });
    })
}
