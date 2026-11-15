import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGroup, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { FocusBrackets } from './FocusBrackets';
import { TV_EASE } from './tvMotion';

// Vraies captures de l'appli (émulateur Android TV, 1600 × 900, commit 949c4b2a).
const SCREENS = [
  { id: 'home', src: '/help/tv/accueil.webp' },
  { id: 'search', src: '/help/tv/recherche.webp' },
  { id: 'details', src: '/help/tv/fiche.webp' },
  { id: 'sources', src: '/help/tv/sources.webp' },
  { id: 'extraction', src: '/help/tv/extraction.webp' },
  { id: 'player', src: '/help/tv/lecture.webp' },
  { id: 'web', src: '/help/tv/lecteur-web.webp' },
] as const;

const HOVER_INTENT_MS = 90;

interface TvScreensShowcaseProps {
  calm: boolean;
}

/**
 * Les écrans de l'appli comme une rangée de la télé : le focus (crochets du
 * logo) se pose sur une vignette et le grand écran suit, comme l'accueil de
 * l'appli suit la carte sélectionnée. Souris, clic, toucher ou flèches.
 */
export function TvScreensShowcase({ calm }: TvScreensShowcaseProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const [active, setActive] = useState(0);
  // Écran affiché sous le nouveau pendant son apparition.
  const [previous, setPrevious] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hoverTimer = useRef<number | null>(null);
  const screen = SCREENS[active];

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
  }, []);

  const moveTo = (index: number) => {
    const next = (index + SCREENS.length) % SCREENS.length;
    setActive(next);
    const tab = tabRefs.current[next];
    tab?.focus();
    // Rangée défilante sur téléphone : garde la vignette en vue.
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    // Liste horizontale au téléphone, verticale sur ordinateur : les deux axes marchent.
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(SCREENS.length - 1);
    }
  };

  const cancelHover = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  // Grand écran et liste côte à côte (ordinateur) : on change d'écran sans
  // perdre l'image de vue. Téléphone : image, vignettes juste dessous, texte.
  return (
    <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
      {/* Toutes les captures restent montées, empilées : l'écran quitté reste
          opaque dessous et seul le nouveau apparaît par-dessus. Un fondu
          croisé laissait voir le fond noir à mi-chemin (scintillement), et une
          image montée au clic n'était pas toujours décodée. */}
      <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/10 lg:row-span-2">
        {SCREENS.map((item, index) => {
          const isActive = index === active;
          const isPrevious = index === previous;
          return (
            <motion.img
              key={item.id}
              src={item.src}
              alt={isActive ? t(`tvApp.screens.items.${item.id}.alt`) : ''}
              aria-hidden={!isActive}
              width={1600}
              height={900}
              loading="eager"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ zIndex: isActive ? 2 : isPrevious ? 1 : 0 }}
              initial={false}
              animate={{ opacity: isActive || isPrevious ? 1 : 0 }}
              transition={{ duration: isActive && !calm ? 0.3 : 0, ease: TV_EASE }}
              onAnimationComplete={() => {
                if (isActive) setPrevious(index);
              }}
            />
          );
        })}
      </div>

      <LayoutGroup id="tv-screens">
        <div
          role="tablist"
          aria-label={t('tvApp.screens.tabsLabel')}
          className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 py-3 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:order-none lg:mx-0 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:px-0 lg:py-0 [&::-webkit-scrollbar]:hidden"
        >
          {SCREENS.map((item, index) => {
            const selected = index === active;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${index}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(index)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPointerEnter={(event) => {
                  if (event.pointerType !== 'mouse') return;
                  cancelHover();
                  hoverTimer.current = window.setTimeout(() => setActive(index), HOVER_INTENT_MS);
                }}
                onPointerLeave={cancelHover}
                className="group w-32 shrink-0 snap-start text-left focus-visible:outline-none sm:w-40 lg:flex lg:w-full lg:items-center lg:gap-3 lg:rounded-lg lg:p-1.5 lg:hover:bg-white/[0.04]"
              >
                <span className="relative block lg:w-20 lg:shrink-0">
                  {selected && (
                    <FocusBrackets layoutId="tv-screen-focus" size="sm" transition={{ duration: 0.32, ease: TV_EASE }} />
                  )}
                  <span
                    className={cn(
                      'block aspect-video overflow-hidden rounded-lg ring-1 transition-opacity',
                      selected ? 'opacity-100 ring-white/25' : 'opacity-60 ring-white/10 group-hover:opacity-90',
                      'group-focus-visible:ring-2 group-focus-visible:ring-white/80',
                    )}
                  >
                    <img
                      src={item.src}
                      alt=""
                      width={1600}
                      height={900}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </span>
                </span>
                <span
                  className={cn(
                    'mt-2.5 block truncate text-sm font-semibold transition-colors lg:mt-0',
                    selected ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200',
                  )}
                >
                  {t(`tvApp.screens.items.${item.id}.label`)}
                </span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${active}`} className="lg:col-start-2">
        <h3 className="text-lg font-bold text-white sm:text-xl">{t(`tvApp.screens.items.${screen.id}.title`)}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-300 sm:text-base">{t(`tvApp.screens.items.${screen.id}.text`)}</p>
      </div>
    </div>
  );
}

export default TvScreensShowcase;
