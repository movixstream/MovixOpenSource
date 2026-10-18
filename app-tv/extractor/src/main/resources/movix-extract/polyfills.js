/*
 * Polyfills navigateur pour exécuter le userscript Movix dans QuickJS, sans
 * WebView. Seul le strict nécessaire au userscript est fourni ; le travail
 * lourd (réseau, chiffrement, encodage, analyse d'URL) est fait en Kotlin par
 * les fonctions natives __n_* (synchrones, voir ExtractorRuntime.kt).
 *
 * Octets : Kotlin reçoit les Uint8Array (UByteArray) et rend des Uint8Array.
 */
(function () {
  "use strict";
  var G = globalThis;

  // ---------- octets ----------
  function u8(data) {
    if (data == null) return new Uint8Array(0);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (Array.isArray(data)) return new Uint8Array(data);
    throw new TypeError("Données binaires attendues");
  }
  function toBuffer(bytes) {
    var b = u8(bytes);
    return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  G.__movixU8 = u8;
  G.__movixToBuffer = toBuffer;

  // ---------- fenêtre ----------
  G.window = G;
  G.self = G;
  G.top = G;
  G.parent = G;
  G.unsafeWindow = G;

  // ---------- console ----------
  function fmt(args) {
    var out = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (typeof a === "string") out.push(a);
      else if (a instanceof Error) out.push(a.name + ": " + a.message);
      else { try { out.push(JSON.stringify(a)); } catch (e) { out.push(String(a)); } }
    }
    return out.join(" ");
  }
  G.console = {
    log: function () { __n_log("log", fmt(arguments)); },
    info: function () { __n_log("info", fmt(arguments)); },
    debug: function () { __n_log("debug", fmt(arguments)); },
    warn: function () { __n_log("warn", fmt(arguments)); },
    error: function () { __n_log("error", fmt(arguments)); },
    trace: function () {}, group: function () {}, groupEnd: function () {}, time: function () {}, timeEnd: function () {},
  };

  // ---------- minuteurs (boucle pilotée par Kotlin) ----------
  var timers = new Map();
  var timerSeq = 0;
  function addTimer(fn, ms, args, interval) {
    var id = ++timerSeq;
    var delay = Math.max(0, Number(ms) || 0);
    timers.set(id, { fn: fn, args: args, ms: delay, interval: interval });
    __n_setTimer(id, delay);
    return id;
  }
  G.setTimeout = function (fn, ms) { return addTimer(fn, ms, Array.prototype.slice.call(arguments, 2), false); };
  G.setInterval = function (fn, ms) { return addTimer(fn, ms, Array.prototype.slice.call(arguments, 2), true); };
  G.clearTimeout = G.clearInterval = function (id) {
    if (timers.delete(id)) __n_clearTimer(id);
  };
  G.queueMicrotask = function (fn) { Promise.resolve().then(fn); };
  G.__movixFireTimer = function (id) {
    var t = timers.get(id);
    if (!t) return;
    if (t.interval) __n_setTimer(id, Math.max(t.ms, 4)); else timers.delete(id);
    if (typeof t.fn === "function") t.fn.apply(G, t.args);
  };

  // ---------- erreurs et événements ----------
  var DOM_CODES = { AbortError: 20, TimeoutError: 23, NotSupportedError: 9, InvalidStateError: 11, SyntaxError: 12 };
  function DOMException(message, name) {
    var e = new Error(message === undefined ? "" : String(message));
    Object.setPrototypeOf(e, DOMException.prototype);
    e.name = name || "Error";
    e.code = DOM_CODES[e.name] || 0;
    return e;
  }
  DOMException.prototype = Object.create(Error.prototype);
  DOMException.prototype.constructor = DOMException;
  G.DOMException = DOMException;

  function Event(type, init) {
    this.type = String(type);
    this.bubbles = !!(init && init.bubbles);
    this.cancelable = !!(init && init.cancelable);
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.timeStamp = Date.now();
  }
  Event.prototype.preventDefault = function () { if (this.cancelable) this.defaultPrevented = true; };
  Event.prototype.stopPropagation = function () {};
  Event.prototype.stopImmediatePropagation = function () { this._stop = true; };
  G.Event = Event;

  function CustomEvent(type, init) { Event.call(this, type, init); this.detail = init && "detail" in init ? init.detail : null; }
  CustomEvent.prototype = Object.create(Event.prototype);
  CustomEvent.prototype.constructor = CustomEvent;
  G.CustomEvent = CustomEvent;

  function MessageEvent(type, init) { Event.call(this, type, init); this.data = init ? init.data : undefined; this.source = init ? init.source : null; this.origin = init ? init.origin || "" : ""; }
  MessageEvent.prototype = Object.create(Event.prototype);
  MessageEvent.prototype.constructor = MessageEvent;
  G.MessageEvent = MessageEvent;

  function EventTarget() {}
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (typeof fn !== "function" && !(fn && typeof fn.handleEvent === "function")) return;
    var map = this.__listeners || (Object.defineProperty(this, "__listeners", { value: {}, enumerable: false }), this.__listeners);
    var list = map[type] || (map[type] = []);
    for (var i = 0; i < list.length; i++) if (list[i].fn === fn) return;
    list.push({ fn: fn, once: !!(opts && typeof opts === "object" && opts.once) });
  };
  EventTarget.prototype.removeEventListener = function (type, fn) {
    var list = this.__listeners && this.__listeners[type];
    if (!list) return;
    for (var i = list.length - 1; i >= 0; i--) if (list[i].fn === fn) list.splice(i, 1);
  };
  EventTarget.prototype.dispatchEvent = function (event) {
    try { if (event.target == null) event.target = this; } catch (e) {}
    try { event.currentTarget = this; } catch (e) {}
    var handler = this["on" + event.type];
    if (typeof handler === "function") { try { handler.call(this, event); } catch (e) { console.error(e); } }
    var list = this.__listeners && this.__listeners[event.type];
    if (list) {
      list = list.slice();
      for (var i = 0; i < list.length; i++) {
        var l = list[i];
        if (l.once) this.removeEventListener(event.type, l.fn);
        try { typeof l.fn === "function" ? l.fn.call(this, event) : l.fn.handleEvent(event); } catch (e) { console.error(e); }
        if (event._stop) break;
      }
    }
    return !event.defaultPrevented;
  };
  G.EventTarget = EventTarget;
  // La fenêtre elle-même reçoit des événements (« message », « movix-extension-loaded »).
  G.addEventListener = EventTarget.prototype.addEventListener;
  G.removeEventListener = EventTarget.prototype.removeEventListener;
  G.dispatchEvent = EventTarget.prototype.dispatchEvent;
  G.postMessage = function (data) {
    G.setTimeout(function () { G.dispatchEvent(new MessageEvent("message", { data: data, source: G, origin: G.location.origin })); }, 0);
  };

  // ---------- AbortController ----------
  function AbortSignal() { EventTarget.call(this); this.aborted = false; this.reason = undefined; this.onabort = null; }
  AbortSignal.prototype = Object.create(EventTarget.prototype);
  AbortSignal.prototype.constructor = AbortSignal;
  AbortSignal.prototype.throwIfAborted = function () { if (this.aborted) throw this.reason; };
  AbortSignal.prototype._abort = function (reason) {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason === undefined ? new DOMException("This operation was aborted", "AbortError") : reason;
    this.dispatchEvent(new Event("abort"));
  };
  AbortSignal.abort = function (reason) { var s = new AbortSignal(); s._abort(reason); return s; };
  AbortSignal.timeout = function (ms) {
    var s = new AbortSignal();
    G.setTimeout(function () { s._abort(new DOMException("The operation timed out", "TimeoutError")); }, ms);
    return s;
  };
  AbortSignal.any = function (signals) {
    var s = new AbortSignal();
    for (var i = 0; i < signals.length; i++) {
      (function (src) {
        if (src.aborted) s._abort(src.reason);
        else src.addEventListener("abort", function () { s._abort(src.reason); }, { once: true });
      })(signals[i]);
    }
    return s;
  };
  G.AbortSignal = AbortSignal;
  function AbortController() { this.signal = new AbortSignal(); }
  AbortController.prototype.abort = function (reason) { this.signal._abort(reason); };
  G.AbortController = AbortController;

  // ---------- encodages ----------
  function TextEncoder() { this.encoding = "utf-8"; }
  TextEncoder.prototype.encode = function (s) { return __n_utf8Encode(s === undefined ? "" : String(s)); };
  TextEncoder.prototype.encodeInto = function (s, dest) {
    var b = this.encode(s); var n = Math.min(b.length, dest.length); dest.set(b.subarray(0, n)); return { read: s.length, written: n };
  };
  G.TextEncoder = TextEncoder;
  function TextDecoder(label, opts) {
    this.encoding = String(label || "utf-8").toLowerCase();
    this.fatal = !!(opts && opts.fatal);
  }
  TextDecoder.prototype.decode = function (data) {
    if (data == null) return "";
    return __n_textDecode(u8(data), this.encoding);
  };
  G.TextDecoder = TextDecoder;
  G.atob = function (s) {
    var r = __n_atob(String(s));
    if (r === null) throw new DOMException("The string to be decoded is not correctly encoded.", "InvalidCharacterError");
    return r;
  };
  G.btoa = function (s) {
    var r = __n_btoa(String(s));
    if (r === null) throw new DOMException("The string to be encoded contains characters outside of the Latin1 range.", "InvalidCharacterError");
    return r;
  };

  // ---------- URL ----------
  function encodeForm(s) {
    return encodeURIComponent(s).replace(/%20/g, "+").replace(/[!'()~]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); });
  }
  function decodeForm(s) {
    s = s.replace(/\+/g, " ");
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }
  function URLSearchParams(init) {
    this._list = [];
    this._url = null;
    if (init == null) return;
    if (typeof init === "string") {
      var str = init.charAt(0) === "?" ? init.slice(1) : init;
      if (!str) return;
      var parts = str.split("&");
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        var eq = parts[i].indexOf("=");
        if (eq < 0) this._list.push([decodeForm(parts[i]), ""]);
        else this._list.push([decodeForm(parts[i].slice(0, eq)), decodeForm(parts[i].slice(eq + 1))]);
      }
    } else if (init instanceof URLSearchParams) {
      this._list = init._list.map(function (p) { return [p[0], p[1]]; });
    } else if (typeof init[Symbol.iterator] === "function") {
      var it = init[Symbol.iterator](), n;
      while (!(n = it.next()).done) this._list.push([String(n.value[0]), String(n.value[1])]);
    } else if (typeof init === "object") {
      for (var k in init) if (Object.prototype.hasOwnProperty.call(init, k)) this._list.push([k, String(init[k])]);
    }
  }
  URLSearchParams.prototype._update = function () { if (this._url) this._url._search = this._list.length ? "?" + this.toString() : ""; };
  URLSearchParams.prototype.append = function (k, v) { this._list.push([String(k), String(v)]); this._update(); };
  URLSearchParams.prototype.delete = function (k) { k = String(k); this._list = this._list.filter(function (p) { return p[0] !== k; }); this._update(); };
  URLSearchParams.prototype.get = function (k) { k = String(k); for (var i = 0; i < this._list.length; i++) if (this._list[i][0] === k) return this._list[i][1]; return null; };
  URLSearchParams.prototype.getAll = function (k) { k = String(k); return this._list.filter(function (p) { return p[0] === k; }).map(function (p) { return p[1]; }); };
  URLSearchParams.prototype.has = function (k) { return this.get(k) !== null; };
  URLSearchParams.prototype.set = function (k, v) {
    k = String(k); v = String(v);
    var found = false;
    this._list = this._list.filter(function (p) { if (p[0] !== k) return true; if (found) return false; found = true; p[1] = v; return true; });
    if (!found) this._list.push([k, v]);
    this._update();
  };
  URLSearchParams.prototype.sort = function () { this._list.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }); this._update(); };
  URLSearchParams.prototype.toString = function () { return this._list.map(function (p) { return encodeForm(p[0]) + "=" + encodeForm(p[1]); }).join("&"); };
  URLSearchParams.prototype.forEach = function (cb, thisArg) { var self = this; this._list.slice().forEach(function (p) { cb.call(thisArg, p[1], p[0], self); }); };
  URLSearchParams.prototype.entries = function () { return this._list.map(function (p) { return [p[0], p[1]]; })[Symbol.iterator](); };
  URLSearchParams.prototype.keys = function () { return this._list.map(function (p) { return p[0]; })[Symbol.iterator](); };
  URLSearchParams.prototype.values = function () { return this._list.map(function (p) { return p[1]; })[Symbol.iterator](); };
  URLSearchParams.prototype[Symbol.iterator] = URLSearchParams.prototype.entries;
  Object.defineProperty(URLSearchParams.prototype, "size", { get: function () { return this._list.length; } });
  G.URLSearchParams = URLSearchParams;

  var blobSeq = 0;
  function URL(url, base) {
    var parsed = __n_parseUrl(String(url), base === undefined || base === null ? null : String(base));
    if (parsed === null) throw new TypeError("Failed to construct 'URL': Invalid URL");
    this._apply(JSON.parse(parsed));
  }
  URL.prototype._apply = function (p) {
    this._protocol = p.protocol; this._username = p.username; this._password = p.password;
    this._hostname = p.hostname; this._port = p.port; this._pathname = p.pathname;
    this._search = p.search; this._hash = p.hash; this._opaque = !!p.opaque;
    this._params = null;
  };
  function prop(name, get, set) { Object.defineProperty(URL.prototype, name, { get: get, set: set, enumerable: true, configurable: true }); }
  prop("protocol", function () { return this._protocol; }, function (v) { v = String(v); this._protocol = v.charAt(v.length - 1) === ":" ? v : v + ":"; });
  prop("username", function () { return this._username; }, function (v) { this._username = String(v); });
  prop("password", function () { return this._password; }, function (v) { this._password = String(v); });
  prop("hostname", function () { return this._hostname; }, function (v) { this._hostname = String(v).toLowerCase(); });
  prop("port", function () { return this._port; }, function (v) { v = String(v); this._port = (this._protocol === "https:" && v === "443") || (this._protocol === "http:" && v === "80") ? "" : v; });
  prop("host", function () { return this._hostname + (this._port ? ":" + this._port : ""); }, function (v) { v = String(v); var i = v.lastIndexOf(":"); if (i > 0 && v.indexOf("]") < i) { this.hostname = v.slice(0, i); this.port = v.slice(i + 1); } else { this.hostname = v; this._port = ""; } });
  prop("origin", function () { return this._opaque ? "null" : this._protocol + "//" + this.host; });
  prop("pathname", function () { return this._pathname; }, function (v) { v = String(v); this._pathname = this._opaque || v.charAt(0) === "/" ? v : "/" + v; });
  prop("search", function () { return this._search; }, function (v) { v = String(v); this._search = !v || v === "?" ? "" : v.charAt(0) === "?" ? v : "?" + v; this._params = null; });
  prop("hash", function () { return this._hash; }, function (v) { v = String(v); this._hash = !v || v === "#" ? "" : v.charAt(0) === "#" ? v : "#" + v; });
  prop("searchParams", function () {
    if (!this._params) { this._params = new URLSearchParams(this._search); this._params._url = this; }
    return this._params;
  });
  prop("href", function () {
    if (this._opaque) return this._protocol + this._pathname + this._search + this._hash;
    var auth = this._username ? this._username + (this._password ? ":" + this._password : "") + "@" : "";
    return this._protocol + "//" + auth + this.host + this._pathname + this._search + this._hash;
  }, function (v) {
    var parsed = __n_parseUrl(String(v), null);
    if (parsed === null) throw new TypeError("Invalid URL");
    this._apply(JSON.parse(parsed));
  });
  URL.prototype.toString = function () { return this.href; };
  URL.prototype.toJSON = function () { return this.href; };
  URL.canParse = function (u, b) { try { new URL(u, b); return true; } catch (e) { return false; } };
  URL.parse = function (u, b) { try { return new URL(u, b); } catch (e) { return null; } };
  URL.createObjectURL = function () { return "blob:" + G.location.origin + "/movix-" + (++blobSeq); };
  URL.revokeObjectURL = function () {};
  G.URL = URL;

  // ---------- document, location, navigator ----------
  var element = function () {
    return { style: {}, dataset: {}, children: [], attributes: {}, setAttribute: function (k, v) { this.attributes[k] = String(v); },
      getAttribute: function (k) { return k in this.attributes ? this.attributes[k] : null; }, appendChild: function (c) { this.children.push(c); return c; },
      removeChild: function (c) { return c; }, remove: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
  };
  G.document = {
    readyState: "complete",
    documentElement: element(),
    head: element(),
    body: element(),
    createElement: element,
    createTextNode: function (t) { return { textContent: String(t) }; },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
    removeEventListener: function () {},
    cookie: "",
  };
  G.location = { href: "https://tv.movix.app/", protocol: "https:", host: "tv.movix.app", hostname: "tv.movix.app", port: "", origin: "https://tv.movix.app", pathname: "/", search: "", hash: "" };
  G.navigator = { userAgent: __n_userAgent(), language: "fr-FR", languages: ["fr-FR", "fr", "en-US", "en"], platform: "Linux armv8l", onLine: true, hardwareConcurrency: 4 };

  // ---------- crypto ----------
  function key(raw, algorithm, usages) { return { type: "secret", extractable: false, algorithm: algorithm, usages: usages || [], __raw: u8(raw).slice() }; }
  function algName(a) { return String(typeof a === "string" ? a : a && a.name).toUpperCase(); }
  G.crypto = {
    getRandomValues: function (arr) {
      var bytes = __n_randomBytes(arr.byteLength);
      new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(bytes);
      return arr;
    },
    randomUUID: function () { return __n_randomUUID(); },
    subtle: {
      digest: function (alg, data) {
        try { return Promise.resolve(toBuffer(__n_digest(algName(alg), u8(data)))); } catch (e) { return Promise.reject(e); }
      },
      importKey: function (format, keyData, algorithm, extractable, usages) {
        if (format !== "raw") return Promise.reject(new DOMException("Format de clé non pris en charge : " + format, "NotSupportedError"));
        return Promise.resolve(key(keyData, typeof algorithm === "string" ? { name: algorithm } : algorithm, usages));
      },
      decrypt: function (alg, k, data) { return cipher(false, alg, k, data); },
      encrypt: function (alg, k, data) { return cipher(true, alg, k, data); },
    },
  };
  function cipher(encrypt, alg, k, data) {
    try {
      var name = algName(alg);
      var iv = alg.iv != null ? u8(alg.iv) : alg.counter != null ? u8(alg.counter) : new Uint8Array(0);
      var out = __n_aes(encrypt, name, k.__raw, iv, u8(data), alg.tagLength || 128, alg.additionalData != null ? u8(alg.additionalData) : new Uint8Array(0));
      if (out === null) return Promise.reject(new DOMException("Échec du déchiffrement", "OperationError"));
      return Promise.resolve(toBuffer(out));
    } catch (e) { return Promise.reject(e); }
  }

  // ---------- Blob, FormData (instanceof et URL d'objets seulement) ----------
  function Blob(parts, opts) {
    var chunks = [], total = 0;
    (parts || []).forEach(function (p) {
      var b = typeof p === "string" ? __n_utf8Encode(p) : p instanceof Blob ? p._bytes : u8(p);
      chunks.push(b); total += b.length;
    });
    var all = new Uint8Array(total), off = 0;
    chunks.forEach(function (c) { all.set(c, off); off += c.length; });
    this._bytes = all;
    this.size = total;
    this.type = opts && opts.type ? String(opts.type) : "";
  }
  Blob.prototype.arrayBuffer = function () { return Promise.resolve(toBuffer(this._bytes)); };
  Blob.prototype.text = function () { return Promise.resolve(__n_textDecode(this._bytes, "utf-8")); };
  Blob.prototype.slice = function (a, b, type) { var n = new Blob([], { type: type }); n._bytes = this._bytes.slice(a, b); n.size = n._bytes.length; return n; };
  G.Blob = Blob;
  function FormData() { this._list = []; }
  FormData.prototype.append = function (k, v) { this._list.push([String(k), v]); };
  FormData.prototype.get = function (k) { for (var i = 0; i < this._list.length; i++) if (this._list[i][0] === k) return this._list[i][1]; return null; };
  G.FormData = FormData;
})();
