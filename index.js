var api = require('./lib/redis-api');
var model = require('./lib/redis-model');

module.exports = ORM = function(config){
	return {
		API: new api(config),
		Model: model
	};
};