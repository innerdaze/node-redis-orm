/**
 * @class
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         27/12/13
 *
 * Enter description of class here using markdown
 */
var respond = require('./responses');

var Model = function(config){
	this.client = config.client;
	this.storageConfig.resourceType = config.resourceType || null;
	this.storageConfig.sets = config.sets || [];
	this.storageConfig.indexes = config.indexes || [];
	this.storageConfig.required = config.required || [];
	this.storageConfig.primary = config.primary || 'id';
	this.storageConfig.model = config.model || {};
};

Model.prototype.init = function(config) {

	var resourceType = this.storageConfig.resourceType;

	config
		.path('/' + resourceType)
		.produces('application/json')
		.consumes('application/json')
		.get('/', this.list, { action: resourceType + ':list' })
		.post('/', this.create, { action: resourceType + ':create' })
		.get('/{id}', this.show, { action: resourceType + ':show' })
		.get('/{id}/', this.show, { action: resourceType + ':show' })
		.put('/{id}', this.update, { action: resourceType + ':update' })
		.del('/{id}', this.remove, { action: resourceType + ':remove' });
};

Model.prototype.list = function(env, next) {
	env.response.body = this.client.getResourcesInSet(this.storageConfig.resourceType + 's', function(err, replies){
		respond.sendEntityFoundResponse(replies, env, next);
	});
};

Model.prototype.create = function(env, next) {

	var self = this;

	env.request.getBody(function(err, body) {
		if (err || !body) {
			respond.sendBodyErrorResponse(err, env, next);
		}

		var obj = JSON.parse(body.toString());

		this.client.createResource(obj, self.storageConfig, function(err, customer){
			if(err){
				respond.sendBodyErrorResponse(err, env, next);
			} else {
				console.log('Created ' + self.storageConfig.resourceType);
				respond.sendCreateEntityResponse(customer, env, next);
			}
		});
	});
};

Model.prototype.show = function(env, next) {
	var uuid = env.route.params.id;

	if(!uuid){
		respond.sendBodyErrorResponse('Missing id', env, next);
	}

	this.client.getResource(uuid, this.storageConfig, function(err, customer){
		if(err || !customer){
			respond.sendEntityNotFoundResponse(undefined, env, next);
		} else {
			respond.sendEntityFoundResponse(customer, env, next);
		}
	});
};

Model.prototype.update = function(env, next) {
	if(!env.route.params.id){
		respond.sendBodyErrorResponse('Missing id', env, next);
	}

	env.request.getBody(function(err, body) {
		if (err || !body) {
			respond.sendBodyErrorResponse(err, env, next);
		}

		var obj = JSON.parse(body.toString());

		this.client.updateResource(obj, self.storageConfig, function(err, customer){
			console.log('Created ' + self.storageConfig.resourceType);
			respond.sendUpdateEntityResponse(customer, env, next);
		});

	});
};

Model.prototype.remove = function(env, next) {
	var uuid = env.route.params.id;

	this.client.deleteResource(uuid, this.storageConfig, function(err, deletedCount){
		console.log('Deleting ' + self.storageConfig.resourceType);
		respond.sendDeleteEntityResponse(uuid, env, next);
	});
};

module.exports = Model;
Model.__proto__ = new Model({
	client: null,
	resourceType: null,
	sets: [],
	indexes: [],
	primary: 'id',
	required: [],
	model: {}
});