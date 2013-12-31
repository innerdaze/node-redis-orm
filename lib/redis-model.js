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
	this.resourceType = config.resourceType || null;
	this.sets = config.sets || [];
	this.indexes = config.indexes || [];
	this.required = config.required || [];
	this.primary = config.primary || 'id';
	this.model = config.model || {};
};

Model.prototype.init = function(config) {

	var resourceType = this.resourceType;

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
	env.response.body = this.client.getResourcesInSet(this.resourceType + 's', function(err, replies){
		respond.sendEntityFoundResponse(replies, env, next);
	});
};

Model.prototype.create = function(env, next) {

	var self = this;

	env.request.getBody(function(err, body) {
		if (err || !body) {
			respond.sendBodyErrorResponse(err, env, next);
		}

		var obj = JSON.parse(body.toString()), validation, key, field;

		/*
		 * Validate the object based on validation objects containing a boolean function and a message in case of a validation error
		 * e.g model.validations.myProperty = {
		 * 	fn: function(value){
		 * 		return !!value;
		 * 	},
		 * 	err: 'Value was not truth';
		 * }
		 */
		if (self.validations){
			for (key in self.validations){
				validation = self.validations[key];
				if (obj[key]){
					if (validation.fn(obj[key]) != true) {
						respond.sendBodyErrorResponse(validation.err);
					}
				}
			}
		}

		/*
		 * Allow the model to provide a function as the model value for a key to auto-populate fields
		 * Function accepts the current value for the field as it's argument
		 * e.g model.generatedProperty = function(base){
		 * 	return base + '-extra-bit';
		 * }
		 */
		if (self.model){
			for(key in self.model){
				field = self.model[key];
				if(typeof field == 'function'){
					obj[key] = field(obj[key]||null);
				}
			}
		}

		if(typeof self.beforeCreateResource === 'function'){
			self.beforeCreateResource(obj, createInternal);
		} else {
			createInternal(obj, env, next);
		}
	});
};

function createInternal(obj, env, next){
	self.client.createResource(obj, self, function(err, customer){
		if(err){
			respond.sendBodyErrorResponse(err, env, next);
		} else {
			console.log('Created ' + self.resourceType);
			respond.sendCreateEntityResponse(customer, env, next);
		}
	});
};

Model.prototype.show = function(env, next) {
	var uuid = env.route.params.id;

	if(!uuid){
		respond.sendBodyErrorResponse('Missing id', env, next);
	}

	this.client.getResource(uuid, this, function(err, customer){
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

		self.client.updateResource(obj, self, function(err, customer){
			console.log('Created ' + self.resourceType);
			respond.sendUpdateEntityResponse(customer, env, next);
		});

	});
};

Model.prototype.remove = function(env, next) {
	var uuid = env.route.params.id;

	this.client.deleteResource(uuid, this, function(err, deletedCount){
		console.log('Deleting ' + self.resourceType);
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
	model: {},
	validations: []
});