//noinspection BadExpressionStatementJS
/**
 * @class				RedisManagementSpi
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         10/01/14
 *
 * Enter description of class here using markdown
 */

"use strict";

let oo 				= require('oolib'),
	co 				= require('co'),
	thunkify 	= require('thunkify'),
	redis 		= require('redis'),
	redisCo 	= require('co-redis'),
	parallel	= require("co-parallel"),
	uuid 			= require('node-uuid'),
	crypto 		= require('crypto'),
	async 		= require('async');

/* DEBUG */
let debug;
let debugEnabled;
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
module.exports = oo.createClass({

	KEY_PREFIX: 'ibcos:resource',

	CRYPTO_BYTES: 256 / 8,

	_create: function(config){

		if(!this.client){
			config = config || {};
			let port = config.port || 6379,
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
	 * @param {Array|String} args
	 *
	 * @returns {Multi|String}
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
	 * @param {RedisClient} client
	 * @param uuid
	 * @param resourceType
	 * @param cb
	 */
	getResource: thunkify(function(client, uuid, resourceType, cb) {
		let self = this;

		co(function *(){
			return yield self.getWith404(client, resourceType + ':' + uuid);
		})(cb);
	}),

	/**
	 * Create a resource.
	 *
	 * If the primary key is set to 'id', a uuid property will be created. Otherwise, indexing is left to the developer
	 * @param {RedisClient} client
	 * @param {Object}    	resource
	 * @param {Object}    	config
	 * @param {Function}  	cb
	 */
	createResource: thunkify(function(client, resource, config, cb) {

		let self = this,
			isMulti = client.hasOwnProperty('_client');

		co(function *(){
			resource.uuid = uuid.v4();

			if(config.primary === 'id'){
				resource.id = resource.uuid;
			}

			// TODO: error handling
			yield self.callRedisCo(client, 'set', [
				self._key(config.resourceType, resource.uuid),
				JSON.stringify(resource)
			]);

			return isMulti ? resource.uuid : resource;
		})(cb)
	}),

	/**
	 *
	 * @param {RedisClient} client
	 * @param resource
	 * @param config
	 * @param cb
	 */
	updateResource: thunkify(function (client, resourceId, resource, config, cb) {
		let self = this;

		co(function *(){

//			TODO: Partial updates
//			let original = yield self.getResource(resourceId, config);

			yield self.callRedisCo(client, 'set', [
				self._key(config.resourceType, resourceId),
				JSON.stringify(resource)
			]);

			return resource;
		})(cb);
	}),

	/**
	 *
	 * @param resourceId
	 * @param config
	 * @param cb
	 */
	deleteResource: thunkify(function(client, resourceId, config, cb){

		let self = this;

		co(function *(){

			// - Delete resource
			yield self.callRedisCo(client, 'del', self._key(config.resourceType, resourceId));

			return resourceId;
		})(cb);
	}),

	/**
	 *
	 * @param {RedisClient} client
	 * @param setName
	 * @param cb
	 */
	getResourcesInSet: thunkify(function(client, setName, cb) {
		let self = this;

		co(function *(){
			let members = yield self.callRedisCo(client, 'smembers', self._key(setName));
			return yield self.callRedisCo(client, 'mget', members);
		})(cb);
	}),

	/**
	 *
	 * @param {RedisClient} client
	 * @param {Object} config
	 * @param {String} key
	 * @param {String} value
	 * @param {Function} [cb]
	 */
//	getKeyForIndex: function(client, config, key, value, cb) {
//		client.get(this._key(config.resourceType, key, value, config.primary), cb)
//	},

	/**
	 * Create a secondary index i.e. association, lookup
	 *
	 * @param {Object} client. The redis client
	 * @param {String} resourceType. The resource type to create
	 * @param {String} key
	 * @param {String} resource. The target resource
	 * @param {String} resourceIndexKey. The key of the target resource to use as the indexer
	 * @param {Function} [cb=function(){}]. Callback function
	 *
	 * @return {Array} Created index
	 */
	createSecondaryIndexForKey: thunkify(function(client, resourceType, key, resource, resourceIndexKey, cb) {
		let self = this;

		co(function *(){

			let index = self._key.apply(self, [resourceType].concat(key)),
				value = resource[key];

			yield self.callRedisCo(client, 'hset', [
				index,
				value,
				resource[resourceIndexKey]
			]);

			return [index, value];
		})(cb);
	}),

	/**
	 *
	 * @param {Object} client
	 * @param {String} resourceType
	 * @param {String} key
	 * @param {String} value
	 * @param {Function} [cb=function(){}]
	 */
	deleteSecondaryIndexForKey: thunkify(function(client, resourceType, key, value, cb) {
		let self = this;

		co(function *(){
			return yield self.callRedisCo(client, 'hdel', [self._key(resourceType, key), value]);
		})(cb);
	}),

	/**
	 *
	 * Get a resource by a secondary index
	 * @param client
	 * @param config
	 * @param index
	 * @param value
	 * @param cb
	 */
	getKeyBySecondaryIndex: thunkify(function(client, config, index, value, cb){
		var self = this;

		co(function *(){
			let resourceId = yield self.callRedisCo(self.getClient(), 'hget', [self._key(config.resourceType, index), value]);

			if(!resourceId){
				throw 'No resource found for: ' + index;
			}

			return yield self.callRedisCo(client, 'get', self._key(config.resourceType, resourceId));
		})(cb);
	}),

	genSecureToken: function() {
		return crypto.randomBytes(this.CRYPTO_BYTES).toString('base64');
	},

	getWith404: thunkify(function(client, key, cb) {
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
				return cb(self._make404(self._key(key)));
			}
		});
	}),

	_make404: function(key) {
		return {
			error: true,
			message: 'entity not found for key: ' + key,
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
	 * @param config
	 * @param setName
	 * @param resourceId
	 */
	addToSet: function(client, config, setName, resourceId) {
		return client.sadd([
			this._key(setName),
			this._key(config.resourceType, resourceId)
		]);
	},

	/**
	 *
	 * @param {Object} client
	 * @param {Object} config
	 * @param {String} setName
	 * @param {String} resourceId
	 * @param [cb]
	 */
	deleteFromSet: thunkify(function(client, config, setName, resourceId, cb) {
		let self = this;

		co(function *(){
			return yield self.callRedisCo(client, 'srem', [
				self._key(setName),
				self._key(config.resourceType, resourceId)
			]);
		})(cb)
	}),

	/**
	 *
	 * @param {RedisClient} client
	 * @param resourceType
	 * @param key
	 * @param value
	 * @param [cb]
	 */
	indexExists: thunkify(function(client, resourceType, key, value, cb) {
		let self = this;

		co(function *(){
			// TODO: process seems to die here
			return yield self.callRedisCo(client, 'hexists', [
				self._key(resourceType, key),
				value
			]);
		})(cb);
	}),

	/**
	 *
	 * @param {RedisClient} multi
	 * @param {Object|Null} resource
	 * @param cb
	 */
	executeMultipleOperations: thunkify(function(multi, cb){
		co(function *(){
			return yield multi.exec();
		})(cb);
	})
});