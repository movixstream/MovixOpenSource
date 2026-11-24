import type { TFunction } from 'i18next';
import AlertButton from '@/components/AlertButton';
import type { useAntiSpoilerSettings } from '@/hooks/useAntiSpoilerSettings';
import { getTmdbImageUrl } from '@/utils/tmdbImages';
import { formatAiringDate, getAiringLabel, type resolveEpisodeAiring } from '@/utils/tvAiring';
import { mergeEpisode, type serverEpisodeMap } from '@/utils/titleHistoryMerge';
import { formatDetailsRating } from '../format';
import type { DetailsImageSizing } from '../images';
import { TV_EPISODE_ACTION_CLASS } from './TvEpisodeCard';
import type { TvEpisodeItem } from './types';
import type { AnimeEpisode, TvEpisode } from './tvData';
import type { TvWatchStatus } from './useTvWatchStatus';

type EpisodeAiring = ReturnType<typeof resolveEpisodeAiring>;
type AntiSpoiler = ReturnType<typeof useAntiSpoilerSettings>;

/** Nom d'une langue Anime-Sama (« VF », « VOSTFR »…). */
export const animeLanguageLabel = (language: string, t: TFunction): string =>
  t(`details.languages.${language.toLowerCase()}`, { defaultValue: language.toUpperCase() });

export const tvRuntimeText = (minutes: number, t: TFunction) => (minutes >= 60
  ? t('details.runtimeHours', { hours: Math.floor(minutes / 60), paddedMinutes: String(minutes % 60).padStart(2, '0') })
  : t('details.runtimeMinutes', { minutes }));

/**
 * Progression d'un épisode : stockage local d'abord, serveur (autre appareil,
 * lecteur web, série marquée en entier) pour ce que le local n'a pas.
 */
