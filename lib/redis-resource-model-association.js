/**
 * @class				ResourceModelAssociation
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         09/01/14
 *
 * Enter description of class here using markdown
 */

"use strict";

let co = require('co'),
		thunkify = require('thunkify'),
		oo = require('oolib');

let ResourceModelAssociation = module.exports = oo.createClass({

	// TODO: This isn't very clean. Use a merge function.
	_create: function(config){
		if(config.model) this.model = config.model;
		if(config.type) this.type = config.type;
		if(config.foreignResource) this.foreignResource = config.foreignResource;
		if(config.localKey) this.localKey = config.localKey;
		if(config.foreignKey) this.foreignKey = config.localKey;
		if(config.fn) this.fn = config.fn;
	},

	/**
	 * @cfg {String} [type=default]. The type of association to create - can be one of:
	 */
	type: 'default',
	/**
	 * @cfg {ResourceModel} foreignResource. The target resource
	 */
	foreignResource: null,
	/**
	 * @cfg {String} key. An array of values to form the key from
	 */
	localKey: null,
	/**
	 * @cfg {String} fn. The key of the target resource to use as the indexer
	 */
	fn: null,

	getType: function(){
		return this.type;
	},

	setType: function(type){
		return this.type = type;
	},

	getForeignResource: function(){
		return this.foreignResource;
	},

	setForeignResource: function(foreignResource){
		return this.foreignResource = foreignResource;
	},

	setLocalKey: function(localKey){
		return this.localKey = localKey;
	},

	getLocalKey: function(){
		return this.localKey;
	},

	setForeignKey: function(foreignKey){
		return this.foreignKey = foreignKey;
	},

	getForeignKey: function(){
		return this.foreignKey;
	},

	getFn: function(){
		return this.fn;
	},

	setFn: function(fn){
		return this.fn = fn;
	},

	create: function(spi, client, localResource, cb){
		let self = this,
				foreignId = localResource[self.localKey];

		co(function *(){
			let foreignResource = yield client.get(spi._key(self.foreignResource, foreignId));

			if(!foreignResource){
				throw 'Couldn\'t find resource to associate with: ' + foreignId;
			} else {

				foreignResource = JSON.parse(foreignResource);

				if (self.fn && typeof self.fn == 'function') {
					yield thunkify(self.fn)(client, localResource, foreignResource);
				} else {
					yield spi.callRedisCo(client, 'hset', [
						spi._key(self.foreignKey, self.localKey),
						foreignResource[self.foreignKey],
						localResource[self.localKey]
					]);
				}

				return self;
			}
		})(cb);
	},

	remove: function(spi, client, cb){

	}
});