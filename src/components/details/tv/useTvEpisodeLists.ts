import { useEffect, useMemo, useState } from 'react';
import type { useTvAiringSchedule } from '@/hooks/useTvAiringSchedule';
import { resolveEpisodeAiring } from '@/utils/tvAiring';
import {
  EPISODE_LIST_SOURCE_EVENT,
  episodeListChoice,
  getDefaultEpisodeListSource,
  getShowEpisodeList,
  groupTvmazeSeasons,
  isTvmazeListDifferent,
  resolveEpisodeList,
  setEpisodeListSource,
  type EpisodeListKind,
  type ShowEpisodeLists,
} from '@/utils/tvmazeEpisodes';
import type { TVShow, TvSeason } from './tvData';

type AiringState = ReturnType<typeof useTvAiringSchedule>;

/** Épisode déjà diffusé, repéré par sa saison (`sa`) et son numéro (`epi`). */
export interface TvAvailableEpisode {
  sa: number;
  epi: number;
}

/**
 * Liste d'épisodes affichée : celle de TMDB, celle de TVmaze (ex. 21
 * chapitres au lieu de 10 épisodes) ou le découpage Netflix (ex. les 5
 * parties de La Casa de Papel), selon le choix global ou celui de la série.
 * Le reste de la page lit `seasonsDetails`.
 */
export function useTvEpisodeLists(
  id: string | null,
  tvShow: TVShow | null,
  tmdbSeasonsDetails: Record<number, TvSeason>,
  { schedule: airingSchedule, now: airingNow }: AiringState,
) {
  // Le choix est relu à chaque rendu : l'évènement en provoque un quand il change.
  const [, setChoiceVersion] = useState(0);
  useEffect(() => {
    const sync = () => setChoiceVersion((version) => version + 1);
    window.addEventListener(EPISODE_LIST_SOURCE_EVENT, sync);
    return () => window.removeEventListener(EPISODE_LIST_SOURCE_EVENT, sync);
  }, []);

  const tmdbEpisodeCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const season of tvShow?.seasons ?? []) counts[season.season_number] = season.episode_count ?? 0;
    return counts;
  }, [tvShow]);
  const scheduleMatches = String(tvShow?.id) === id;
  const tvmazeEpisodeList = scheduleMatches ? airingSchedule?.episodeList : undefined;
  const netflixEpisodeList = scheduleMatches ? airingSchedule?.netflixEpisodeList : undefined;
  const episodeLists = useMemo<ShowEpisodeLists>(() => ({
    tmdbCounts: tmdbEpisodeCounts,
    tvmaze: tvmazeEpisodeList,
    netflix: netflixEpisodeList,
    onNetflix: scheduleMatches && !!airingSchedule?.onNetflix,
  }), [tmdbEpisodeCounts, tvmazeEpisodeList, netflixEpisodeList, scheduleMatches, airingSchedule]);
  const episodeListKind = getShowEpisodeList(id, episodeLists);
  const tvmazeSeasons = useMemo(
    () => tvmazeEpisodeList?.length ? groupTvmazeSeasons(tvmazeEpisodeList) : null,
    [tvmazeEpisodeList],
  );
  const netflixSeasons = useMemo(
    () => netflixEpisodeList?.length ? groupTvmazeSeasons(netflixEpisodeList) : null,
    [netflixEpisodeList],
  );

  // Deux sélecteurs, chacun visible seulement si sa liste diffère de TMDB :
  // au-dessus des saisons, TMDB ou Netflix ; au-dessus des épisodes (hors
  // Netflix), TVmaze ou TMDB, même quand le filtre écarte TVmaze.
  const hasNetflixLayout = !!netflixSeasons && isTvmazeListDifferent(tmdbEpisodeCounts, netflixEpisodeList);
  const usesNetflixLayout = episodeListKind === 'netflix';
  const episodeListOptions = useMemo<EpisodeListKind[]>(
    () => !usesNetflixLayout && tvmazeSeasons && isTvmazeListDifferent(tmdbEpisodeCounts, tvmazeEpisodeList)
      ? ['tvmaze', 'tmdb'] : [],
    [usesNetflixLayout, tvmazeSeasons, tmdbEpisodeCounts, tvmazeEpisodeList],
  );
  const chooseEpisodeList = (kind: EpisodeListKind) => {
    if (!id) return;
    // Si le choix global donne déjà ce résultat, on retire l'exception.
    setEpisodeListSource(id, episodeListChoice(kind, episodeLists));
  };
  // Quitter Netflix revient à la liste du choix global (TVmaze ou TMDB).
  const chooseSeasonLayout = (netflix: boolean) =>
    chooseEpisodeList(netflix ? 'netflix' : resolveEpisodeList(getDefaultEpisodeListSource(), episodeLists));

  const activeListSeasons = episodeListKind === 'netflix' ? netflixSeasons : episodeListKind === 'tvmaze' ? tvmazeSeasons : null;
  const seasonsDetails = useMemo<Record<number, TvSeason>>(() => {
    if (!activeListSeasons) return tmdbSeasonsDetails;
    // Le découpage Netflix remplace toutes les saisons TMDB (ex. la saison 0
    // de La Casa de Papel reprend les parties 1 et 2).
    const merged: Record<number, TvSeason> = episodeListKind === 'netflix' ? {} : { ...tmdbSeasonsDetails };
    for (const [season, episodes] of Object.entries(activeListSeasons)) {
      const number = Number(season);
      const tmdbSeason = tmdbSeasonsDetails[number];
      merged[number] = episodeListKind === 'netflix'
        ? { season_number: number, poster_path: tmdbSeason?.poster_path ?? null, air_date: episodes[0]?.air_date, episodes }
        : { ...(tmdbSeason ?? { season_number: number }), episodes };
    }
    return merged;
  }, [tmdbSeasonsDetails, activeListSeasons, episodeListKind]);

  // Pastilles de saison : celles de TMDB, ou les parties Netflix.
  const seasonCards = useMemo<TvSeason[]>(
    () => episodeListKind === 'netflix' && netflixSeasons
      ? Object.keys(netflixSeasons).map((season) => ({ season_number: Number(season) }))
      : tvShow?.seasons ?? [],
    [episodeListKind, netflixSeasons, tvShow],
  );

  const availableEpisodes = useMemo<TvAvailableEpisode[]>(() => Object.entries(seasonsDetails).flatMap(([season, details]) =>
    (details.episodes ?? []).filter((episode) =>
      resolveEpisodeAiring({ ...episode, season_number: Number(season) }, airingSchedule, airingNow).kind === 'aired',
    ).map((episode) => ({ sa: Number(season), epi: episode.episode_number })),
  ).sort((a, b) => a.sa - b.sa || a.epi - b.epi), [seasonsDetails, airingSchedule, airingNow]);

  const availableSeasons = useMemo(
    () => [...new Set(availableEpisodes.map((episode) => episode.sa))].sort((a, b) => a - b),
    [availableEpisodes],
  );

  // Saison de départ : la 1 si elle existe (les épisodes spéciaux, saison 0,
  // ne passent pas devant), sinon la première disponible.
  const defaultStartSeason = useMemo(() => {
    if (availableSeasons.length === 0) return 1;
    if (availableSeasons.includes(1)) return 1;
    return availableSeasons[0];
  }, [availableSeasons]);

  return {
    episodeListKind, episodeListOptions, tvmazeSeasons, hasNetflixLayout, usesNetflixLayout,
    chooseEpisodeList, chooseSeasonLayout,
    seasonsDetails, seasonCards, availableEpisodes, availableSeasons, defaultStartSeason,
  };
}
