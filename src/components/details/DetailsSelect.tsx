import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DETAILS_FOCUS, DETAILS_PRESS } from './layout';
import { DETAILS_EASE_OUT } from './motion';

export interface DetailsSelectOption {
  value: string;
  label: string;
  /** Petit nombre à droite (épisodes, images…). */
  count?: number;
  /** Nombre écrit en entier (« 23 épisodes ») : affiché en pastille à la place du nombre seul. */
  countLabel?: string;
  /** Ligne mise à part en tête (« Toutes les langues ») : masquée pendant une recherche. */
  pinned?: boolean;
  /** Autres textes qui retrouvent la ligne (code de langue…), en plus du libellé. */
  keywords?: string[];
}

export interface DetailsSelectProps {
  value: string;
  options: DetailsSelectOption[];
  onChange: (value: string) => void;
  /** Texte du bouton quand rien n'est choisi, et nom accessible de la liste. */
  placeholder: string;
  searchLabel: string;
  emptyLabel: string;
  /** Icône posée devant le libellé du bouton. */
  icon?: ReactNode;
  /** Au-delà de ce nombre de lignes, la liste se filtre au clavier. */
  searchThreshold?: number;
  /** Bouton à la largeur de son texte, liste au moins aussi large (saisons). */
  fit?: boolean;
  className?: string;
  triggerClassName?: string;
}

/** Normalise pour la recherche : sans casse ni accents. */
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Menu déroulant des fiches : bouton translucide, panneau noir arrondi qui
 * s'ouvre en léger zoom ancré en haut, recherche à la frappe et pilotage au
 * clavier (flèches, Début, Fin, Entrée, Échap). La page défile toujours,
 * menu ouvert : seule la liste garde la molette quand on est dessus
 * (`data-lenis-prevent`). Langues de la galerie, saisons, épisodes en vue
 * « menu déroulant ».
 */
export function DetailsSelect({
  value,
  options,
  onChange,
  placeholder,
  searchLabel,
  emptyLabel,
  icon,
  searchThreshold = 6,
  fit = false,
  className,
  triggerClassName,
}: DetailsSelectProps) {
  const reduceMotion = useReducedMotion();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);
  const hasSearch = options.length > searchThreshold;
  const visible = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return options;
    return options.filter((option) => !option.pinned
      && (fold(option.label).includes(needle) || option.keywords?.some((keyword) => fold(keyword) === needle)));
  }, [options, query]);

  const close = (focusTrigger = false) => {
    setOpen(false);
    setQuery('');
    if (focusTrigger) triggerRef.current?.focus();
  };

  const choose = (next: string) => {
    onChange(next);
    close(true);
  };

  // À l'ouverture : la ligne choisie est mise en avant, la recherche prend le
  // focus avec une souris (au doigt, le clavier virtuel couvrirait la liste).
  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    if (hasSearch && window.matchMedia?.('(pointer: fine)').matches) searchRef.current?.focus({ preventScroll: true });
    // Seulement à l'ouverture : la sélection ne change pas liste ouverte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  // Garder la ligne active visible. On ne fait défiler que la liste :
  // `scrollIntoView` déplacerait aussi la page.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop - 6;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight + 6;
    }
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(visible.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Home' && event.target === triggerRef.current) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End' && event.target === triggerRef.current) {
      event.preventDefault();
      setActiveIndex(visible.length - 1);
    } else if (event.key === 'Enter') {
      const option = visible[activeIndex];
      if (option) {
        event.preventDefault();
        choose(option.value);
      }
    } else if (event.key === 'Tab') {
      close();
    }
  };

  const optionId = (option: DetailsSelectOption) => `${listId}-${option.value.replace(/\s+/g, '_')}`;
  const activeId = open && visible[activeIndex] ? optionId(visible[activeIndex]) : undefined;

  return (
    <div ref={rootRef} className={cn('relative', fit && 'inline-block max-w-full', open && 'z-30', className)} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={selected ? undefined : placeholder}
        aria-activedescendant={hasSearch ? undefined : activeId}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'flex h-12 items-center justify-between gap-3 rounded-[14px] border px-4 text-sm font-medium text-white',
          fit ? 'max-w-full' : 'w-full',
          open ? 'border-white/30 bg-white/[.2]' : 'border-white/[.22] bg-white/[.14] hover:bg-white/[.22]',
          DETAILS_PRESS,
          DETAILS_FOCUS,
          triggerClassName,
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {icon}
          <span className={cn('truncate', !selected && 'text-white/60')}>{selected?.label ?? placeholder}</span>
          {selected?.count !== undefined && (
            <span className="flex-none whitespace-nowrap rounded-full bg-white/15 px-2 py-0.5 text-xs tabular-nums">{selected.countLabel ?? selected.count}</span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 flex-none opacity-80 transition-transform duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            style={{ transformOrigin: 'top center' }}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-4px) scale(0.97)' }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px) scale(1)' }}
            exit={reduceMotion
              ? { opacity: 0, transition: { duration: 0.1 } }
              : { opacity: 0, transform: 'translateY(-4px) scale(0.97)', transition: { duration: 0.12, ease: DETAILS_EASE_OUT } }}
            transition={{ duration: 0.18, ease: DETAILS_EASE_OUT }}
            className={cn(
              'absolute left-0 top-full z-30 mt-2 overflow-hidden rounded-[14px] border border-white/[.12] bg-[#141414] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]',
              fit ? 'w-max min-w-full max-w-[min(24rem,calc(100vw-24px))]' : 'right-0',
            )}
          >
            {hasSearch && (
              <div className="border-b border-white/10 p-2">
                <label className="flex h-10 items-center gap-2 rounded-[10px] bg-white/[.07] px-3 text-white/60 focus-within:bg-white/[.1] focus-within:text-white">
                  <Search aria-hidden="true" className="size-4 flex-none" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={searchLabel}
                    aria-label={searchLabel}
                    aria-controls={listId}
                    aria-activedescendant={activeId}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-full min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/45 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
                  />
                </label>
              </div>
            )}

            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={placeholder}
              data-lenis-prevent
              className="relative max-h-72 overflow-y-auto overscroll-contain p-1.5 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]"
            >
              {visible.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-white/50">{emptyLabel}</p>
              ) : visible.map((option, index) => {
                const isSelected = option.value === value;
                const isActive = index === activeIndex;
                return (
                  <div
                    key={option.value}
                    id={optionId(option)}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    onPointerMove={() => { if (!isActive) setActiveIndex(index); }}
                    onClick={() => choose(option.value)}
                    className={cn(
                      'flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-[10px] px-3 text-sm',
                      isActive && 'bg-white/[.09]',
                      isSelected ? 'font-semibold text-white' : 'text-white/75',
                      option.pinned && !query && 'mb-1',
                    )}
                  >
                    {/* Coche à droite, seulement sur la ligne choisie : pas de
                        colonne vide à gauche quand rien n'est choisi (épisodes). */}
                    <span className={cn('min-w-0 truncate', !option.countLabel && 'flex-1')}>{option.label}</span>
                    {option.count !== undefined && (option.countLabel ? (
                      <span className="flex-none whitespace-nowrap rounded-full bg-white/[.08] px-2 py-0.5 text-xs font-medium tabular-nums text-white/70">{option.countLabel}</span>
                    ) : (
                      <span className="flex-none text-xs tabular-nums text-white/45">{option.count}</span>
                    ))}
                    {isSelected && <Check aria-hidden="true" className="ml-auto size-4 flex-none text-red-500" />}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default DetailsSelect;
