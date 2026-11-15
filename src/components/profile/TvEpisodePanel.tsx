// Panneau des épisodes d'une série, ouvert sous la rangée de la carte dans les
// grilles Vus / Watchlist / Favoris. Il lit lui-même le localStorage :
// - nouveau format `${liste}_episodes_tv_${id}` : objet { S1E3: true, … } ;
// - ancien format `${liste}_tv_episodes` : tableau d'éléments avec episodeInfo ;
// - `watched_tv` / `watchlist_tv` : la série entière est dans la liste.
// Les suppressions passent par localStorage.setItem (App les synchronise).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Eye, ListVideo, Trash2, X } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import type { WatchItem } from './types';
import { fetchTmdb, readStoredArray, readStoredRecord } from './storage';
import { IconButton, buttonClass } from './ui';

type EpisodeListType = 'watched' | 'watchlist';

interface TvEpisodePanelProps {
  showId: number;
  showTitle: string;
  listType: 'watched' | 'watchlist' | 'favorites';
  onClose: () => void;
  detailsPath: string;
}

interface EpisodeState {
  /** Clés canoniques `S{saison}E{épisode}` (ou clé brute si elle n'a pas ce format). */
  episodes: string[];
  isFullSeries: boolean;
}

const EPISODE_KEY = /^S(\d+)E(\d+)$/i;
const UNGROUPED = -1;

/** `s01e03` → `S1E3` ; une clé hors format reste telle quelle. */
function canonicalKey(key: string): string {
  const match = key.match(EPISODE_KEY);
  return match ? `S${Number.parseInt(match[1], 10)}E${Number.parseInt(match[2], 10)}` : key;
}

function parseKey(key: string): { season: number; episode: number } | null {
  const match = key.match(EPISODE_KEY);
  return match ? { season: Number.parseInt(match[1], 10), episode: Number.parseInt(match[2], 10) } : null;
}

/** Épisodes d'une liste, formats nouveau et ancien confondus, sans doublon. */
function readEpisodeKeys(showId: number, listType: EpisodeListType): string[] {
  const keys = new Set<string>();
  const record = readStoredRecord(`${listType}_episodes_tv_${showId}`);
  Object.keys(record).forEach((key) => {
    if (record[key]) keys.add(canonicalKey(key));
  });
  readStoredArray<WatchItem>(`${listType}_tv_episodes`).forEach((entry) => {
    if (entry?.id === showId && entry.episodeInfo) {
      keys.add(`S${entry.episodeInfo.season}E${entry.episodeInfo.episode}`);
    }
  });
  return [...keys];
}

/** Regroupe par saison (triées), épisodes triés ; les clés hors format vont dans -1. */
function groupBySeason(keys: string[]): Array<[number, string[]]> {
  const seasons = new Map<number, string[]>();
  keys.forEach((key) => {
    const season = parseKey(key)?.season ?? UNGROUPED;
    seasons.set(season, [...(seasons.get(season) ?? []), key]);
  });
  seasons.forEach((list, season) => {
    if (season === UNGROUPED) return;
    list.sort((a, b) => (parseKey(a)?.episode ?? 0) - (parseKey(b)?.episode ?? 0));
  });
  return [...seasons.entries()].sort(([a], [b]) => {
    if (a === UNGROUPED) return 1;
    if (b === UNGROUPED) return -1;
    return a - b;
  });
}

/**
 * Les animés gardent la liste détaillée même « série entière » : ancien format
 * d'épisodes, cache anime-sama, ou numéros d'épisode très élevés.
 */
function isAnimeShow(showId: number): boolean {
  if (readStoredArray<WatchItem>('watched_tv_episodes').some((entry) => entry?.id === showId)) return true;
  const idText = String(showId);
  try {
    if (Object.keys(localStorage).some((key) => key.includes('anime-sama') && key.includes(idText))) return true;
  } catch { /* stockage inaccessible */ }
  return Object.keys(readStoredRecord(`watched_episodes_tv_${showId}`)).some(
    (key) => (parseKey(key)?.episode ?? 0) > 50,
  );
}

