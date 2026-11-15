import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const makeStorage = () => {
  const store = new Map();
  return {
    get length() { return store.size; },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
};

const loadModule = () => {
  const source = readFileSync('src/hooks/useTmdbImages.ts', 'utf8')
    .replace(
      "import { useEffect, useState } from 'react';",
      "const { useEffect, useState } = globalThis.__hookRuntime || require('react');",
    )
    .replace("import axios from 'axios';", 'const axios = { get: (...args: any[]) => globalThis.__axiosGet(...args) };')
    .replace("import { getTmdbLanguage } from '../i18n';", "const getTmdbLanguage = () => 'fr-FR';")
    .replace("const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';", "const TMDB_API_KEY = 'test';");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', js)(require, mod, mod.exports);
  return mod.exports;
};

const createHookHarness = () => {
  let initialized = false;
  let state;
  let previousDeps;
  let pendingEffect;

  return {
    runtime: {
      useState(initializer) {
        if (!initialized) {
          state = typeof initializer === 'function' ? initializer() : initializer;
          initialized = true;
        }
        return [state, (next) => {
          state = typeof next === 'function' ? next(state) : next;
        }];
      },
      useEffect(effect, deps) {
        const changed = !previousDeps
          || deps.length !== previousDeps.length
          || deps.some((value, index) => !Object.is(value, previousDeps[index]));
        if (changed) {
          previousDeps = deps;
          pendingEffect = effect;
        }
      },
    },
    flushEffect() {
      const effect = pendingEffect;
      pendingEffect = undefined;
      effect?.();
    },
  };
};

test('le cache dérivé des images conserve au plus 500 médias en LRU', async () => {
  const listeners = new Map();
  const previous = {
    sessionStorage: globalThis.sessionStorage,
    window: globalThis.window,
    axiosGet: globalThis.__axiosGet,
  };
  let axiosCalls = 0;

  try {
    globalThis.sessionStorage = makeStorage();
    globalThis.window = {
      addEventListener: (name, listener) => listeners.set(name, listener),
      cancelIdleCallback: () => {},
    };
    globalThis.__axiosGet = async (_url, { params }) => {
      axiosCalls++;
      return {
        data: {
          logos: [{ file_path: `/logo-${params.include_image_language}.png`, iso_639_1: 'fr' }],
          posters: [{ file_path: '/poster.jpg', iso_639_1: 'fr' }],
        },
      };
    };

    const { prefetchTmdbImages } = loadModule();
    for (let id = 1; id <= 500; id++) {
      await prefetchTmdbImages('movie', id);
    }
    // Relire 1 le rend plus récent que 2 avant l'insertion qui déclenche
    // l'éviction : on vérifie bien un LRU, pas une simple FIFO.
    await prefetchTmdbImages('movie', 1);
    await prefetchTmdbImages('movie', 501);

    listeners.get('pagehide')?.();
    const persisted = JSON.parse(sessionStorage.getItem('movix_tmdb_images_cache_v7'));
    assert.equal(Object.keys(persisted).length, 500);
    assert.ok(persisted.movie_1_fr, 'une entrée relue récemment a été évincée');
    assert.equal(persisted.movie_2_fr, undefined, 'l’entrée la moins récente n’a pas été évincée');
    assert.ok(persisted.movie_501_fr, 'l’entrée la plus récente a disparu');

    await prefetchTmdbImages('movie', 1);
    assert.equal(axiosCalls, 501, 'une entrée récente a été rechargée malgré le hit LRU');
    await prefetchTmdbImages('movie', 2);
    assert.equal(axiosCalls, 502, 'l’entrée évincée n’a pas été rechargée');
    listeners.get('pagehide')?.();
  } finally {
    if (previous.axiosGet === undefined) delete globalThis.__axiosGet;
    else globalThis.__axiosGet = previous.axiosGet;
    if (previous.window === undefined) delete globalThis.window;
    else globalThis.window = previous.window;
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
  }
});

test('le hook masque une ancienne clé mais garde la valeur de la même clé après éviction', async () => {
  const listeners = new Map();
  const harness = createHookHarness();
  const previous = {
    sessionStorage: globalThis.sessionStorage,
    window: globalThis.window,
    axiosGet: globalThis.__axiosGet,
    hookRuntime: globalThis.__hookRuntime,
  };

  try {
    globalThis.sessionStorage = makeStorage();
    globalThis.window = {
      addEventListener: (name, listener) => listeners.set(name, listener),
      cancelIdleCallback: () => {},
    };
    globalThis.__hookRuntime = harness.runtime;
    globalThis.__axiosGet = async (url) => {
      const id = Number(url.match(/\/(\d+)\/images/)?.[1]);
      return {
        data: {
          logos: [],
          posters: [{ file_path: `/poster-${id}.jpg`, iso_639_1: 'fr' }],
        },
      };
    };

    const { prefetchTmdbImages, useTmdbImages } = loadModule();
    await prefetchTmdbImages('movie', 1);

    let rendered = useTmdbImages('movie', 1, undefined, true);
    harness.flushEffect();
    assert.match(rendered.posterUrl, /poster-1\.jpg$/);

    // Le render qui reçoit une nouvelle clé arrive avant son useEffect : il ne
    // doit jamais exposer l'affiche conservée dans le state de la clé 1.
    rendered = useTmdbImages('movie', 2, undefined, false);
    assert.deepEqual(rendered, { logoUrl: null, posterUrl: null });
    harness.flushEffect();

    // Revenir à 1 réassocie le state à cette clé. Le second render représente
    // le commit déclenché par setState dans l'effet cache-hit.
    useTmdbImages('movie', 1, undefined, true);
    harness.flushEffect();
    rendered = useTmdbImages('movie', 1, undefined, true);
    assert.match(rendered.posterUrl, /poster-1\.jpg$/);

    // 500 nouvelles clés évincent 1 du cache global. Le hook garde pourtant
    // sa valeur locale tant que sa clé ne change pas, même désactivé.
    for (let id = 2; id <= 501; id++) {
      await prefetchTmdbImages('movie', id);
    }
    rendered = useTmdbImages('movie', 1, undefined, false);
    assert.match(rendered.posterUrl, /poster-1\.jpg$/);
    harness.flushEffect();
    listeners.get('pagehide')?.();
  } finally {
    if (previous.hookRuntime === undefined) delete globalThis.__hookRuntime;
    else globalThis.__hookRuntime = previous.hookRuntime;
    if (previous.axiosGet === undefined) delete globalThis.__axiosGet;
    else globalThis.__axiosGet = previous.axiosGet;
    if (previous.window === undefined) delete globalThis.window;
    else globalThis.window = previous.window;
    if (previous.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previous.sessionStorage;
  }
});
