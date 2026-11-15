// Dernier titre en cours (clé continueWatching), pour le bouton « Reprendre ».

import { useEffect, useState } from 'react';
import { encodeId } from '@/utils/idEncoder';
import { fetchTmdb, readJson } from './storage';

export interface ResumeItem {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  backdrop: string | null;
  poster: string | null;
  season?: number;
  episode?: number;
  /** Pourcentage vu, 0 si inconnu. */
  progress: number;
  /** Minutes restantes, null si inconnu. */
  remainingMinutes: number | null;
  watchPath: string;
  detailsPath: string;
}

interface Entry {
  id: number;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
  lastAccessed: number;
}

const toTime = (value: unknown) => {
  const time = Date.parse(typeof value === 'string' ? value : '');
  return Number.isFinite(time) ? time : 0;
};

function latestEntries(): Entry[] {
  const data = readJson<{ movies?: unknown[]; tv?: unknown[] }>('continueWatching', {});
  const entries: Entry[] = [];
  type RawEntry = { id?: unknown; lastAccessed?: unknown; currentEpisode?: { season?: unknown; episode?: unknown } } | null;
  (Array.isArray(data.movies) ? data.movies : []).forEach((value) => {
    const raw = (typeof value === 'object' ? value : null) as RawEntry;
    const id = typeof value === 'number' ? value : raw?.id;
    if (typeof id === 'number') entries.push({ id, type: 'movie', lastAccessed: toTime(raw?.lastAccessed) });
  });
  (Array.isArray(data.tv) ? data.tv : []).forEach((value) => {
    const raw = value as RawEntry;
    if (typeof raw?.id !== 'number') return;
    const season = Number(raw.currentEpisode?.season) || 1;
    const episode = Number(raw.currentEpisode?.episode) || 1;
    entries.push({ id: raw.id, type: 'tv', season, episode, lastAccessed: toTime(raw.lastAccessed) });
  });
  return entries.sort((a, b) => b.lastAccessed - a.lastAccessed);
}

function progressOf(entry: Entry) {
  const key = entry.type === 'movie'
    ? `progress_${entry.id}`
    : `progress_tv_${entry.id}_s${entry.season}_e${entry.episode}`;
  const data = readJson<{ position?: number; duration?: number } | null>(key, null);
  if (!data?.position || !data?.duration) return { progress: 0, remainingMinutes: null };
  return {
    progress: Math.min(100, (data.position / data.duration) * 100),
    remainingMinutes: Math.max(0, Math.round((data.duration - data.position) / 60)),
  };
}

export function useResumeItem() {
  const [item, setItem] = useState<ResumeItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Le plus récent qui n'est pas fini (au-delà de 95 %, on passe au suivant).
    const entry = latestEntries().find((candidate) => progressOf(candidate).progress < 95);
    if (!entry) {
      setLoading(false);
      return;
    }
    void fetchTmdb(`/${entry.type}/${entry.id}`).then((data) => {
      if (cancelled) return;
      if (!data) {
        setLoading(false);
        return;
      }
      const encoded = encodeId(entry.id);
      setItem({
        id: entry.id,
        type: entry.type,
        title: data.title || data.name || '',
        backdrop: data.backdrop_path || null,
        poster: data.poster_path || null,
        season: entry.season,
        episode: entry.episode,
        ...progressOf(entry),
        watchPath: entry.type === 'movie'
          ? `/watch/movie/${encoded}`
          : `/watch/tv/${encoded}/s/${entry.season}/e/${entry.episode}`,
        detailsPath: `/${entry.type}/${encoded}`,
      });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { item, loading };
}