function isInWholeSeriesList(showId: number, listType: EpisodeListType): boolean {
  return readStoredArray<{ id?: unknown }>(`${listType}_tv`).some((entry) => entry?.id === showId);
}

/** Retire un épisode des deux formats de stockage, quelle que soit la casse de la clé. */
function removeEpisodeFromStorage(showId: number, listType: EpisodeListType, key: string) {
  const target = parseKey(key);
  const recordKey = `${listType}_episodes_tv_${showId}`;
  const record = readStoredRecord(recordKey);
  const kept: Record<string, boolean> = {};
  let changed = false;
  Object.keys(record).forEach((storedKey) => {
    const parsed = parseKey(storedKey);
    const same = target && parsed
      ? parsed.season === target.season && parsed.episode === target.episode
      : storedKey === key;
    if (same) changed = true;
    else kept[storedKey] = record[storedKey];
  });
  if (changed) localStorage.setItem(recordKey, JSON.stringify(kept));

  if (!target) return;
  const legacyKey = `${listType}_tv_episodes`;
  const legacy = readStoredArray<WatchItem>(legacyKey);
  const legacyKept = legacy.filter(
    (entry) =>
      !(entry?.id === showId &&
        entry.episodeInfo?.season === target.season &&
        entry.episodeInfo?.episode === target.episode),
  );
  if (legacyKept.length !== legacy.length) localStorage.setItem(legacyKey, JSON.stringify(legacyKept));
}

interface SeasonBlockProps {
  title: string;
  episodes: string[];
  expanded: boolean;
  onToggle: () => void;
  formatEpisode: (key: string) => string;
  onRemove: (key: string) => void;
  removeLabel: string;
  reduceMotion: boolean;
}

