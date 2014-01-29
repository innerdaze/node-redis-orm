/**
 * @class
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         27/12/13
 *
 * Enter description of class here using markdown
 */

/**
 * @class
 * @author      Lee Driscoll
 * @docauthor   Lee Driscoll
 *
 * Date         05/12/13
 *
 * Enter description of class here using markdown
 */

var helpers = {};

helpers.sendErrorResponse = function(statusCode, err, env, next){
	env.response.statusCode = statusCode;
	env.response.headers = { 'Content-Type': 'text/json' };
	env.response.body = {
		error: true,
		message: 'Error: ' + (err)
	};

	next(env);
};

helpers.sendBodyErrorResponse = function(bodyErr, env, next){
	env.response.statusCode = 401;
	env.response.headers = { 'Content-Type': 'text/json' };
	env.response.body = {
		error: true,
		message: 'Bad Request: ' + (bodyErr || 'could not parse body')
	};

	next(env);
};

helpers.sendCreateEntityResponse = function(entity, env, next){
	env.response.statusCode = 201;
	env.response.headers = { 'Content-Type': 'text/json' };
	env.response.body = {
		success: true,
		message: entity
	};

	next(env);
};

helpers.sendUpdateEntityResponse = function(entity, env, next){
	env.response.statusCode = 200;
	env.response.headers = { 'Content-Type': 'text/json' };
	env.response.body = {
		success: true,
		message: entity
	};

	next(env);
};

helpers.sendDeleteEntityResponse = function(entityId, env, next){
	env.response.statusCode = 200;
	env.response.headers = { 'Content-Type': 'text/json' };
	env.response.body = {
		success: true,
		message: 'Entity deleted',
		entity: entityId
	};

	next(env);
};

helpers.sendEntityNotFoundResponse = function(message, env, next){
	env.response.statusCode = 404;
	env.response.headers = { 'Content-Type': 'text/json' };
	env.response.body = {
		error: true,
		errorCode: 'entity not found',
		message: message
	};

	next(env);
};

helpers.sendEntityFoundResponse = function(entity, env, next){
	env.response.statusCode = 200;
	env.response.headers = { 'Content-Type': 'text/json' };
	env.response.body = {
		success: true,
		message: entity
	};

	next(env);
};

helpers.decodeJsonBuffer = function(buffer){
	try {
		var result = {
			success: true,
			message: JSON.parse(buffer.toString())
		};
	} catch (e) {
		result = {
			success: false,
			error: e
		};
	}
	return result;
};

helpers.encodeJsonBuffer = function(object){
	return new Buffer(JSON.stringify(object))
};

module.exports = helpers;