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

module.exports = oo.createClass({

	// TODO: This isn't very clean. Use a merge function.
	_create: function(config){
		if(config.model) this.model = config.model;
		if(config.type) this.type = config.type;
		if(config.foreignResource) this.foreignResource = config.foreignResource;
		if(config.localKey) this.localKey = config.localKey;
		if(config.foreignKey) this.foreignKey = config.localKey;
		if(config.fn) this.fn = thunkify(config.fn);
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

	create: thunkify(function(client, localResource, cb){
		let self = this,
			spi = self.model.spi,
			foreignId = localResource[self.localKey];

		if(!foreignId){
			cb();
		} else {

			co(function *(){

				let foreignResource = yield spi.getResource(spi.getClient(), foreignId, self.foreignResource);

				if (self.fn && typeof self.fn == 'function') {

					if(!foreignResource){
						throw 'Couldn\'t find resource to associate with: ' + foreignId;
					} else {
						foreignResource = foreignResource;
						return yield self.fn(client, localResource, foreignResource);
					}
				} else {
					// produces a key of `prefix:localResourceType:foreignResourceType:foreignResourceKey:foreignResourceValue -> localResourceID
					return yield spi.createSecondaryIndexForKey(client, self.model.resourceType, [
						self.foreignResource,
						self.foreignKey,
						foreignResource[foreignKey]
					], localResource, self.model.primary);
				}
			})(cb);
		}
	}),

	remove: thunkify(function(client, localResource, cb){
		let self = this,
			spi = self.model.spi;

		if(!self.fn){
			co(function *(){
				return yield spi.deleteSecondaryIndexForKey(client, self.model.resourceType, self.localKey, localResource);
			})(cb);
		} else {
			cb(null, true);
		}
	})
});