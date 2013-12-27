/**
 * @class
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         27/12/13
 *
 * Enter description of class here using markdown
 */

var Model = function(config){};

Model.prototype.storageConfig = {
	resourceType: null,
	sets: [],
	indexes: [],
	primary: 'id',
	required: [],
	model: {}
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
	env.response.body =  redis.getResourcesInSet(this.storageConfig.resourceType + 's', function(err, replies){
		argoHelper.sendEntityFoundResponse(replies, env, next);
	});
};

Model.prototype.create = function(env, next) {

	var self = this;

	env.request.getBody(function(err, body) {
		if (err || !body) {
			argoHelper.sendBodyErrorResponse(err, env, next);
		}

		var obj = JSON.parse(body.toString());

		redis.createResource(obj, self.storageConfig, function(err, customer){
			if(err){
				argoHelper.sendBodyErrorResponse(err, env, next);
			} else {
				console.log('Created ' + this.storageConfig.resourceType);
				argoHelper.sendCreateEntityResponse(customer, env, next);
			}
		});
	});
};

Model.prototype.show = function(env, next) {
	var uuid = env.route.params.id;

	if(!uuid){
		argoHelper.sendBodyErrorResponse('Missing id', env, next);
	}

	redis.getResource(uuid, this.storageConfig, function(err, customer){
		if(err || !customer){
			argoHelper.sendEntityNotFoundResponse(undefined, env, next);
		} else {
			argoHelper.sendEntityFoundResponse(customer, env, next);
		}
	});
};

Model.prototype.update = function(env, next) {
	if(!env.route.params.id){
		argoHelper.sendBodyErrorResponse('Missing id', env, next);
	}

	env.request.getBody(function(err, body) {
		if (err || !body) {
			argoHelper.sendBodyErrorResponse(err, env, next);
		}

		var obj = JSON.parse(body.toString());

		redis.updateResource(obj, this.storageConfig, function(err, customer){
			console.log('Created ' + this.storageConfig.resourceType);
			argoHelper.sendUpdateEntityResponse(customer, env, next);
		});

	});
};

Model.prototype.remove = function(env, next) {
	var uuid = env.route.params.id;

	redis.deleteResource(uuid, this.storageConfig, function(err, deletedCount){
		console.log('Deleting ' + this.storageConfig.resourceType);
		argoHelper.sendDeleteEntityResponse(uuid, env, next);
	});
};