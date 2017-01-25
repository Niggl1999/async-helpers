/*!
 * async-helpers <https://github.com/doowb/async-helpers>
 *
 * Copyright (c) 2015, Brian Woodward.
 * Licensed under the MIT License.
 */

'use strict';

var typeOf = require('kind-of');
var stringify = require('safe-json-stringify');
var define = require('define-property');
var extend = require('extend-shallow');
var co = require('co');

/**
 * Caches
 */

var cache = {};
var stash = {};

/**
 * Create a new instance of AsyncHelpers
 *
 * ```js
 * var asyncHelpers = new AsyncHelpers();
 * ```
 *
 * @param {Object} `options` options to pass to instance
 * @return {Object} new AsyncHelpers instance
 * @api public
 */

function AsyncHelpers(options) {
  if (!(this instanceof AsyncHelpers)) {
    return new AsyncHelpers(options);
  }
  this.options = extend({}, options);
  this.prefix = this.options.prefix || '{$ASYNCID$';
  this.globalCounter = AsyncHelpers.globalCounter++;
  this.helpers = {};
  this.counter = 0;

  Object.defineProperty(this, 'prefixRegx', {
    configurable: true,
    set: function(regex) {
      define(this, '_re', regex);
    },
    get: function() {
      return this._re || (this._re = toRegex(this.prefix, 'g'));
    }
  });
}

/**
 * Keep track of instances created for generating globally
 * unique ids
 * @type {Number}
 */

AsyncHelpers.globalCounter = 0;
AsyncHelpers.cache = cache;
AsyncHelpers.stash = stash;

/**
 * Add a helper to the cache.
 *
 * ```js
 * asyncHelpers.set('upper', function(str, cb) {
 *   cb(null, str.toUpperCase());
 * });
 * ```
 *
 * @param {String} `name` Name of the helper
 * @param {Function} `fn` Helper function
 * @return {Object} Returns `this` for chaining
 * @api public
 */

AsyncHelpers.prototype.set = function(name, fn) {
  if (isObject(name)) {
    for (var key in name) {
      if (name.hasOwnProperty(key)) {
        this.set(key, name[key]);
      }
    }
    return this;
  }

  if (typeof name !== 'string') {
    throw new TypeError('AsyncHelpers#set: expected `name` to be a string');
  }
  if (typeof fn !== 'function' && !isObject(fn)) {
    throw new TypeError('AsyncHelpers#set: expected `fn` to be a function or object');
  }

  this.helpers[name] = fn;
  return this;
};

/**
 * Get all helpers or a helper with the given name.
 *
 * ```js
 * var helpers = asyncHelpers.get();
 * var wrappedHelpers = asyncHelpers.get({wrap: true});
 * ```
 *
 * @param  {String} `name` Optionally pass in a name of a helper to get.
 * @param  {Object} `options` Additional options to use.
 *   @option {Boolean} `wrap` Wrap the helper(s) with async processing capibilities
 * @return {Function|Object} Single helper function when `name` is provided, otherwise object of all helpers
 * @api public
 */

AsyncHelpers.prototype.get = function(helper, options) {
  if (typeof helper === 'string') {
    return this.wrapHelper(helper, options);
  }
  return this.wrapHelpers(this.helpers, helper);
};

/**
 * Wrap a helper with async handling capibilities.
 *
 * ```js
 * var wrappedHelper = asyncHelpers.wrap('upper');
 * var wrappedHelpers = asyncHelpers.wrap();
 * ```
 *
 * @param  {String} `helper` Optionally pass the name of the helper to wrap
 * @return {Function|Object} Single wrapped helper function when `name` is provided, otherwise object of all wrapped helpers.
 * @api public
 */

AsyncHelpers.prototype.wrapHelper = function(helper, options) {
  if (isObject(helper)) {
    options = helper;
    helper = null;
  }

  var type = typeOf(helper);
  switch (type) {
    case 'string':
      return this.wrapHelper(this.helpers[helper], options);
    case 'object':
      return this.wrapHelpers(helper, options);
    case 'function':
      if (isHelperGroup(helper)) {
        helper = this.wrapHelpers(helper, options);
      }

      if (helper.wrapped === true) {
        return helper;
      }

      var opts = extend({}, this.options, options);
      if (opts.wrap) {
        return this.wrapper(helper, helper, this);
      }

      return helper;
    default: {
      throw new TypeError('AsyncHelpers.wrapHelper: unsupported type: ' + type);
    }
  }
};

/**
 * Wrap an object of helpers to enable async handling
 * @param  {Object} `helpers`
 * @param  {Object} `options`
 */

