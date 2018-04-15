(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global.WebRPC = factory());
}(this, (function () { 'use strict';

  /**
   * @callback listener
   * @param {*} data Any data could be passed to event listener
   */

  var Emitter = function Emitter () {
    this.events = Object.create(null);
  };

  /**
   * Add listener to event. No context provided, use Function.prototype.bind(), arrow function or closure instead.
   * @param{string} event  Event name
   * @param{listener} listener Event listener
   * @return {Emitter}         Return self
   * @example
   *
   * function listener (data) {
   *console.log(data)
   * }
   *
   * emitter.on('event', listener)
   */
  Emitter.prototype.on = function on (event, listener) {
    var listeners = this.events[event];

    if (!listeners) {
      listeners = [];
      this.events[event] = listeners;
    }

    listeners.push(listener);

    return this
  };

  /**
   * Remove listener from event.
   * @param{string} event  Event name
   * @param{listener} listener Event listener
   * @return {Emitter}         Return self
   * @example
   *
   * emitter.off('event', listener)
   */
  Emitter.prototype.off = function off (event, listener) {
    var listeners = this.events[event];

    if (listeners) {
      var idx = listeners.indexOf(listener);
      if (idx !== -1) {
        listeners.splice(idx, 1);
      }
    }

    return this
  };

  /**
   * Trigger an event. Multiple arguments not supported, use destructuring instead.
   * @param{string}event Event name
   * @param{*}     dataEvent data
   * @return {Emitter}     Return self
   * @example
   *
   * emitter.emit('event', { foo: 'bar' })
   */
  Emitter.prototype.emit = function emit (event, data) {
    var listeners = this.events[event];

    if (listeners) {
      for (var i = 0; i < listeners.length; i++) {
        listeners[i](data);
      }
    }

    return this
  };

  function isObject (object) {
    return Object(object) === object
  }

  function isTransferable (object) {
    return object instanceof ArrayBuffer
  }

  function peekTransferables (data, result) {
    if ( result === void 0 ) result = [];

    if (isTransferable(data)) {
      result.push(data);
    } else if (isObject(data)) {
      for (var i in data) {
        peekTransferables(data[i], result);
      }
    }
    return result
  }

  function uuid () {
    return Math.floor((1 + Math.random()) * 1e10).toString(16)
  }

  var RpcClient = (function (EventEmitter) {
    function RpcClient (ref) {
      var workers = ref.workers;

      EventEmitter.call(this);
      this.workers = [].concat( workers );
      this.idx = 0;
      this.calls = {};
      this.timeouts = {};
      this.errors = {};
      this.handler = this.handler.bind(this);
      this.listen();
    }

    if ( EventEmitter ) RpcClient.__proto__ = EventEmitter;
    RpcClient.prototype = Object.create( EventEmitter && EventEmitter.prototype );
    RpcClient.prototype.constructor = RpcClient;

    RpcClient.prototype.listen = function listen () {
      var this$1 = this;

      this.workers.forEach(function (worker) { return worker.addEventListener('message', this$1.handler); });
    };

    RpcClient.prototype.handler = function handler (e) {
      var ref = e.data;
      var error = ref.error;
      var method = ref.method;
      var eventName = ref.eventName;
      var data = ref.data;
      var uid = ref.uid;
      if (error) {
        this.reject(uid, error);
      } else if (method) {
        this.resolve(uid, data);
      } else if (eventName) {
        this.emit(eventName, data);
      }
    };

    RpcClient.prototype.reject = function reject (uid, error) {
      if (this.errors[uid]) {
        this.errors[uid](new Error(error));
        this.clear(uid);
      }
    };

    RpcClient.prototype.resolve = function resolve (uid, data) {
      if (this.calls[uid]) {
        this.calls[uid](data);
        this.clear(uid);
      }
    };

    RpcClient.prototype.clear = function clear (uid) {
      clearTimeout(this.timeouts[uid]);
      delete this.timeouts[uid];
      delete this.calls[uid];
      delete this.errors[uid];
    };

    RpcClient.prototype.call = function call (method, data, ref) {
      var this$1 = this;
      if ( ref === void 0 ) ref = {};
      var timeout = ref.timeout; if ( timeout === void 0 ) timeout = 2000;

      var uid = uuid();
      var transferables = peekTransferables(data);
      return new Promise(function (resolve, reject) {
        this$1.timeouts[uid] = setTimeout(function () { return this$1.reject(uid, ("Timeout exceeded for RPC method \"" + method + "\"")); }, timeout);
        this$1.calls[uid] = resolve;
        this$1.errors[uid] = reject;
        this$1.workers[this$1.idx].postMessage({ method: method, uid: uid, data: data }, transferables);
        this$1.idx = ++this$1.idx % this$1.workers.length; // round robin
      })
    };

    return RpcClient;
  }(Emitter));

  /* eslint-env serviceworker */

  var RpcServer = function RpcServer (methods) {
    this.methods = methods;
    this.listen();
  };

  RpcServer.prototype.listen = function listen () {
    self.addEventListener('message', this.handler.bind(this));
  };

  RpcServer.prototype.handler = function handler (e) {
      var this$1 = this;

    var ref = e.data;
      var method = ref.method;
      var uid = ref.uid;
      var data = ref.data;
    if (this.methods[method]) {
      Promise.resolve(data).then(this.methods[method]).then(
        function (data) { return this$1.reply(uid, method, data); },
        function (error) { return this$1.throw(uid, String(error)); }
      );
    } else {
      this.throw(uid, ("Unknown RPC method \"" + method + "\""));
    }
  };

  RpcServer.prototype.reply = function reply (uid, method, data) {
    var transferables = peekTransferables(data);
    self.postMessage({ uid: uid, method: method, data: data }, transferables);
  };

  RpcServer.prototype.throw = function throw$1 (uid, error) {
    self.postMessage({ uid: uid, error: error });
  };

  RpcServer.prototype.emit = function emit (eventName, data) {
    self.postMessage({
      eventName: eventName,
      data: data
    });
  };

  var index = {
    Client: RpcClient,
    Server: RpcServer
  }

  return index;

})));
