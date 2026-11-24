import type { TFunction } from 'i18next';
import i18n from '@/i18n';

const LANGUAGE_KEYS: Record<string, string> = {
  en: 'details.langEnglish',
  fr: 'details.langFrench',
  es: 'details.langSpanish',
  de: 'details.langGerman',
  it: 'details.langItalian',
  pt: 'details.langPortuguese',
  ja: 'details.langJapanese',
  ko: 'details.langKorean',
  zh: 'details.langChinese',
  ru: 'details.langRussian',
  ar: 'details.langArabic',
  hi: 'details.langHindi',
  'no-text': 'details.langNoText',
  unknown: 'details.langUnknown',
};

const displayNames = new Map<string, Intl.DisplayNames | null>();

/** Noms de langues du navigateur dans la langue du site (`null` si indisponible). */
function languageDisplayNames(locale: string): Intl.DisplayNames | null {
  if (!displayNames.has(locale)) {
    try {
      displayNames.set(locale, typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([locale], { type: 'language' }) : null);
    } catch {
      displayNames.set(locale, null);
    }
  }
  return displayNames.get(locale) ?? null;
}

/**
 * Nom d'une langue TMDB (code ISO 639-1). Hors des langues traduites, le nom
 * vient du navigateur (« Bulgare », « Tchèque ») ; le code en majuscules
 * reste le dernier recours.
 */
export function detailsLanguageName(code: string, t: TFunction): string {
  const key = LANGUAGE_KEYS[code];
  if (key) return t(key);
  const locale = i18n.language || 'fr';
  try {
    const name = languageDisplayNames(locale)?.of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) {
      return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
    }
  } catch {
    // Code refusé par Intl : on garde le code.
  }
  return code.toUpperCase();
}
