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
	oo = require('oolib'),
	ApiError = require('api-error');

module.exports = oo.createClass({

	// TODO: This isn't very clean. Use a merge function.
	_create: function(config){
		if(config.model) {
			this.model = config.model;
			this.spi = this.model.spi;
		}
		if(config.type) this.type = config.type;
		if(config.foreignResourceType) this.foreignResourceType = config.foreignResourceType;
		if(config.localKey) this.localKey = config.localKey;
		if(config.foreignKey) this.foreignKey = config.localKey;
		if(config.fn) this.fn = thunkify(config.fn);
	},

	/**
	 * @cfg {String} [type=default]. The type of association to create - can be one of:
	 */
	type: 'default',
	/**
	 * @cfg {ResourceModel} foreignResourceType. The target resource
	 */
	foreignResourceType: null,
	/**
	 * @cfg {String} key. An array of values to form the key from
	 */
	localKey: null,
	/**
	 * @cfg {String} fn. The key of the target resource to use as the indexer
	 */
	fn: null,
	/**
	 * @prop {String} generatedKey. The result of the create function
	 */
	generatedKey: null,
	/**
	 * @prop {RedisSpi} spi. The Redis SPI
	 */
	spi: null,

	create: thunkify(function(client, localResource, cb){
		let self = this,
			foreignId = localResource[self.localKey];

		if(!foreignId){
			cb();
		} else {

			co(function *(){

				let foreignResource = yield self.spi.getResource(self.spi.getClient(), foreignId, self.foreignResourceType);

				if (self.fn && typeof self.fn == 'function') {

					if(!foreignResource){
						throw new ApiError(404, 'Couldn\'t find resource for association: ' + foreignId);
					} else {
						return yield self.fn(client, localResource, foreignResource);
					}
				} else {
					// produces a key of `prefix:localResourceType:foreignResourceType:foreignResourceKey:foreignResourceValue -> localResourceID
					self.generatedKey = yield self.spi.createSecondaryIndexForKey(client, self.model.resourceType, [
						self.foreignResourceType,
						self.foreignKey,
						foreignResource[self.foreignKey]
					], localResource, self.model.primary);

					return self.generatedKey;
				}
			})(cb);
		}
	}),

	remove: thunkify(function(client, localResource, cb){
		let self = this;

		if(!self.fn){
			co(function *(){
				return yield self.spi.deleteSecondaryIndexForKey(client, self.model.resourceType, self.localKey, localResource);
			})(cb);
		} else {
			cb(null, true);
		}
	})
});