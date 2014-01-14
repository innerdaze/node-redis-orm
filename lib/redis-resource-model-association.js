/**
 * @class				ResourceModelAssociation
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         09/01/14
 *
 * Enter description of class here using markdown
 */

var oo = require('oolib');

var ResourceModelAssociation = module.exports = oo.createClass({

	_create: function(config){
		if(config.type) this.type = config.type;
		if(config.foreignResource) this.foreignResource = config.foreignResource;
		if(config.localKey) this.localKey = config.localKey;
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

	getFn: function(){
		return this.fn;
	},

	setFn: function(fn){
		return this.fn = fn;
	},

	create: function(spi, client, localResource, cb){
		var self = this,
				foreignId = localResource[self.localKey];

		client.get(spi._key(self.foreignResource, foreignId), function(err, foreignResource){

			if(err||!foreignResource){
				cb('Couldn\'t find resource to associate with: ' + foreignId);
			} else {
				foreignResource = JSON.parse(foreignResource);

				self.fn(client, localResource, foreignResource, function(err, result){
					if(err||!result){
						cb(err||'unexpected error creating association');
					} else if(typeof result == 'array'){
						spi.createSecondaryIndexForKey(client, config, result, localResource, 'id', cb);
					} else if(typeof result == 'boolean'){
						cb(undefined, result);
					}
				});
			}
		});
	},

	remove: function(spi, client, cb){

	}
});