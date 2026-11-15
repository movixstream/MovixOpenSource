// src/utils/lastPlayerPref.ts
//
// Persistance de la préférence "se souvenir du dernier lecteur choisi".
// Quand activée, le dernier `TopLevelSourceId` sélectionné manuellement par
// l'utilisateur prend priorité sur l'ordre des sources lors du chargement
// d'un nouveau film/épisode — *si* ce lecteur est disponible. Sinon on
// retombe sur le système de priorité existant.
//
// Storage : 2 clés localStorage indépendantes (toggle + valeur).
import { TOP_LEVEL_SOURCE_IDS, type TopLevelSourceId } from '../types/sourcePriority';

// Préfixe `player` → match la règle de sync serveur (`SYNCABLE_PREFIXES` dans
// API/Mainapi/utils/syncPolicy.js). Les anciens noms `movix_remember_last_player`
// / `movix_last_player` étaient silencieusement filtrés par le client.
const TOGGLE_KEY = 'playerRememberLast';
const VALUE_KEY = 'playerLastId';
// Lecteur précis choisi DANS la source (Lulu, Vidara… dans « Lecteur Movix »).
// Sans lui, seule la source est reprise et le tri hoster remet son n°1 en tête.
const HOSTER_KEY = 'playerLastHoster';
const CHANGE_EVENT = 'movix-last-player-changed';

const VALID_IDS = new Set<string>(TOP_LEVEL_SOURCE_IDS);

/** Toggle on/off — défaut false (opt-in). */
export function getRememberLastPlayer(): boolean {
  try {
    return localStorage.getItem(TOGGLE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setRememberLastPlayer(enabled: boolean): void {
  try {
    localStorage.setItem(TOGGLE_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* noop */
  }
}

/**
 * Renvoie le dernier `TopLevelSourceId` enregistré, ou null si rien n'est
 * sauvé OU si la valeur n'est plus un id valide (ex: id retiré dans une
 * version future). Robuste à la désérialisation.
 */
export function getLastPlayer(): TopLevelSourceId | null {
  try {
    const v = localStorage.getItem(VALUE_KEY);
    if (!v) return null;
    return VALID_IDS.has(v) ? (v as TopLevelSourceId) : null;
  } catch {
    return null;
  }
}

/** Clé du lecteur précis choisi dans la dernière source (voir `hosterKeyOf`). */
export function getLastHoster(): string | null {
  try {
    return localStorage.getItem(HOSTER_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Enregistre l'id si c'est un `TopLevelSourceId` valide. No-op sinon (laisse
 * le caller relayer n'importe quel string sans craindre de polluer le storage).
 * `hoster` mémorise le lecteur précis dans la source ; absent = on l'oublie,
 * pour ne pas réappliquer un lecteur d'une autre source.
 */
export function setLastPlayer(id: string, hoster?: string | null): void {
  // `nexus_file` est retiré de l'UI de priorité : ses fichiers sont triés
  // avec ceux de `nexus_hls`, sous la même entrée « Lecteur Movix ».
  if (id === 'nexus_file') id = 'nexus_hls';
  if (!id || !VALID_IDS.has(id)) return;
  try {
    localStorage.setItem(VALUE_KEY, id);
    if (hoster) localStorage.setItem(HOSTER_KEY, hoster);
    else localStorage.removeItem(HOSTER_KEY);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* noop */
  }
}

/** S'abonne aux changements (toggle ou valeur). Renvoie un unsubscriber. */
export function subscribeToLastPlayerChanges(cb: () => void): () => void {
  const handler = () => cb();
  const storageHandler = (e: StorageEvent) => {
    if (e.key === TOGGLE_KEY || e.key === VALUE_KEY || e.key === HOSTER_KEY) cb();
  };
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}
