//var HashApi = require('./lib/redis-hash-api');
var StringApi = require('./lib/redis-string-api');
//var HashResourceModel = require('redis-model');
var ResourceModel = require('./lib/redis-resource-model');

module.exports = ORM = function(config){
	return {
		API: new StringApi(config),
		ResourceModel: ResourceModel
	};
};