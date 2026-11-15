import { ANIMATION_PREF_META, LIGHT_MODE_STORAGE_KEY } from './animationPreferences';
import { BG_STORAGE_KEYS } from './bgPreferences';
import { MOVIE_RELEASE_WARNINGS_KEY } from './movieReleasePreferences';
import { SUBTITLE_STYLE_STORAGE_KEY } from './subtitlePreferences';
import { pushPrefsToExtension, resetExtractionPrefs } from './extractionPrefs';
import { HALLOWEEN_THEME_STORAGE_KEY } from '../hooks/useHalloweenTheme';

// Clés des réglages du menu Paramètres. Supprimer la clé suffit : chaque
// réglage retombe sur sa valeur par défaut à la lecture suivante.
//
// Volontairement absents : compte, profils, sessions, historique, listes et
// les choix de confidentialité (collecte de données, historique désactivé,
// recommandations). Les remettre « par défaut » réactiverait la collecte sans
// accord explicite.
const SETTINGS_STORAGE_KEYS: readonly string[] = [
  // Apparence
  LIGHT_MODE_STORAGE_KEY,
  ...Object.values(ANIMATION_PREF_META).map((meta) => meta.storageKey),
  ...Object.values(BG_STORAGE_KEYS),
  'settings_bg_mode',
  'square_corners_enabled',
  'movix_intro_enabled',
  'screensaver_enabled',
  'screensaver_timeout',
  'screensaver_mode',
  'settings_disable_auto_scroll',
  'settings_disable_route_scroll_to_top',
  'settings_smooth_scroll',
  'settings_smooth_scroll_intensity',
  'settings_hide_comments_section',
  'settings_hide_hero',
  'settings_media_colors',
  'settings_sound_effects_enabled',
  'settings_episode_list_source',
  MOVIE_RELEASE_WARNINGS_KEY,
  HALLOWEEN_THEME_STORAGE_KEY,
  // Sous-titres
  SUBTITLE_STYLE_STORAGE_KEY,
  // Performance
  'settings_image_quality',
  'low_latency_streaming',
  // Langue
  'user_language',
  // Lecteurs et sources
  'playerRememberLast',
  'playerSkipSegments',
  'settings_source_priority_prefs',
  // Popup publicitaire
  'settings_ad_popup_mode',
  'settings_ad_popup_adult',
];

/** Remet tous les réglages du menu Paramètres à leur valeur par défaut. */
export function resetAllSettings(): void {
  for (const key of SETTINGS_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Stockage indisponible : rien à effacer.
    }
  }
  resetExtractionPrefs();
  void pushPrefsToExtension();
}
