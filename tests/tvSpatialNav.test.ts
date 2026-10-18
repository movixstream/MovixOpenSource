import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __resetTvSpatialNavSuppression,
  directionFromKey,
  isInSearchZone,
  isTvBackKey,
  isTvSpatialNavSuppressed,
  pickBestCandidate,
  releaseTvSpatialNav,
  resolveTvBackAction,
  suppressTvSpatialNav,
  type Rect,
} from '../src/utils/tvSpatialNav.ts';

// `pickBestCandidate` est pure : on la teste sur des rectangles littéraux,
// sans DOM. Grille type « affiches » : 3 colonnes × 2 lignes de 200×300,
// espacées de 20 px.
const cell = (col: number, row: number): Rect => ({
  left: col * 220,
  top: row * 320,
  right: col * 220 + 200,
  bottom: row * 320 + 300,
});

const grid = [
  { id: 'a', rect: cell(0, 0) },
  { id: 'b', rect: cell(1, 0) },
  { id: 'c', rect: cell(2, 0) },
  { id: 'd', rect: cell(0, 1) },
  { id: 'e', rect: cell(1, 1) },
  { id: 'f', rect: cell(2, 1) },
];

function from(id: string) {
  return grid.find((item) => item.id === id)!.rect;
}

function without(id: string) {
  return grid.filter((item) => item.id !== id);
}

test('la navigation suit la grille dans les quatre directions', () => {
  assert.equal(pickBestCandidate(from('a'), without('a'), 'right')?.id, 'b');
  assert.equal(pickBestCandidate(from('b'), without('b'), 'right')?.id, 'c');
  assert.equal(pickBestCandidate(from('b'), without('b'), 'left')?.id, 'a');
  assert.equal(pickBestCandidate(from('b'), without('b'), 'down')?.id, 'e');
  assert.equal(pickBestCandidate(from('e'), without('e'), 'up')?.id, 'b');
});

test('l’alignement prime sur la distance brute', () => {
  // 'd' (même ligne, un peu plus loin) doit gagner contre 'b' (ligne du
  // dessus, plus proche à vol d'oiseau) quand on va à droite depuis 'a'... on
  // vérifie le cas symétrique : depuis 'a', « bas » doit donner 'd' et non 'e'.
  assert.equal(pickBestCandidate(from('a'), without('a'), 'down')?.id, 'd');
  assert.equal(pickBestCandidate(from('f'), without('f'), 'up')?.id, 'c');
});

test('aucun candidat au bord de l’écran', () => {
  assert.equal(pickBestCandidate(from('a'), without('a'), 'left'), null);
  assert.equal(pickBestCandidate(from('a'), without('a'), 'up'), null);
  assert.equal(pickBestCandidate(from('f'), without('f'), 'right'), null);
  assert.equal(pickBestCandidate(from('f'), without('f'), 'down'), null);
});

test('des éléments de hauteurs différentes restent atteignables', () => {
  // Barre latérale haute et étroite à gauche d'une carte : « gauche » depuis la
  // carte doit l'atteindre malgré l'écart de centres.
  const card: Rect = { left: 400, top: 200, right: 700, bottom: 380 };
  const sidebar = { id: 'sidebar', rect: { left: 0, top: 0, right: 300, bottom: 900 } };
  assert.equal(pickBestCandidate(card, [sidebar], 'left')?.id, 'sidebar');
});

test('le compteur de suppression s’imbrique et ne devient jamais négatif', () => {
  __resetTvSpatialNavSuppression();
  assert.equal(isTvSpatialNavSuppressed(), false);

  suppressTvSpatialNav();
  suppressTvSpatialNav(); // deux lecteurs pendant une transition de route
  assert.equal(isTvSpatialNavSuppressed(), true);

  releaseTvSpatialNav();
  assert.equal(isTvSpatialNavSuppressed(), true, 'un seul release ne libère pas');

  releaseTvSpatialNav();
  assert.equal(isTvSpatialNavSuppressed(), false);

  releaseTvSpatialNav(); // release orphelin (démontage en double)
  assert.equal(isTvSpatialNavSuppressed(), false);
  suppressTvSpatialNav();
  assert.equal(isTvSpatialNavSuppressed(), true, 'le compteur n’est pas passé sous zéro');
  __resetTvSpatialNavSuppression();
});

test('la touche Retour est reconnue quel que soit le firmware', () => {
  assert.equal(isTvBackKey({ key: 'Escape', keyCode: 27 }), true);
  assert.equal(isTvBackKey({ key: '', keyCode: 461 }), true, 'webOS');
  assert.equal(isTvBackKey({ key: '', keyCode: 10009 }), true, 'Tizen');
  assert.equal(isTvBackKey({ key: 'GoBack', keyCode: 0 }), true);
  assert.equal(isTvBackKey({ key: 'Enter', keyCode: 13 }), false);
  assert.equal(isTvBackKey({ key: 'ArrowLeft', keyCode: 37 }), false);
});

test('directionFromKey ne répond qu’aux flèches', () => {
  assert.equal(directionFromKey('ArrowUp'), 'up');
  assert.equal(directionFromKey('ArrowDown'), 'down');
  assert.equal(directionFromKey('ArrowLeft'), 'left');
  assert.equal(directionFromKey('ArrowRight'), 'right');
  assert.equal(directionFromKey('Enter'), null);
  assert.equal(directionFromKey('constructor'), null, 'pas de fuite du prototype');
});

test('la zone de recherche couvre l’écran suivant, pas au-delà', () => {
  const vw = 1920;
  const vh = 1080;
  const row = (top: number): Rect => ({ left: 100, top, right: 300, bottom: top + 300 });
  // Rangée entièrement sous la ligne de flottaison : doit rester atteignable,
  // sinon « bas » ne fait jamais défiler la page.
  assert.equal(isInSearchZone(row(1200), vw, vh), true);
  assert.equal(isInSearchZone(row(-1000), vw, vh), true);
  // Vignette hors champ à droite d'un carrousel.
  assert.equal(isInSearchZone({ left: 2000, top: 100, right: 2300, bottom: 400 }, vw, vh), true);
  // Trois écrans plus bas : hors zone.
  assert.equal(isInSearchZone(row(3300), vw, vh), false);
});

test('Retour ferme d’abord la surface ouverte, puis le champ, puis revient en arrière', () => {
  assert.equal(
    resolveTvBackAction({ hasOpenSurface: true, isEditingText: true, canGoBack: true }),
    'escape'
  );
  assert.equal(
    resolveTvBackAction({ hasOpenSurface: false, isEditingText: true, canGoBack: true }),
    'blur'
  );
  assert.equal(
    resolveTvBackAction({ hasOpenSurface: false, isEditingText: false, canGoBack: true }),
    'back'
  );
  assert.equal(
    resolveTvBackAction({ hasOpenSurface: false, isEditingText: false, canGoBack: false }),
    'exit'
  );
});
