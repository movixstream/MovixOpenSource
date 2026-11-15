// src/components/Settings/LanguageCard.tsx
//
// Card présentant une langue (VF, VOSTFR, VJ, VA, VKR, VCN) dans la section
// "Langues" du panneau "Priorité des sources". Structure identique à
// SourceCard : drapeau SVG (react-country-flag) + code + switch + pin + ⚙.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import ReactCountryFlag from 'react-country-flag';
import { Button } from '../ui/button';
import { PinButton } from '../ui/PinButton';
import type { LanguageId } from '../../types/sourcePriority';

/**
 * Map code langue → label textuel. Les codes absents retombent sur
 * `id.toUpperCase()`. Séparé de LANGUAGE_FLAG_CODES car certains consumers
 * (ex: labels i18n des toasts) veulent juste le texte sans drapeau.
 */
export const LANGUAGE_FLAGS: Record<string, string> = {
  vf: 'VF',
  vostfr: 'VOSTFR',
  vj: 'VJ',
  va: 'VA',
  vkr: 'VKR',
  vcn: 'VCN',
};

/**
 * Map code langue → code pays ISO-3166-1 alpha-2 pour `ReactCountryFlag`.
 * Les 🇫🇷 emoji ne rendent pas sur Windows (pas de font regional indicators),
 * donc on utilise les SVG via flagcdn/react-country-flag comme dans HLSPlayer.
 */
export const LANGUAGE_FLAG_CODES: Record<string, string> = {
  vf: 'FR',
  vostfr: 'JP',
  vj: 'JP',
  va: 'US',
  vkr: 'KR',
  vcn: 'CN',
};

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  ariaLabel?: string;
}

const Switch: React.FC<SwitchProps> = ({ checked, onCheckedChange, ariaLabel }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    onClick={(e) => {
      e.stopPropagation();
      onCheckedChange(!checked);
    }}
    className={`relative w-10 h-6 rounded-full transition-colors duration-200 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${
      checked ? 'bg-indigo-500' : 'bg-gray-600'
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${
        checked ? 'translate-x-4' : 'translate-x-0'
      }`}
    />
  </button>
);

interface LanguageCardProps {
  id: LanguageId;
  enabled: boolean;
  isPinned: boolean;
  isFirst: boolean;
  onToggle: (enabled: boolean) => void;
  onTogglePin: () => void;
  /** Stub M6 — dialog override hosters pour cette langue. No-op pour l'instant. */
  onOpenOverride: () => void;
  /**
   * Cache le bouton ⚙ Settings. Utilisé pour la catégorie Films/Séries
   * où la langue est une préférence globale SANS override par-langue
   * (les hosters restent gérés par la liste globale moviesTv).
   */
  hideOverride?: boolean;
}

export const LanguageCard: React.FC<LanguageCardProps> = ({
  id, enabled, isPinned, isFirst, onToggle, onTogglePin, onOpenOverride, hideOverride,
}) => {
  const { t } = useTranslation();
  const label = LANGUAGE_FLAGS[id] ?? id.toUpperCase();
  const flagCode = LANGUAGE_FLAG_CODES[id];
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        {flagCode ? (
          <ReactCountryFlag
            countryCode={flagCode}
            svg
            style={{ width: '1.25em', height: '1.25em', borderRadius: '2px', flexShrink: 0 }}
            title={label}
          />
        ) : (
          <span aria-hidden className="text-white/40 shrink-0">🌐</span>
        )}
        <span className="font-medium text-white truncate">{label}</span>
        {isFirst && (
          <span
            className="text-xs text-amber-400 font-semibold"
            aria-label={t('settings.sourcePriority.pinAriaLanguage')}
          >
            {t('settings.sourcePriority.pinBadge')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          ariaLabel={t('settings.sourcePriority.toggleLanguageAria', { label })}
        />
        <PinButton isPinned={isPinned} onToggle={onTogglePin} />
        {!hideOverride && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenOverride}
            aria-label={t('settings.sourcePriority.customizeLanguageHosters')}
            className="h-8 w-8 group/icon"
          >
            <Settings className="text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" size={14} />
          </Button>
        )}
      </div>
    </div>
  );
};

export default LanguageCard;
