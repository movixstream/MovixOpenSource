import type { MediaRef } from './types.ts';

export function assertMediaRef(media: MediaRef): void {
  if (media.type !== 'movie' && media.type !== 'tv') {
    throw new Error(`MediaRef.type invalide: ${String(media.type)}`);
  }
  if (!Number.isInteger(media.tmdbId) || media.tmdbId <= 0) {
    throw new Error(`MediaRef.tmdbId invalide: ${String(media.tmdbId)}`);
  }
  if (media.type === 'tv') {
    if (media.season != null && (!Number.isInteger(media.season) || media.season < 1)) {
      throw new Error(`MediaRef.season invalide: ${String(media.season)}`);
    }
    if (media.episode != null && (!Number.isInteger(media.episode) || media.episode < 1)) {
      throw new Error(`MediaRef.episode invalide: ${String(media.episode)}`);
    }
    if (media.episode != null && media.season == null) {
      throw new Error('MediaRef.episode exige MediaRef.season');
    }
  }
  if (media.type === 'movie' && (media.season != null || media.episode != null)) {
    throw new Error('MediaRef movie ne doit pas porter season/episode');
  }
}
