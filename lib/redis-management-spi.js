/**
 * @class
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         10/01/14
 *
 * Enter description of class here using markdown
 */

var oo = require('./oolib');
var redis = require('redis');
var uuid = require('node-uuid');
var crypto = require('crypto');
var async = require('async');


/* DEBUG */
var debug;
var debugEnabled;
if (process.env.NODE_DEBUG && /apigee/.test(process.env.NODE_DEBUG)) {
	debug = function (x) {
		console.log('Ibcos Resource Server [Redis]: ' + x);
	};
	debugEnabled = true;
} else {
	debug = function () {
	};
}

/**
 *
 * @param config
 * @constructor
 */
var RedisManagementSpi = oo.createClass({

	KEY_PREFIX: 'ibcos:resource',

	CRYPTO_BYTES: 256 / 8,

	_create: function(config){

		if(!this.prototype.client){
			config = config || {};
			var port = config.port || 6379,
				host = config.host || '127.0.0.1',
				ropts = config.options || {};

			this.prototype.client = redis.createClient(port, host, ropts);
		}
	},

	/**
	 *
	 * @param uuid
	 * @param config
	 * @param cb
	 */
	getResource: function(uuid, config, cb) {
		this.getWith404(this.client, config.resourceType + ':' + uuid, function(err, reply) {
			if (err) { return cb(err); }
			return cb(undefined, reply);
		});
	},

	/**
	 * Create a resource with an a v4 uuid
	 * @param {Object}    resource
	 * @param {Object}    config
	 * @param {Function}  cb
	 */
	createResource: function(resource, config, cb) {

		resource.uuid = uuid.v4();

		if(config.primary === 'id'){
			resource.id = resource.uuid;
		}

		var self = this;

		if(config.required && config.indexes){
			config.required.concat(config.indexes)
		}

		if(!config.required && config.indexes){
			config.required = config.indexes;
		}

		if(config.required){
			var required, i, key, ln;

			// TODO: Fix - will error if (config.required === '*' && !config.model)
			required = config.required === '*' ? Object.keys(config.model) : config.required;

			for(i =0, ln =required.length; i<ln; i++){
				key = required[i];

				if(!resource.hasOwnProperty(key)){
					return cb('Missing required key [' + key + ']');
				}
			}
		}

		if (config.indexes) {
			async.every(config.indexes, function(index, callback) {
				if (!resource[index]) {
					return cb('Missing index [' + index + ']');
				} else {
					self._indexExists(self.client, config.resourceType, index, resource[index], function (err, result) {
						callback(!result);
					});
				}
			}, function (result) {
				if (!result) {
					cb('Duplicate index for resource');
				} else {
					self._createResourceInternal(self.client, resource, config, cb)
				}
			});
		} else {
			self._createResourceInternal(self.client, resource, config, cb)
		}
	},

	/**
	 *
	 * @param resourceId
	 * @param config
	 * @param cb
	 */
	deleteResource: function(resourceId, config, cb){

		var self = this,
			multi = self.client.multi(),
			i, ln, indexKey;

		// - Delete resource
		// - Remove from all sets
		// - Remove from indexes

		// Support declaration of primary key in model config

		multi.del(self.key(config.resourceType, resourceId));

		if (config.sets) {
			for (i = 0, ln = config.sets.length; i < ln; i++) {
				self._deleteFromSet(self, multi, config, config.sets[i], resourceId);
			}
		}

		if (config.indexes) {
			self.getResource(resourceId, config, function(err, resource){
				if(err){
					cb(err);
				} else {
					for (i = 0, ln = config.indexes.length; i < ln; i++) {
						indexKey = config.indexes[i];
						self._deleteIndexForKey(self, multi, config, indexKey, resource[indexKey]);
					}
					multi.exec(cb);
				}
			});
		} else {
			multi.exec(cb);
		}
	},

	/**
	 *
	 * @param setName
	 * @param cb
	 */
	getResourcesInSet: function(setName, cb) {
		this._getAllMembers(this.client, setName, cb);
	},

	/**
	 *
	 * @param config
	 * @param index
	 * @param value
	 * @param cb
	 */
	getResourceByIndex: function(config, index, value, cb){
		var self = this;

		self.getKeyForIndex(self, self.client, config, index, value, function(err, resourceId){
			if (!resourceId) {
				cb('No resource found for: ' + index);
			} else {
				self.client.get(resourceId, cb);
			}
		});
	},

	genSecureToken: function() {
		return crypto.randomBytes(this.CRYPTO_BYTES).toString('base64');
	},

	getWith404: function(client, key, cb) {
		var self = this;

		client.get(self._key(key), function (err, reply) {
			if (err) {
				return cb(err);
			}
			if (reply) {

				try {
					reply = JSON.parse(reply);
				}
				catch (e) {
				}

				return cb(null, reply);
			} else {
				return cb(self._make404());
			}
		});
	},

	_make404: function() {
		return {
			error: true,
			message: 'entity not found',
			statusCode: 404
		};
	},

	_key: function() {
		var argsArray = [].slice.apply(arguments);
		argsArray.unshift(this.KEY_PREFIX);
		return argsArray.join(':');
	},

	/**
	 *
	 * @param client
	 * @param resource
	 * @param config
	 * @param cb
	 */
	_createResourceInternal: function(client, resource, config, cb) {
		var multi = client.multi(),
				self = this,
				i, indexKey, ln;

		// TODO: error handling

		multi.set(self._key(config.resourceType, resource.uuid), JSON.stringify(resource));

		if (config.sets) {
			for (i = 0, ln = config.sets.length; i < ln; i++) {
				self._addToSet(multi, config, config.sets[i], resource.uuid);
			}
		}

		if (config.indexes) {
			for (i = 0, ln = config.indexes.length; i < ln; i++) {
				indexKey = config.indexes[i];
				self.createIndexForKey(multi, config, indexKey, resource, 'id');
			}
		}

		/*
		 * Create any specified associations
		 * an association callback can return as it's first argument:
		 * 	 an error string, or
		 * 	 undefined (no error)
		 * the second argument can be either
		 * 	 an array of key parts for an external association, or
		 * 	 true (assumes any relevant processing occurred within the association function)
		 */
		if (config.associations){
			async.every(config.associations, function(association, callback){
				if(resource[association.localKey]){
					association.create(self, client, config, resource, callback);
				}
			}, function(err){
				if(err){
					cb(err);
				} else {
					self._executeMultipleOperations(multi, resource, cb);
				}
			});
		} else {
			self._executeMultipleOperations(multi, resource, cb);
		}
	},

	/**
	 *
	 * @param client
	 * @param setName
	 * @param [cb]
	 */
	_getAllMembers: function(client, setName, cb) {
		client.smembers(this._key(setName), function (err, replies) {
			client.mget(replies, cb)
		});
	},

	/**
	 *
	 * @param client
	 * @param config
	 * @param setName
	 * @param resourceId
	 */
	_addToSet: function(client, config, setName, resourceId) {
		client.sadd(this._key(setName), this._key(config.resourceType, resourceId));
	},

	/**
	 *
	 * @param {RedisManagementSpi} spi
	 * @param {Object} client
	 * @param {Object} config
	 * @param {String} setName
	 * @param {String} resourceId
	 */
	_deleteFromSet: function(client, config, setName, resourceId) {
		client.srem(this._key(setName), this._key(config.resourceType, resourceId));
	},

	/**
	 *
	 * @param {RedisClient} client
	 * @param key
	 * @param [cb]
	 */
	_keyExists: function(client, key, cb){
		client.exists(this._key(key), cb);
	},

	_executeMultipleOperations: function(multi, resource, cb){
		multi.exec(function (err, reply) {
			if (err) {
				cb(err);
			} else {
				cb(undefined, resource);
			}
		});
	}
});

/**
 *
 * @param config
 * @returns {RedisManagementSpi}
 */
module.exports = RedisManagementSpi;