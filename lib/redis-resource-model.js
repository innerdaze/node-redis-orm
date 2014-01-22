//noinspection BadExpressionStatementJS
/**
 * @class				ResourceModel
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         27/12/13
 *
 * Enter description of class here using markdown
 */

"use strict";

let co 											= require('co'),
		parseBody 							= require('co-body'),
		thunkify 								= require('thunkify'),
		respond 								= require('./responses'),
		oo 											= require('oolib'),
		async 									= require('async'),
		parallel 								= require("co-parallel"),
		events  								= require('events').EventEmitter,
		ResourceModelAssociation = require('./redis-resource-model-association.js');


module.exports = oo.createClass(events, {

	// TODO: implement access levels, secure fields, non-mutable etc.

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
		for(let i =0, ln =this.associations.length, item; i<ln; i++){

			item = this.associations[i];

			item.model = this;

			item = new ResourceModelAssociation(item);
		}
	},

	init: function(config) {

		let resourceType = this.resourceType;

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
		let self = this;

		co(function *(){
			return yield thunkify(self.spi.getResourcesInSet).call(self.spi, self.spi.getClient(), self.resourceType + 's');
		})(function(err, result){
			respond.sendEntityFoundResponse(result, env, next);
		});
	},

	// TODO: Secure client (Not sure what this refers to anymore. Must be more verbose in future.)
	create: function(env, next) {

		let self = this,
				client = self.spi.getClient(),
				multi = client.multi();

		co(function *(){

			let resource, resourceId;

			resource = yield parseBody.json(env.request);

			// Run field converters
			// TODO: Make this an optional step at this level
			resource = yield thunkify(self.generateFields).call(self, resource);

			if(self.required){
				yield thunkify(self._checkRequired).call(self, client, resource);
			}

			// Validate
			yield thunkify(self.validate).call(self, resource);

			// Create resource
			// TODO: figure out how resourceId is getting about despite me not doing anything with it.
			resourceId = yield thunkify(self.spi.createResource).call(self, multi, resource, self);

			// Create indexes
			if(self.indexes && self.indexes.length){
				yield thunkify(self._checkIndexes).call(self, client, resource);
				yield thunkify(self._createIndexes).call(self, multi, resource);
			}

			// Create Associations
			if (self.associations && self.associations.length){
				resource = yield thunkify(self._createAssociations).call(self, multi, resource);
			}

			// Add to Sets Associations
			if (self.sets && self.sets.length){
				resource = yield thunkify(self._addToSets).call(self, multi, resource);
			}

			console.log('Created ' + self.resourceType);

			// Post process
			if(self.afterCreateResource && typeof self.afterCreateResource === 'function'){
				resource = yield thunkify(self.afterCreateResource).call(self, multi, resource);
			}

			return yield thunkify(self.spi.executeMultipleOperations)(multi, resource);
		})(function(err, result){
			if (err || !result) {

				// TODO: Write a more pro error piping solution

				if(err.statusCode && err.statusCode == 404){
					respond.sendEntityNotFoundResponse(err.message, env, next);
				}
				respond.sendBodyErrorResponse(err, env, next);
			} else {
				respond.sendCreateEntityResponse(result, env, next);
			}
		});
	},

	/**
	 *
	 * @param client
	 * @param resource
	 * @param cb
	 * @private
	 */
	_addToSets: function(client, resource, cb){
		let self = this;

		co(function *(){
			yield parallel(self.sets.map(function *(item){
				return self.spi.addToSet.call(self.spi, client, self, item, resource[self.primary]);
			}));

			return resource;
		})(cb);
	},

	/**
	 *
	 * @param client
	 * @param resource
	 * @param cb
	 * @private
	 */
	_createIndexes: function(client, resource, cb){
		let self = this;

		co(function *(){
			yield parallel(self.indexes.map(function *(index){
				return yield thunkify(self.spi.createSecondaryIndexForKey).call(self, client, self.resourceType, index, resource, self.primary);
			}));

			return resource;
		})(cb);
	},

	/**
	 *
	 * @param client
	 * @param resource
	 * @param cb
	 * @private
	 */
	_checkIndexes: function(client, resource, cb){
		let self = this;

		co(function *(){
			return yield parallel(self.indexes.map(function *(index){
				return yield thunkify(self.spi.indexExists)(client, self.resourceType, index, resource[index]);
			}));
		})(cb);
	},

	/**
	 *
	 * @param client
	 * @param config
	 * @param resource
	 * @param cb
	 * @private
	 */
	_checkRequired: function(client, resource, cb){
		// TODO: Fix - will error if (config.required === '*' && !config.properties)
		let required = this.required === '*' ? Object.keys(this.properties) : this.required;

		co(function *(){
			yield parallel(required.map(function *(key){
				if(!resource.hasOwnProperty(key)){
					throw 'Missing required key [' + key + ']';
				}
				return true;
			}));

			return resource;
		})(cb);
	},

	/*
	 * Create any specified associations
	 * an association callback can return as it's first argument:
	 * 	 an error string, or
	 * 	 undefined (no error)
	 * the second argument can be either
	 * 	 an array of key parts for an external association, or
	 * 	 true (assumes any relevant processing occurred within the association function)
	 */
	_createAssociations: function(client, resource, cb){
		let self = this;

		co(function *(){
			yield parallel(self.associations.map(function *(association){
				let foreignId = resource[association.localKey];

				if(!foreignId){
					throw 'No localKey exists on resource';
				}

				if(typeof association.fn == 'function') {
					let foreignResource = yield thunkify(self.spi.getResource).call(self.spi, self.spi.getClient(), foreignId, association.foreignResource);
					return yield thunkify(association.fn)(client, resource, foreignResource);
				} else {
					return yield thunkify(self.spi.createSecondaryIndexForKey).call(self.spi, client, self.resourceType, association.localKey, resource, self.primary);
				}
			}));

			return resource;
		})(cb);
	},

	/*
	 * Allow the model to provide a function as the model value for a key to auto-populate fields
	 * Function accepts the current value for the field as it's argument
	 * e.g model.generatedProperty = function(base){
	 * 	return base + '-extra-bit';
	 * }
	 */
	generateFields: function(rawResource, cb){

		// TODO: Make generators async and thunkified
		let self = this;

		if (self.properties){
			for(let key in self.properties){
				let field = self.properties[key];
				if(field.type && typeof field.type == 'function'){
					rawResource[key] = field.type.call(self, rawResource[key]||null);
				}
			}
			cb(null, rawResource);
		}
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

		let self = this;

		co(function *(){

			yield parallel(Object.keys(resource).map(function *(key){

				let field = self.properties[key];

				if (field.hasOwnProperty('validations')) {
					let validations = field.validations;

					yield parallel(validations.map(function *(validation){
						if (validation.hasOwnProperty('fn')) {
							if (!validation.fn(resource[key])) {
								throw validation.err;
							}
						}
						return true;
					}));
				}
				return true;
			}));

			return resource;
		})(cb);
	},

	get: function(env, next) {
		var uuid = env.route.params.id;

		if(!uuid){
			respond.sendBodyErrorResponse('Missing id', env, next);
		}

		this.spi.getResource(uuid, this.spi.getClient(), this.resourceType, function(err, resource){
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
		let self = this,
				uuid = env.route.params.id;

		co(function *(){

			let client = self.spi.getClient(),
					multi = client.multi();

			if(self.beforeDeleteResource && typeof self.beforeDeleteResource === 'function'){
				let resource = yield thunkify(self.spi.getResource).call(self.spi, client, uuid, self.resourceType);
				yield thunkify(self.beforeDeleteResource).call(self, multi, resource);
			}

			yield thunkify(self.spi.deleteResource).call(self.spi, multi, uuid, self);

			return yield thunkify(self.spi.executeMultipleOperations)(multi);
		})(function(err){
			if(err){
				respond.sendBodyErrorResponse(err, env, next);
			} else {
				respond.sendDeleteEntityResponse(uuid, env, next);
			}
		});
	}
});