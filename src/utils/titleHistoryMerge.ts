// Fusion de l'historique serveur d'un titre (GET /api/history/title) avec le
// stockage local, pour les fiches film et série. Règle du contrat : le local
// est toujours le plus frais et gagne ; le serveur comble seulement ce qui
// manque (positions exactes d'un autre appareil, estimés des lecteurs web,
// marques « Déjà vu »). En mode animé, les numéros du serveur (anime-sama) ne
// s'appliquent pas aux épisodes TMDB de la fiche.
// Module pur (imports de types seulement), testé par node --test.

import type { TitleHistory, TitleHistoryEpisode } from '../services/historyService';

/** Seuils de reprise de la fiche film (inchangés) : plus de 30 s vues, moins de 95 %. */
const RESUME_MIN_SECONDS = 30;
const RESUME_MAX_PERCENT = 95;

const positive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

// --- Film -------------------------------------------------------------------------

/**
 * « Vu » connu seulement du serveur, montré À CÔTÉ du bouton ou de la coche
 * (qui ne posent et ne retirent que la marque locale) : `estimated` = un
 * lecteur web le dit, `otherDevice` = marque ou lecture d'un autre appareil.
 */
export type ServerWatched = 'estimated' | 'otherDevice' | null;

/** progress_ local fini (95 % ou plus), comme le seuil de reprise de la fiche. */
export function localProgressFinished(raw: string | null): boolean {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return positive(value?.position) && positive(value?.duration) && (value.position / value.duration) * 100 >= RESUME_MAX_PERCENT;
  } catch {
    return false;
  }
}

/**
 * Bouton « Vu » d'un film : allumé par la marque locale seule. Si seul le
 * serveur dit le film vu (et pas une position finie de cet appareil), une
 * indication à part : « Vu (estimé) » ou « Vu sur un autre appareil ».
 */
export function movieWatchedState(
  localWatched: boolean,
  localFinished: boolean,
  server: TitleHistory | null,
): { toggleOn: boolean; serverWatched: ServerWatched } {
  if (localWatched) return { toggleOn: true, serverWatched: null };
  if (localFinished || server?.status !== 'finished') return { toggleOn: false, serverWatched: null };
  return { toggleOn: false, serverWatched: !server.markedWatched && server.estimated ? 'estimated' : 'otherDevice' };
}

export interface ResumePoint {
  position: number;
  duration: number;
  estimated: boolean;
  fromServer: boolean;
}

const resumable = (position: number, duration: number) =>
  position > RESUME_MIN_SECONDS && (position / duration) * 100 < RESUME_MAX_PERCENT;

/**
 * Reprise d'un film : la position locale si elle existe (même finie : elle
 * gagne, et une position finie ne propose pas de reprise), sinon celle du
 * serveur, exacte ou estimée, avec les mêmes seuils.
 */
export function movieResume(
  local: { position: number; duration: number } | null,
  server: TitleHistory | null,
): ResumePoint | null {
  if (local && positive(local.position) && positive(local.duration)) {
    return resumable(local.position, local.duration)
      ? { position: local.position, duration: local.duration, estimated: false, fromServer: false }
      : null;
  }
  if (!server || !positive(server.position) || !positive(server.duration)) return null;
  return resumable(server.position, server.duration)
    ? { position: server.position, duration: server.duration, estimated: server.estimated, fromServer: true }
    : null;
}

// --- Série : épisodes ------------------------------------------------------------------

/** Épisodes du serveur par « saison:épisode » ; vide en mode animé (numérotation différente). */
export function serverEpisodeMap(server: TitleHistory | null): Map<string, TitleHistoryEpisode> {
  const map = new Map<string, TitleHistoryEpisode>();
  if (!server || server.animeMode) return map;
  for (const entry of server.episodes) map.set(`${entry.season}:${entry.episode}`, entry);
  return map;
}

