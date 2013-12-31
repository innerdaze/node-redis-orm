var api = require('./lib/redis-api');
var resource = require('./lib/redis-resource');

module.exports = ORM = function(config){
	return {
		API: new api(config),
		Resource: resource
	};
};