export function tvEpisodeWatchState(
  id: string | null,
  season: number | null,
  episodeNumber: number,
  watchStatus: TvWatchStatus,
  serverEpisodes: ReturnType<typeof serverEpisodeMap>,
  seriesMarked: boolean,
) {
  const key = `s${season}e${episodeNumber}`;
  let percent = 0;
  let hasProgress = false;
  try {
    if (typeof window !== 'undefined' && id) {
      const saved = localStorage.getItem(`progress_tv_${id}_s${season}_e${episodeNumber}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.position && parsed.duration && parsed.duration > 0) {
          percent = Math.round((parsed.position / parsed.duration) * 100);
          // Au moins 1 % vu pour compter comme commencé.
          hasProgress = parsed.position > 0 && percent > 0;
        }
      }
    }
  } catch {
    // stockage ou JSON illisible : pas de progression locale
  }
  const merged = mergeEpisode(
    { percent, hasProgress, watched: Boolean(watchStatus.episodeWatched[key]) },
    serverEpisodes.get(`${season}:${episodeNumber}`),
    seriesMarked,
  );
  // Coche : la marque locale seule. Vu d'après le serveur seulement :
  // indication à part (serverWatched), la coche n'est pas allumée.
  const seen = merged.watched || merged.serverWatched !== null || (merged.hasProgress && merged.percent >= 95);
  return { key, merged, seen, current: !seen && merged.hasProgress && merged.percent > 0 };
}

export type TvEpisodeWatchState = ReturnType<typeof tvEpisodeWatchState>;

interface EpisodeItemContext {
  id: string | null;
  showName: string;
  season: number;
  selectedEpisode: number | null;
  watchState: TvEpisodeWatchState;
  watchStatus: TvWatchStatus;
  airing: EpisodeAiring;
  airingNow: number;
  antiSpoiler: AntiSpoiler;
  sizing: DetailsImageSizing;
  /** Largeur CSS de la vignette ; `null` tant que la grille n'est pas mesurée. */
  thumbCssWidth: number | null;
  language: string;
  t: TFunction;
}

/** Épisode TMDB (ou TVmaze) prêt pour `TvEpisodeList`, anti-spoil appliqué. */
export function toTvEpisodeItem(episode: TvEpisode, context: EpisodeItemContext): TvEpisodeItem {
  const { id, showName, season, selectedEpisode, watchState: state, watchStatus, airing, airingNow, antiSpoiler, sizing, thumbCssWidth, language, t } = context;
  const hideNames = antiSpoiler.shouldHide('episodeNames');
  // `still_url` : image TVmaze complète, laissée telle quelle.
  const still = episode.still_path || episode.still_url;
  const reminderAt = airing.timestamp ?? (airing.date ? Date.parse(`${airing.date}T00:00:00Z`) : NaN);
  // TMDB ne sert les vignettes d'épisode qu'en 92, 185 et 300 px, puis
  // l'original (souvent en 1080p). Jusqu'à une fois et demie 300 px on reste
  // sur 300 ; l'original ne part qu'au-delà, ou en qualité « haute ».
  const stillWidth = (cssWidth: number) => {
    const wanted = Math.ceil(cssWidth * sizing.imageDpr);
    return sizing.quality !== 'high' && wanted <= 450 ? Math.min(wanted, 300) : wanted;
  };
  return {
    key: state.key,
    number: episode.episode_number,
    title: hideNames
      ? antiSpoiler.getMaskedContent(episode.name, 'episodeNames', undefined, episode.episode_number)
      : `${episode.episode_number}. ${episode.name}`,
    imageUrl: still && thumbCssWidth !== null
      ? getTmdbImageUrl(still, { kind: 'still', quality: sizing.quality, width: stillWidth(thumbCssWidth), role: 'card' })
      : null,
    imageHidden: antiSpoiler.shouldHide('episodeImages'),
    airing: airing.kind === 'unconfirmed' ? null : airing.kind,
    meta: [
      episode.runtime ? tvRuntimeText(episode.runtime, t) : null,
      airing.date || airing.timestamp !== null
        ? (airing.kind === 'aired' ? formatAiringDate(airing, language) : getAiringLabel(airing, t, language, airingNow))
        : null,
    ].filter((part): part is string => Boolean(part)),
    metaWide: episode.vote_average && episode.vote_average > 0 ? [`★ ${formatDetailsRating(episode.vote_average, language)}`] : [],
    overview: episode.overview
      ? (antiSpoiler.shouldHide('episodeOverviews') ? antiSpoiler.getMaskedContent(episode.overview, 'episodeOverviews') : episode.overview)
      : null,
    progress: state.merged.percent,
    status: state.seen ? 'seen' : state.current ? 'current' : null,
    selected: selectedEpisode === episode.episode_number,
    watched: state.merged.watched,
    serverWatched: state.merged.serverWatched,
    inWatchlist: Boolean(watchStatus.episodeWatchlist[state.key]),
    // Ne pas proposer un rappel dont l'instant est déjà passé.
    alert: reminderAt > airingNow && airing.date && id && showName ? (
      <AlertButton
        showId={id}
        showName={showName}
        season={season}
        episode={episode.episode_number}
        episodeName={episode.name}
        airDate={airing.timestamp !== null ? new Date(airing.timestamp).toISOString() : airing.date}
        className={TV_EPISODE_ACTION_CLASS}
      />
    ) : undefined,
  };
}

/** Épisode Anime-Sama prêt pour `TvEpisodeList`. */
export const toAnimeEpisodeItem = (episode: AnimeEpisode, season: number | null, selectedEpisode: number | null, t: TFunction): TvEpisodeItem => ({
  key: `anime-s${season}e${episode.index}`,
  number: episode.index,
  // Le nom vient d'Anime-Sama (« Episode 62 ») : pas de rang devant.
  title: String(episode.name || episode.index),
  compact: true,
  tags: episode.streaming_links.map((link) => animeLanguageLabel(link.language, t)),
  selected: selectedEpisode === episode.index,
});
