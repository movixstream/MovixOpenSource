import { useEffect, useMemo, useState } from 'react';
import { useTitleHistory } from '@/hooks/useTitleHistory';
import { serverEpisodeMap, seriesFullyMarked, seriesResume } from '@/utils/titleHistoryMerge';

interface LocalResume {
  seasonNumber: number;
  episodeNumber: number;
  position: number;
  duration: number;
  hasProgress: boolean;
}

type ContinueWatchingTvEntry = {
  id: number;
  currentEpisode?: { season: number; episode: number };
  lastAccessed?: string;
};

interface ResumeCandidate {
  season: number;
  episode: number;
  timestamp: number;
  position: number;
  duration: number;
}

const readProgress = (key: string): { position: number; duration: number; timestamp: number } | null => {
  const value = localStorage.getItem(key);
  if (!value) return null;
  try {
    const data = JSON.parse(value);
    return {
      position: Number(data.position) || 0,
      duration: Number(data.duration) || 0,
      timestamp: data.timestamp ? Date.parse(data.timestamp) : NaN,
    };
  } catch {
    return null;
  }
};

/**
 * Dernier épisode regardé d'après le stockage local : l'entrée
 * `continueWatching` et toutes les clés `progress_tv_<id>_s<S>_e<E>`, la plus
 * récente l'emporte.
 */
function findLatestLocalEpisode(id: string): ResumeCandidate | null {
  let latest: ResumeCandidate | null = null;
  const consider = (candidate: ResumeCandidate) => {
    if (!Number.isFinite(candidate.season) || !Number.isFinite(candidate.episode)) return;
    if (candidate.season <= 0 || candidate.episode <= 0) return;
    if (!Number.isFinite(candidate.timestamp)) return;
    if (!latest || candidate.timestamp > latest.timestamp) latest = candidate;
  };

  const continueWatching = JSON.parse(localStorage.getItem('continueWatching') || '{"movies": [], "tv": []}') as {
    tv?: ContinueWatchingTvEntry[];
  };
  const entry = Array.isArray(continueWatching.tv)
    ? continueWatching.tv.find((show) => show.id === parseInt(id))
    : undefined;
  if (entry?.currentEpisode) {
    const season = Number(entry.currentEpisode.season);
    const episode = Number(entry.currentEpisode.episode);
    const progress = Number.isFinite(season) && Number.isFinite(episode)
      ? readProgress(`progress_tv_${id}_s${season}_e${episode}`)
      : null;
    const accessed = entry.lastAccessed ? Date.parse(entry.lastAccessed) : NaN;
    consider({
      season,
      episode,
      timestamp: progress && Number.isFinite(progress.timestamp) ? progress.timestamp : accessed,
      position: progress?.position ?? 0,
      duration: progress?.duration ?? 0,
    });
  }

  const prefix = `progress_tv_${id}_s`;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const match = key.match(/^progress_tv_\d+_s(\d+)_e(\d+)$/);
    if (!match) continue;
    const progress = readProgress(key);
    if (!progress || !Number.isFinite(progress.timestamp)) continue;
    consider({ season: Number(match[1]), episode: Number(match[2]), ...progress });
  }
  return latest;
}

/**
 * Épisode à reprendre. Le stockage local gagne toujours ; l'historique serveur
 * (autre appareil, lecteurs web, « Déjà vu ») comble ce qui manque. Une saison
 * absente de la liste affichée ramène à la saison de départ.
 */
export function useTvResume(
  id: string | null,
  { animeMode, availableSeasons, defaultStartSeason }: { animeMode: boolean; availableSeasons: number[]; defaultStartSeason: number },
) {
  const [local, setLocal] = useState<LocalResume>({
    seasonNumber: 1, episodeNumber: 1, position: 0, duration: 0, hasProgress: false,
  });

  useEffect(() => {
    if (!id) return;
    try {
      const latest = findLatestLocalEpisode(id);
      if (!latest) {
        setLocal({ seasonNumber: defaultStartSeason, episodeNumber: 1, position: 0, duration: 0, hasProgress: false });
        return;
      }
      const excluded = !animeMode && availableSeasons.length > 0 && !availableSeasons.includes(latest.season);
      setLocal({
        seasonNumber: excluded ? defaultStartSeason : latest.season,
        episodeNumber: excluded ? 1 : latest.episode,
        position: latest.position,
        duration: latest.duration,
        hasProgress: true,
      });
    } catch (error) {
      console.error('Error parsing continue watching data:', error);
    }
  }, [id, animeMode, availableSeasons, defaultStartSeason]);

  const titleHistory = useTitleHistory('tv', id);
  const serverEpisodes = useMemo(() => serverEpisodeMap(titleHistory), [titleHistory]);
  const seriesMarked = seriesFullyMarked(titleHistory);
  const resumeData = seriesResume(local, titleHistory, {
    pageAnimeMode: animeMode,
    availableSeasons,
    defaultStartSeason,
  });

  return { resumeData, serverEpisodes, seriesMarked };
}
