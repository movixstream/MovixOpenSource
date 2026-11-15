// src/utils/embedOrigin.ts
import type { TopLevelSourceId } from '../types/sourcePriority';
import { getRememberLastPlayer, getLastPlayer, getLastHoster } from './lastPlayerPref';
import { hosterKeyOf } from './sourceAutoSelect';

/**
 * embedorigin est le lecteur Movix (base) à préférer : il passe devant tous
 * les autres lecteurs embed, dans la liste comme au choix automatique. Seul
 * le dernier lecteur gardé en mémoire (« se souvenir du dernier lecteur »)
 * passe devant lui.
 */
export const isEmbedOriginUrl = (url: string): boolean =>
  /(^|\/\/|\.)embedorigin\./i.test(url);

/**
 * Sources de la priorité qui se jouent dans un lecteur embed (iframe). Quand
 * le choix automatique tombe sur l'une d'elles et qu'un lien embedorigin
 * existe, c'est embedorigin qui est lancé. Les sources directes (HLS, MP4,
 * Darkino…) gardent leur rang.
 */
export const EMBED_SOURCE_IDS: ReadonlySet<TopLevelSourceId> = new Set<TopLevelSourceId>([
  'fstream', 'omega', 'wiflix', 'j1f', 'swiftflow', 'coflix', 'viper',
  'custom', 'frembed', 'vox', 'vostfr',
]);

/** Vrai si la source vient du « se souvenir du dernier lecteur ». */
export const isRememberedPick = (pick: TopLevelSourceId): boolean =>
  getRememberLastPlayer() && getLastPlayer() === pick;

/** Vrai si un dernier lecteur est gardé en mémoire. */
export const hasRememberedPlayer = (): boolean =>
  getRememberLastPlayer() && getLastPlayer() !== null;

/**
 * Lien « custom » à lancer : le lecteur gardé en mémoire s'il est là, sinon
 * embedorigin, sinon Uqload, sinon le premier.
 */
export function pickCustomLink(links: readonly string[]): string | undefined {
  if (isRememberedPick('custom')) {
    const hoster = getLastHoster();
    const remembered = hoster ? links.find((url) => hosterKeyOf({ url }) === hoster) : undefined;
    if (remembered) return remembered;
  }
  return links.find(isEmbedOriginUrl)
    ?? links.find((link) => link.toLowerCase().includes('uqload.'))
    ?? links[0];
}
