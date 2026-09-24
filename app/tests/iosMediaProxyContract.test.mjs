import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = new URL('../', import.meta.url);
const read = relativePath => readFile(new URL(relativePath, ROOT), 'utf8');
const capability = 'a'.repeat(32);
const documentGeneration = 'b'.repeat(32);
const token43 = character => character.repeat(43);
const validIOSLocalURL = port =>
  `http://127.0.0.1:${port}/p/${token43('A')}/${token43('b')}/${token43('_')}`;

async function loadBridge({ platform = 'ios', openResult = validIOSLocalURL(28123) } = {}) {
  const mediaHeaderSource = await read('src/services/mediaProxyHeaders.ts');
  const mediaHeaderModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(mediaHeaderSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: mediaHeaderModule, exports: mediaHeaderModule.exports });
  const source = await read('src/services/bridge.ts');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'bridge.ts',
  });

  const openCalls = [];
  const nativeModules = {
    MediaProxy: {
      async open(...args) {
        openCalls.push(args);
        if (openResult instanceof Error) throw openResult;
        return typeof openResult === 'function' ? openResult(...args) : openResult;
      },
      async resolveForCast() {
        throw new Error('unused');
      },
    },
  };
  const noop = () => {};
  const asyncNoop = async () => undefined;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === 'react-native') {
        return { NativeModules: nativeModules, Platform: { OS: platform } };
      }
      if (specifier === './mediaProxyHeaders') {
        return mediaHeaderModule.exports;
      }
      if (specifier === './castLoadSingleFlight') {
        return {
          createCastLoadIdentity: () => 'unused',
          createCastLoadSingleFlight: () => ({ run: asyncNoop }),
        };
      }
      if (specifier === './cast') {
        return new Proxy({}, {
          get: (_target, property) =>
            String(property).startsWith('subscribe') ? () => noop : asyncNoop,
        });
      }
      if (specifier === './playbackAwake') return { setPlaybackAwakeOwner: noop };
      if (specifier === './pictureInPicture') {
        return {
          enterPictureInPicture: asyncNoop,
          exitPictureInPicture: asyncNoop,
          setPictureInPicturePlaybackActive: noop,
          subscribePictureInPicture: () => noop,
        };
      }
      if (specifier === './networkJournal') {
        // Journal de diagnostic : inerte ici, il ne doit rien changer au pont.
        return { recordJournalEntry: noop };
      }
      if (specifier === './diagnosticReport') return { recordCastDiagnostic: noop, diagnosticErrorCode: (_error, fallback) => fallback, diagnosticErrorDetails: (_error, fallback) => fallback };
      if (specifier === './diagnostics') return { copyDiagnostics: asyncNoop };
      throw new Error(`Unexpected bridge dependency: ${specifier}`);
    },
    AbortController,
    Headers,
    Map,
    Number,
    Object,
    Promise,
    Response,
    Set,
    String,
    URL,
    WeakMap,
    console,
    fetch: async () => {
      throw new Error('unused');
    },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(outputText, sandbox, { filename: 'bridge.cjs' });
  return { bridge: module.exports, openCalls };
}

