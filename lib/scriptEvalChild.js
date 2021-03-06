var path = require('path')
var os = require('os')
var vm = require('vm')

module.exports = function (inputs, callback, done) {
  function doRequire (moduleName) {
    var searchedPaths = ''

    function safeRequire (require, path) {
      try {
        return require(path)
      } catch (e) {
        searchedPaths += path + os.EOL
        return false
      }
    }

    var result = safeRequire(require.main.require, moduleName, searchedPaths) ||
      safeRequire(require, moduleName, searchedPaths) ||
      safeRequire(require, path.join(inputs.rootDirectory, moduleName), searchedPaths) ||
      safeRequire(require, path.join(inputs.appDirectory, moduleName), searchedPaths) ||
      safeRequire(require, path.join(inputs.parentModuleDirectory, moduleName), searchedPaths)

    if (!result) {
      throw new Error('Unable to find module ' + moduleName + os.EOL + 'Searched paths: ' + os.EOL + searchedPaths)
    }

    return result
  }

  var _require = function (moduleName) {
    if (inputs.allowedModules === '*') {
      return doRequire(moduleName)
    }

    var modules = inputs.allowedModules.filter(function (mod) {
      return (mod.id || mod) === moduleName
    })

    if (modules.length === 1) {
      return doRequire(modules[0].path || modules[0])
    }

    throw new Error('Unsupported module in scripts: ' + moduleName + '. To enable require on particular module, you need to update the configuration as ' +
      '{"scripts": { "allowedModules": ["' + moduleName + '"] } } ... Alternatively you can also set "*" to allowedModules to enable everything')
  }

  inputs.request.cancel = function (e) {
    done(null, {
      cancelRequest: true,
      additionalInfo: e
    })
  }
  var messages = []

  function extendFunction (consoleMethod, level) {
    var original = console[consoleMethod]

    console[consoleMethod] = function () {
      original.apply(this, arguments)
      messages.push({
        timestamp: new Date().getTime(),
        level: level,
        message: Array.prototype.join.call(arguments, ' ')
      })
    }
  }

  extendFunction('log', 'info')
  extendFunction('warn', 'warn')
  extendFunction('error', 'error')

  var doneWrap = function (err) {
    Object.keys(backCompatibleRequest).forEach(function (k) {
      if (k !== 'reporter') {
        inputs.request[k] = backCompatibleRequest[k]
      }
    })

    done(null, {
      request: inputs.request,
      response: inputs.response,
      shouldRunAfterRender: true,
      logs: messages,
      error: err ? {
        message: err.message,
        stack: err.stack
      } : undefined
    })
  }

  var backCompatibleRequest = doneWrap
  Object.keys(inputs.request).forEach(function (k) {
    backCompatibleRequest[k] = inputs.request[k]
  })
  var sandbox = {
    request: backCompatibleRequest,
    __request: backCompatibleRequest,
    __response: inputs.response,
    response: inputs.response,
    require: _require,
    setTimeout: setTimeout,
    console: console,
    Buffer: Buffer,
    __appDirectory: inputs.appDirectory,
    __rootDirectory: inputs.rootDirectory,
    __parentModuleDirectory: inputs.parentModuleDirectory,
    reporter: {
      render: function (shortid, cb) {
        callback(shortid, cb)
      }
    },
    done: doneWrap
  }

  backCompatibleRequest.reporter = sandbox.reporter

  var runBeforeRender = "\nif (typeof beforeRender === 'function') { beforeRender(__request, __response, done); } else { if (typeof afterRender === 'function') done() }"
  var runAfterRender = "\nif (typeof afterRender === 'function') { afterRender(__request, __response, done); } else { done(); }"

  vm.runInNewContext(inputs.script + (inputs.method === 'beforeRender' ? runBeforeRender : runAfterRender), sandbox)
}

