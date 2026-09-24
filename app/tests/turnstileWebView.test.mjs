import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const escapeStringRegexp = (
  await import(pathToFileURL(require.resolve('escape-string-regexp')).href)
).default;

function load(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require(id) {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
    console: { warn() {} },
  });
  return module.exports;
}

const config = load('../src/config/index.ts');

function renderWebView(os = 'ios', version = '18.0') {
  let clearedCapabilities = 0;
  const react = {
    createElement: (_component, props) => props,
    forwardRef: component => component,
    useCallback: callback => callback,
    useEffect() {},
    useImperativeHandle() {},
    useMemo: factory => factory(),
    useRef: value => ({ current: value }),
    useState: initial => [typeof initial === 'function' ? initial() : initial],
  };
  const { default: WebViewBrowser } = load('../src/components/WebViewBrowser.tsx', {
    react,
    'react-native': { Platform: { OS: os, Version: version } },
    'react-native-webview': { WebView: 'WebView' },
    '../config': config,
    '../services/networkJournal': { isNetworkJournalEnabled: () => false },
    '../services/bridge': {
      clearBridgeCapabilities: () => { clearedCapabilities += 1; },
    },
    '../services/playbackAwake': {},
    '../services/pictureInPicture': {
      getPreparedNativePlaybackSourceProtocolVersion: () => 1,
    },
    '../injection/inject': { buildInjectedJavaScript: () => 'MOVIX_INJECTION' },
  });
  return {
    props: WebViewBrowser({ url: 'https://movix.tax' }, null),
    get clearedCapabilities() { return clearedCapabilities; },
  };
}

test('iOS leaves the User-Agent to WKWebView on every OS version', () => {
  for (const version of ['17.0', '18.0', '26.0']) {
    assert.equal(renderWebView('ios', version).props.userAgent, undefined);
  }
  assert.equal(renderWebView('android', 34).props.userAgent, config.CONFIG.USER_AGENT);
});

test('Turnstile frames stay internal without revoking the main-page capabilities', async () => {
  const browser = renderWebView();
  const externalUrls = [];
  const { createOnShouldStartLoadWithRequest } = load(
    '../node_modules/react-native-webview/src/WebViewShared.tsx',
    {
      react: {},
      'react-native': {
        Linking: {
          canOpenURL: async url => { externalUrls.push(url); return false; },
        },
      },
      'escape-string-regexp': escapeStringRegexp,
      './WebView.styles': {},
    },
  );
  const results = [];
  const onRequest = createOnShouldStartLoadWithRequest(
    (allowed, url) => results.push({ allowed, url }),
    browser.props.originWhitelist,
    browser.props.onShouldStartLoadWithRequest,
  );
  const internalUrls = [
    'https://movix.tax',
    'https://challenges.cloudflare.com/turnstile/v0/api.js',
    'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/iframe',
    'about:blank',
    'about:srcdoc',
  ];
  for (const url of internalUrls) {
    onRequest({ nativeEvent: { url, isTopFrame: false, lockIdentifier: 1 } });
  }
  assert.deepEqual(results, internalUrls.map(url => ({ allowed: true, url })));
  assert.deepEqual(externalUrls, []);
  assert.equal(browser.clearedCapabilities, 0);

  for (const url of ['file:///private/example', 'javascript:alert(1)', 'about:config']) {
    onRequest({ nativeEvent: { url, isTopFrame: false, lockIdentifier: 2 } });
    assert.equal(results.at(-1).allowed, false, url);
  }
  await Promise.resolve();
  assert.equal(externalUrls.length, 3);

  onRequest({ nativeEvent: {
    url: 'https://movix.tax/login', isTopFrame: true, lockIdentifier: 3,
  } });
  assert.equal(browser.clearedCapabilities, 1);
});