async function loadBridgeRuntimeBuilder() {
  let source = await read('src/injection/bridge-runtime.ts');
  source = source.replace(
    /import\s+\{\s*MEDIA_ENTRY_PATH_SOURCE\s*\}\s+from\s+['"]\.\/mediaProxyRouting['"];\s*/,
    `const MEDIA_ENTRY_PATH_SOURCE = ${JSON.stringify(String.raw`\.(?:m3u8|mp4)(?:$|[?#])`)};\n`,
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'bridge-runtime.ts',
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports });
  return module.exports.buildBridgeRuntime;
}

function makeWebViewHarness() {
  const responses = [];
  class CustomEvent {
    constructor(_type, init = {}) {
      this.detail = init.detail;
    }
  }
  const ref = {
    current: {
      injectJavaScript(script) {
        vm.runInNewContext(script, {
          CustomEvent,
          window: {
            dispatchEvent(event) {
              responses.push(event.detail);
            },
          },
        });
      },
    },
  };
  return { ref, responses };
}

const trustedContext = (overrides = {}) => ({
  sourceUrl: 'https://movix.tax/watch/movie/1',
  topLevelUrl: 'https://movix.tax/watch/movie/1',
  trustedOrigins: ['https://movix.tax/'],
  isTopFrame: false,
  navigationGeneration: 7,
  ...overrides,
});

async function registerIOSCapability(
  bridge,
  ref,
  context = trustedContext(),
  authorization = { capability, generation: documentGeneration },
) {
  await bridge.handleBridgeMessage(JSON.stringify({
    type: 'GM_MEDIA_PROXY_REGISTER_CAPABILITY',
    ...authorization,
  }), ref, context);
}

async function openMedia(bridge, ref, context = trustedContext(), overrides = {}) {
  await bridge.handleBridgeMessage(JSON.stringify({
    type: 'GM_OPEN_MEDIA_PROXY',
    id: `open-${Math.random()}`,
    capability,
    generation: documentGeneration,
    url: 'https://cdn.example/movie/master.m3u8',
    method: 'GET',
    headers: { Referer: 'https://movix.tax/' },
    ...overrides,
  }), ref, context);
}

test('iOS runtime keeps capability material lexical and sends it only with proxy messages', async () => {
  const buildBridgeRuntime = await loadBridgeRuntimeBuilder();
  const listeners = new Map();
  const posted = [];
  let randomFill = 0x10;
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const window = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) || []) handler(event);
    },
    crypto: {
      getRandomValues(bytes) {
        randomFill += 1;
        bytes.fill(randomFill);
        return bytes;
      },
    },
    fetch: async () => {
      throw new Error('unused');
    },
  };
  window.ReactNativeWebView = {
    postMessage(raw) {
      const message = JSON.parse(raw);
      posted.push(message);
      if (message.type === 'GM_OPEN_MEDIA_PROXY') {
        window.dispatchEvent(new CustomEvent('__MOVIX_BRIDGE_RESPONSE', {
          detail: {
            id: message.id,
            success: true,
            value: validIOSLocalURL(28123),
          },
        }));
      }
    },
  };
  const context = vm.createContext({
    ArrayBuffer,
    CustomEvent,
    Promise,
    URLSearchParams,
    Uint8Array,
    atob,
    clearTimeout: () => {},
    console,
    setTimeout: () => 1,
    window,
  });
  vm.runInContext(buildBridgeRuntime({
    mediaProxyRoutingEnabled: true,
    mediaProxyCapabilityEnabled: true,
  }), context);

  const localURL = await window.GM_openMediaProxy({
    url: 'https://cdn.example/movie/master.m3u8',
    headers: {},
  });
  assert.equal(localURL, validIOSLocalURL(28123));
  assert.deepEqual(posted.map(message => message.type), [
    'GM_MEDIA_PROXY_REGISTER_CAPABILITY',
    'GM_OPEN_MEDIA_PROXY',
  ]);
  assert.match(posted[0].capability, /^[a-f0-9]{32}$/);
  assert.match(posted[0].generation, /^[a-f0-9]{32}$/);
  assert.equal(posted[1].capability, posted[0].capability);
  assert.equal(posted[1].generation, posted[0].generation);
  assert.notEqual(posted[0].capability, posted[0].generation);
  assert.equal(window.__MOVIX_MEDIA_PROXY_CAPABILITY, undefined);
  assert.equal(window.__MOVIX_MEDIA_PROXY_GENERATION, undefined);
});

test('trusted iOS main-document capability opens the native proxy without isTopFrame', async () => {
  const { bridge, openCalls } = await loadBridge();
  const { ref, responses } = makeWebViewHarness();

  await registerIOSCapability(bridge, ref);
  await openMedia(bridge, ref);

  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0][0], 'https://cdn.example/movie/master.m3u8');
  assert.equal(openCalls[0][1], 'GET');
  assert.equal(JSON.stringify(openCalls[0][2]), JSON.stringify({
    Referer: 'https://movix.tax/',
  }));
  assert.equal(responses.at(-1)?.success, true);
  assert.equal(responses.at(-1)?.value, validIOSLocalURL(28123));
});

