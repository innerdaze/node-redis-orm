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
	 * @cfg {String} foreignSetName.
	 */
	foreignSetName: null,

	/**
	 *
	 * Internal Redis Commands:
	 * smembers	prefix:localResourceType:localResourceId:foreignSetName -> foreignIds
	 * mget	[prefix:foreignResourceType:foreignIds] -> [foreignResources]
	 *
	 * @param client
	 * @param cb
	 */
	get: function(client, cb){
		var self;

		co(function *(){
			return yield self.spi.getResourcesInForeignSet(client, self.foreignSetName);
		})(cb);
	},

	/**
	 *
	 * Internal Redis Commands:
	 * sadd	prefix:localResourceType:foreignSetName foreignId
	 *
	 * @param client
	 * @param resourceId
	 * @param cb
	 */
	set: function(client, resourceId, cb){
		var self;

		co(function *(){
			return yield self.spi.addToSet(client, self.model, self.foreignSetName, resourceId);
		})(cb);
	}
});