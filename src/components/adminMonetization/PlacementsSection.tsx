import React from 'react';
import { CircleOff, LayoutGrid } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  MONETIZATION_PLACEMENT_IDS,
  MONETIZATION_ROTATION_MODES,
  MONETIZATION_SEQUENCE_SCOPES,
  type MonetizationPlacement,
  type MonetizationSettings,
  type PlacementId
} from '../../services/monetizationAdminService';
import {
  SettingsField,
  SettingsSection,
  TestLink,
  invalidInputClass,
  settingsInputClass
} from '../adminVipDonations/SettingsUi';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import {
  AD_URL_MAX_LENGTH,
  WINDOWS_PER_CLICK_MAX,
  countLiveAds,
  isHttpUrl,
  placementFieldKey,
  type MonetizationErrors
} from './monetizationForm';
import { FieldGroup, OptionCards, SegmentedChoice } from './MonetizationUi';
import { PLACEMENT_ICONS, useMonetizationText } from './monetizationUiHelpers';
import PlacementPreview from './PlacementPreview';

interface PlacementCardProps {
  id: PlacementId;
  placement: MonetizationPlacement;
  liveAdCount: number;
  globallyEnabled: boolean;
  errors: MonetizationErrors;
  onChange: (patch: Partial<MonetizationPlacement>) => void;
}

