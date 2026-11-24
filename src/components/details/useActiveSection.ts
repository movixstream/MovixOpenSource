import { useEffect, useState } from 'react';

/**
 * Section courante d'une page à ancres : la dernière, dans l'ordre donné, dont
 * le haut a franchi une ligne placée au tiers haut de l'écran. Tout en haut de
 * la page, c'est la première section.
 *
 * L'observateur surveille la zone située au-dessus de cette ligne, sans limite
 * vers le haut : une section « entamée » le reste une fois dépassée, et un saut
 * de défilement (touche Fin, retour arrière du navigateur) est vu comme un
 * défilement normal.
 *
 * @param ids Identifiants DOM des sections, dans l'ordre de la page.
 * @param line Position de la ligne, en pourcentage de la hauteur de l'écran.
 */
export function useActiveSection(ids: readonly string[], line = 33): string | null {
  const key = ids.join('|');
  const [active, setActive] = useState<string | null>(ids[0] ?? null);

  useEffect(() => {
    const list = key ? key.split('|') : [];
    setActive((current) => (current && list.includes(current) ? current : list[0] ?? null));
    if (typeof IntersectionObserver === 'undefined') return;
    const elements = list
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const started = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) started.add(entry.target.id);
        else started.delete(entry.target.id);
      }
      let current = list[0] ?? null;
      for (const id of list) {
        if (started.has(id)) current = id;
      }
      setActive(current);
    }, { rootMargin: `100000px 0px -${100 - line}% 0px`, threshold: 0 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [key, line]);

  return active;
}

type LenisWindow = Window & {
  lenis?: { scrollTo?: (target: HTMLElement, options?: { duration?: number }) => void };
};

/**
 * Défile en douceur jusqu'à une section. Lenis s'il tourne (comme le clic sur
 * le logo de l'en-tête), sinon `scrollIntoView`. Dans les deux cas l'arrêt
 * tient compte du `scroll-margin-top` de la section.
 */
export function scrollToDetailsSection(id: string): void {
  const element = document.getElementById(id);
  if (!element) return;
  const lenis = (window as LenisWindow).lenis;
  if (lenis?.scrollTo) {
    lenis.scrollTo(element, { duration: 1 });
    return;
  }
  const reduceMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}
