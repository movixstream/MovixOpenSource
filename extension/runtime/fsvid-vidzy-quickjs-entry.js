import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten-core';

const WASM_CDN_URL =
  'https://cdn.jsdelivr.net/npm/@jitl/quickjs-wasmfile-release-sync@0.32.0/dist/emscripten-module.wasm';
const WASM_SHA256 =
  '105c3bed22d457e43e3d1c3c1c6959fda62a8fe06f0fc8a985303c3a2be72232';
const MAX_WASM_BYTES = 600 * 1024;
const MAX_HTML_LENGTH = 512 * 1024;
const MAX_SCRIPT_LENGTH = 128 * 1024;
const MAX_TOTAL_SCRIPT_LENGTH = 256 * 1024;
const MAX_SCRIPT_COUNT = 16;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const STACK_LIMIT_BYTES = 512 * 1024;
// WASM is slower than the native Python binding on packed Fsvid scripts.
const EXECUTION_TIMEOUT_MS = 1500;
const MAX_MEDIA_URL_LENGTH = 16 * 1024;
const PLAYER_SIGNALS = Object.freeze([
  'videojs',
  'jwplayer',
  'sources',
  'atob(',
  'eval(function',
  'eval ( function',
  '.m3u8',
]);

let quickJsModulePromise;