/** Bloc de saison repliable : en-tête cliquable puis liste des épisodes. */
function SeasonBlock({ title, episodes, expanded, onToggle, formatEpisode, onRemove, removeLabel, reduceMotion }: SeasonBlockProps) {
  const transition = { duration: reduceMotion ? 0 : 0.2, ease: [0.25, 0.1, 0.25, 1] as const };

  return (
    <div className="self-start overflow-hidden rounded-lg bg-black/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-[15px] font-medium text-white transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
      >
        <span className="tabular-nums">{title}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white opacity-60 transition-transform duration-200 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="episodes"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition}
            className="overflow-hidden"
          >
            <ul className="space-y-0.5 px-2 pb-2">
              {episodes.map((key) => (
                <li
                  key={key}
                  className="group flex min-h-10 items-center justify-between gap-2 rounded-md py-0.5 pl-3 pr-1 odd:bg-white/[0.03]"
                >
                  <span className="min-w-0 truncate text-[15px] text-white/80 tabular-nums">{formatEpisode(key)}</span>
                  <IconButton
                    tone="light"
                    label={removeLabel}
                    onClick={() => onRemove(key)}
                    className="hover:!bg-red-600 hover:!text-white md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function TvEpisodePanel({ showId, showTitle, listType, onClose, detailsPath }: TvEpisodePanelProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion() ?? false;
  const episodeList: EpisodeListType | null = listType === 'favorites' ? null : listType;

  const [state, setState] = useState<EpisodeState>(() =>
    episodeList
      ? { episodes: readEpisodeKeys(showId, episodeList), isFullSeries: isInWholeSeriesList(showId, episodeList) }
      : { episodes: [], isFullSeries: false },
  );
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const isAnime = useMemo(() => isAnimeShow(showId), [showId]);

  // Relecture à chaque changement de série ou de liste.
  useEffect(() => {
    setExpanded(new Set());
    if (!episodeList) {
      setState({ episodes: [], isFullSeries: false });
      return;
    }
    setState({ episodes: readEpisodeKeys(showId, episodeList), isFullSeries: isInWholeSeriesList(showId, episodeList) });
  }, [showId, episodeList]);

  // « Vus » : la série compte comme entière si tous les épisodes TMDB sont vus.
  useEffect(() => {
    if (episodeList !== 'watched') return;
    let cancelled = false;
    const watchedCount = Object.keys(readStoredRecord(`watched_episodes_tv_${showId}`)).length;
    if (watchedCount === 0) return;
    fetchTmdb<{ number_of_episodes?: number }>(`/tv/${showId}`).then((data) => {
      const total = data?.number_of_episodes ?? 0;
      if (!cancelled && total > 0 && watchedCount >= total) {
        setState((prev) => ({ ...prev, isFullSeries: true }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showId, episodeList]);

  const toggleSeason = useCallback((season: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(season)) next.delete(season);
      else next.add(season);
      return next;
    });
  }, []);

  const removeEpisode = useCallback(
    (key: string) => {
      if (!episodeList) return;
      try {
        removeEpisodeFromStorage(showId, episodeList, key);
      } catch (error) {
        console.error(`Erreur lors du retrait de l'épisode ${key} (${episodeList}) :`, error);
        return;
      }
      // Mêmes clés canoniques que celles lues : l'état reste cohérent avec le stockage.
      setState((prev) => ({ ...prev, episodes: prev.episodes.filter((episode) => episode !== key) }));
    },
    [showId, episodeList],
  );

  const formatEpisode = useCallback(
    (key: string) => {
      const parsed = parseKey(key);
      return parsed
        ? t('profilePage.episodes.episodeNumber', { episode: parsed.episode, defaultValue: 'Épisode {{episode}}' })
        : key;
    },
    [t],
  );

  const seasons = useMemo(() => groupBySeason(state.episodes), [state.episodes]);

  const heading =
    episodeList === 'watched'
      ? t('profilePage.episodes.watchedHeading', 'Épisodes vus')
      : episodeList === 'watchlist'
        ? t('profilePage.episodes.watchlistHeading', 'Épisodes dans la watchlist')
        : null;

  const renderBody = () => {
    if (!episodeList) {
      return <p className="text-[15px] text-white/60">{t('profilePage.episodes.favoritesApplyToSeries')}</p>;
    }

    if (state.isFullSeries && !isAnime) {
      const Icon = episodeList === 'watched' ? Eye : ListVideo;
      return (
        <p className="flex items-center gap-3 rounded-lg bg-black/40 px-4 py-3 text-[15px] text-white/80">
          <Icon className="h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
          {episodeList === 'watched'
            ? t('profilePage.episodes.watchedEntireSeries')
            : t('profilePage.episodes.entireSeriesInWatchlist')}
        </p>
      );
    }

    if (state.episodes.length === 0) {
      return (
        <p className="text-[15px] text-white/60">
          {episodeList === 'watched'
            ? t('profilePage.episodes.noEpisodeWatched')
            : t('profilePage.episodes.noEpisodeInWatchlist')}
        </p>
      );
    }

    const removeLabel =
      episodeList === 'watched'
        ? t('profilePage.episodes.removeFromWatched')
        : t('profilePage.episodes.removeFromWatchlist');

    return (
      <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {seasons.map(([season, episodes]) => (
          <SeasonBlock
            key={season}
            title={
              season === UNGROUPED
                ? t('profilePage.episodes.otherEpisodes', { count: episodes.length })
                : t('profilePage.episodes.seasonEpisodes', { season, count: episodes.length })
            }
            episodes={episodes}
            expanded={expanded.has(season)}
            onToggle={() => toggleSeason(season)}
            formatEpisode={formatEpisode}
            onRemove={removeEpisode}
            removeLabel={removeLabel}
            reduceMotion={reduceMotion}
          />
        ))}
      </div>
    );
  };

  return (
    <motion.section
      aria-label={showTitle}
      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className="col-span-full rounded-xl bg-gray-900 p-5"
    >
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-semibold text-white">{showTitle}</h3>
          {heading && <p className="mt-0.5 text-[15px] text-white/60">{heading}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link to={detailsPath} className={buttonClass('secondary', 'sm')}>
            {t('profilePage.episodes.viewDetails', 'Voir la fiche')}
          </Link>
          <IconButton tone="light" label={t('profilePage.episodes.closePanel', 'Fermer le panneau des épisodes')} onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      </header>

      {renderBody()}
    </motion.section>
  );
}
