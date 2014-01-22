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
	getResource: function(client, uuid, resourceType, cb) {
		let self = this;

		co(function *(){
			return yield thunkify(self.getWith404).call(self, client, resourceType + ':' + uuid);
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

			// TODO: error handling
			yield self.callRedisCo(client, 'set', [
				self._key(config.resourceType, resource.uuid),
				JSON.stringify(resource)
			]);

			return isMulti ? resource.uuid : resource;
		})(cb)
	},

	/**
	 *
	 * @param {RedisClient} client
	 * @param resource
	 * @param config
	 * @param cb
	 */
	updateResource: function (client, resource, config, cb) {
		let self = this;

		co(function *(){
			return yield self.callRedisCo(client, 'set', [
				self._key(config.resourceType, resource.uuid),
				JSON.stringify(resource)
			])
		})(cb);
	},

	/**
	 *
	 * @param resourceId
	 * @param config
	 * @param cb
	 */
	deleteResource: function(resourceId, config, cb){

		let self = this,
				client = self.getClient(),
				multi = client.multi();

		// Support declaration of primary key in properties config

		co(function *(){

			// - Delete resource
			yield self.callRedisCo(multi, 'del', self._key(config.resourceType, resourceId));

			// - Remove from all sets
			if(config.sets){
				yield parallel(config.sets.map(function *(name){
					return yield thunkify(self.deleteFromSet).call(self, multi, config, name, resourceId);
				}));
			}

			// - Remove from indexes
			if(config.indexes){
				let resource = yield thunkify(self.getResource).call(self, client, resourceId, config.resourceType);

				yield parallel(config.indexes.map(function *(index){
					return yield self.deleteSecondaryIndexForKey(multi, config.resourceType, index, resource[index]);
				}));
			}

			return resourceId;
		})(cb);
	},

	/**
	 *
	 * @param {RedisClient} client
	 * @param setName
	 * @param cb
	 */
	getResourcesInSet: function(client, setName, cb) {
		let self = this;

		co(function *(){
			let members = yield self.callRedisCo(client, 'smembers', self._key(setName));
			return yield self.callRedisCo(client, 'mget', members);
		})(cb);
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
		let self = this;

		co(function *(){
			return yield self.callRedisCo(client, 'hdel', [this._key(resourceType, key), value]);
		})(cb);
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
			let resourceId = yield self.callRedisCo(self.getClient(), 'hget', [self._key(config.resourceType, index), value]);

			if(!resourceId){
				throw 'No resource found for: ' + index;
			}

			return yield self.callRedisCo(client, 'get', self._key(config.resourceType, resourceId));
		})(cb);
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
	deleteFromSet: function(client, config, setName, resourceId, cb) {
		let self = this;

		co(function *(){
			return yield self.callRedisCo(client, 'srem', [
				this._key(setName),
				this._key(config.resourceType, resourceId)
			]);
		})(cb)
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
		let self = this;

		co(function *(){
			return yield self.callRedisCo(client, 'exists', self._key(resourceType, key, value));
		})(cb);
	},

	/**
	 *
	 * @param multi
	 * @param [resource]
	 * @param cb
	 */
	executeMultipleOperations: function(multi, resource, cb){
		co(function *(){
			let result = yield multi.exec();
			return resource||result;
		})(cb);
	}
});