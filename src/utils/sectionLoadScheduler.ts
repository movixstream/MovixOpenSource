// One row per task gives React and the browser a chance to paint between
// carousels, including on Safari/TV browsers without requestIdleCallback.
const pending = new Map<symbol, () => void>();
let timer: number | undefined;
let idle: number | undefined;

function scheduleNext() {
  if (!pending.size || timer !== undefined || idle !== undefined) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(runNext, { timeout: 200 });
    } else {
      runNext();
    }
  }, 16);
}

function runNext() {
  idle = undefined;
  const next = pending.entries().next().value;
  if (!next) return;
  const [key, task] = next;
  pending.delete(key);
  try {
    task();
  } finally {
    scheduleNext();
  }
}

export function scheduleSectionLoad(task: () => void): () => void {
  const key = Symbol();
  pending.set(key, task);
  scheduleNext();
  return () => {
    pending.delete(key);
    if (pending.size) return;
    if (timer !== undefined) window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    timer = idle = undefined;
  };
}
