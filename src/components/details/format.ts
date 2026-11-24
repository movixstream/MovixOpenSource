/**
 * Formats d'affichage des fiches. Chaque appel à `Intl` est protégé : l'Intl
 * partiel de certaines TV jette sur une option ou une langue inconnue.
 */

const withIntl = <T,>(attempts: Array<() => T>, fallback: T): T => {
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      // Essayer la forme suivante.
    }
  }
  return fallback;
};

/** Note sur 10 à une décimale, dans la langue du site (« 8,1 »). */
export function formatDetailsRating(value: number, language: string): string {
  const options = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  return withIntl([
    () => new Intl.NumberFormat(language || undefined, options).format(value),
    () => new Intl.NumberFormat(undefined, options).format(value),
  ], value.toFixed(1));
}

/** Nombre entier avec séparateurs de milliers (« 9 023 »). */
export function formatDetailsCount(value: number, language: string): string {
  return withIntl([
    () => new Intl.NumberFormat(language || undefined).format(value),
  ], String(value));
}

/** Montant en dollars, au dollar près (« 190 000 000 $US »). */
export function formatDetailsMoney(value: number, language: string): string {
  const options = { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 } as const;
  return withIntl([
    () => new Intl.NumberFormat(language || undefined, options).format(value),
    () => new Intl.NumberFormat(undefined, options).format(value),
  ], `${Math.round(value)} $`);
}

/** Montant en dollars abrégé (« 190 M $ »), avec le signe si `signed`. */
export function formatDetailsCompactMoney(value: number, language: string, signed = false): string {
  const compact = { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 } as const;
  const sign = signed ? { signDisplay: 'exceptZero' } as const : {};
  return withIntl([
    () => new Intl.NumberFormat(language || undefined, { ...compact, ...sign, currencyDisplay: 'narrowSymbol' }).format(value),
    () => new Intl.NumberFormat(language || undefined, { ...compact, ...sign }).format(value),
  ], formatDetailsMoney(value, language));
}

/** Date TMDB (`AAAA-MM-JJ`) en toutes lettres (« 27 février 2024 ») ; `null` si elle est invalide. */
export function formatDetailsLongDate(value: string | null | undefined, language: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const time = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  const options = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' } as const;
  return withIntl([
    () => new Intl.DateTimeFormat(language || undefined, options).format(time),
    () => new Intl.DateTimeFormat(undefined, options).format(time),
  ], value.slice(0, 10));
}

/** Nom d'un code ISO dans la langue du site ; `fallback` (nom TMDB, en anglais) si `Intl` ne le connaît pas. */
function displayName(type: 'region' | 'language', code: string, fallback: string, language: string): string {
  const name = withIntl<string | undefined>([
    () => new Intl.DisplayNames([language || 'fr'], { type, fallback: 'none' }).of(code),
  ], undefined);
  if (!name || name.toLowerCase() === code.toLowerCase()) return fallback || code;
  // « anglais » → « Anglais » : les noms s'affichent seuls, dans une pastille.
  return name.charAt(0).toLocaleUpperCase(language || undefined) + name.slice(1);
}

/** Pays d'après son code ISO 3166-1 (« US » → « États-Unis »). */
export function formatDetailsCountry(code: string, language: string, fallback = ''): string {
  return displayName('region', code, fallback, language);
}

/** Langue d'après son code ISO 639-1 (« en » → « Anglais »). */
export function formatDetailsLanguage(code: string, language: string, fallback = ''): string {
  // « xx » : code TMDB des films sans dialogue, inconnu d'`Intl`.
  if (code === 'xx') return language?.startsWith('fr') ? 'Aucune langue' : 'No language';
  return displayName('language', code, fallback, language);
}

/** Durée d'une vidéo en secondes : `mm:ss`, ou `h:mm:ss` au-delà d'une heure. */
export function formatDetailsClock(timeInSeconds: number): string {
  if (!timeInSeconds || Number.isNaN(timeInSeconds)) return '00:00';
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  const pad = (part: number) => part.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
