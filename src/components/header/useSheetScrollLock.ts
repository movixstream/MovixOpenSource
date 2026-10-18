import { useEffect, type RefObject } from 'react';

// Instance Lenis (défilement doux) posée sur window par SmoothScroll.
type LenisHolder = { lenis?: { destroy: () => void } };

// iOS et iPadOS (Safari, WKWebView) : seuls à ignorer overflow:hidden.
const isAppleTouch = () => {
  try {
    return /iP(hone|ad|od)/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
};

// Verrou partagé : deux panneaux ouverts ensemble (passage de l'un à l'autre)
// ne verrouillent qu'une fois. Le second lisait sinon scrollY = 0 sous le body
// déjà fixé, et la page revenait en haut à la fermeture.
let holders = 0;
let unlockPage: (() => void) | null = null;

const lockPage = () => {
  const win = window as unknown as LenisHolder;
  const lenis = win.lenis;
  const scrollY = window.scrollY;
  const lockedPath = window.location.pathname;
  const html = document.documentElement.style;
  const body = document.body.style;
  // Ailleurs qu'iOS, overflow:hidden sur <html> suffit : la page garde sa
  // position et sa mise en page. Le body en position:fixed remettait en page
  // tout le document à l'ouverture et à la fermeture (un saut sous le voile
  // sur Chrome Android, barres collantes et listes virtualisées comprises).
  const pin = isAppleTouch();

  html.overflow = 'hidden';
  html.overscrollBehavior = 'none';
  body.overscrollBehavior = 'none';
  if (pin) {
    body.overflow = 'hidden';
    body.position = 'fixed';
    body.top = `-${scrollY}px`;
    body.left = '0';
    body.right = '0';
    body.width = '100%';
  }
  if (lenis) {
    lenis.destroy();
    // Sans ce delete, window.lenis pointe vers une instance détruite : le
    // test !window.lenis à la fermeture ne passe jamais et le smooth scroll
    // n'est jamais réinitialisé pour les utilisateurs qui l'ont activé.
    delete win.lenis;
  }

  return () => {
    html.overflow = '';
    html.overscrollBehavior = '';
    body.overscrollBehavior = '';
    if (pin) {
      body.overflow = '';
      body.position = '';
      body.top = '';
      body.left = '';
      body.right = '';
      body.width = '';
      // Restaure la position uniquement si on est resté sur la même page :
      // une navigation via un lien du menu doit laisser le scroll-to-top de
      // la nouvelle route gagner.
      if (window.location.pathname === lockedPath) {
        window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' as ScrollBehavior });
      }
    }
    if (!win.lenis) {
      window.dispatchEvent(new CustomEvent('settings_smooth_scroll_changed'));
    }
  };
};

/**
 * Bloque le défilement de la page (html + Lenis) tant qu'un panneau plein
 * écran est ouvert (menu Explorer, notifications, profil). Sur iOS, body en
 * position:fixed avec top:-scrollY (technique body-scroll-lock) : iOS ignore
 * overflow:hidden, et un fixed sans top compensé fait sauter la page en haut
 * derrière le menu + perd la position au retour.
 */
export const useSheetScrollLock = (active: boolean, scrollerRef: RefObject<HTMLDivElement>) => {
  useEffect(() => {
    if (!active) return;

    if (holders++ === 0) unlockPage = lockPage();

    // Anti-chaînage iOS/WKWebView, sans preventDefault. Quand un geste démarre
    // pile sur un bord du scroller (scrollTop 0, ou fond atteint), WebKit
    // décide dès le premier touchmove de transférer le pan à l'ancêtre — ici
    // le document verrouillé ou l'UIScrollView du WKWebView — et le geste
    // entier est consommé sans rien faire : « des fois on ne peut pas
    // scroller ». On décolle donc le scroller du bord d'un pixel avant que la
    // décision soit prise.
    //
    // La version précédente preventDefault-ait ces gestes : c'était pire, un
    // simple tremblement de 1px vers le bas en haut de liste tuait le geste
    // entier puisque WebKit ne réévalue pas sa décision ensuite.
    const overlay = scrollerRef.current;
    const nudgeOffEdges = () => {
      const el = scrollerRef.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 2) return; // rien à faire défiler : le chaînage est sans effet
      if (el.scrollTop <= 0) el.scrollTop = 1;
      else if (el.scrollTop >= max) el.scrollTop = max - 1;
    };
    nudgeOffEdges();
    overlay?.addEventListener('touchstart', nudgeOffEdges, { passive: true });

    return () => {
      overlay?.removeEventListener('touchstart', nudgeOffEdges);
      if (--holders > 0) return;
      unlockPage?.();
      unlockPage = null;
    };
  // scrollerRef est stable (useRef) : seul `active` relance le verrou.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
};