test('iOS rejects subframe, untrusted, mismatched, and stale capabilities immediately', async () => {
  const { bridge, openCalls } = await loadBridge();
  const { ref, responses } = makeWebViewHarness();

  const rejectedContexts = [
    trustedContext({
      sourceUrl: 'https://frame.attacker.invalid/embed',
    }),
    trustedContext({
      sourceUrl: 'https://untrusted.invalid/watch',
      topLevelUrl: 'https://untrusted.invalid/watch',
    }),
    trustedContext({
      sourceUrl: 'https://movix.tax/iframe',
    }),
  ];
  for (const context of rejectedContexts) {
    await registerIOSCapability(bridge, ref, context);
    await openMedia(bridge, ref, context);
    assert.equal(JSON.stringify(responses.at(-1)), JSON.stringify({
      id: responses.at(-1).id,
      success: false,
      error: 'Local media proxy unavailable',
    }));
  }
  assert.equal(openCalls.length, 0);

  await registerIOSCapability(bridge, ref);
  await openMedia(bridge, ref, trustedContext(), { capability: 'c'.repeat(32) });
  assert.equal(openCalls.length, 0);
  assert.equal(responses.at(-1)?.error, 'Local media proxy unavailable');

  bridge.clearBridgeCapabilities(ref);
  await registerIOSCapability(bridge, ref);
  await openMedia(bridge, ref, trustedContext({ navigationGeneration: 8 }));
  assert.equal(openCalls.length, 0);
  assert.equal(responses.at(-1)?.error, 'Local media proxy unavailable');

  const freshAuthorization = {
    capability: 'c'.repeat(32),
    generation: 'd'.repeat(32),
  };
  const nextNavigation = trustedContext({ navigationGeneration: 8 });
  await registerIOSCapability(bridge, ref, nextNavigation, freshAuthorization);
  await openMedia(bridge, ref, nextNavigation, freshAuthorization);
  assert.equal(openCalls.length, 1);
  assert.equal(responses.at(-1)?.success, true);
});

test('iOS sends the provider encoding and origin to the native media proxy', async () => {
  const { bridge, openCalls } = await loadBridge();
  const { ref, responses } = makeWebViewHarness();
  await registerIOSCapability(bridge, ref);

  for (const [host, origin] of [
    ['r1.fsvid.lol', 'https://fsvid.lol'],
    ['u14.vidzy.cc', 'https://vidzy.org'],
    ['strm4.uqload.vc', 'https://uqload.vc'],
    ['strm1.uqload.bz', 'https://uqload.bz'],
  ]) {
    await openMedia(bridge, ref, trustedContext(), {
      url: `https://${host}/master.m3u8`,
      headers: { Origin: 'https://movix.tax', Referer: 'https://movix.tax/', Range: 'bytes=0-1023' },
    });
    assert.equal(responses.at(-1)?.success, true);
    const headers = openCalls.at(-1)[2];
    assert.equal(headers.Origin, origin);
    assert.equal(headers.Referer, `${origin}/`);
    assert.equal(headers.Range, 'bytes=0-1023');
    assert.equal(headers['Accept-Encoding'], 'identity, gzip;q=0, deflate;q=0, br;q=0, zstd;q=0');
  }
});

test('iOS accepts only canonical 43-token loopback URLs and bounded ports', async () => {
  let localURL = validIOSLocalURL(1);
  const { bridge } = await loadBridge({ openResult: () => localURL });
  const { ref, responses } = makeWebViewHarness();
  await registerIOSCapability(bridge, ref);

  for (const accepted of [validIOSLocalURL(1), validIOSLocalURL(65535)]) {
    localURL = accepted;
    await openMedia(bridge, ref);
    assert.equal(responses.at(-1)?.success, true, accepted);
  }

  const path = `/p/${token43('A')}/${token43('b')}/${token43('_')}`;
  const invalid = [
    `http://127.0.0.1:0${path}`,
    `http://127.0.0.1:65536${path}`,
    `http://127.0.0.1:01${path}`,
    `HTTP://127.0.0.1:1${path}`,
    `http://localhost:1${path}`,
    `http://user@127.0.0.1:1${path}`,
    `http://127.0.0.1:1/p/${token43('A').slice(1)}/${token43('b')}/${token43('_')}`,
    `http://127.0.0.1:1/p/${token43('A')}A/${token43('b')}/${token43('_')}`,
    `http://127.0.0.1:1/p/${token43('A')}/${token43('b')}/${'+'.repeat(43)}`,
    `http://127.0.0.1:1${path}/`,
    `http://127.0.0.1:1${path}?query=1`,
    `http://127.0.0.1:1${path}#fragment`,
    `http://127.0.0.1:1\\p\\${token43('A')}\\${token43('b')}\\${token43('_')}`,
    `http://127.0.0.1:1${path}\n`,
  ];
  for (const rejected of invalid) {
    localURL = rejected;
    await openMedia(bridge, ref);
    assert.equal(responses.at(-1)?.success, false, rejected);
    assert.equal(responses.at(-1)?.error, 'Local media proxy unavailable');
  }
});

