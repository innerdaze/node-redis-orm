//noinspection BadExpressionStatementJS
/**
 * @class
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         10/01/14
 *
 * Enter description of class here using markdown
 */

"use strict";

var oo = require('oolib');

var co = require('co');
var thunkify = require('thunkify');

var redis = require('redis');
var redisCo = require('co-redis');

var uuid = require('node-uuid');
var crypto = require('crypto');
var async = require('async');


/* DEBUG */
var debug;
var debugEnabled;
if (process.env.NODE_DEBUG && /spi/.test(process.env.NODE_DEBUG)) {
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

		if(!this.client){
			config = config || {};
			var port = config.port || 6379,
				host = config.host || '127.0.0.1',
				ropts = config.options || {};

			this._client = redisCo(redis.createClient(port, host, ropts));
		}
	},

	getClient: function(){
		return this._client;
	},

	setClient: function(client){
		return this._client = client;
	},

	/**
	 * @private
	 *
	 * @param {RedisClient} client
	 * @param {String} command
	 * @param {Array} args
	 *
	 * @returns {Multi||String}
	 */
	callRedisCo: thunkify(function(client, command, args, cb){
		co(function *(){
			if(!client[command]){
				throw command + ' is not a method of RedisManagementSPI';
			}

			let isMulti = client.hasOwnProperty('_client');

			if(isMulti){
				return client[command].call(client, args);
			} else {
				return yield client[command].call(client, args);
			}
		})(cb);
	}),

	/**
	 *
	 * @param uuid
	 * @param config
	 * @param cb
	 */
	getResource: function(uuid, resourceType, cb) {
		let self = this;

		co(function *(){
			return yield thunkify(self.getWith404).call(self, self.getClient(), resourceType + ':' + uuid);
		})(cb);
	},

	/**
	 * Create a resource with an a v4 uuid
	 * @param {RedisClient} client
	 * @param {Object}    	resource
	 * @param {Object}    	config
	 * @param {Function}  	cb
	 */
	createResource: function (client, resource, config, cb) {

		let self = this,
			isMulti = client.hasOwnProperty('_client');

		co(function *(){
			resource.uuid = uuid.v4();

			if(config.primary === 'id'){
				resource.id = resource.uuid;
			}

			if(config.required){
				yield thunkify(self._checkRequired)(client, config, resource);
			}

			// TODO: error handling
			return yield self.callRedisCo(client, 'set', [
				self._key(config.resourceType, resource.uuid),
				JSON.stringify(resource)
			]);
		})(function(err, result){
			cb(err, isMulti ? resource.uuid : resource);
		})
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

		// Support declaration of primary key in properties config

		multi.del(self._key(config.resourceType, resourceId));

		if (config.sets) {
			for (i = 0, ln = config.sets.length; i < ln; i++) {
				self._deleteFromSet(multi, config, config.sets[i], resourceId);
			}
		}

		if (config.indexes) {
			self.getResource(resourceId, config.resourceType, function(err, resource){
				if(err){
					cb(err);
				} else {
					for (i = 0, ln = config.indexes.length; i < ln; i++) {
						indexKey = config.indexes[i];
						self.deleteSecondaryIndexForKey(multi, config.resourceType, indexKey, resource[indexKey]);
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

	getKeyForIndex: function(client, config, index, value, cb){
		throw('template method not implemented: getKeyForIndex');
	},

	/**
	 *
	 * @param {Object} client. The redis client
	 * @param {String} resourceType. The resource type to create
	 * @param {String} key
	 * @param {String} resource. The target resource
	 * @param {String} resourceKey. The key of the target resource to use as the indexer
	 * @param {Function} [cb=function(){}]. Callback function
	 */
	createSecondaryIndexForKey: function(client, resourceType, key, resource, resourceKey, cb) {
		let self = this;

		co(function *(){
			return yield self.callRedisCo(client, 'hset', [
				self._key.apply(self, [resourceType].concat(key)),
				resource[key],
				resource[resourceKey]
			]);
		})(cb);
	},

	/**
	 *
	 * @param {Object} client
	 * @param {String} resourceType
	 * @param {String} key
	 * @param {String} value
	 * @param {Function} [cb=function(){}]
	 */
	deleteSecondaryIndexForKey: function(client, resourceType, key, value, cb) {
		client.hdel(this._key(resourceType, key), value, cb || function(){});
	},

	/**
	 *
	 * Get a resource by a secondary index
	 * @param client
	 * @param config
	 * @param index
	 * @param value
	 * @param cb
	 */
	getKeyBySecondaryIndex: function(client, config, index, value, cb){
		var self = this;

		co(function *(){

		})(function(err){
			cb(err, res)
		});

		client.hget(self._key(config.resourceType, index), value, function(err, resourceId){
			if (!resourceId) {
				cb('No resource found for: ' + index);
			} else {
				client.get(self._key(config.resourceType, resourceId), cb);
			}
		});
	},

	genSecureToken: function() {
		return crypto.randomBytes(this.CRYPTO_BYTES).toString('base64');
	},

	getWith404: function(client, key, cb) {
		let self = this;

		co(function *(){
			return yield client.get(self._key(key));
		})(function(err, result){

			if (err) {
				return cb(err);
			} else if (result) {

				try {
					result = JSON.parse(result);
				}
				catch (e) {
					throw e;
				}

				return cb(null, result);
			} else {
				return cb(self._make404());
			}
		});
	},

	_checkRequired: function(client, config, resource, cb){
		// TODO: Fix - will error if (config.required === '*' && !config.properties)
		let required = config.required === '*' ? Object.keys(config.properties) : config.required;

		async.each(required, function(key, callback){
			if(!resource.hasOwnProperty(key)){
				callback('Missing required key [' + key + ']');
			} else {
				callback(null);
			}
		}, cb);
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
	 * @param setName
	 * @param [cb]
	 */
	_getAllMembers: function(client, setName, cb) {
		var self = this;

		client.smembers(this._key(setName), function (err, replies) {
			client.mget(replies, cb)
		});
	},

	/**
	 *
	 * @param client
	 * @param setName
	 * @param resourceId
	 */
	addToSet: function(client, config, setName, resourceId) {
		let self = this;

		return client.sadd([
			this._key(setName),
			this._key(config.resourceType, resourceId)
		]);
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
	 * @param resourceType
	 * @param key
	 * @param value
	 * @param [cb]
	 */
	indexExists: function(client, resourceType, key, value, cb) {
		this._keyExists(client, resourceType + ':' + key + ':' + value, cb);
	},

	/**
	 *
	 * @param {RedisClient} client
	 * @param key
	 * @param [cb]
	 */
	_keyExists: function(client, key, cb){
		var self = this;

		co(function *(){
			return yield client.exists(self._key(key));
		})(cb);
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