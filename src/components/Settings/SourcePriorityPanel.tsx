// src/components/Settings/SourcePriorityPanel.tsx
//
// Panneau "Priorité des sources" intégré à Settings. Milestones 5 + 6 :
//   - Tabs [Films & Séries] / [Animes]
//   - Films & Séries : section Sources (DnD + toggle + pin) + section
//     Ordre des hosters (DnD + pin, hosters grisés si désactivés dans Extracteurs)
//   - Animes : section Langues (DnD + toggle + pin) + section Ordre des hosters
//   - Bouton "Tout réinitialiser" global (confirm natif M5, AlertDialog M8)
//   - Boutons ⚙ (override par source/langue) ouvrent `OverrideModal` (M6)
//   - Liens "Extracteurs →" sur hosters grisés : stubs no-op (M9)
//
// Les primitives `Tabs*` sont définies localement pour éviter d'ajouter un
// wrapper Radix à `src/components/ui/` (pas de `@radix-ui/react-tabs`
// installé). API volontairement minimale (value + defaultValue + onValueChange)
// pour matcher le code du plan milestone 5.
import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import ReusableModal from '../ui/reusable-modal';
import { SortableList } from '../ui/SortableList';
import { SourceCard, SOURCE_LABELS } from './SourceCard';
import { HosterCard } from './HosterCard';
import { LanguageCard, LANGUAGE_FLAGS } from './LanguageCard';
import { OverrideModal } from './OverrideModal';
import { HosterRegexEditor } from './HosterRegexEditor';
import {
  getSourcePriorityPrefs, subscribeToPriorityChanges,
  resetSourcePriorityPrefs, updateCategory,
  pinSource, unpinSource, pinLanguage, unpinLanguage, pinHoster, unpinHoster,
  pinMovieLanguage, unpinMovieLanguage,
  clearPinOnDrag,
  resetMoviesTvSources, resetMoviesTvHosters,
  resetAnimeLanguages, resetAnimeHosters,
  restoreMoviesTv, restoreAnime,
} from '../../utils/sourcePriorityPrefs';
import {
  getExtractionPrefs, M3U8_EXTRACTOR_KEYS,
  type M3u8ExtractorKey,
} from '../../utils/extractionPrefs';
import type {
  SourcePriorityPrefs, TopLevelSourceId, LanguageId, HosterId,
  MoviesTvPrefs, AnimePrefs,
} from '../../types/sourcePriority';

// ─── Reset + undo helpers (M8) ─────────────────────────────────────────────
// Union discriminée : chaque variant porte son type de snapshot spécifique
// pour garder un typage strict sans any implicit. L'appel dispatche sur `type`.
type ResetHandler =
  | { type: 'moviesTv'; fn: () => MoviesTvPrefs; restore: (s: MoviesTvPrefs) => void }
  | { type: 'anime'; fn: () => AnimePrefs; restore: (s: AnimePrefs) => void };

/**
 * Exécute le reset + déclenche un toast Sonner avec bouton Annuler 5s.
 * Le snapshot retourné par `handler.fn()` est passé au `handler.restore`
 * dans le onClick de l'action. La union discriminée garantit que le bon
 * restore reçoit le bon type — le switch sur `type` préserve le narrowing.
 */
const doResetWithUndo = (
  label: string,
  undoLabel: string,
  toastMessage: string,
  handler: ResetHandler,
): void => {
  void label; // kept for readability at call sites (M9: toast text now i18n-ready)
  if (handler.type === 'moviesTv') {
    const snapshot = handler.fn();
    toast(toastMessage, {
      action: {
        label: undoLabel,
        onClick: () => handler.restore(snapshot),
      },
      duration: 5000,
    });
  } else {
    const snapshot = handler.fn();
    toast(toastMessage, {
      action: {
        label: undoLabel,
        onClick: () => handler.restore(snapshot),
      },
      duration: 5000,
    });
  }
};

