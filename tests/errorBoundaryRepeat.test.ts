import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

/**
 * Charge le vrai ErrorBoundary avec un React minimal : setState est compté au
 * lieu de déclencher un rendu, ce qui suffit à vérifier qu'une rafale
 * d'erreurs ne relance pas une mise à jour à chaque capture (React #185).
 */
const loadBoundary = (recoverable: (error: unknown) => boolean) => {
  const source = readFileSync(new URL('../src/components/ErrorBoundary.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const calls = { setState: 0, reloads: 0, captures: 0 };
  class Component {
    props: unknown;
    state: Record<string, unknown> = {};
    constructor(props: unknown) { this.props = props; }
    setState(patch: Record<string, unknown>) { calls.setState += 1; this.state = { ...this.state, ...patch }; }
  }
  const modules: Record<string, unknown> = {
    react: { __esModule: true, default: { Component, createElement: () => null }, Component, createElement: () => null },
    '../routing/lazyWithRetry': {
      isChunkLoadError: () => false,
      isChunkResponseError: () => false,
      reloadForChunkFailure: () => { calls.reloads += 1; return true; },
    },
    '../utils/errorTracking': {
      isRecoverableError: recoverable,
      captureCrash: () => { calls.captures += 1; return 'evt'; },
    },
    './brand/MovixWordmark': { MovixWordmark: () => null },
  };
  const module = { exports: {} as Record<string, unknown> };
  const console = { error: () => {} };
  new Function('require', 'module', 'exports', 'console', outputText)(
    (name: string) => modules[name], module, module.exports, console,
  );
  const ErrorBoundary = module.exports.default as new (props: unknown) => {
    state: Record<string, unknown>;
    componentDidCatch: (error: Error, info: object) => void;
  };
  const getDerivedStateFromError = (ErrorBoundary as unknown as { getDerivedStateFromError: (e: Error) => object }).getDerivedStateFromError;
  const boundary = new ErrorBoundary({});
  const catchError = (error: Error) => {
    boundary.state = { ...boundary.state, ...getDerivedStateFromError(error) };
    boundary.componentDidCatch(error, { componentStack: '' });
  };
  return { boundary, calls, catchError };
};

test('une rafale d’erreurs récupérables ne relance ni setState ni rechargement à chaque capture', () => {
  const { calls, catchError } = loadBoundary(() => true);
  // FRONTEND-FN : une trentaine de « Invalid character: '\0' » en 160 ms.
  for (let i = 0; i < 30; i++) catchError(Object.assign(new Error("Invalid character: '\\0'"), { name: 'SyntaxError' }));
  assert.equal(calls.setState, 1, 'une seule mise à jour d’état');
  assert.equal(calls.reloads, 1, 'un seul rechargement encadré programmé');
  assert.equal(calls.captures, 0, 'rien n’est remonté');
});

test('un vrai crash est remonté une fois avec son écran, les suivants sans mise à jour d’état', () => {
  const { boundary, calls, catchError } = loadBoundary(() => false);
  const first = new TypeError('a is undefined');
  catchError(first);
  assert.equal(calls.setState, 1);
  assert.equal(boundary.state.eventId, 'evt');
  catchError(new TypeError('b is undefined'));
  catchError(new TypeError('c is undefined'));
  assert.equal(calls.setState, 1, 'aucune nouvelle mise à jour');
  assert.equal(calls.captures, 3, 'les erreurs suivantes restent remontées (le SDK plafonne)');
  assert.equal(calls.reloads, 0);
});
