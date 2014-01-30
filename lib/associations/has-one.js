/**
 * @class
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         30/01/14
 *
 * Enter description of class here using markdown
 */

"use strict";

let co = require('co'),
	thunkify = require('thunkify'),
	oo = require('oolib'),
	Association = require('../redis-resource-model-association');


module.exports = oo.createClass(Association, {

	/**
	 * @cfg {String} foreignResourceKey
	 */
	foreignResourceKey: null,

	_create: function(config){
		this.foreignResourceKey = config.foreignResourceKey == 'id' ? null : config.foreignResourceKey
	},

	/**
	 *
	 * Redis Internal Commands:
	 * hget	prefix:localResourceType:localResourceId:foreignResourceType -> foreignResourceId
	 * get	prefix:foreignResourceType:foreignId -> foreignResourceType
	 *
	 *
	 * @param client
	 * @param cb
	 */
	get: function(client, cb){
		var self;

		co(function *(){
			return yield self.spi.getKeyBySecondaryIndex()
		})(cb);
	},

	/**
	 *
	 * Redis Internal Commands:
	 *
	 * hget	prefix:localResourceType:foreignResourceType foreignId -> localResourceId
	 * or
	 * hget	prefix:localResourceType:foreignResourceType:foreignResourceKey foreignResourceValue -> localResourceId
	 * then
	 * get prefix:localResourceType:localId -> localResource
	 *
	 * @param client
	 * @param foreignResourceValue
	 * @param cb
	 */
	findBy: function(client, foreignResourceValue, cb){
		var self;

		co(function *(){

			let index;

			if(self.foreignResourceKey){
				index = [self.foreignResourceType, self.foreignResourceKey];
			} else {
				index = self.foreignResourceKey;
			}

			return yield self.spi.getKeyBySecondaryIndex(client, self.model, index, foreignResourceValue)
		})(cb);
	},

	/**
	 *
	 *
	 * Redis Internal Commands:
	 *
	 * hset	prefix:localResourceType:foreignResourceType foreignId localResourceId
	 * or
	 * hset	prefix:localResourceType:foreignResourceType:foreignResourceKey foreignResourceValue localResourceId
	 * then
	 * get prefix:localResourceType:localResourceId -> localResource
	 *
	 * @param client
	 * @param resource
	 * @param cb
	 */
	set: function(client, resource, cb){
		let self;

		co(function *(){
			let index;

			if(self.foreignResourceKey){
				index = [self.foreignResourceType, self.foreignResourceKey];
			} else {
				index = self.foreignResourceKey;
			}

			return yield self.spi.createSecondaryIndexForKey(client, self.model.resourceType, index || [], resource, 'id');
		})(cb);
	}


});