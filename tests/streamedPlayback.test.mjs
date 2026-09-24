import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { getStreamedServerDetails, selectStreamedVariant, unwrapStreamedBytes } from '../src/utils/streamedPlayback.ts';
import streamedNative from '../API/Mainapi/utils/streamedNative.js';
import { sourceFunction } from './helpers/sourceFunction.mjs';

test('le relais Streamed garde le loader natif et ne renvoie pas ses playlists enfants vers le master', () => {
  const file = 'src/components/LiveTVPlayer.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let selection;
  const visit = node => {
    if (ts.isIfStatement(node) && node.expression.getText(source) === 'extensionHandlesStream' && node.getText(source).includes('hlsConfig.loader')) selection = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(selection);
  const code = ts.transpile(selection.getText(source), { target: ts.ScriptTarget.ES2022 });
  for (const streamUrl of ['https://proxiesembed.test/streamed-proxy?url=fixture', 'https://media.test/streamed-proxy?url=fixture']) {
    const currentStream = { _streamedNative: { key: 'fixture' }, _streamedExtension: false };
    const isStreamedRelay = sourceFunction(file, 'isStreamedRelay', { currentStream });
    const isAlreadyProxied = sourceFunction(file, 'isAlreadyProxied', { isStreamedRelay, streamUrl });
    const shouldForceProxy = sourceFunction(file, 'shouldForceProxy', {
      forceDirect: false, isAlreadyProxied, isWiflixStream: false, isFamilyRestream: false,
      isTF1Stream: false, useProxy: true, isHttp: false, isPageHttps: true, effectiveExtensionAvailable: false, isVavooStream: false,
    });
    assert.equal(isAlreadyProxied, true);
    assert.equal(shouldForceProxy, false);
    const context = vm.createContext({
      currentStream, isStreamedRelay, isAlreadyProxied, shouldForceProxy, streamUrl,
      hlsConfig: {}, extensionHandlesStream: false, ProxyLoader: 'proxy', ExtensionLoader: 'extension',
      console: { log() {} },
    });
    vm.runInContext(code, context);
    assert.equal(context.hlsConfig.loader, undefined, 'HLS conserve les URLs enfants signées avec son loader par défaut');
  }
});

test('extension et relais VIP conservent la même qualité sans mélange des horloges SD/HD', () => {
  const hd = '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080\nhigh.m3u8\n';
  const sd = '#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=960x540\nlow.m3u8\n';
  for (const variants of [hd + sd, sd + hd]) {
    assert.equal(selectStreamedVariant('#EXTM3U\n' + variants), '#EXTM3U\n' + hd);
    assert.equal(selectStreamedVariant('#EXTM3U\n' + variants), streamedNative.selectStreamedVariant('#EXTM3U\n' + variants));
  }
  const media = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:25056\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n';
  assert.equal(selectStreamedVariant(media), media);
  assert.equal(selectStreamedVariant(media), streamedNative.selectStreamedVariant(media));
});

test('le vrai loader extension filtre uniquement les playlists Streamed avant de les transmettre à HLS', async () => {
  const file = 'src/components/LiveTVPlayer.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const loader = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ExtensionLoader');
  assert.ok(loader);
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=700000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=8000000\nhigh.m3u8\n';
  const context = vm.createContext({
    URL, atob, performance, selectStreamedVariant,
    console: { log() {}, error() {} },
    fetchFromExtension: async () => ({ status: 200, data: Buffer.from(master).toString('base64') }),
  });
  const code = ts.transpile(loader.getText(source), { target: ts.ScriptTarget.ES2022 });
  const Loader = vm.runInContext(code + '\nExtensionLoader', context);
  for (const streamedReferer of [undefined, 'https://embed.st/', 'https://exposestrat.com/']) {
    let result;
    await new Loader({ streamedReferer }).load({ url: 'https://cdn.test/master.m3u8', type: 'manifest' }, {}, {
      onSuccess: (response, stats) => { result = response.data; assert.equal(stats.loaded, result.length); },
      onError: error => assert.fail(JSON.stringify(error)),
    });
    assert.equal(result, streamedReferer ? selectStreamedVariant(master) : master);
  }
});

test('les conteneurs image du relais révèlent uniquement leur transport stream', () => {
  const ts = new Uint8Array(376); ts[0] = ts[188] = 0x47;
  const png = new Uint8Array(400); png.set([0x89, 0x50, 0x4e, 0x47]); png.set(ts, 24);
  assert.deepEqual(unwrapStreamedBytes(png), ts);
  const webp = new Uint8Array(42 + ts.length); webp.set(new TextEncoder().encode('RIFF')); webp.set(new TextEncoder().encode('WEBP'), 8); webp.set(ts, 42);
  assert.deepEqual(unwrapStreamedBytes(webp), ts);
});

test('les détails affichent langue, chaîne et qualité sans identifiant technique', () => {
  assert.deepEqual(getStreamedServerDetails('admin · 1 · English - Paramount+ · HD'), {
    language: 'English', languageCode: 'en', broadcaster: 'Paramount+', quality: 'HD',
  });
  assert.deepEqual(getStreamedServerDetails('delta · 1 · French · HD'), {
    language: 'French', languageCode: 'fr', broadcaster: '', quality: 'HD',
  });
  assert.deepEqual(getStreamedServerDetails('admin · 2 · SD'), {
    language: '', languageCode: '', broadcaster: '', quality: 'SD',
  });
  assert.equal(getStreamedServerDetails('admin · 2 · Welsh - Sports - Live · HD').broadcaster, 'Sports - Live');
  assert.equal(getStreamedServerDetails('admin · 2 · Welsh · HD').language, 'Welsh');
  assert.equal(getStreamedServerDetails('Autre description').broadcaster, 'Autre description');
});

