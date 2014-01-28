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
			return yield self.spi.getResourcesInSet(self.spi.getClient(), self.resourceType + 's');
		})(function(err, result){
			respond.sendEntityFoundResponse(result, env, next);
		});
	},

	// TODO: Secure client (Not sure what this refers to anymore. Must be more verbose in future.)
	create: function(env, next) {

		let self = this;

		co(function *(){

			let client = self.spi.getClient(),
					multi = client.multi(),
					resource, resourceId;

			resource = yield parseBody.json(env.request);

			// Run field converters
			// TODO: Make this an optional step at this level
			resource = yield self.generateFields(resource);

			if(self.required){
				yield self._checkRequired(client, resource);
			}

			// Validate
			yield self.validate(resource);

			// Create resource
			// TODO: figure out how resourceId is getting about despite me not doing anything with it.
			resourceId = yield self.spi.createResource(multi, resource, self);

			// Create indexes
			if(self.indexes && self.indexes.length){
				yield self._checkIndexes(client, resource);
				yield self._createIndexes(multi, resource);
			}

			// Create Associations
			if (self.associations && self.associations.length){
				resource = yield self._createAssociations(multi, resource);
			}

			// Add to Sets Associations
			if (self.sets && self.sets.length){
				resource = yield self._addToSets(multi, resource);
			}

			console.log('Created ' + self.resourceType);

			// Post process
			if(self.afterCreateResource && typeof self.afterCreateResource === 'function'){
				resource = yield self.afterCreateResource(multi, resource);
			}

			return yield self.spi.executeMultipleOperations(multi, resource);
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
	_addToSets: thunkify(function(client, resource, cb){
		let self = this;

		co(function *(){
			yield parallel(self.sets.map(function *(item){
				return self.spi.addToSet.call(self.spi, client, self, item, resource[self.primary]);
			}));

			return resource;
		})(cb);
	}),

	/**
	 *
	 * @param client
	 * @param resource
	 * @param cb
	 * @private
	 */
	_createIndexes: thunkify(function(client, resource, cb){
		let self = this;

		co(function *(){
			yield parallel(self.indexes.map(function *(index){
				return yield self.spi.createSecondaryIndexForKey(client, self.resourceType, index, resource, self.primary);
			}));

			return resource;
		})(cb);
	}),

	/**
	 *
	 * @param client
	 * @param resource
	 * @param cb
	 * @private
	 */
	_checkIndexes: thunkify(function(client, resource, cb){
		let self = this;

		co(function *(){
			return yield parallel(self.indexes.map(function *(index){
				let result = yield self.spi.indexExists(client, self.resourceType, index, resource[index]);

				if(result){
					throw 'Duplicate ' + index + ': ' + resource[index] + ' for ' + self.resourceType;
				}

				return result;
			}));
		})(cb);
	}),

	/**
	 *
	 * @param client
	 * @param config
	 * @param resource
	 * @param cb
	 * @private
	 */
	_checkRequired: thunkify(function(client, resource, cb){
		// TODO: optimise this by having it call only once
		let required, index;

		// TODO: Fix - will error if (config.required === '*' && !config.properties)
		required = this.required === '*' ? Object.keys(this.properties) : this.required;

		if((index = ~required.indexOf('id'))){
			required.splice(index, 1);
		}

		co(function *(){
			yield parallel(required.map(function *(key){
				if(!resource.hasOwnProperty(key)){
					throw 'Missing required key [' + key + ']';
				}
				return true;
			}));

			return resource;
		})(cb);
	}),

	/*
	 * Create any specified associations
	 * an association callback can return as it's first argument:
	 * 	 an error string, or
	 * 	 undefined (no error)
	 * the second argument can be either
	 * 	 an array of key parts for an external association, or
	 * 	 true (assumes any relevant processing occurred within the association function)
	 */
	_createAssociations: thunkify(function(client, resource, cb){
		let self = this;

		co(function *(){
			yield parallel(self.associations.map(function *(association){
					return yield association.create(self, client, resource);
			}));

			return resource;
		})(cb);
	}),

	/*
	 * Delete any specified associations
	 */
	_deleteAssociations: thunkify(function(client, resource, cb){
		let self = this;

		co(function *(){
			yield parallel(self.associations.map(function *(association){
					return yield association.remove(self, client, resource);
			}));

			return resource;
		})(cb);
	}),

	/*
	 * Allow the model to provide a function as the model value for a key to auto-populate fields
	 * Function accepts the current value for the field as it's argument
	 * e.g model.generatedProperty = function(base){
	 * 	return base + '-extra-bit';
	 * }
	 */
	generateFields: thunkify(function(rawResource, cb){

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
	}),

	/*
	 * Validate the object based on validation objects containing a boolean function and a message in case of a validation error
	 * e.g model.validations.myProperty = {
	 * 	fn: function(value){
	 * 		return !!value;
	 * 	},
	 * 	err: 'Value was not truth';
	 * }
	 */
	validate: thunkify(function(resource, cb){

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
	}),

	get: function(env, next) {
		let self = this;

		co(function *(){
			let uuid = env.route.params.id;

			if(!uuid){
				throw 'Missing id';
			}

			return yield self.spi.getResource(uuid, self.spi.getClient(), this.resourceType);
		})(function(err, resource){
			if(err || !resource){
				respond.sendEntityNotFoundResponse(undefined, env, next);
			} else {
				respond.sendEntityFoundResponse(resource, env, next);
			}
		});
	},

	getBySecondaryIndex: function(env, next) {
		let self = this;

		co(function *(){
			let key = env.route.params.key,
				value = env.route.params.value;

			return yield self.spi.getKeyBySecondaryIndex(self.spi.getClient(), self, key, value);
		})(function(err, resource){
			if(err || !resource){
				respond.sendEntityNotFoundResponse(undefined, env, next);
			} else {
				respond.sendEntityFoundResponse(resource, env, next);
			}
		});
	},

	update: function(env, next) {

		let self = this;

		co(function *(){
			let client = self.spi.getClient(),
					multi = client.multi(),
					resource;

			if(!env.route.params.id){
				throw 'Missing id';
			}

			resource = yield parseBody.json(env.request);

			resource = yield self.spi.updateResource(multi, resource, self);

			return yield self.spi.executeMultipleOperations(multi, resource);
		})(function(err){
			if(err){
				respond.sendBodyErrorResponse(err, env, next);
			} else {
				respond.sendUpdateEntityResponse(resource, env, next);
			}
		});
	},

	remove: function(env, next) {
		let self = this,
				resourceId = env.route.params.id;

		co(function *(){

			let client = self.spi.getClient(),
					multi = client.multi(),
					resource;

			if(self.beforeDeleteResource && typeof self.beforeDeleteResource === 'function'){
				resource = yield self.spi.getResource(client, resourceId, self.resourceType);
				yield self.beforeDeleteResource(multi, resource);
			}

			yield self.spi.deleteResource(multi, resourceId, self);

			// - Remove from indexes
			if(self.indexes){
				resource = yield self.spi.getResource(client, resourceId, self.resourceType);

				yield parallel(self.indexes.map(function *(index){
					return yield self.spi.deleteSecondaryIndexForKey(multi, self.resourceType, index, resource[index]);
				}));
			}

			// Create Associations
			if (self.associations && self.associations.length){
				resource = yield self._deleteAssociations(multi, resource);
			}

			// - Remove from all sets
			if(self.sets){
				yield parallel(self.sets.map(function *(name){
					return yield self.spi.deleteFromSet(multi, self, name, resourceId);
				}));
			}

			return yield self.spi.executeMultipleOperations(multi);
		})(function(err){
			if(err){
				respond.sendBodyErrorResponse(err, env, next);
			} else {
				respond.sendDeleteEntityResponse(uuid, env, next);
			}
		});
	}
});