/**
 * Série marquée « Déjà vu » en entier : le serveur ne détaille pas ses
 * épisodes, chacun compte comme vu. Hors mode animé (numérotation différente).
 */
export function seriesFullyMarked(server: TitleHistory | null): boolean {
  return Boolean(server && server.mediaType === 'tv' && server.markedWatched && !server.animeMode);
}

/** Seuil « épisode vu » de l'onglet pour une progression exacte. */
const EPISODE_WATCHED_PERCENT = 85;

/**
 * Barre et coche d'un épisode. Barre : progression locale d'abord, sinon
 * serveur. Coche (`watched`) : la marque locale seule. `serverWatched` :
 * indication à part quand seul le serveur dit l'épisode vu (estimé, marque
 * ou lecture d'un autre appareil, série entière marquée), sauf si la
 * progression locale le montre déjà. Durée ≤ 0 = inconnue.
 */
export function mergeEpisode(
  local: { percent: number; hasProgress: boolean; watched: boolean },
  server: TitleHistoryEpisode | undefined,
  seriesMarked = false,
): { percent: number; hasProgress: boolean; watched: boolean; serverWatched: ServerWatched; estimated: boolean } {
  const localSeen = local.watched || (local.hasProgress && local.percent >= EPISODE_WATCHED_PERCENT);
  let serverWatched: ServerWatched = null;
  if (!localSeen) {
    if (seriesMarked) serverWatched = 'otherDevice';
    else if (server?.watched) serverWatched = server.estimated && !server.marked ? 'estimated' : 'otherDevice';
  }
  if (local.hasProgress || !server || !positive(server.position) || !positive(server.duration)) {
    return { percent: local.percent, hasProgress: local.hasProgress, watched: local.watched, serverWatched, estimated: false };
  }
  const percent = Math.min(100, Math.round((server.position / server.duration) * 100));
  return { percent, hasProgress: percent > 0, watched: local.watched, serverWatched, estimated: server.estimated };
}

// --- Série : reprise ---------------------------------------------------------------------

export interface SeriesResume {
  seasonNumber: number;
  episodeNumber: number;
  position: number;
  duration: number;
  hasProgress: boolean;
}

/**
 * Épisode à reprendre : celui du stockage local s'il y en a un, sinon
 * l'épisode courant du serveur — seulement si sa numérotation est celle de
 * la fiche (même mode animé) et, hors animé, si la saison est affichée.
 */
export function seriesResume(
  local: SeriesResume,
  server: TitleHistory | null,
  context: { pageAnimeMode: boolean; availableSeasons: number[]; defaultStartSeason: number },
): SeriesResume & { estimated: boolean; fromServer: boolean } {
  const keepLocal = { ...local, estimated: false, fromServer: false };
  if (local.hasProgress || !server) return keepLocal;
  const { season, episode } = server;
  if (season === null || episode === null || season < 0 || episode < 1) return keepLocal;
  if (server.animeMode !== context.pageAnimeMode) return keepLocal;
  if (!context.pageAnimeMode && context.availableSeasons.length > 0 && !context.availableSeasons.includes(season)) return keepLocal;
  const hasPosition = positive(server.position) && positive(server.duration);
  return {
    seasonNumber: season,
    episodeNumber: episode,
    position: hasPosition ? (server.position as number) : 0,
    duration: hasPosition ? (server.duration as number) : 0,
    hasProgress: hasPosition,
    estimated: hasPosition && server.estimated,
    fromServer: true,
  };
}

/**
 * Valeur `progress_*` à écrire avant d'ouvrir le lecteur, qui ne lit que le
 * stockage local : seulement une position exacte venue du serveur (le temps
 * d'un lecteur web n'est pas une position).
 */
export function seedProgress(resume: ResumePoint, now: string): string | null {
  if (!resume.fromServer || resume.estimated || !positive(resume.position) || !positive(resume.duration)) return null;
  return JSON.stringify({ position: resume.position, timestamp: now, duration: resume.duration });
}
