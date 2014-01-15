//noinspection BadExpressionStatementJS
/**
 * @class
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         27/12/13
 *
 * Enter description of class here using markdown
 */

"use strict";

var co = require('co');
var thunkify = require('thunkify');
var parseBody = require('co-body');


var respond = require('./responses');
var ResourceModelAssociation = require('./redis-resource-model-association.js');
var oo = require('oolib');
var async = require('async');

var ResourceModel = module.exports = oo.createClass({

	spi: null,
	storageFormat: 'string',
	resourceType: null,
	sets: [],
	indexes: [],
	primary: 'id',
	required: [],
	associations: [],
	properties: {},
	validations: [],
	raw: null,

	_create: function(config){
		if(this.required && this.indexes){
			this.required.concat(this.indexes)
		}

		if(!this.required && this.indexes){
			this.required = this.indexes;
		}

		// define Associations
		for(var i =0, ln =this.associations.length; i<ln; i++){
			this.associations[i] = new ResourceModelAssociation(this.associations[i]);
		}
	},

	init: function(config) {

		var resourceType = this.resourceType;

		config
			.path('/' + resourceType)
			.produces('application/json')
			.consumes('application/json')
			.get('/', this.list, { action: resourceType + ':list' })
			.post('/', this.create, { action: resourceType + ':create' })
			.get('/{id}', this.get, { action: resourceType + ':get' })
			.get('/{key}/{value}', this.getBySecondaryIndex, { action: resourceType + ':getBySecondaryIndex' })
			.put('/{id}', this.update, { action: resourceType + ':update' })
			.del('/{id}', this.remove, { action: resourceType + ':remove' });
	},

	getSpi: function(){
		return this.spi;
	},

	setSpi: function(spi){
		return this.spi = spi;
	},

	getStorageFormat: function(){
		return this.storageFormat;
	},

	setStorageFormat: function(storageFormat){
		return this.storageFormat = storageFormat;
	},

	getResourceType: function(){
		return this.resourceType;
	},

	setResourceType: function(resourceType){
		return this.resourceType = resourceType;
	},

	getSets: function(){
		return this.sets;
	},

	setSets: function(sets){
		return this.sets = sets;
	},

	getIndexes: function(){
		return this.sets;
	},

	setIndexes: function(indexes){
		return this.indexes = indexes;
	},

	getPrimary: function(){
		return this.primary;
	},

	setPrimary: function(primary){
		return this.primary = primary;
	},

	getRequired: function(){
		return this.required;
	},

	setRequired: function(required){
		return this.required = required;
	},

	getAssociations: function(){
		return this.associations;
	},

	setAssociations: function(associations){
		return this.associations = associations;
	},

	getProperties: function(){
		return this.properties;
	},

	setProperties: function(properties){
		return this.properties = properties;
	},

	getValidations: function(){
		return this.validations;
	},

	setValidations: function(validations){
		return this.validations = validations;
	},

	list: function(env, next) {
		env.response.body = this.spi.getResourcesInSet(this.resourceType + 's', function(err, replies){
			respond.sendEntityFoundResponse(replies, env, next);
		});
	},

	create: function(env, next) {

		let self = this;

		co(function *(){
			return yield parseBody.json(env.request);
		})(function(err, obj){

			if (err || !obj) {
				respond.sendBodyErrorResponse(err, env, next);
			}

			var key, field;

			/*
			 * Allow the model to provide a function as the model value for a key to auto-populate fields
			 * Function accepts the current value for the field as it's argument
			 * e.g model.generatedProperty = function(base){
			 * 	return base + '-extra-bit';
			 * }
			 */
			if (self.properties){
				for(key in self.properties){
					field = self.properties[key];
					if(field.type && typeof field.type == 'function'){
						obj[key] = field.type.call(self, obj[key]||null);
					}
				}
			}

			co(function *(){
				yield thunkify(self.validate.bind(self))(obj);
			})(function(err, result){
				if(err){
					respond.sendBodyErrorResponse(err, env, next);
				} else {
					self._createInternal(obj, env, next);
				}
			});

		});
	},

	/*
	 * Validate the object based on validation objects containing a boolean function and a message in case of a validation error
	 * e.g model.validations.myProperty = {
	 * 	fn: function(value){
	 * 		return !!value;
	 * 	},
	 * 	err: 'Value was not truth';
	 * }
	 */
	validate: function(resource, cb){

		var field, validations, self = this;

		async.each(Object.keys(resource), function(key, mainCallback){

			if(resource.hasOwnProperty(key)){

				field = self.properties[key];

				if (!field.hasOwnProperty('validations')) {
					mainCallback(null);
				} else {

					validations = field.validations;

					async.each(validations, function (validation, validationCallback) {
						if (validation.hasOwnProperty('fn')) {
							if (!validation.fn(resource[key])) {
								validationCallback(validation.err)
							} else {
								validationCallback();
							}
						}
					}, mainCallback);
				}
			}

		}, function(err){
			if(err){
				cb(err);
			} else {
				cb(null, resource);
			}
		});
	},

	_createInternal: function(resource, env, next){

		var self = this;

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
	},

	get: function(env, next) {
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
	},

	getBySecondaryIndex: function(env, next) {
		var key = env.route.params.key,
			value = env.route.params.value;

		this.spi.getKeyBySecondaryIndex(this.spi.getClient(), this, key, value, function(err, resource){
			if(err || !resource){
				respond.sendEntityNotFoundResponse(undefined, env, next);
			} else {
				respond.sendEntityFoundResponse(resource, env, next);
			}
		});
	},

	update: function(env, next) {
		if(!env.route.params.id){
			respond.sendBodyErrorResponse('Missing id', env, next);
		}

		var self = this;

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
	},

	remove: function(env, next) {
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
								self._deleteResourceCallback(err, self, uuid, env, next);
							});
						}
					});
				}

			});
		} else {
			self.spi.deleteResource(uuid, self,  function(err, deletedCount){
				self._deleteResourceCallback(err, self, uuid, env, next);
			});
		}

	},

	_deleteResourceCallback: function(err, config, uuid, env, next){
		if(err){
			respond.sendBodyErrorResponse(err, env, next);
		} else {
			console.log('Deleting ' + config.resourceType);
			respond.sendDeleteEntityResponse(uuid, env, next);
		}
	}
});