// Cible active du modal d'override (M6). `null` = fermé.
// Le champ `category` est discriminant : `moviesTv` impose `id: TopLevelSourceId`,
// `anime` impose `id: LanguageId`.
type OverrideTarget =
  | { category: 'moviesTv'; id: TopLevelSourceId; label: string }
  | { category: 'anime'; id: LanguageId; label: string };

// ─── Primitives Tabs locales ────────────────────────────────────────────────
// API inspirée de Radix (Tabs + TabsList + TabsTrigger + TabsContent).
// Contexte interne pour synchroniser la valeur active entre trigger et content.

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
}
const TabsContext = React.createContext<TabsContextValue | null>(null);

interface TabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}
const Tabs: React.FC<TabsProps> = ({ defaultValue, value, onValueChange, children, className }) => {
  const [internal, setInternal] = useState(defaultValue);
  const active = value ?? internal;
  const setValue = (v: string) => {
    setInternal(v);
    onValueChange?.(v);
  };
  return (
    <TabsContext.Provider value={{ value: active, setValue }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
};

const TabsList: React.FC<{ children: ReactNode; className?: string }> = ({ children, className }) => (
  <div
    role="tablist"
    onKeyDown={(e) => {
      // Force nav haut/bas uniquement dans le panneau de priorité — on bloque
      // les flèches gauche/droite qui feraient sinon switcher les tabs en
      // accidentel (si focus sur une trigger). L'utilisateur peut toujours
      // cliquer ou Tab pour atteindre l'autre onglet.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
      }
    }}
    className={`relative inline-flex items-center gap-1 rounded-lg bg-white/5 p-1 ${className ?? ''}`}
  >
    {children}
  </div>
);

interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
  /** DOM id of the associated TabsContent (for aria-controls, M9 a11y). */
  controls?: string;
  /** DOM id of this trigger button (so the panel can point back via aria-labelledby). */
  id?: string;
}

/**
 * TabsTrigger avec indicateur actif animé "shadcn-style" :
 * la pastille indigo glisse entre les triggers via `layoutId` partagé de framer-motion.
 * Seul l'active rend le `motion.div` ; framer-motion anime la transition
 * entre l'ancien et le nouveau trigger automatiquement grâce au `layoutId` commun.
 */
const TabsTrigger: React.FC<TabsTriggerProps> = ({ value, children, className, controls, id }) => {
  const ctx = React.useContext(TabsContext);
  if (!ctx) return null;
  const isActive = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={isActive}
      aria-controls={controls}
      tabIndex={isActive ? 0 : -1}
      onClick={() => ctx.setValue(value)}
      className={`relative px-4 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${
        isActive ? 'text-white' : 'text-gray-300 hover:text-white'
      } ${className ?? ''}`}
    >
      {isActive && (
        <motion.div
          layoutId="priority-tabs-indicator"
          className="absolute inset-0 bg-indigo-500 rounded-md shadow"
          transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </button>
  );
};

interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
  /** DOM id of this panel, pointed to by the matching TabsTrigger's aria-controls. */
  id?: string;
  /** DOM id of the matching TabsTrigger, for aria-labelledby on this panel. */
  labelledBy?: string;
}
/**
 * TabsContent reste monté quelle que soit la tab active (hidden quand
 * inactive). Ça évite un remount coûteux à chaque switch (toutes les
 * SortableList + cards + listeners doivent sinon se re-créer → scroll
 * saccadé pendant le rebuild). Le panel inactif est retiré du flux layout
 * via `display: none` et marqué `aria-hidden`.
 *
 * Petite transition opacity pour que le switch se sente fluide sans
 * trop retarder l'interaction clavier/souris.
 */
