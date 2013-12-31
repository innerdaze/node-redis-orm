/****************************************************************************
 The MIT License (MIT)

 Copyright (c) 2013 Apigee Corporation

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 ****************************************************************************/

"use strict";

/**
 * @class				redis-management
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         27/12/13
 *
 * This module implements the management SPI interface using redis.
 *
 * Objects supported:
 *
 * developer: {
 *   email (string)
 *   id: (string)
 *   userName: (string)
 *   firstName: (string)
 *   lastName: (string)
 *   status: (string)
 *   attributes: (object)
 * }
 *
 * application: {
 *   name: (string)
 *   id: (string)
 *   status: (string)
 *   callbackUrl: (string)
 *   developerId: (string)
 *   attributes: (object)
 *   credentials: [(credentials object)],
 *   defaultScope: (string),  (if specified, must also be in validScopes list)
 *   validScopes: [(string)]
 * }
 *
 * credentials: {
 *   key: (string)
 *   secret: (string)
 *   status: (string)
 *   attributes: (object)
 * }
 *
 * service: {
 *   name: (string)
 *   id: (string)
 *   redirectUrl: (string)
 * }
 */

/*
 schema:
 ibcos:resource:resource_type:resource_id -> resource
 ibcos:resource:resource_type:resource_property:associated_value:id -> resource_id
 ibcos:resource:resource_set_name[] -> resource_id

 volos:management:application_id -> application
 volos:management:username -> developer_id
 volos:management:credentials.key -> application_id
 volos:management:credentials.key:credentials.secret -> application_id
 volos:management:developer_email:application_name -> application_id
 */


/**
 * @const {string} KEY_PREFIX namespace to contain all redis keys
 */
var KEY_PREFIX = 'ibcos:resource';

var CRYPTO_BYTES = 256 / 8;

var crypto = require('crypto');
var uuid = require('node-uuid');
var redis = require('redis');

var async = require('async');

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
 * @returns {RedisManagementSpi}
 */

module.exports = RedisManagementSpi;

/**
 *
 * @param config
 * @constructor
 */
function RedisManagementSpi(config) {
	config = config || {};
	var port = config.port || 6379,
		host = config.host || '127.0.0.1',
		ropts = config.options || {};

	this.client = redis.createClient(port, host, ropts);
}

/**
 * Create a resource with an a v4 uuid
 * @param {Object}    resource
 * @param {Object}    config
 * @param {String}    config.resourceType
 * @param {[String]}  config.sets
 * @param {[String]}  config.required
 * @param {[String]}  config.indexes
 * @param {Function}  cb
 */
RedisManagementSpi.prototype.createResource = function(resource, config, cb) {

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
				indexExists(self.client, config.resourceType, index, resource[index], function (err, result) {
					callback(!result);
				});
			}
		}, function (result) {
			if (!result) {
				cb('Duplicate index for resource');
			} else {
				createResourceInternal(self.client, resource, config, cb)
			}
		});
	} else {
		createResourceInternal(self.client, resource, config, cb)
	}
};

/**
 *
 * @param uuid
 * @param config
 * @param cb
 */
RedisManagementSpi.prototype.getResource = function(uuid, config, cb) {
	getWith404(this.client, config.resourceType + ':' + uuid, function(err, reply) {
		if (err) { return cb(err); }
		return cb(undefined, reply);
	});
};

/**
 *
 * @param setName
 * @param cb
 */
RedisManagementSpi.prototype.getResourcesInSet = function(setName, cb) {
	getAllMembers(this.client, setName, cb);
};

/**
 *
 * @param config
 * @param index
 * @param value
 * @param cb
 */
RedisManagementSpi.prototype.getResourceByIndex = function(config, index, value, cb){
	var self = this;

	getKeyForIndex(self.client, config, index, value, function(err, resourceId){
		if (!resourceId) {
			cb('No user found for: ' + index);
		} else {
			self.getResource(resourceId, config, cb);
		}
	});
};

/**
 *
 * @param resource
 * @param config
 * @param cb
 */