for (const file of ['extension/Chrome/background.js', 'extension/Firefox/background.js', 'userscript/movix.user.js']) {
  test(`${file} : Golf ancien, data-source et iframe créée par atob`, async () => {
    const helper = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('// BEGIN STREAMED HANDSHAKE')[1].split('// END STREAMED HANDSHAKE')[0];
    for (const format of ['legacy', 'data-source', 'script']) {
      const legacy = format === 'legacy';
      const embedUrl = `https://embed.st/embed/ingest/${format === 'script' ? 'nrealmadrid' : 'fixture'}/1`;
      const html = legacy ? 'fid="fixture";' : format === 'script'
        ? fs.readFileSync(new URL('./fixtures/streamed-golf-script.html', import.meta.url), 'utf8')
        : `<iframe data-source="${Buffer.from(embedUrl).toString('base64')}"></iframe>`;
      const requests = [];
      const context = vm.createContext({ URL, TextEncoder, AbortController, setTimeout, clearTimeout, atob,
        extractionPrefs: { livetv: { streamed: true } },
        proxyBytesToBase64: b => Buffer.from(b).toString('base64'), addHeadersRule: async () => {},
        fetch: async (url, options) => {
          requests.push(url);
          if (url.includes('/embed/golf/')) return new Response('<iframe src="https://rockystream.st/watch"></iframe>');
          if (url.includes('rockystream.st')) {
            assert.equal(options.headers.Referer, 'https://embed.st/embed/golf/1485/1');
            return new Response(html);
          }
          if (legacy) {
            assert.ok(url.startsWith('https://exposestrat.com/maestrohd1.php?'));
            return new Response('return(["https://cdn.zohanayaan.com/","live.m3u8"].join(""));');
          }
          assert.equal(url, 'https://embed.st/fetch');
          assert.equal(options.headers.Referer, embedUrl);
          assert.deepEqual(Buffer.from(options.body), streamedNative.encodeStreamedRequest(streamedNative.parseStreamedEmbed(embedUrl)));
          return new Response(Buffer.from([10, 1, 2]), { headers: { goat: 'fixture' } });
        },
      });
      vm.runInContext(helper, context);
      const result = await vm.runInContext('streamedHandshake', context)('https://embed.st/embed/golf/1485/1');
      if (legacy) assert.equal(result.url, 'https://cdn.zohanayaan.com/live.m3u8');
      else assert.equal(result.embedUrl, embedUrl);
      assert.equal(requests.length, 3);
    }
  });
  test(`${file} : les destinations décodées avec atob restent contrôlées`, async () => {
    const helper = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('// BEGIN STREAMED HANDSHAKE')[1].split('// END STREAMED HANDSHAKE')[0];
    for (const target of ['https://embed.st.evil.test/embed/ingest/match/1', 'https://127.0.0.1/private',
      'http://embed.st/embed/ingest/match/1', 'https://user@embed.st/embed/ingest/match/1', 'javascript:alert(1)']) {
      const requests = [];
      const context = vm.createContext({ URL, TextEncoder, AbortController, setTimeout, clearTimeout, atob,
        extractionPrefs: { livetv: { streamed: true } }, addHeadersRule: async () => {},
        fetch: async url => {
          requests.push(url);
          assert.equal(url, 'https://embed.st/embed/golf/1485/1');
          return new Response(`<script>f . src = atob ( '${Buffer.from(target).toString('base64')}' );</script>`);
        },
      });
      vm.runInContext(helper, context);
      await assert.rejects(vm.runInContext('streamedHandshake', context)('https://embed.st/embed/golf/1485/1'), /URL Streamed invalide/);
      assert.equal(requests.length, 1);
    }
  });
  test(`${file} : handshake local borné, headers et source désactivée`, async () => {
    const code = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const helper = code.split('// BEGIN STREAMED HANDSHAKE')[1].split('// END STREAMED HANDSHAKE')[0];
    let requests = 0; const rules = [];
    const prefs = { livetv: { streamed: true } };
    const context = vm.createContext({ URL, TextEncoder, AbortController, setTimeout, clearTimeout, atob,
      extractionPrefs: prefs, proxyBytesToBase64: b => Buffer.from(b).toString('base64'),
      addHeadersRule: async (...rule) => { rules.push(rule); },
      fetch: async (url, options) => {
        requests++;
        assert.equal(url, 'https://embed.st/fetch');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Referer, 'https://embed.st/embed/admin/match/1');
        assert.equal(Buffer.from(options.body).toString('hex'), '0a0561646d696e12056d617463681a0131');
        return { ok: true, headers: new Headers({ goat: 'fixture' }), arrayBuffer: async () => Uint8Array.from([10, 1, 2]).buffer };
      },
    });
    vm.runInContext(helper, context);
    const run = vm.runInContext('streamedHandshake', context);
    const result = await run('https://embed.st/embed/admin/match/1');
    assert.equal(result.body, 'CgEC'); assert.equal(rules.length, 1);
    await assert.rejects(run('https://127.0.0.1/embed/admin/match/1'));
    prefs.livetv.streamed = false;
    await assert.rejects(run('https://embed.st/embed/admin/match/1'));
    assert.equal(requests, 1);
  });
}
