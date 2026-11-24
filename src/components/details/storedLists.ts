import { writeLocalStorage } from '@/utils/browserStorage';

/** Entrée d'une liste locale (à voir, favoris, vus) ; seul `id` est lu ici. */
export type DetailsStoredMedia = { id?: number } & Record<string, unknown>;

const parseStoredMediaList = (stored: string | null): DetailsStoredMedia[] | null => {
  if (stored === null) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Liste locale lue telle quelle ; `null` si elle est illisible. */
export const readStoredMediaList = (key: string): DetailsStoredMedia[] | null => {
  try {
    return parseStoredMediaList(window.localStorage.getItem(key));
  } catch {
    return null;
  }
};

/**
 * Réécrit une liste locale. Une liste illisible n'est pas écrasée : rend
 * `false`, comme un stockage plein ou refusé.
 */
export const updateStoredMediaList = (key: string, update: (items: DetailsStoredMedia[]) => DetailsStoredMedia[]): boolean => {
  try {
    const items = parseStoredMediaList(window.localStorage.getItem(key));
    if (items === null) return false;
    return writeLocalStorage(key, JSON.stringify(update(items)));
  } catch {
    return false;
  }
};
