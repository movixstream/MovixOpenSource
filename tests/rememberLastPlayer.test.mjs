import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// « Se souvenir du dernier lecteur » doit reprendre le lecteur précis choisi
// dans une source (Lulu dans « Lecteur Movix »), pas seulement la source :
// sinon le tri par priorité remet SeekStreaming en tête à chaque film.

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const events = new EventTarget();
globalThis.window = {
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
  dispatchEvent: events.dispatchEvent.bind(events),
};
globalThis.CustomEvent ??= class extends Event {};

const bundle = await build({
  stdin: {
    contents: `
      export * from './src/utils/sourceAutoSelect.ts';
      export * from './src/utils/lastPlayerPref.ts';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
});
const mod = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const movixSources = () => [
  { url: 'https://cdn.example/seek.m3u8', label: 'SeekStreaming', type: 'seekstreaming', seekKind: 'cfNative' },
  // URL de CDN nue + label court : le registre ne reconnaît pas le hoster.
  { url: 'https://cdn.example/lulu.m3u8', label: 'Lulu', type: 'unknown' },
  { url: 'https://cdn.example/byse.m3u8', label: 'Bysebuho 1080p', type: 'unknown' },
];

test('sans le réglage, SeekStreaming reste en tête', () => {
  store.clear();
  mod.setLastPlayer('nexus_hls', 'label:lulu');
  const sorted = mod.sortHostersByPriority(movixSources(), { category: 'moviesTv', topLevel: 'nexus_hls' });
  assert.equal(sorted[0].label, 'SeekStreaming');
});

test('le lecteur choisi dans « Lecteur Movix » repasse en tête', () => {
  store.clear();
  mod.setRememberLastPlayer(true);
  mod.setLastPlayer('nexus_hls', mod.hosterKeyOf(movixSources()[1]));
  const sorted = mod.sortHostersByPriority(movixSources(), { category: 'moviesTv', topLevel: 'nexus_hls' });
  assert.equal(sorted[0].label, 'Lulu');
  assert.equal(mod.pickAutoSelectedSource([{ id: 'nexus_hls', hasData: true }, { id: 'fstream', hasData: true }]), 'nexus_hls');
});

test('un lecteur inconnu du registre est retrouvé par son label', () => {
  store.clear();
  mod.setRememberLastPlayer(true);
  mod.setLastPlayer('nexus_hls', mod.hosterKeyOf(movixSources()[2]));
  assert.equal(mod.getLastHoster(), 'label:bysebuho');
  const next = movixSources().map((s) => (s.type === 'unknown' ? { ...s, url: 'https://other.cdn/x.m3u8', label: 'Bysebuho 720p' } : s));
  const sorted = mod.sortHostersByPriority(next, { category: 'moviesTv', topLevel: 'nexus_hls' });
  assert.equal(sorted[0].label, 'Bysebuho 720p');
});

test('le lecteur mémorisé ne réordonne pas une autre source', () => {
  store.clear();
  mod.setRememberLastPlayer(true);
  mod.setLastPlayer('nexus_hls', 'lulustream');
  const fstream = [
    { url: 'https://voe.sx/e/1', type: 'voe' },
    { url: 'https://lulustream.com/e/2', type: 'lulustream' },
  ];
  const sorted = mod.sortHostersByPriority(fstream, { category: 'moviesTv', topLevel: 'fstream' });
  assert.equal(sorted[0].type, 'voe');
});

test('nexus_file est mémorisé sous « Lecteur Movix »', () => {
  store.clear();
  mod.setLastPlayer('nexus_file', 'uqload');
  assert.equal(mod.getLastPlayer(), 'nexus_hls');
  mod.setLastPlayer('fstream');
  assert.equal(mod.getLastHoster(), null);
});