AsyncHelpers.prototype.wrapHelpers = function(helpers, options) {
  if (!isObject(helpers) && isHelperGroup(helpers)) {
    throw new TypeError('expected helpers to be an object');
  }

  var res = {};
  for (var key in helpers) {
    if (helpers.hasOwnProperty(key)) {
      var helper = helpers[key];
      if (isObject(helper)) {
        res[key] = this.wrapHelpers(helper, options);
      } else {
        if (helper.wrapped !== true) {
          res[key] = this.wrapHelper(helper, options);
        } else {
          res[key] = helper;
        }
      }
    }
  }
  return res;
};

/**
 * Returns a wrapper function for a single helper.
 * @param  {String} `name` The name of the helper
 * @param  {Function} `fn` The actual helper function
 * @param  {Object} `context` Context
 * @return {String} Returns an async ID to use for resolving the value. ex: `{$ASYNCID$!$8$}`
 */

AsyncHelpers.prototype.wrapper = function(name, fn) {
  var prefix = appendPrefix(this.prefix, this.globalCounter);
  var self = this;

  // wrap the helper and generate a unique ID for resolving it
  function wrapper() {
    var num = self.counter++;
    var id = createId(prefix, num);

    var token = {
      name: name,
      async: !!fn.async,
      prefix: prefix,
      num: num,
      id: id,
      fn: fn,
      args: [].slice.call(arguments)
    };

    define(token, 'context', this);
    stash[id] = token;
    return id;
  }

  define(wrapper, 'wrapped', true);
  define(wrapper, 'helperName', name);
  return wrapper;
};

/**
 * Reset all the stashed helpers.
 *
 * ```js
 * asyncHelpers.reset();
 * ```
 * @return {Object} Returns `this` to enable chaining
 * @api public
 */

AsyncHelpers.prototype.reset = function() {
  stash = {};
  this.counter = 0;
  return this;
};

/**
 * Get all matching ids from the given `str`
 * @return {Array} Returns an array of matching ids
 */

AsyncHelpers.prototype.matches = function(str) {
  return str.match(this.prefixRegx);
};

/**
 * Returns true if the given string has an async helper id
 * @return {Boolean}
 */

AsyncHelpers.prototype.hasAsyncId = function(str) {
  return this.prefixRegx.test(str);
};

/**
 * Resolve a stashed helper by the generated id.
 * This is a generator function and should be used with [co][]
 *
 * ```js
 * var upper = asyncHelpers.get('upper', {wrap: true});
 * var id = upper('doowb');
 *
 * co(asyncHelpers.resolveId(id))
 *   .then(console.log)
 *   .catch(console.error);
 *
 * //=> DOOWB
 * ```
 *
 * @param  {String} `key` ID generated when from executing a wrapped helper.
 * @api public
 */

AsyncHelpers.prototype.resolveId = function * (key) {
  if (typeof key !== 'string') {
    throw new Error('AsyncHelpers#resolveId: expects `key` to be a string.');
  }

  var helper = stash[key];
  if (!helper) {
    throw new Error('AsyncHelpers#resolveId: cannot resolve helper: "' + key + '"');
  }

  var args = yield this.resolveArgs(helper);
  var self = this;
  var str;

  return yield function(cb) {
    if (typeof helper.fn !== 'function') {
      cb(null, helper.fn);
      return;
    }

    var next = function(err, val) {
      if (typeof val !== 'undefined') {
        helper.fn = val;
        cb(err, helper.fn);
        return;
      }
      cb(err, '');
      return;
    };

    if (helper.fn.async) {
      var callback = function(err, result) {
        if (err) {
          next(formatError(err, helper, args));
          return;
        }

        if (self.hasAsyncId(result)) {
          self.resolveIds(result, next);
          return;
        }
        next(null, result);
        return;
      };

      args.push(callback);
    }

    try {
      str = helper.fn.apply(helper.context, args);
      if (self.hasAsyncId(str)) {
        self.resolveIds(str, next);
        return;
      }
    } catch (err) {
      next(formatError(err, helper, args));
      return;
    }

    if (!helper.fn.async) {
      next(null, str);
      return;
    }

    // do nothing
  };
};

/**
 * Generator function for resolving helper arguments
 * that contain async ids. This function should be used
 * with [co][].
 *
 * This is used inside `resolveId`:
 *
 * ```js
 * var args = yield co(asyncHelpers.resolveArgs(helper));
 * ```
 * @param {Object} `helper` helper object with an `argRefs` array.
 */

AsyncHelpers.prototype.resolveArgs = function * (helper) {
  for (var i = 0; i < helper.args.length; i++) {
    var arg = helper.args[i];
    if (!arg) continue;

    if (typeof arg === 'string' && this.hasAsyncId(arg)) {
      helper.args[i] = yield this.resolveId(arg);

    } else if (isObject(arg) && isObject(arg.hash)) {
      arg.hash = yield this.resolveObject(arg.hash);
    }
  }
  return helper.args;
};

