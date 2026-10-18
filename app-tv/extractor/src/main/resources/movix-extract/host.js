/*
 * Hôte du userscript : API Greasemonkey (GM_*) branchées sur Kotlin, point
 * d'entrée des extractions, et cale QuickJS pour Fsvid / Vidzy.
 *
 * Réseau : GM_xmlhttpRequest appelle __n_request (synchrone, rend la main
 * tout de suite) ; Kotlin fait la requête puis appelle __movixOnResponse(id).
 */
(function () {
  "use strict";
  var G = globalThis;
  var u8 = G.__movixU8;
  var toBuffer = G.__movixToBuffer;

  // ---------- GM_xmlhttpRequest ----------
  var requests = new Map();
  var requestSeq = 0;

  function GM_xmlhttpRequest(d) {
    var id = ++requestSeq;
    var headers = {};
    if (d.headers) {
      for (var k in d.headers) if (Object.prototype.hasOwnProperty.call(d.headers, k) && d.headers[k] != null) headers[k] = String(d.headers[k]);
    }
    var text = null, bytes = null;
    if (d.data != null) {
      if (typeof d.data === "string") text = d.data;
      else if (d.data instanceof G.URLSearchParams) text = d.data.toString();
      else if (d.data instanceof G.Blob) bytes = d.data._bytes;
      else if (d.data instanceof G.FormData) text = d.data._list.map(function (p) { return encodeURIComponent(p[0]) + "=" + encodeURIComponent(String(p[1])); }).join("&");
      else bytes = u8(d.data);
    }
    requests.set(id, d);
    __n_request(id, String(d.method || "GET").toUpperCase(), String(d.url), JSON.stringify(headers), text, bytes, Number(d.timeout) > 0 ? Number(d.timeout) : 30000);
    return {
      abort: function () {
        if (!requests.delete(id)) return;
        __n_abortRequest(id);
        if (typeof d.onabort === "function") d.onabort({ status: 0, statusText: "abort" });
        if (typeof d.onloadend === "function") d.onloadend({ status: 0 });
      },
    };
  }

  G.__movixOnResponse = function (id) {
    var d = requests.get(id);
    if (!d) { __n_dropResponse(id); return; }
    requests.delete(id);
    var meta = JSON.parse(__n_responseMeta(id));
    if (meta.error) {
      __n_dropResponse(id);
      var failure = { status: 0, statusText: meta.error, error: meta.error, finalUrl: String(d.url), responseHeaders: "" };
      if (meta.timeout && typeof d.ontimeout === "function") d.ontimeout(failure);
      else if (typeof d.onerror === "function") d.onerror(failure);
      if (typeof d.onloadend === "function") d.onloadend(failure);
      return;
    }
    var bytes = __n_responseBody(id);
    var text = null;
    var decode = function () { return text === null ? (text = __n_textDecode(bytes, meta.charset || "utf-8")) : text; };
    var type = d.responseType;
    var response;
    if (type === "arraybuffer") response = toBuffer(bytes);
    else if (type === "blob") response = new G.Blob([bytes], { type: meta.contentType || "" });
    else if (type === "json") { try { response = JSON.parse(decode()); } catch (e) { response = null; } }
    else response = decode();
    var r = {
      readyState: 4,
      status: meta.status,
      statusText: meta.statusText,
      responseHeaders: meta.headers,
      finalUrl: meta.finalUrl,
      response: response,
      context: d.context,
    };
    Object.defineProperty(r, "responseText", { get: decode, enumerable: true });
    if (typeof d.onload === "function") d.onload(r);
    if (typeof d.onloadend === "function") d.onloadend(r);
  };

  // ---------- stockage (mémoire du processus) ----------
  var store = new Map();
  G.GM_xmlhttpRequest = GM_xmlhttpRequest;
  G.GM_getValue = function (k, fallback) { return store.has(k) ? store.get(k) : fallback; };
  G.GM_setValue = function (k, v) { store.set(k, v); };
  G.GM_deleteValue = function (k) { store.delete(k); };
  G.GM_listValues = function () { return Array.from(store.keys()); };
  G.GM_info = { script: { name: "Movix", version: "tv" }, scriptHandler: "MovixTV", version: "1" };
  G.GM = {
    xmlHttpRequest: GM_xmlhttpRequest,
    getValue: function (k, f) { return Promise.resolve(G.GM_getValue(k, f)); },
    setValue: function (k, v) { return Promise.resolve(G.GM_setValue(k, v)); },
    deleteValue: function (k) { return Promise.resolve(G.GM_deleteValue(k)); },
    info: G.GM_info,
  };
  // Pas de GM_openMediaProxy : le lecteur natif pose lui-même les en-têtes.

  // ---------- cale QuickJS (Fsvid / Vidzy) ----------
  // Le userscript charge d'habitude un QuickJS compilé en WebAssembly depuis
  // jsDelivr ; ici ses appels vont à un second QuickJS natif, côté Kotlin.
  function Handle(value) { this.value = value; }
  Handle.prototype.dispose = function () {};
  function Context(runtime) { this._rt = runtime; this._id = -1; }
  Context.prototype._ensure = function () {
    if (this._id < 0) this._id = __n_sandboxCreate(this._rt._memory, this._rt._stack);
    return this._id;
  };
  Context.prototype.evalCode = function (code, filename) {
    var remaining = this._rt._deadline > 0 ? Math.max(1, this._rt._deadline - Date.now()) : 0;
    var res = JSON.parse(__n_sandboxEval(this._ensure(), String(code), String(filename || "eval.js"), remaining));
    return res.ok ? { value: new Handle(res.value) } : { error: new Handle(res.error) };
  };
  Context.prototype.dump = function (handle) { return handle ? handle.value : undefined; };
  Context.prototype.dispose = function () { if (this._id >= 0) { __n_sandboxDispose(this._id); this._id = -1; } };
  function Runtime() { this._memory = 32 * 1024 * 1024; this._stack = 512 * 1024; this._deadline = 0; }
  Runtime.prototype.setMemoryLimit = function (n) { this._memory = Number(n) || this._memory; };
  Runtime.prototype.setMaxStackSize = function (n) { this._stack = Number(n) || this._stack; };
  Runtime.prototype.setInterruptHandler = function (deadline) { this._deadline = typeof deadline === "number" ? deadline : 0; };
  Runtime.prototype.newContext = function () { return new Context(this); };
  Runtime.prototype.dispose = function () {};
  G.__movixNativeQJS = {
    getQuickJS: function () { return Promise.resolve({ newRuntime: function () { return new Runtime(); } }); },
    // L'appelant passe une date limite ; la cale la transmet telle quelle.
    shouldInterruptAfterDeadline: function (deadline) { return Number(deadline) || 0; },
  };

  // ---------- extractions ----------
  G.__movixExtract = function (id, url) {
    Promise.resolve()
      .then(function () {
        if (typeof G.movixExtractM3u8 !== "function") throw new Error("Userscript non chargé");
        return G.movixExtractM3u8(null, url);
      })
      .then(function (r) {
        var prep = null;
        var stream = r && r.success !== false ? r.hlsUrl || r.m3u8Url || (r.hlsCandidates && r.hlsCandidates[0] && r.hlsCandidates[0].url) : null;
        if (stream && typeof G.__MOVIX_PREPARE_CAST_SOURCE__ === "function") {
          try { prep = G.__MOVIX_PREPARE_CAST_SOURCE__({ type: "CAST_PREPARE_SOURCE", url: stream }); } catch (e) { prep = null; }
        }
        __n_extractDone(id, JSON.stringify({ result: r || null, stream: stream || null, prepared: prep }));
      })
      .catch(function (e) {
        __n_extractDone(id, JSON.stringify({ result: { success: false, error: String((e && e.message) || e) }, stream: null, prepared: null }));
      });
  };
})();