RedisManagementSpi.prototype.updateResource = function (resource, config, cb) {
	this.client.set(_key(config.resourceType, resource.uuid), JSON.stringify(resource), cb);
};

/**
 *
 * @param resourceId
 * @param config
 * @param cb
 */
RedisManagementSpi.prototype.deleteResource = function(resourceId, config, cb){

	var multi = this.client.multi(), i, ln, indexKey;

	// - Delete resource
	// - Remove from all sets
	// - Remove from indexes

	// Support declaration of primary key in model config

	multi.del(_key(config.resourceType, resourceId));

	if (config.sets) {
		for (i = 0, ln = config.sets.length; i < ln; i++) {
			deleteFromSet(multi, config, config.sets[i], resourceId);
		}
	}

	if (config.indexes) {
		this.getResource(resourceId, config, function(err, resource){
			if(err){
				cb(err);
			} else {
				for (i = 0, ln = config.indexes.length; i < ln; i++) {
					indexKey = config.indexes[i];
					deleteIndexForKey(multi, config, indexKey, resource[indexKey]);
				}
				multi.exec(cb);
			}
		});
	} else {
		multi.exec(cb);
	}
};

// Operations on applications

RedisManagementSpi.prototype.getDeveloperApp = function (developerEmail, appName, cb) {

	var self = this;
	this.client.get(_key(developerEmail, appName), function (err, reply) {
		if (err) {
			return cb(err);
		}
		if (reply) {
			getWith404(self.client, reply, cb);
		} else {
			return cb(make404());
		}
	});
};

RedisManagementSpi.prototype.getAppIdForClientId = function (key, cb) {
	this.client.get(_key(key), cb);
};

RedisManagementSpi.prototype.getAppForClientId = function (key, cb) {
	var self = this;
	self.getAppIdForClientId(key, function (err, reply) {
		if (!reply) {
			return cb({
				errorCode: 'invalid_request',
				message: 'no application exists for provided client id'
			});
		}
		self.getResource(reply, cb);
	});
};

RedisManagementSpi.prototype.checkRedirectUri = function (clientId, redirectUri, cb) {
	this.getAppForClientId(clientId, function (err, reply) {
		if (err) {
			return cb(err);
		}
		return cb(null, redirectUri !== reply.callbackUrl);
	});
};

RedisManagementSpi.prototype.deleteApp = function (uuid, cb) {
	deleteApplication(this.client, uuid, cb);
};

RedisManagementSpi.prototype.getAppIdForCredentials = function (key, secret, cb) {
	this.client.get(_key(key, secret), cb);
};

RedisManagementSpi.prototype.getAppForCredentials = function (key, secret, cb) {
	var self = this;
	self.getAppIdForCredentials(key, secret, function (err, reply) {
		if (!reply) {
			return cb({
				errorCode: 'invalid_client',
				message: 'invalid client key and secret combination'
			});
		}
		getWith404(self.client, reply, cb);
	});
};

// utility functions

function getWith404(client, key, cb) {
	client.get(_key(key), function (err, reply) {
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
			return cb(make404());
		}
	});
}

function make404() {
	return {
		error: true,
		message: 'entity not found',
		statusCode: 404
	};
}

/**
 *
 * @param client
 * @param setName
 * @param [cb]
 */
function getAllMembers(client, setName, cb) {
	client.smembers(_key(setName), function (err, replies) {
		client.mget(replies, cb)
	});
}

/**
 *
 * @param client
 * @param config
 * @param setName
 * @param resourceId
 */
function addToSet(client, config, setName, resourceId) {
	client.sadd(_key(setName), _key(config.resourceType, resourceId));
}

/**
 *
 * @param {Object} client
 * @param {Object} config
 * @param {String} setName
 * @param {String} resourceId
 */
function deleteFromSet(client, config, setName, resourceId) {
	client.srem(_key(setName), _key(config.resourceType, resourceId));
}


/**
 *
 * @param {Object} client
 * @param {Object} config
 * @param {String} key
 * @param {String} value
 * @param {Function} [cb]
 */
function getKeyForIndex(client, config, key, value, cb) {
	client.get(_key(config.resourceType, key, value, config.primary), cb)
}

