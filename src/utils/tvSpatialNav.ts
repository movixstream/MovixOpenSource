/**
 * Navigation directionnelle à la télécommande (D-pad).
 *
 * Implémentation géométrique volontairement maison : les librairies du domaine
 * (`norigin-spatial-navigation`, `@bbc/lrud`) demandent d'instrumenter chaque
 * élément focusable, ce qui voudrait dire toucher 57 pages et 114 composants.
 * Ici on travaille sur le DOM déjà rendu — aucun composant n'a à changer.
 */

export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type Direction = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="button"]:not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Pénalité appliquée à l'écart perpendiculaire à la direction. Un facteur > 1
 * privilégie les éléments alignés : sur une grille d'affiches, appuyer sur
 * « droite » doit rester sur la même ligne même si la vignette de la ligne du
 * dessous est géométriquement un peu plus proche.
 */
const PERPENDICULAR_PENALTY = 3;

function centerOf(rect: Rect): { x: number; y: number } {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  };
}

/**
 * `true` si `candidate` est du bon côté de `origin`. Le test porte sur les
 * bords et non sur les centres : deux éléments de hauteurs très différentes
 * (une carte et un bouton de barre latérale) doivent rester atteignables.
 */
function isInDirection(origin: Rect, candidate: Rect, direction: Direction): boolean {
  switch (direction) {
    case 'up':
      return candidate.bottom <= origin.top + 1;
    case 'down':
      return candidate.top >= origin.bottom - 1;
    case 'left':
      return candidate.right <= origin.left + 1;
    case 'right':
      return candidate.left >= origin.right - 1;
  }
}

function distanceScore(origin: Rect, candidate: Rect, direction: Direction): number {
  const o = centerOf(origin);
  const c = centerOf(candidate);
  const dx = c.x - o.x;
  const dy = c.y - o.y;

  const horizontal = direction === 'left' || direction === 'right';
  const along = Math.abs(horizontal ? dx : dy);
  const across = Math.abs(horizontal ? dy : dx);

  return along + across * PERPENDICULAR_PENALTY;
}

/**
 * Meilleur candidat dans `direction`, ou `null` s'il n'y en a aucun.
 * Fonction pure sur des rectangles : testable sans DOM.
 */
export function pickBestCandidate<T extends { rect: Rect }>(
  origin: Rect,
  candidates: readonly T[],
  direction: Direction
): T | null {
  let best: T | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!isInDirection(origin, candidate.rect, direction)) continue;
    const score = distanceScore(origin, candidate.rect, direction);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function isVisible(el: HTMLElement, rect: DOMRect): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (el.hasAttribute('inert')) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (style.pointerEvents === 'none') return false;
  return true;
}

/**
 * Éléments focusables visibles dans le viewport, avec leur rectangle. On borne
 * au viewport pour ne pas envoyer le focus 40 écrans plus bas dans une grille
 * infinie — le scroll suit le focus, pas l'inverse.
 */
export function getVisibleFocusables(
  root: ParentNode = document
): Array<{ el: HTMLElement; rect: Rect }> {
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const out: Array<{ el: HTMLElement; rect: Rect }> = [];

  root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR).forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (!isVisible(el, rect)) return;
    if (
      rect.bottom < 0 ||
      rect.top > viewportHeight ||
      rect.right < 0 ||
      rect.left > viewportWidth
    ) {
      return;
    }
    out.push({
      el,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Suppression temporaire — compteur de références.
// ---------------------------------------------------------------------------
// Les lecteurs (`HLSPlayer`, `LiveTVPlayer`) capturent déjà les flèches sur
// `document` pour le seek et le volume. Plutôt que de sonder le DOM pour savoir
// si un lecteur est monté, chaque lecteur déclare « je possède les flèches tant
// que je suis monté ». Un compteur, et pas un booléen : deux lecteurs peuvent
// coexister brièvement pendant une transition de route.

let suppressionCount = 0;

export function suppressTvSpatialNav(): void {
  suppressionCount += 1;
}

export function releaseTvSpatialNav(): void {
  suppressionCount = Math.max(0, suppressionCount - 1);
}

export function isTvSpatialNavSuppressed(): boolean {
  return suppressionCount > 0;
}

/** Tests uniquement. */
export function __resetTvSpatialNavSuppression(): void {
  suppressionCount = 0;
}

// ---------------------------------------------------------------------------
// Touche Retour
// ---------------------------------------------------------------------------

/**
 * `true` si l'événement correspond à la touche Retour d'une télécommande.
 *
 * webOS émet historiquement `keyCode 461` sans `key` exploitable, mais certains
 * firmwares traduisent déjà en `Escape` — les deux sont acceptés, ce qui évite
 * d'avoir à trancher avant le relevé sur la TV réelle.
 */
export function isTvBackKey(event: Pick<KeyboardEvent, 'key' | 'keyCode'>): boolean {
  if (event.key === 'Escape' || event.key === 'GoBack' || event.key === 'BrowserBack') {
    return true;
  }
  return event.keyCode === 461 || event.keyCode === 10009; // 10009 = Tizen
}

// Prototype nul : sinon `directionFromKey('constructor')` renverrait la
// fonction Object, et un `key` inattendu suffirait à déclencher une
// « direction ». (`Object.hasOwn` n'est pas une option : Chromium 93, alors
// que webOS 22 est en 87.)
const DIRECTION_BY_KEY: Record<string, Direction> = Object.assign(
  Object.create(null) as Record<string, Direction>,
  {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  } as const
);

export function directionFromKey(key: string): Direction | null {
  return DIRECTION_BY_KEY[key] ?? null;
}
