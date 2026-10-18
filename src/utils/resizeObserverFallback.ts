// Repli minimal quand le navigateur n'expose pas ResizeObserver.
//
// Certains Safari macOS (16.x vu dans GlitchTip, FRONTEND-FF) arrivent sans
// ResizeObserver : Embla l'instancie à l'init de chaque carrousel et tout
// l'écran d'accueil tombait dans l'ErrorBoundary. Plutôt que de protéger
// chaque `new ResizeObserver` (Embla, lecteur, composants UI…), on pose un
// remplaçant simple : chaque élément observé reçoit une première mesure,
// puis une nouvelle à chaque redimensionnement de la fenêtre, uniquement si
// sa taille a changé. Moins fin que l'API native (pas de changement de taille
// provoqué par le contenu), mais suffisant pour que rien ne plante.

type Callback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

type Size = { width: number; height: number };

const measure = (target: Element): DOMRectReadOnly => {
  const rect = target.getBoundingClientRect();
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    width: rect.width,
    height: rect.height,
    right: rect.width,
    bottom: rect.height,
    toJSON() {
      return { width: rect.width, height: rect.height };
    },
  } as DOMRectReadOnly;
};

const toEntry = (target: Element, contentRect: DOMRectReadOnly): ResizeObserverEntry => {
  const size = [{ inlineSize: contentRect.width, blockSize: contentRect.height }];
  return {
    target,
    contentRect,
    borderBoxSize: size,
    contentBoxSize: size,
    devicePixelContentBoxSize: size,
  } as unknown as ResizeObserverEntry;
};

export const createResizeObserverFallback = (win: Window & typeof globalThis) => {
  const instances = new Set<FallbackResizeObserver>();
  let listening = false;

  const onResize = () => {
    instances.forEach((instance) => instance.check());
  };

  class FallbackResizeObserver {
    private readonly callback: Callback;
    private readonly targets = new Map<Element, Size | null>();
    private pending = 0;

    constructor(callback: Callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('ResizeObserver: le callback doit être une fonction');
      }
      this.callback = callback;
    }

    observe(target: Element) {
      if (!target || this.targets.has(target)) return;
      // null = pas encore mesuré : la première vérification livre toujours
      // une entrée, comme l'API native.
      this.targets.set(target, null);
      instances.add(this);
      if (!listening) {
        listening = true;
        win.addEventListener('resize', onResize);
        win.addEventListener('orientationchange', onResize);
      }
      if (!this.pending) {
        this.pending = win.setTimeout(() => {
          this.pending = 0;
          this.check();
        }, 0);
      }
    }

    unobserve(target: Element) {
      this.targets.delete(target);
      if (this.targets.size === 0) this.disconnect();
    }

    disconnect() {
      this.targets.clear();
      instances.delete(this);
      if (this.pending) {
        win.clearTimeout(this.pending);
        this.pending = 0;
      }
    }

    check() {
      const entries: ResizeObserverEntry[] = [];
      this.targets.forEach((previous, target) => {
        const rect = measure(target);
        if (previous && previous.width === rect.width && previous.height === rect.height) return;
        this.targets.set(target, { width: rect.width, height: rect.height });
        entries.push(toEntry(target, rect));
      });
      if (entries.length) this.callback(entries, this as unknown as ResizeObserver);
    }
  }

  return FallbackResizeObserver as unknown as typeof ResizeObserver;
};

export const installResizeObserverFallback = (): void => {
  if (typeof window === 'undefined') return;
  const win = window as Window & typeof globalThis;
  if (typeof win.ResizeObserver === 'function') return;
  try {
    win.ResizeObserver = createResizeObserverFallback(win);
  } catch {
    // Fenêtre verrouillée : on laisse les appelants gérer l'absence.
  }
};