/**
 *
 * @param {Object} client. The redis client
 * @param {Object} config. The resource config
 * @param {String[]} key. An array of values to form the key from
 * @param {String} resource. The target resource
 * @param {String} resourceKey. The key of the target resource to use as the indexer
 * @param {Function} [cb]. Callback function
 */
function createIndexForKey(client, config, key, resource, resourceKey, cb) {
	var keyArray = [config.resourceType].concat(key).concat(resourceKey);
	client.set(_key(keyArray), _key(config.resourceType, resource[resourceKey]), cb || function(){});
}

/**
 *
 * @param {Object} client
 * @param {Object} config
 * @param {String} key
 * @param {String} value
 * @param {Function} [cb]
 */
function deleteIndexForKey(client, config, key, value, cb) {
	client.del(_key(config.resourceType, key, value, config.primary), cb);
}

/**
 *
 * @param client
 * @param key
 * @param [cb]
 */
function keyExists(client, key, cb){
	client.exists(_key(key), cb);
}

/**
 *
 * @param client
 * @param config
 * @param key
 * @param value
 * @param [cb]
 */
function indexExists(client, config, key, value, cb) {
	keyExists(client, config.resourceType + ':' + key + ':' + value + ':' + config.primary, cb);
}

/**
 *
 * @param client
 * @param resource
 * @param config
 * @param cb
 */
function createResourceInternal(client, resource, config, cb) {
	var multi = client.multi(), i, indexKey, ln;

	// TODO: error handling

	multi.set(_key(config.resourceType, resource.uuid), JSON.stringify(resource));

	if (config.sets) {
		for (i = 0, ln = config.sets.length; i < ln; i++) {
			addToSet(multi, config, config.sets[i], resource.uuid);
		}
	}

	if (config.indexes) {
		for (i = 0, ln = config.indexes.length; i < ln; i++) {
			indexKey = config.indexes[i];
			createIndexForKey(multi, config, [indexKey], resource, 'id');
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
			createAssociation(multi, config, resource, association, callback);
		}, function(err){
			if(err){
				cb(err);
			} else {
				executeMultipleOperations(multi, resource, cb);
			}
		});
	} else {
		executeMultipleOperations(multi, resource, cb);
	}
}

function executeMultipleOperations(multi, resource, cb){
	multi.exec(function (err, reply) {
		if (err) {
			cb(err);
		} else {
			cb(undefined, resource);
		}
	});
}

function createAssociation(client, config, localResource, associationConfig, cb){
	var foreignId = localResource[associationConfig.localKey];

	redis.get(foreignId, function(err, foreignResource){
		if(err){
			cb('Couldn\'t find resource: ' + foreignId);
		} else {
			associationConfig.fn(client, localResource, foreignResource, function(err, result){
				if(err||!result){
					cb(err||'unexpected error creating association');
				} else if(typeof result == 'array'){
					createIndexForKey(client, config, result, localResource, 'id', cb);
				} else if(typeof result == 'boolean'){
					cb(undefined, result);
				}
			});
		}
	});
}


// must match saveApplication for deleting created keys
function deleteApplication(client, uuid, cb) {
	getWith404(client, uuid, function (err, application) {
		if (err) {
			return cb(err);
		}

		var multi = client.multi();

		// credentials[i].key -> application_id
		// credentials[i].key:credentials[i].secret -> application_id
		for (var i = 0; i < application.credentials.length; i++) {
			multi.del(_key(application.credentials[i].key));
			multi.del(_key(application.credentials[i].key, application.credentials[i].secret));
		}


		// developer_name:application_name -> application_id
		getWith404(client, uuid, function (err, dev) {
			if (dev) {
				multi.del(_key(dev.email, application.name));
			}

			// must do here instead of outside because of async callback
			multi.exec(cb);
		});
	});
}

RedisManagementSpi.prototype.genSecureToken = function() {
	return crypto.randomBytes(CRYPTO_BYTES).toString('base64');
}

function _key() {
	var argsArray = [].slice.apply(arguments);
	argsArray.unshift(KEY_PREFIX);
	return argsArray.join(':');
}