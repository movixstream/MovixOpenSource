import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DETAILS_FOCUS } from './layout';

export interface DetailsSynopsisProps {
  /** Texte du synopsis. */
  text: string;
  /** Slogan, montré au-dessus du texte une fois déplié sur téléphone. */
  tagline?: string | null;
  /** Libellé du lien qui déplie le texte sur téléphone (« Lire la suite »). */
  moreLabel: string;
  /** Libellé du lien qui le replie (« Réduire »). */
  lessLabel: string;
  className?: string;
}

/**
 * Synopsis court de l'image du haut. Dès 768 px : trois lignes, le texte
 * complet est dans la section Aperçu. Avant : quatre lignes et un lien pour
 * lire la suite sur place.
 */
export function DetailsSynopsis({ text, tagline, moreLabel, lessLabel, className }: DetailsSynopsisProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const textId = useId();

  useEffect(() => { setExpanded(false); }, [text]);

  // Le lien n'a de sens que si le texte dépasse vraiment ses quatre lignes.
  useEffect(() => {
    const element = textRef.current;
    if (!element || expanded) return;
    const measure = () => setOverflowing(element.scrollHeight - element.clientHeight > 2);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className={className}>
      {expanded && tagline && (
        <p className="mb-2 text-[15px] italic text-white/70 md:hidden">{tagline}</p>
      )}
      <p
        ref={textRef}
        id={textId}
        className={cn(
          'text-pretty text-[15px] leading-[1.6] text-white/[.88] md:line-clamp-3 md:max-w-[58ch] md:text-[17px] md:leading-[1.55] md:text-white/85 2xl:text-[19px]',
          !expanded && 'line-clamp-4',
        )}
      >
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            'mt-1 inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-80 motion-reduce:transition-none md:hidden',
            DETAILS_FOCUS,
          )}
        >
          {expanded ? lessLabel : moreLabel}
          {expanded ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

export default DetailsSynopsis;