export function isAllowedEmbedUrl(rawUrl, provider) {
  if (provider !== 'fsvid' && provider !== 'vidzy') return false;

  try {
    const parsed = new URL(String(rawUrl || '').trim());
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      (!parsed.port || parsed.port === '443') &&
      Boolean(parsed.hostname) &&
      /\/embed(?:[-/])/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function normalizeProviderMediaUrl(rawCandidate, embedUrl, provider) {
  if (!isAllowedEmbedUrl(embedUrl, provider)) return null;

  const candidate = String(rawCandidate || '')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .trim()
    .replace(/\\+$/, '');
  if (
    !candidate ||
    candidate.length > MAX_MEDIA_URL_LENGTH ||
    !candidate.toLowerCase().includes('.m3u8') ||
    candidate.toLowerCase().includes('troll')
  ) {
    return null;
  }

  try {
    const parsed = /^https:\/\//i.test(candidate)
      ? new URL(candidate)
      : new URL(candidate, embedUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== '443') ||
      !parsed.hostname ||
      !parsed.pathname.toLowerCase().includes('.m3u8') ||
      parsed.href.length > MAX_MEDIA_URL_LENGTH
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function selectInlineScripts(html) {
  if (typeof html !== 'string' || html.length > MAX_HTML_LENGTH) return [];

  const scripts = [];
  let totalLength = 0;
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] || '';
    const source = (match[2] || '').trim();
    if (
      !source ||
      source.length > MAX_SCRIPT_LENGTH ||
      /\bsrc\s*=/i.test(attributes) ||
      /\btype\s*=\s*["'](?:application\/json|application\/ld\+json|module)["']/i.test(
        attributes,
      )
    ) {
      continue;
    }
    const lowered = source.toLowerCase();
    if (!PLAYER_SIGNALS.some(signal => lowered.includes(signal))) continue;
    if (scripts.length >= MAX_SCRIPT_COUNT) break;
    if (totalLength + source.length > MAX_TOTAL_SCRIPT_LENGTH) break;
    scripts.push(source);
    totalLength += source.length;
  }
  return scripts;
}

function getExtensionRuntime() {
  return globalThis.chrome?.runtime || globalThis.browser?.runtime || null;
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function downloadVerifiedWasm() {
  const response = await fetch(WASM_CDN_URL, {
    cache: 'force-cache',
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`quickjs_wasm_http_${response.status}`);

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_WASM_BYTES) throw new Error('quickjs_wasm_too_large');

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_WASM_BYTES) {
    throw new Error('quickjs_wasm_invalid_size');
  }

  const digest = await crypto.subtle.digest('SHA-256', buffer);
  if (bytesToHex(new Uint8Array(digest)) !== WASM_SHA256) {
    throw new Error('quickjs_wasm_hash_mismatch');
  }
  return new Uint8Array(buffer);
}

async function getQuickJsModule() {
  if (!quickJsModulePromise) {
    const extensionRuntime = getExtensionRuntime();
    quickJsModulePromise = (async () => {
      // Node-based source tests keep using the package's local WASM. Real
      // extension runtimes download the immutable, hash-pinned CDN asset.
      const variant = extensionRuntime
        ? newVariant(RELEASE_SYNC, {
            wasmBinary: await downloadVerifiedWasm(),
            wasmLocation: WASM_CDN_URL,
            log: () => {},
          })
        : RELEASE_SYNC;
      return newQuickJSWASMModuleFromVariant(variant);
    })().catch(error => {
      quickJsModulePromise = undefined;
      throw error;
    });
  }
  return quickJsModulePromise;
}

export function createBootstrap(embedUrl) {
  const urlObj = new URL(embedUrl);
  const safeEmbedUrl = JSON.stringify(embedUrl);
  const safeEmbedOrigin = JSON.stringify(urlObj.origin);
  const safeEmbedHostname = JSON.stringify(urlObj.hostname);
  const safeEmbedHost = JSON.stringify(urlObj.host);
  const safeEmbedPathname = JSON.stringify(urlObj.pathname || '');
  const safeEmbedSearch = JSON.stringify(urlObj.search || '');
  const safeEmbedHash = JSON.stringify(urlObj.hash || '');
  const safeEmbedPort = JSON.stringify(urlObj.port || '');
  return `
    'use strict';
    var __movixCandidates = [];
    var __movixMaxCandidates = 64;
    var __movixMaxString = ${MAX_MEDIA_URL_LENGTH};
    var __movixSeen = new WeakSet();
    function __movixCapture(value, depth) {
      depth = depth || 0;
      if (depth > 6 || value == null || __movixCandidates.length >= __movixMaxCandidates) return;
      if (typeof value === 'string') {
        if (value.length <= __movixMaxString && value.toLowerCase().indexOf('.m3u8') !== -1) {
          __movixCandidates.push(value);
        }
        return;
      }
      if ((typeof value !== 'object' && typeof value !== 'function') || __movixSeen.has(value)) return;
      __movixSeen.add(value);
      var keys;
      try { keys = Object.keys(value); } catch (_) { return; }
      for (var j = 0; j < keys.length && j < 64; j++) {
        try { __movixCapture(value[keys[j]], depth + 1); } catch (_) {}
      }
    }
    function atob(input) {
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      var value = String(input).replace(/[\\t\\n\\f\\r ]/g, '').replace(/-/g, '+').replace(/_/g, '/');
      if (value.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(value)) throw new TypeError('Invalid base64');
      value = value.replace(/=+$/, '');
      var output = '';
      var buffer = 0;
      var bits = 0;
      for (var i = 0; i < value.length; i++) {
        var index = chars.indexOf(value.charAt(i));
        if (index < 0) throw new TypeError('Invalid base64');
        buffer = (buffer << 6) | index;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          output += String.fromCharCode((buffer >> bits) & 255);
        }
      }
      return output;
    }
    function btoa(input) {
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      var value = String(input);
      var output = '';
      for (var i = 0; i < value.length; i += 3) {
        var a = value.charCodeAt(i);
        var b = value.charCodeAt(i + 1);
        var c = value.charCodeAt(i + 2);
        if (a > 255 || b > 255 || c > 255) throw new TypeError('Invalid character');
        output += chars.charAt(a >> 2);
        output += chars.charAt(((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4));
        output += isNaN(b) ? '=' : chars.charAt(((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6));
        output += isNaN(c) ? '=' : chars.charAt(c & 63);
      }
      return output;
    }
    var __movixChainTarget = function () {};
    var __movixChain = new Proxy(__movixChainTarget, {
      apply: function (_target, _thisArg, args) {
        for (var i = 0; i < args.length; i++) __movixCapture(args[i], 0);
        return __movixChain;
      },
      construct: function (_target, args) {
        for (var i = 0; i < args.length; i++) __movixCapture(arguments[i], 0);
        return __movixChain;
      },
      get: function (_target, property) {
        if (property === 'then') return undefined;
        if (property === Symbol.toPrimitive) return function () { return ''; };
        return __movixChain;
      },
      set: function () { return true; }
    });
    function __movixPlayerFactory() {
      for (var i = 0; i < arguments.length; i++) __movixCapture(arguments[i], 0);
      return __movixChain;
    }
    __movixPlayerFactory.addLanguage = __movixPlayerFactory;
    __movixPlayerFactory.getPlayers = function () { return {}; };
    // Le lecteur mesure un div caché (\`width:calc(1in + 43px)\` → 139 px CSS
    // dans un vrai navigateur) : on garde le dernier style posé pour le relire.
    var __movixLastCss = '';
    var __movixCssUnits = { px: 1, 'in': 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16, q: 96 / 101.6 };
    function __movixMeasuredPx(axis) {
      var declaration = new RegExp('(?:^|[;\\\\s])' + axis + '\\\\s*:\\\\s*([^;]+)', 'i').exec(__movixLastCss);
      if (!declaration) return 96;
      var termPattern = /([-+]?)\\s*(\\d+(?:\\.\\d+)?)\\s*(px|in|cm|mm|pt|pc|q)\\b/gi;
      var total = 0;
      var found = false;
      var term;
      while ((term = termPattern.exec(declaration[1])) !== null) {
        total += (term[1] === '-' ? -1 : 1) * parseFloat(term[2]) * __movixCssUnits[term[3].toLowerCase()];
        found = true;
      }
      return found ? Math.round(total) : 96;
    }
    var __movixLooseObject = new Proxy(function () {}, {
      apply: function () { return __movixLooseObject; },
      construct: function () { return __movixLooseObject; },
      get: function (_target, property) {
        if (property === 'canPlayType') return function (type) { return type && (type.indexOf('hls') !== -1 || type.indexOf('mpegURL') !== -1 || type.indexOf('mp4') !== -1) ? 'probably' : 'maybe'; };
        if (property === 'getAttribute') return function (attr) { return attr === 'src' ? '' : 'true'; };
        if (property === 'hasAttribute') return function () { return true; };
        if (property === 'referrer') return ${safeEmbedOrigin};
        if (property === 'offsetWidth' || property === 'clientWidth') return __movixMeasuredPx('width');
        if (property === 'offsetHeight' || property === 'clientHeight') return __movixMeasuredPx('height');
        if (property === 'then') return undefined;
        if (property === Symbol.toPrimitive) return function () { return ''; };
        return __movixLooseObject;
      },
      set: function (_target, property, value) {
        if (property === 'cssText') __movixLastCss = String(value);
        else if (property === 'width' || property === 'height') __movixLastCss += ';' + property + ':' + String(value);
        return true;
      }
    });
    var console = { log: function(){}, info: function(){}, warn: function(){}, error: function(){}, debug: function(){} };
    var location = {
      href: ${safeEmbedUrl},
      origin: ${safeEmbedOrigin},
      hostname: ${safeEmbedHostname},
      host: ${safeEmbedHost},
      pathname: ${safeEmbedPathname},
      search: ${safeEmbedSearch},
      hash: ${safeEmbedHash},
      port: ${safeEmbedPort},
      ancestorOrigins: [${safeEmbedOrigin}],
      protocol: 'https:'
    };
    var navigator = { userAgent: 'Mozilla/5.0 Chrome/140.0.0.0', language: 'fr-FR' };
    var document = __movixLooseObject;
    var videojs = __movixPlayerFactory;
    var player = __movixPlayerFactory;
    var jwplayer = __movixPlayerFactory;
    var fluidPlayer = __movixPlayerFactory;
    var Playerjs = __movixPlayerFactory;
    var Clappr = { Player: __movixPlayerFactory };
    function setTimeout(callback) { if (typeof callback === 'function') callback(); return 1; }
    function clearTimeout() {}
    function setInterval() { return 0; }
    function clearInterval() {}
    function requestAnimationFrame() { return 0; }
    function cancelAnimationFrame() {}
    function addEventListener() {}
    var fetch = undefined;
    var XMLHttpRequest = undefined;
    var WebSocket = undefined;
    var EventSource = undefined;
    var Worker = undefined;
    var SharedWorker = undefined;
    var window = globalThis;
    var self = globalThis;
  `;
}

function disposeResult(result) {
  try {
    if (result?.error) result.error.dispose();
    else result?.value?.dispose();
  } catch {
    // The runtime is disposed immediately afterwards.
  }
}

export async function extractPlayerM3u8(html, embedUrl, provider) {
  if (!isAllowedEmbedUrl(embedUrl, provider)) return null;
  const scripts = selectInlineScripts(html);
  if (!scripts.length) return null;

  let QuickJS;
  try {
    QuickJS = await getQuickJsModule();
  } catch (error) {
    console.warn('[MovixQuickJS] runtime unavailable:', error?.message || error);
    return null;
  }

  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(STACK_LIMIT_BYTES);
  const deadline = Date.now() + EXECUTION_TIMEOUT_MS;
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const context = runtime.newContext();

  try {
    const bootstrapResult = context.evalCode(createBootstrap(embedUrl), 'movix-bootstrap.js');
    if (bootstrapResult.error) {
      disposeResult(bootstrapResult);
      return null;
    }
    disposeResult(bootstrapResult);

    for (let index = 0; index < scripts.length; index++) {
      const result = context.evalCode(scripts[index], `player-script-${index + 1}.js`);
      disposeResult(result);
      if (Date.now() > deadline) break;
    }

    const captureResult = context.evalCode(`
      (function () {
        var names = ['sources', 'source', 'file', 'hls', 'hlsUrl', 'm3u8', 'config', 'playerConfig'];
        for (var i = 0; i < names.length; i++) {
          try { __movixCapture(globalThis[names[i]]); } catch (_) {}
        }
        return JSON.stringify(__movixCandidates);
      })()
    `, 'movix-result.js');
    if (captureResult.error) {
      disposeResult(captureResult);
      return null;
    }
    const dumped = context.dump(captureResult.value);
    disposeResult(captureResult);
    const candidates = JSON.parse(String(dumped || '[]'));
    for (const candidate of candidates) {
      const normalized = normalizeProviderMediaUrl(candidate, embedUrl, provider);
      if (normalized) return normalized;
    }
    return null;
  } catch {
    return null;
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

globalThis.MovixQuickJS = Object.freeze({ extractPlayerM3u8 });