/**
 * Generator function for resolving values on an object
 * that contain async ids. This function should be used
 * with [co][].
 *
 * This is used inside `resolveArgs`:
 *
 * ```js
 * var args = yield co(asyncHelpers.resolveObject(options.hash));
 * ```
 * @param {Object} `obj` object with with values that may be async ids.
 * @returns {Object} Object with resolved values.
 */

AsyncHelpers.prototype.resolveObject = function * (obj) {
  var keys = Object.keys(obj);
  var self = this;

  return yield keys.reduce(function(acc, key) {
    return co(function * () {
      var val = acc[key];
      if (typeof val === 'string' && self.hasAsyncId(val)) {
        acc[key] = yield self.resolveId(val);
      }
      return acc;
    });
  }, obj);
};

/**
 * After rendering a string using wrapped async helpers,
 * use `resolveIds` to invoke the original async helpers and replace
 * the async ids with results from the async helpers.
 *
 * ```js
 * asyncHelpers.resolveIds(renderedString, function(err, content) {
 *   if (err) return console.error(err);
 *   console.log(content);
 * });
 * ```
 * @param  {String} `str` String containing async ids
 * @param  {Function} `cb` Callback function accepting an `err` and `content` parameters.
 * @api public
 */

AsyncHelpers.prototype.resolveIds = function(str, cb) {
  if (typeof cb !== 'function') {
    throw new TypeError('AsyncHelpers#resolveIds() expects a callback function.');
  }
  if (typeof str !== 'string') {
    return cb(new TypeError('AsyncHelpers#resolveIds() expects a string.'));
  }

  var matches = this.matches(str);

  var self = this;
  co(function * () {
    if (!matches) {
      return str;
    };

    for (var i = 0; i < matches.length; i++) {
      var key = matches[i];
      var val = yield self.resolveId(key);
      str = str.split(key).join(val);
    }
    return str;
  })
  .then(function(res) {
    cb(null, res);
  })
  .catch(cb);
};

/**
 * Format an error message to provide better information about the
 * helper and the arguments passed to the helper when the error occurred.
 *
 * @param  {Object} `err` Error object
 * @param  {Object} `helper` helper object to provide more information
 * @param  {Array} `args` Array of arguments passed to the helper.
 * @return {Object} Formatted Error object
 */

function formatError(err, helper, args) {
  args = args.filter(function(arg) {
    if (!arg || typeof arg === 'function') {
      return false;
    }
    return true;
  }).map(function(arg) {
    return stringify(arg);
  });

  err.reason = '"' + helper.name
    + '" helper cannot resolve: `'
    + args.join(', ') + '`';

  err.helper = helper;
  err.args = args;
  return err;
}

/**
 * Create a prefix to use when generating an async id.
 *
 * @param  {String} `prefix` prefix string to start with.
 * @param  {String} `counter` string to append.
 * @return {String} new prefix
 */

function appendPrefix(prefix, counter) {
  return prefix + counter + '$';
}

/**
 * Create an async id from the provided prefix and counter.
 *
 * @param  {String} `prefix` prefix string to start with
 * @param  {String} `counter` string to append.
 * @return {String} async id
 */

function createId(prefix, counter) {
  return appendPrefix(prefix, counter) + '}';
}

/**
 * Create a regular expression based on the given `prefix`.
 * @param  {String} `prefix`
 * @return {RegExp}
 */

function toRegex(prefix, flags, options) {
  var key = appendPrefix(prefix, '(\\d)+');
  if (cache.hasOwnProperty(key)) {
    return cache[key];
  }

  if (typeof flags !== 'string') {
    options = flags;
    flags = undefined;
  }

  var regex = new RegExp(createRegexString(key, options), flags);
  cache[key] = regex;
  return regex;
}

/**
 * Create a string to pass into `RegExp` for checking for and finding async ids.
 * @param  {String} `prefix` prefix to use for the first part of the regex
 * @return {String} string to pass into `RegExp`
 */

function createRegexString(prefix, options) {
  var key = 'createRegexString:' + prefix;
  if (cache.hasOwnProperty(key)) {
    return cache[key];
  }
  options = options || {};
  var str = '\\' + prefix.split(/\\?\$/).join('\\$') + '(\\d)+\\$\\}';
  if (options.strict) {
    str = '^' + str + '$';
  }
  cache[key] = str;
  return str;
}

/**
 * Return true if the given value is a helper "group"
 */

function isHelperGroup(helpers) {
  if (!helpers) return false;
  if (typeof helpers === 'function' || isObject(helpers)) {
    var len = Object.keys(helpers).length;
    var min = (helpers.async || helpers.sync) ? 1 : 0;
    return helpers.isGroup === true || len > min;
  }
  if (Array.isArray(helpers)) {
    return helpers.isGroup === true;
  }
  return false;
}

/**
 * Return true if the given value is an object
 */

function isObject(val) {
  return typeOf(val) === 'object';
}

/**
 * Expose `AsyncHelpers`
 */

module.exports = AsyncHelpers;