const TabsContent: React.FC<TabsContentProps> = ({ value, children, className, id, labelledBy }) => {
  const ctx = React.useContext(TabsContext);
  if (!ctx) return null;
  const isActive = ctx.value === value;
  return (
    <div
      role="tabpanel"
      id={id}
      aria-labelledby={labelledBy}
      aria-hidden={!isActive}
      hidden={!isActive}
      className={`${className ?? ''} transition-opacity duration-150 ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      {children}
    </div>
  );
};

// ─── Panel ─────────────────────────────────────────────────────────────────

export const SourcePriorityPanel: React.FC = () => {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<SourcePriorityPrefs>(() => getSourcePriorityPrefs());
  const [extractionPrefs, setExtractionPrefsState] = useState(() => getExtractionPrefs());
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(null);

  useEffect(() => subscribeToPriorityChanges(setPrefs), []);
  useEffect(() => {
    const h = () => setExtractionPrefsState(getExtractionPrefs());
    window.addEventListener('movix-extraction-prefs-changed', h);
    return () => window.removeEventListener('movix-extraction-prefs-changed', h);
  }, []);

  const hosterIsDisabledInExtractors = useMemo(() => {
    return (id: HosterId): boolean =>
      (M3U8_EXTRACTOR_KEYS as readonly string[]).includes(id as string)
        && !extractionPrefs.m3u8[id as M3u8ExtractorKey];
  }, [extractionPrefs]);

  const moviesTv = prefs.categories.moviesTv;
  const anime = prefs.categories.anime;

  // M8 : AlertDialog Radix (via Dialog stylé) pour le reset global — remplace
  // le `confirm()` natif du stub M5. Même pattern qu'en M7 pour la suppression
  // des hosters custom : pas besoin d'ajouter un wrapper alert-dialog.tsx.
  const [resetAllOpen, setResetAllOpen] = useState(false);

  // M9 — "Aller à Extracteurs" → scroll vers la section Extracteurs de
  // SettingsPage (id déjà existant : #extractions, cf SettingsPage.tsx).
  const scrollToExtractors = () => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('extractions')
      ?? document.querySelector('[data-settings-section="extractors"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <Tabs defaultValue="moviesTv" className="space-y-4">
        {/* Row: Tabs à gauche + bouton Reset à droite sur la même ligne */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList>
            <TabsTrigger
              value="moviesTv"
              id="tab-moviesTv-trigger"
              controls="tab-moviesTv-panel"
            >
              {t('settings.sourcePriority.tabMoviesTv')}
            </TabsTrigger>
            <TabsTrigger
              value="anime"
              id="tab-anime-trigger"
              controls="tab-anime-panel"
            >
              {t('settings.sourcePriority.tabAnime')}
            </TabsTrigger>
          </TabsList>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResetAllOpen(true)}
            className="shrink-0"
          >
            <RotateCcw size={14} className="mr-1.5" /> {t('settings.sourcePriority.resetAll')}
          </Button>
        </div>

        {/* ─── FILMS & SÉRIES ─── */}
        <TabsContent
          value="moviesTv"
          id="tab-moviesTv-panel"
          labelledBy="tab-moviesTv-trigger"
          className="space-y-5 mt-4"
        >
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-white">{t('settings.sourcePriority.sectionSources')}</h4>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-white/60 hover:text-white group/icon"
                onClick={() => doResetWithUndo(
                  t('settings.sourcePriority.resetSourcesLabel'),
                  t('settings.sourcePriority.undoToastAction'),
                  t('settings.sourcePriority.resetSectionToast', {
                    section: t('settings.sourcePriority.resetSourcesLabel'),
                  }),
                  { type: 'moviesTv', fn: resetMoviesTvSources, restore: restoreMoviesTv },
                )}
                title={t('settings.sourcePriority.resetSourcesTitle')}
              >
                <RotateCcw size={12} className="mr-1 text-white opacity-60 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" /> {t('settings.sourcePriority.resetSectionShort')}
              </Button>
            </div>
            <SortableList
              items={moviesTv.sourceOrder.map((e) => e.id)}
              onReorder={(newOrder) => {
                clearPinOnDrag('moviesTv', 'source');
                updateCategory('moviesTv', (cat) => ({
                  ...cat,
                  sourceOrder: newOrder.map((id) => {
                    const existing = cat.sourceOrder.find((e) => e.id === id);
                    return existing ?? { id: id as TopLevelSourceId, enabled: true };
                  }),
                }));
              }}
              renderItem={(id) => {
                const entry = moviesTv.sourceOrder.find((e) => e.id === id);
                if (!entry) return null;
                const pinnedId = moviesTv.pinnedSource?.id;
                const isFirst = moviesTv.sourceOrder[0]?.id === id;
                return (
                  <SourceCard
                    id={entry.id}
                    enabled={entry.enabled}
                    isPinned={pinnedId === entry.id}
                    isFirst={isFirst}
                    onToggle={(v) => updateCategory('moviesTv', (cat) => ({
                      ...cat,
                      sourceOrder: cat.sourceOrder.map((e) =>
                        e.id === entry.id ? { ...e, enabled: v } : e,
                      ),
                    }))}
                    onTogglePin={() =>
                      pinnedId === entry.id ? unpinSource() : pinSource(entry.id)
                    }
                    onOpenOverride={() => setOverrideTarget({
                      category: 'moviesTv',
                      id: entry.id,
                      label: SOURCE_LABELS[entry.id] ?? entry.id,
                    })}
                  />
                );
              }}
            />
          </section>

          {/* ─── Langue préférée (Films/Séries) ────────────────────────────
              S'applique aux sources qui proposent plusieurs versions :
              FStream, Lynx (wiflix), Viper. sortHostersByPriority lit
              `languageOrder` pour trier les items `.category`/`.language`
              avant l'ordre des hosters. Les sources sans langue explicite
              sont classées après celles avec une langue activée. */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="flex flex-col">
                <h4 className="font-medium text-white">
                  {t('settings.sourcePriority.sectionMovieLanguages')}
                </h4>
                <p className="text-xs text-white/50">
                  {t('settings.sourcePriority.sectionMovieLanguagesDescription')}
                </p>
              </div>
            </div>
            <SortableList
              items={moviesTv.languageOrder.map((e) => e.id)}
              onReorder={(newOrder) => {
                clearPinOnDrag('moviesTv', 'language');
                updateCategory('moviesTv', (cat) => ({
                  ...cat,
                  languageOrder: newOrder.map((id) => {
                    const existing = cat.languageOrder.find((e) => e.id === id);
                    return existing ?? { id: id as LanguageId, enabled: true };
                  }),
                }));
              }}
              renderItem={(id) => {
                const entry = moviesTv.languageOrder.find((e) => e.id === id);
                if (!entry) return null;
                const pinnedId = moviesTv.pinnedLanguage?.id;
                const isFirst = moviesTv.languageOrder[0]?.id === id;
                return (
                  <LanguageCard
                    id={entry.id}
                    enabled={entry.enabled}
                    isPinned={pinnedId === entry.id}
                    isFirst={isFirst}
                    onToggle={(v) => updateCategory('moviesTv', (cat) => ({
                      ...cat,
                      languageOrder: cat.languageOrder.map((e) =>
                        e.id === entry.id ? { ...e, enabled: v } : e,
                      ),
                    }))}
                    onTogglePin={() =>
                      pinnedId === entry.id ? unpinMovieLanguage() : pinMovieLanguage(entry.id)
                    }
                    /* Pas d'override par-langue pour Films/Séries (hosters
                       restent globaux). Le ⚙ de LanguageCard ouvre un modal
                       vide dans ce contexte — on désactive le callback via
                       une action no-op et toast info. */
                    onOpenOverride={() => { /* no-op pour movies */ }}
                    hideOverride
                  />
                );
              }}
            />
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-white">{t('settings.sourcePriority.sectionHosters')}</h4>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-white/60 hover:text-white group/icon"
                onClick={() => doResetWithUndo(
                  t('settings.sourcePriority.resetMoviesTvHostersLabel'),
                  t('settings.sourcePriority.undoToastAction'),
                  t('settings.sourcePriority.resetSectionToast', {
                    section: t('settings.sourcePriority.resetMoviesTvHostersLabel'),
                  }),
                  { type: 'moviesTv', fn: resetMoviesTvHosters, restore: restoreMoviesTv },
                )}
                title={t('settings.sourcePriority.resetHostersTitle')}
              >
                <RotateCcw size={12} className="mr-1 text-white opacity-60 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" /> {t('settings.sourcePriority.resetSectionShort')}
              </Button>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              {t('settings.sourcePriority.hosterToggleHint')}
            </p>
            <SortableList
              items={moviesTv.hosterOrder}
              disabledIds={moviesTv.hosterOrder.filter((id) => hosterIsDisabledInExtractors(id))}
              onReorder={(newOrder) => {
                clearPinOnDrag('moviesTv', 'hoster');
                updateCategory('moviesTv', (cat) => ({
                  ...cat,
                  hosterOrder: newOrder as HosterId[],
                }));
              }}
              renderItem={(id) => {
                const pinnedId = moviesTv.pinnedHoster?.id;
                const isFirst = moviesTv.hosterOrder[0] === id;
                const custom = prefs.customHosters.find((c) => c.id === id);
                return (
                  <HosterCard
                    id={id as HosterId}
                    customLabel={custom?.name}
                    isPinned={pinnedId === id}
                    isFirst={isFirst}
                    isDisabledInExtractors={hosterIsDisabledInExtractors(id as HosterId)}
                    onTogglePin={() =>
                      pinnedId === id
                        ? unpinHoster('moviesTv')
                        : pinHoster('moviesTv', id as HosterId)
                    }
                    onGoToExtractors={scrollToExtractors}
                  />
                );
              }}
            />
          </section>
        </TabsContent>

        {/* ─── ANIMES ─── */}
        <TabsContent
          value="anime"
          id="tab-anime-panel"
          labelledBy="tab-anime-trigger"
          className="space-y-5 mt-4"
        >
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-white">{t('settings.sourcePriority.sectionLanguages')}</h4>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-white/60 hover:text-white group/icon"
                onClick={() => doResetWithUndo(
                  t('settings.sourcePriority.resetAnimeLanguagesLabel'),
                  t('settings.sourcePriority.undoToastAction'),
                  t('settings.sourcePriority.resetSectionToast', {
                    section: t('settings.sourcePriority.resetAnimeLanguagesLabel'),
                  }),
                  { type: 'anime', fn: resetAnimeLanguages, restore: restoreAnime },
                )}
                title={t('settings.sourcePriority.resetLanguagesTitle')}
              >
                <RotateCcw size={12} className="mr-1 text-white opacity-60 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" /> {t('settings.sourcePriority.resetSectionShort')}
              </Button>
            </div>
            <SortableList
              items={anime.languageOrder.map((e) => e.id)}
              onReorder={(newOrder) => {
                clearPinOnDrag('anime', 'language');
                updateCategory('anime', (cat) => ({
                  ...cat,
                  languageOrder: newOrder.map((id) => {
                    const existing = cat.languageOrder.find((e) => e.id === id);
                    return existing ?? { id: id as LanguageId, enabled: true };
                  }),
                }));
              }}
              renderItem={(id) => {
                const entry = anime.languageOrder.find((e) => e.id === id);
                if (!entry) return null;
                const pinnedId = anime.pinnedLanguage?.id;
                const isFirst = anime.languageOrder[0]?.id === id;
                return (
                  <LanguageCard
                    id={entry.id}
                    enabled={entry.enabled}
                    isPinned={pinnedId === entry.id}
                    isFirst={isFirst}
                    onToggle={(v) => updateCategory('anime', (cat) => ({
                      ...cat,
                      languageOrder: cat.languageOrder.map((e) =>
                        e.id === entry.id ? { ...e, enabled: v } : e,
                      ),
                    }))}
                    onTogglePin={() =>
                      pinnedId === entry.id ? unpinLanguage() : pinLanguage(entry.id)
                    }
                    onOpenOverride={() => setOverrideTarget({
                      category: 'anime',
                      id: entry.id,
                      label: LANGUAGE_FLAGS[entry.id] ?? entry.id.toUpperCase(),
                    })}
                  />
                );
              }}
            />
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-white">{t('settings.sourcePriority.sectionHostersAnime')}</h4>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-white/60 hover:text-white group/icon"
                onClick={() => doResetWithUndo(
                  t('settings.sourcePriority.resetAnimeHostersLabel'),
                  t('settings.sourcePriority.undoToastAction'),
                  t('settings.sourcePriority.resetSectionToast', {
                    section: t('settings.sourcePriority.resetAnimeHostersLabel'),
                  }),
                  { type: 'anime', fn: resetAnimeHosters, restore: restoreAnime },
                )}
                title={t('settings.sourcePriority.resetHostersTitle')}
              >
                <RotateCcw size={12} className="mr-1 text-white opacity-60 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" /> {t('settings.sourcePriority.resetSectionShort')}
              </Button>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              {t('settings.sourcePriority.hosterToggleHint')}
            </p>
            <SortableList
              items={anime.hosterOrder}
              disabledIds={anime.hosterOrder.filter((id) => hosterIsDisabledInExtractors(id))}
              onReorder={(newOrder) => {
                clearPinOnDrag('anime', 'hoster');
                updateCategory('anime', (cat) => ({
                  ...cat,
                  hosterOrder: newOrder as HosterId[],
                }));
              }}
              renderItem={(id) => {
                const pinnedId = anime.pinnedHoster?.id;
                const isFirst = anime.hosterOrder[0] === id;
                const custom = prefs.customHosters.find((c) => c.id === id);
                return (
                  <HosterCard
                    id={id as HosterId}
                    customLabel={custom?.name}
                    isPinned={pinnedId === id}
                    isFirst={isFirst}
                    isDisabledInExtractors={hosterIsDisabledInExtractors(id as HosterId)}
                    onTogglePin={() =>
                      pinnedId === id
                        ? unpinHoster('anime')
                        : pinHoster('anime', id as HosterId)
                    }
                    onGoToExtractors={scrollToExtractors}
                  />
                );
              }}
            />
          </section>
        </TabsContent>
      </Tabs>

      {/* Milestone 7 — Éditeur regex & hosters personnalisés. Monté une
          seule fois, hors des Tabs : le store `customHosters` et
          `patternOverrides` est global aux 2 catégories (moviesTv + anime). */}
      <HosterRegexEditor />

      {/* Modal d'override hosters par source / langue (M6). Ouverte via ⚙
          sur une SourceCard (Films/Séries) ou LanguageCard (Animes). */}
      {overrideTarget && (
        <OverrideModal
          open
          onClose={() => setOverrideTarget(null)}
          category={overrideTarget.category}
          contextId={overrideTarget.id}
          contextLabel={overrideTarget.label}
        />
      )}

      {/* ─── Popup "Tout réinitialiser" (custom) ────────────────────────────
          Utilise `ReusableModal` (pattern framer-motion du projet avec z-[100000],
          fade+scale, portal, body scroll-lock) plutôt que Radix Dialog pour
          avoir une popup visuellement distincte pour l'action destructive.
          Pas d'undo : le reset global wipe aussi customHosters et patternOverrides. */}
      <ReusableModal
        isOpen={resetAllOpen}
        onClose={() => setResetAllOpen(false)}
        title={t('settings.sourcePriority.resetConfirmTitle')}
        className="max-w-md"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-red-500/15 border border-red-500/30"
            >
              <AlertTriangle size={22} className="text-red-400" />
            </span>
            <p className="text-sm text-white/80 leading-relaxed">
              {t('settings.sourcePriority.resetConfirmDescription')}
            </p>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setResetAllOpen(false)}>
              {t('settings.sourcePriority.resetConfirmCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                resetSourcePriorityPrefs();
                setResetAllOpen(false);
                toast.success(t('settings.sourcePriority.resetAllToast'));
              }}
            >
              <RotateCcw size={14} className="mr-1.5" />
              {t('settings.sourcePriority.resetConfirmAction')}
            </Button>
          </div>
        </div>
      </ReusableModal>
    </motion.div>
  );
};

export default SourcePriorityPanel;
