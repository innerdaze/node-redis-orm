//var HashApi = require('./lib/redis-hash-spi');
var StringSpi = require('./lib/redis-string-spi');
//var HashResourceModel = require('redis-model');
var ResourceModel = require('./lib/redis-resource-model');

module.exports = ORM = function(config){
	return {
		StringSPI: new StringSpi(config),
		ResourceModel: ResourceModel
	};
};