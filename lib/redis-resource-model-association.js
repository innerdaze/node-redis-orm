/**
 * @class				ResourceModelAssociation
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         09/01/14
 *
 * Enter description of class here using markdown
 */


function ResourceModelAssociation(config){
	for(var key in config){
		if(config.hasOwnProperty(key)){
			this[key] = config[key];
		}
	}
}

// Set defaults
ResourceModelAssociation.prototype = new ResourceModelAssociation({
	/**
	 * @cfg {String} [type=default]. The type of association to create - can be one of:
	 */
	type: 'default',
	/**
	 * @cfg {Resource} foreignResource. The target resource
	 */
	foreignResource: null,
	/**
	 * @cfg {String} key. An array of values to form the key from
	 */
	localKey: null,
	/**
	 * @cfg {String} fn. The key of the target resource to use as the indexer
	 */
	fn: null
});

ResourceModelAssociation.prototype.create = function(api, client, config, localResource, cb){
	var self = this,
			foreignId = localResource[self.localKey];

	client.get(_key(self.foreignResource, foreignId), function(err, foreignResource){
		if(err){
			cb('Couldn\'t find resource: ' + foreignId);
		} else {
			foreignResource = JSON.parse(foreignResource);
			self.fn(client, localResource, foreignResource, function(err, result){
				if(err||!result){
					cb(err||'unexpected error creating association');
				} else if(typeof result == 'array'){
					api.createIndexForKey(client, config, result, localResource, 'id', cb);
				} else if(typeof result == 'boolean'){
					cb(undefined, result);
				}
			});
		}
	});
};