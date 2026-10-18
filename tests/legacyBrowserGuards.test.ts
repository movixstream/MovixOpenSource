import assert from 'node:assert/strict';
import test from 'node:test';
import { createResizeObserverFallback } from '../src/utils/resizeObserverFallback.ts';
import { beginEmblaScroll, endEmblaScroll } from '../src/utils/scrollingState.ts';

// Fenêtre minimale : timers réels, écouteurs « resize » déclenchables à la main.
const createWindow = () => {
  const listeners = new Map<string, Array<() => void>>();
  return {
    win: {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id: number) => clearTimeout(id as unknown as NodeJS.Timeout),
      addEventListener(type: string, fn: () => void) {
        listeners.set(type, [...(listeners.get(type) || []), fn]);
      },
    } as unknown as Window & typeof globalThis,
    fire(type: string) {
      (listeners.get(type) || []).forEach((fn) => fn());
    },
  };
};

const createElement = (size: { width: number; height: number }) => ({
  size,
  getBoundingClientRect() {
    return { width: this.size.width, height: this.size.height };
  },
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('le repli ResizeObserver livre une première mesure puis seulement les changements', async () => {
  const { win, fire } = createWindow();
  const Fallback = createResizeObserverFallback(win);
  const calls: Array<Array<{ target: unknown; width: number }>> = [];
  const observer = new Fallback((entries) => {
    calls.push(entries.map((entry) => ({ target: entry.target, width: entry.contentRect.width })));
  });
  const element = createElement({ width: 100, height: 50 });
  observer.observe(element as unknown as Element);
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].width, 100);

  fire('resize');
  assert.equal(calls.length, 1, 'taille inchangée : pas de rappel');

  element.size = { width: 140, height: 50 };
  fire('resize');
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0].width, 140);

  observer.disconnect();
  element.size = { width: 200, height: 50 };
  fire('resize');
  assert.equal(calls.length, 2, 'plus rien après disconnect');
});

test('le repli ResizeObserver annule la première mesure si on se déconnecte avant', async () => {
  const { win } = createWindow();
  const Fallback = createResizeObserverFallback(win);
  let called = false;
  const observer = new Fallback(() => { called = true; });
  observer.observe(createElement({ width: 10, height: 10 }) as unknown as Element);
  observer.disconnect();
  await tick();
  assert.equal(called, false);
});

test('beginEmblaScroll ne plante pas quand classList.add n’est pas une fonction', () => {
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { body: { classList: { add: undefined, remove: 'x' } } };
  try {
    assert.doesNotThrow(() => beginEmblaScroll());
    assert.doesNotThrow(() => endEmblaScroll());
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
});

test('beginEmblaScroll pose puis retire la classe sur un body normal', () => {
  const previous = (globalThis as { document?: unknown }).document;
  const classes = new Set<string>();
  (globalThis as { document?: unknown }).document = {
    body: {
      classList: {
        add(name: string) { classes.add(name); },
        remove(name: string) { classes.delete(name); },
      },
    },
  };
  try {
    beginEmblaScroll();
    assert.ok(classes.has('embla-scrolling'));
    endEmblaScroll();
    assert.ok(!classes.has('embla-scrolling'));
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
});
