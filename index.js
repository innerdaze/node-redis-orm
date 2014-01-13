//var HashApi = require('./lib/redis-hash-spi');
var StringSPI = require('./lib/redis-string-spi'),
		ResourceModel = require('./lib/redis-resource-model'),
		ORM;

module.exports = ORM = {
	StringSPI: StringSPI,
	ResourceModel: ResourceModel
};