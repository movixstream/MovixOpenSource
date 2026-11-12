import type { MediaRef, SourceProvider } from '../types.ts';

function placeholder(id: string, label: string): SourceProvider {
  return {
    id,
    label,
    enabled: false,
    supports: (media: MediaRef) => media.type === 'movie' || media.type === 'tv',
    async resolve() {
      return [];
    },
  };
}

/** Autres sources de *visionnage* à brancher (pas `/download` DDL). */
export const placeholderProviders: SourceProvider[] = [
  placeholder('wiflix', 'Wiflix (?resolve=1 → m3u8)'),
  placeholder('fstream', 'FStream (?resolve=1 → m3u8)'),
  placeholder('j1f', '1jour1film (?resolve=1)'),
  placeholder('coflix', 'Coflix (?resolve=1)'),
  placeholder('cpasmal', 'Cpasmal (?resolve=1)'),
  placeholder('voirdrama', 'VoirDrama (?resolve=1)'),
  placeholder('animeSama', 'Anime-Sama (m3u8ByPlayer)'),
  placeholder('frenchstream', 'FrenchStream films (?resolve=1) ; séries = trou'),
];
