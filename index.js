var SPI = require('./lib/redis-management-spi'),
		ResourceModel = require('./lib/redis-resource-model'),
		ORM;

module.exports = ORM = {
	SPI: SPI,
	ResourceModel: ResourceModel
};