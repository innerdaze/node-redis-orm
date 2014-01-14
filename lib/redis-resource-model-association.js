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

	create: function(spi, client, localResource, cb){
		var self = this,
				foreignId = localResource[self.localKey];

		client.get(spi._key(self.foreignResource, foreignId), function(err, foreignResource){

			if(err){
				cb('Couldn\'t find resource: ' + foreignId);
			} else {
				foreignResource = JSON.parse(foreignResource);

				self.fn(client, localResource, foreignResource, function(err, result){
					if(err||!result){
						cb(err||'unexpected error creating association');
					} else if(typeof result == 'array'){
						spi.createIndexForKey(client, config, result, localResource, 'id', cb);
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