test('iOS native failures expose only the generic proxy error', async () => {
  const { bridge } = await loadBridge({
    openResult: new Error('https://secret.invalid/path?token=sensitive'),
  });
  const { ref, responses } = makeWebViewHarness();
  await registerIOSCapability(bridge, ref);
  await openMedia(bridge, ref);

  assert.equal(JSON.stringify(responses.at(-1)), JSON.stringify({
    id: responses.at(-1).id,
    success: false,
    error: 'Local media proxy unavailable',
  }));
  assert.doesNotMatch(JSON.stringify(responses), /secret|token|sensitive/i);
});

test('navigation revocation suppresses an in-flight iOS proxy result', async () => {
  let finishOpen;
  const pendingNativeOpen = new Promise(resolve => {
    finishOpen = resolve;
  });
  const { bridge, openCalls } = await loadBridge({
    openResult: () => pendingNativeOpen,
  });
  const { ref, responses } = makeWebViewHarness();
  await registerIOSCapability(bridge, ref);

  const pendingMessage = openMedia(bridge, ref);
  await Promise.resolve();
  assert.equal(openCalls.length, 1);
  bridge.clearBridgeCapabilities(ref);
  finishOpen(validIOSLocalURL(28123));
  await pendingMessage;

  assert.equal(responses.at(-1)?.success, false);
  assert.equal(responses.at(-1)?.error, 'Local media proxy unavailable');
});

test('Android retains top-frame provenance and its historical 24-token local URL', async () => {
  const token24 = 'a'.repeat(24);
  const androidURL = `http://127.0.0.1:28123/p/${token24}/${token24}/${token24}`;
  const { bridge, openCalls } = await loadBridge({
    platform: 'android',
    openResult: androidURL,
  });
  const { ref, responses } = makeWebViewHarness();
  const androidContext = trustedContext({ isTopFrame: true });

  await bridge.handleBridgeMessage(JSON.stringify({
    type: 'GM_OPEN_MEDIA_PROXY',
    id: 'android-open',
    url: 'https://cdn.example/movie/master.m3u8',
    method: 'GET',
    headers: {},
  }), ref, androidContext);
  assert.equal(openCalls.length, 1);
  assert.equal(responses.at(-1)?.value, androidURL);

  await bridge.handleBridgeMessage(JSON.stringify({
    type: 'GM_OPEN_MEDIA_PROXY',
    id: 'android-subframe',
    url: 'https://cdn.example/movie/master.m3u8',
    method: 'GET',
    headers: {},
  }), ref, trustedContext({ isTopFrame: false }));
  assert.equal(openCalls.length, 1);
  assert.equal(responses.at(-1)?.error, 'Local media proxy unavailable');
});

test('proxy request header limits reject excess, oversized, and CRLF input before native open', async () => {
  const { bridge, openCalls } = await loadBridge();
  const { ref, responses } = makeWebViewHarness();
  await registerIOSCapability(bridge, ref);

  const accepted = Object.fromEntries(
    Array.from({ length: 32 }, (_, index) => [`X-${index}`, 'v']),
  );
  accepted['K'.repeat(128)] = 'V'.repeat(8192);
  delete accepted['X-0'];
  await openMedia(bridge, ref, trustedContext(), { headers: accepted });
  assert.equal(openCalls.length, 1);

  const rejectedHeaders = [
    Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`X-${index}`, 'v'])),
    { ['K'.repeat(129)]: 'v' },
    { K: 'V'.repeat(8193) },
    { 'X-Bad\r\nInjected': 'v' },
    { K: 'value\r\nInjected: true' },
  ];
  for (const headers of rejectedHeaders) {
    await openMedia(bridge, ref, trustedContext(), { headers });
    assert.equal(responses.at(-1)?.success, false);
  }
  assert.equal(openCalls.length, 1);
});

test('proxy bridge permits HTTPS GET and HEAD only', async () => {
  const { bridge, openCalls } = await loadBridge();
  const { ref, responses } = makeWebViewHarness();
  await registerIOSCapability(bridge, ref);

  await openMedia(bridge, ref, trustedContext(), { method: 'HEAD' });
  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0][1], 'HEAD');

  await openMedia(bridge, ref, trustedContext(), { method: 'POST' });
  assert.equal(responses.at(-1)?.success, false);
  await openMedia(bridge, ref, trustedContext(), {
    url: 'http://cdn.example/movie/master.m3u8',
  });
  assert.equal(responses.at(-1)?.success, false);
  assert.equal(openCalls.length, 1);
});
