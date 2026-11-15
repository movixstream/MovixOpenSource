import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type KeysModule = typeof import('../src/utils/turnstileKeys.ts');

// Module réel : `import.meta.env` et `window` sont fournis par le test.
function load(env: Record<string, string>, hostname?: string): KeysModule {
  const source = readFileSync(new URL('../src/utils/turnstileKeys.ts', import.meta.url), 'utf8')
    .replaceAll('import.meta.env', '__env');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const window = hostname === undefined ? undefined : { location: { hostname } };
  new Function('exports', '__env', 'window', js)(exports, env, window);
  return exports as KeysModule;
}

const ENV = {
  VITE_TURNSTILE_SITE_KEY: 'site-1',
  VITE_TURNSTILE_INVISIBLE_SITEKEY: 'invisible-1',
  VITE_TURNSTILE_DOMAINS_2: 'movix.new, https://Other.Mirror/',
  VITE_TURNSTILE_SITE_KEY_2: 'site-2',
  VITE_TURNSTILE_INVISIBLE_SITEKEY_2: 'invisible-2',
};

test('le groupe 1 sert les domaines qu\'aucun groupe ne revendique', () => {
  const keys = load(ENV, 'movix.site');
  assert.equal(keys.TURNSTILE_SITE_KEY, 'site-1');
  assert.equal(keys.TURNSTILE_INVISIBLE_SITEKEY, 'invisible-1');
  assert.deepEqual(keys.resolveTurnstileKeys('notmovix.new'), { siteKey: 'site-1', invisibleSiteKey: 'invisible-1' });
});

test('un domaine listé et ses sous-domaines prennent les clés de leur groupe', () => {
  const keys = load(ENV, 'www.movix.new');
  assert.equal(keys.TURNSTILE_SITE_KEY, 'site-2');
  assert.equal(keys.TURNSTILE_INVISIBLE_SITEKEY, 'invisible-2');
  assert.deepEqual(keys.resolveTurnstileKeys('OTHER.mirror.'), { siteKey: 'site-2', invisibleSiteKey: 'invisible-2' });
});

test('une clé absente d\'un groupe retombe sur celle du groupe 1', () => {
  const keys = load({ ...ENV, VITE_TURNSTILE_DOMAINS_10: 'partial.mirror', VITE_TURNSTILE_SITE_KEY_10: 'site-10' }, 'partial.mirror');
  assert.equal(keys.TURNSTILE_SITE_KEY, 'site-10');
  assert.equal(keys.TURNSTILE_INVISIBLE_SITEKEY, 'invisible-1');
});

test('sans fenêtre ni configuration, aucune clé : Turnstile désactivé', () => {
  assert.equal(load(ENV).TURNSTILE_SITE_KEY, 'site-1');
  const empty = load({}, 'movix.new');
  assert.equal(empty.TURNSTILE_SITE_KEY, '');
  assert.equal(empty.TURNSTILE_INVISIBLE_SITEKEY, '');
});

test('parseTurnstileDomains suit la même règle que l\'API', () => {
  const keys = load(ENV, 'movix.site');
  assert.deepEqual(keys.parseTurnstileDomains(' https://A.tld/path ; *.b.tld\nc.tld.,, '), ['a.tld', 'b.tld', 'c.tld']);
  assert.deepEqual(keys.parseTurnstileDomains(undefined), []);
});