const PlacementCard: React.FC<PlacementCardProps> = ({ id, placement, liveAdCount, globallyEnabled, errors, onChange }) => {
  const { t, issueText } = useMonetizationText();
  const Icon = PLACEMENT_ICONS[id];
  const name = t(`admin.monetization.placements.names.${id}`);
  const enabled = placement.enabled;
  const fallbackFieldId = `monetization-placement-${id}-fallback`;
  const fallbackError = issueText(errors[placementFieldKey(id, 'fallbackUrl')]);
  const windowsError = issueText(errors[placementFieldKey(id, 'windowsPerClick')]);
  const trimmedFallback = placement.fallbackUrl.trim();
  const windowsValue = String(placement.windowsPerClick) as '1' | '2' | '3';

  return (
    <li
      className={cn(
        'min-w-0 rounded-xl border p-3.5 transition-colors sm:p-4',
        enabled ? 'border-white/10 bg-black/20' : 'border-white/5 bg-black/10'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn('shrink-0 rounded-lg bg-white/5 p-2 ring-1 ring-white/10', !enabled && 'opacity-50')}>
          <Icon className="h-5 w-5 text-amber-300" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <label htmlFor={`monetization-placement-${id}`} className="cursor-pointer font-semibold text-white">
              {name}
            </label>
            {enabled && globallyEnabled && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  liveAdCount > 0
                    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-amber-400/45 bg-amber-500/15 text-amber-200'
                )}
              >
                {liveAdCount > 0
                  ? t('admin.monetization.placements.adsHere', { count: liveAdCount })
                  : t('admin.monetization.placements.noAdsHere')}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-white/50">{t(`admin.monetization.placements.where.${id}`)}</p>
        </div>
        <Switch
          id={`monetization-placement-${id}`}
          checked={enabled}
          onCheckedChange={(next) => onChange({ enabled: next })}
        />
      </div>

      {!enabled ? (
        <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-white/55">
          {/* Texte blanc translucide : couleur pleine + opacité sur l'icône. */}
          <CircleOff className="mt-1 h-4 w-4 shrink-0 text-white opacity-50" aria-hidden="true" />
          {t(`admin.monetization.placements.off.${id}`)}
        </p>
      ) : (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <FieldGroup id={`monetization-placement-${id}-rotation`} legend={t('admin.monetization.placements.rotationLabel')}>
              <OptionCards
                name={`monetization-placement-${id}-rotation`}
                value={placement.rotation}
                onChange={(rotation) => onChange({ rotation })}
                options={MONETIZATION_ROTATION_MODES.map((mode) => ({
                  value: mode,
                  label: t(`admin.monetization.placements.rotation.${mode}.title`),
                  description: t(`admin.monetization.placements.rotation.${mode}.text`)
                }))}
              />
            </FieldGroup>

            {placement.rotation === 'sequence' && (
              <FieldGroup id={`monetization-placement-${id}-scope`} legend={t('admin.monetization.placements.scopeLabel')}>
                <OptionCards
                  name={`monetization-placement-${id}-scope`}
                  value={placement.sequenceScope}
                  onChange={(sequenceScope) => onChange({ sequenceScope })}
                  className="sm:grid-cols-2"
                  options={MONETIZATION_SEQUENCE_SCOPES.map((scope) => ({
                    value: scope,
                    label: t(`admin.monetization.placements.scope.${scope}.title`),
                    description: t(`admin.monetization.placements.scope.${scope}.text`)
                  }))}
                />
              </FieldGroup>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <FieldGroup
              id={`monetization-placement-${id}-windows`}
              legend={t('admin.monetization.placements.windowsLabel')}
              hint={t('admin.monetization.placements.windowsHint')}
              error={windowsError}
            >
              <SegmentedChoice
                ariaLabel={t('admin.monetization.placements.windowsLabel')}
                value={windowsValue}
                onChange={(next) => onChange({ windowsPerClick: Number(next) })}
                options={Array.from({ length: WINDOWS_PER_CLICK_MAX }, (_, index) => {
                  const count = index + 1;
                  return {
                    value: String(count) as '1' | '2' | '3',
                    label: t('admin.monetization.placements.windowsOption', { count })
                  };
                })}
              />
            </FieldGroup>

            <SettingsField
              id={fallbackFieldId}
              label={t('admin.monetization.placements.fallbackLabel')}
              hint={t('admin.monetization.placements.fallbackHint')}
              error={fallbackError}
            >
              <div className="flex gap-2">
                <Input
                  id={fallbackFieldId}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={AD_URL_MAX_LENGTH}
                  value={placement.fallbackUrl}
                  placeholder="https://"
                  onChange={(event) => onChange({ fallbackUrl: event.target.value })}
                  aria-invalid={Boolean(fallbackError) || undefined}
                  aria-describedby={`${fallbackFieldId}-message`}
                  className={cn(settingsInputClass, 'min-w-0', fallbackError && invalidInputClass)}
                />
                <TestLink
                  href={trimmedFallback && isHttpUrl(trimmedFallback) ? trimmedFallback : null}
                  label={t('admin.monetization.placements.open')}
                  ariaLabel={t('admin.monetization.placements.openFallbackAria', { name })}
                />
              </div>
            </SettingsField>
          </div>
        </div>
      )}
    </li>
  );
};

interface PlacementsSectionProps {
  settings: MonetizationSettings;
  // Brouillon normalisé envoyé à l'aperçu (ce qui serait enregistré).
  previewSettings: MonetizationSettings;
  errors: MonetizationErrors;
  errorCount: number;
  modified: boolean;
  onPlacementChange: (id: PlacementId, patch: Partial<MonetizationPlacement>) => void;
}

// ─── Emplacements et aperçu ────────────────────────────────────────────────

const PlacementsSection: React.FC<PlacementsSectionProps> = ({
  settings,
  previewSettings,
  errors,
  errorCount,
  modified,
  onPlacementChange
}) => {
  const { t, modifiedLabel } = useMonetizationText();
  const now = new Date();

  return (
    <SettingsSection
      id="monetization-placements"
      icon={LayoutGrid}
      title={t('admin.monetization.placements.title')}
      description={t('admin.monetization.placements.description')}
      modifiedLabel={modifiedLabel(modified)}
    >
      <div className="space-y-5">
        <ul className="space-y-3">
          {MONETIZATION_PLACEMENT_IDS.map((id) => (
            <PlacementCard
              key={id}
              id={id}
              placement={settings.placements[id]}
              liveAdCount={countLiveAds(settings, now, id)}
              globallyEnabled={settings.enabled}
              errors={errors}
              onChange={(patch) => onPlacementChange(id, patch)}
            />
          ))}
        </ul>

        <PlacementPreview settings={previewSettings} errorCount={errorCount} />
      </div>
    </SettingsSection>
  );
};

export default PlacementsSection;
