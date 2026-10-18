import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Navigation = typeof import('../src/components/profile/tabNavigation.ts');

// Module pur (aucun import) : transpilé et évalué sans Vite.
function loadNavigation(): Navigation {
  const source = readFileSync(new URL('../src/components/profile/tabNavigation.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', js)(exports, (name: string) => {
    throw new Error(`module inattendu : ${name}`);
  });
  return exports as Navigation;
}

const { nextTabIndex } = loadNavigation();

test('nextTabIndex : flèches gauche/droite en boucle', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 3), 1);
  assert.equal(nextTabIndex('ArrowRight', 2, 3), 0);
  assert.equal(nextTabIndex('ArrowLeft', 1, 3), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2);
});

test('nextTabIndex : Début et Fin', () => {
  assert.equal(nextTabIndex('Home', 2, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
});

test('nextTabIndex : autre touche ou liste vide → -1', () => {
  assert.equal(nextTabIndex('Enter', 0, 3), -1);
  assert.equal(nextTabIndex('ArrowDown', 0, 3), -1);
  assert.equal(nextTabIndex('ArrowRight', 0, 0), -1);
});
