const path = require('path');
const fileExists = require('./utils').fileExists;
const Translation = require('./translation');
const MochaFactory = require('./mocha_factory');
const recorder = require('./recorder');

let container = {
  helpers: {},
  support: {},
  mocha: {},
  translation: {},
};

/**
 * Dependency Injection Container
 */
class Container {
  /**
   * Create container with all required helpers and support objects
   *
   * @api
   * @param {*} config
   * @param {*} opts
   */
  static create(config, opts) {
    const mochaConfig = config.mocha || {};
    if (config.grep && !opts.grep) {
      mochaConfig.grep = config.grep;
    }
    container.mocha = MochaFactory.create(mochaConfig, opts || {});
    container.helpers = createHelpers(config.helpers || {});
    container.translation = loadTranslation(config.translation || null);
    container.support = createSupportObjects(config.include || {});
  }

  /**
   * Get all support objects or get support object by name
   *
   * @api
   * @param {string} [name]
   */
  static support(name) {
    if (!name) {
      return container.support;
    }
    return container.support[name];
  }

  /**
   * Get all helpers or get a helper by name
   *
   * @api
   * @param {string} [name]
   */
  static helpers(name) {
    if (!name) {
      return container.helpers;
    }
    return container.helpers[name];
  }

  /**
   * Get translation
   *
   * @api
   */
  static translation() {
    return container.translation;
  }

  /**
   * Get Mocha instance
   *
   * @api
   */
  static mocha() {
    return container.mocha;
  }

  /**
   * Append new services to container
   *
   * @api
   */
  static append(newContainer) {
    const deepMerge = require('./utils').deepMerge;
    container = deepMerge(container, newContainer);
  }

  /**
   * Clear container
   *
   * @param {*} newHelpers
   * @param {*} newSupport
   */
  static clear(newHelpers, newSupport) {
    container.helpers = newHelpers || {};
    container.support = newSupport || {};
    container.translation = loadTranslation();
  }
}

module.exports = Container;

function createHelpers(config) {
  const helpers = {};
  let helperModule;
  let moduleName;
  for (const helperName in config) {
    try {
      if (config[helperName].require) {
        if (config[helperName].require.startsWith('.')) {
          moduleName = path.resolve(global.codecept_dir, config[helperName].require); // custom helper
        } else {
          moduleName = config[helperName].require; // plugin helper
        }
      } else {
        moduleName = `./helper/${helperName}`; // built-in helper
      }
      const HelperClass = require(moduleName);
      if (HelperClass._checkRequirements) {
        const requirements = HelperClass._checkRequirements();
        if (requirements) {
          let install;
          if (require('./utils').installedLocally()) {
            install = `npm install --save-dev ${requirements.join(' ')}`;
          } else {
            install = `[sudo] npm install -g ${requirements.join(' ')}`;
          }
          throw new Error(`Required modules are not installed.\n\nRUN: ${install}`);
        }
      }
      helpers[helperName] = new HelperClass(config[helperName]);
    } catch (err) {
      throw new Error(`Could not load helper ${helperName} from module '${moduleName}':\n${err.message}`);
    }
  }

  for (const name in helpers) {
    if (helpers[name]._init) helpers[name]._init();
  }
  return helpers;
}

function createSupportObjects(config) {
  const objects = {};
  for (const name in config) {
    objects[name] = getSupportObject(config, name);
    try {
      if (typeof objects[name] === 'function') {
        objects[name] = objects[name]();
      } else if (objects[name]._init) {
        objects[name]._init();
      }
    } catch (err) {
      throw new Error(`Initialization failed for ${objects[name]}\n${err.message}`);
    }
  }
  if (!objects.I) {
    objects.I = require('./actor')();

    if (container.translation.I !== 'I') {
      objects[container.translation.I] = objects.I;
    }
  }

  const asyncWrapper = function (f) {
    return function () {
      return f.apply(this, arguments).catch((e) => {
        recorder.saveFirstAsyncError(e);
      });
    };
  };

  Object.keys(objects).forEach((object) => {
    const currentObject = objects[object];
    Object.keys(currentObject).forEach((method) => {
      const currentMethod = currentObject[method];
      if (currentMethod[Symbol.toStringTag] === 'AsyncFunction') {
        objects[object][method] = asyncWrapper(currentMethod);
      }
    });
  });

  return objects;
}

function getSupportObject(config, name) {
  const module = config[name];
  if (typeof module === 'string') {
    return loadSupportObject(module, name);
  }
  return module;
}

function loadSupportObject(modulePath, supportObjectName) {
  if (modulePath.charAt(0) === '.') {
    modulePath = path.join(global.codecept_dir, modulePath);
  }
  try {
    return require(modulePath);
  } catch (err) {
    throw new Error(`Could not include object ${supportObjectName} from module '${modulePath}'\n${err.message}`);
  }
}

function loadTranslation(translation) {
  if (!translation) {
    return new Translation({
      I: 'I',
      actions: {},
    }, false);
  }

  let vocabulary;
  // check if it is a known translation
  if (require('../translations')[translation]) {
    vocabulary = require('../translations')[translation];
    return new Translation(vocabulary);
  } else if (fileExists(path.join(global.codecept_dir, translation))) {
    // get from a provided file instead
    vocabulary = require(path.join(global.codecept_dir, translation));
  } else {
    throw new Error(`Translation option is set in config, but ${translation} is not a translated locale or filename`);
  }

  return new Translation(vocabulary);
}
