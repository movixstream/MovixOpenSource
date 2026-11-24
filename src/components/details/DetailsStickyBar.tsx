import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useIsOffscreen } from './useIsOffscreen';

/** Vrai quand le pied de page du site est à l'écran : la barre ne doit pas le recouvrir. */
function useFooterVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const footer = document.querySelector('[data-site-footer]');
    if (!footer || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);
  return visible;
}

export interface DetailsStickyBarProps {
  /** Bouton principal du haut de page : la barre apparaît quand il sort de l'écran. */
  watch: RefObject<Element>;
  /** Faux tant que la page n'a pas monté le bouton observé. */
  enabled?: boolean;
  /** Contenu : le bouton principal (`flex-1`) et, au besoin, un bouton carré. */
  children: ReactNode;
  className?: string;
}

/**
 * Barre collée en bas de l'écran sous 768 px, avec le bouton principal. Elle
 * glisse en place quand le bouton du haut n'est plus visible, s'efface devant
 * le pied de page, et respecte la zone des gestes du téléphone
 * (`safe-area-inset-bottom`).
 */
export function DetailsStickyBar({ watch, enabled = true, children, className }: DetailsStickyBarProps) {
  const offscreen = useIsOffscreen(watch, enabled);
  const footerVisible = useFooterVisible();
  const shown = offscreen && !footerVisible;
  return (
    <div
      aria-hidden={!shown}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex gap-2.5 border-t border-white/[.12] bg-black px-3 pt-2.5 sm:px-6 md:hidden',
        'pb-[calc(1rem+env(safe-area-inset-bottom,0px))]',
        'transition-[transform,visibility] duration-200 motion-reduce:transition-none',
        shown ? 'visible translate-y-0' : 'invisible translate-y-full',
        className,
      )}
    >
      {children}
    </div>
  );
}

export default DetailsStickyBar;
