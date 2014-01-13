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
var ResourceModelAssociation = require('./redis-resource-model-association.js');

function ResourceModel(config){
	for(var key in config){
		if(config.hasOwnProperty(key)){
			this[key] = config[key];
		}
	}

	// Create Associations
	for(var i =0, ln =this.associations.length; i<ln; i++){
		this.associations[i] = new ResourceModelAssociation(this.associations[i]);
	}
}

// Set defaults
ResourceModel.prototype = new ResourceModel({
	spi: null,
	storageFormat: 'string',
	resourceType: null,
	sets: [],
	indexes: [],
	primary: 'id',
	required: [],
	associations: [],
	model: {},
	validations: [],
	afterCreateResource: null,
	beforeDeleteResource: null
});

ResourceModel.prototype.init = function(config) {

	var resourceType = this.resourceType;

	config
		.path('/' + resourceType)
		.produces('application/json')
		.consumes('application/json')
		.get('/', this.list, { action: resourceType + ':list' })
		.post('/', this.create, { action: resourceType + ':create' })
		.get('/{id}', this.get, { action: resourceType + ':get' })
		.get('/{key}/{value}', this.getByIndex, { action: resourceType + ':getByIndex' })
		.put('/{id}', this.update, { action: resourceType + ':update' })
		.del('/{id}', this.remove, { action: resourceType + ':remove' });
};

ResourceModel.prototype.list = function(env, next) {
	env.response.body = this.spi.getResourcesInSet(this.resourceType + 's', function(err, replies){
		respond.sendEntityFoundResponse(replies, env, next);
	});
};

ResourceModel.prototype.create = function(env, next) {

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

		createInternal(self, obj, env, next);

	});
};

function createInternal(self, resource, env, next){

	self.spi.createResource(resource, self, function(err, resource){
		if(err){
			respond.sendBodyErrorResponse(err, env, next);
		} else {

			console.log('Created ' + self.resourceType);

			if(self.afterCreateResource && typeof self.afterCreateResource === 'function'){
				self.afterCreateResource(self.spi.getClient(), resource, function(err, resource){
					if(err){
						respond.sendBodyErrorResponse(err, env, next);
					} else {
						respond.sendCreateEntityResponse(resource, env, next);
					}
				});
			} else {
				respond.sendCreateEntityResponse(resource, env, next);
			}
		}
	});
}

ResourceModel.prototype.get = function(env, next) {
	var uuid = env.route.params.id;

	if(!uuid){
		respond.sendBodyErrorResponse('Missing id', env, next);
	}

	this.spi.getResource(uuid, this, function(err, resource){
		if(err || !resource){
			respond.sendEntityNotFoundResponse(undefined, env, next);
		} else {
			respond.sendEntityFoundResponse(resource, env, next);
		}
	});
};

ResourceModel.prototype.getByIndex = function(env, next) {
	var key = env.route.params.key,
		value = env.route.params.value;

	this.spi.getResourceByIndex(this, key, value, function(err, resource){
		if(err || !resource){
			respond.sendEntityNotFoundResponse(undefined, env, next);
		} else {
			respond.sendEntityFoundResponse(resource, env, next);
		}
	});
};

ResourceModel.prototype.update = function(env, next) {
	if(!env.route.params.id){
		respond.sendBodyErrorResponse('Missing id', env, next);
	}

	env.request.getBody(function(err, body) {
		if (err || !body) {
			respond.sendBodyErrorResponse(err, env, next);
		}

		var obj = JSON.parse(body.toString());

		self.spi.updateResource(obj, self, function(err, resource){
			console.log('Created ' + self.resourceType);
			respond.sendUpdateEntityResponse(resource, env, next);
		});

	});
};

ResourceModel.prototype.remove = function(env, next) {
	var uuid = env.route.params.id, self = this;

	if(self.beforeDeleteResource && typeof self.beforeDeleteResource === 'function'){

		self.spi.getResource(uuid, self, function(err, resource){

			if(err){
				respond.sendEntityNotFoundResponse('Could not find resource to delete: ' + uuid, env, next);
			} else {

				self.beforeDeleteResource(self.spi.getClient(), resource, function(err, resource){
					if(err){
						respond.sendBodyErrorResponse(err, env, next);
					} else {
						self.spi.deleteResource(uuid, self, function(err, deletedCount){
							deleteResourceCallback(err, self, uuid, env, next);
						});
					}
				});
			}

		});
	} else {
		self.spi.deleteResource(uuid, self,  function(err, deletedCount){
			deleteResourceCallback(err, self, uuid, env, next);
		});
	}

};

function deleteResourceCallback(err, config, uuid, env, next){
	if(err){
		respond.sendBodyErrorResponse(err, env, next);
	} else {
		console.log('Deleting ' + config.resourceType);
		respond.sendDeleteEntityResponse(uuid, env, next);
	}
}

module.exports = ResourceModel;