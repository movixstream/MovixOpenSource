import React, { useId, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  SlidersHorizontal,
  Trash2,
  type LucideIcon
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  MONETIZATION_AUDIENCES,
  MONETIZATION_COUNTRIES_MODES,
  MONETIZATION_DEVICES,
  MONETIZATION_OS_IDS,
  MONETIZATION_PLACEMENT_IDS,
  type MonetizationAd,
  type MonetizationSettings
} from '../../services/monetizationAdminService';
import {
  IntegerInput,
  SettingsField,
  TestLink,
  ToggleRow,
  invalidInputClass,
  settingsInputClass
} from '../adminVipDonations/SettingsUi';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import {
  AD_NAME_MAX_LENGTH,
  AD_NOTE_MAX_LENGTH,
  AD_URL_MAX_LENGTH,
  MONETIZATION_URL_MACROS,
  adFieldKey,
  buildTestAdUrl,
  countAdErrors,
  countAdvancedRules,
  formatCountryList,
  fromDateTimeLocalValue,
  getAdStatus,
  getAdWeightMeaning,
  parseCountryList,
  toDateTimeLocalValue,
  type MonetizationAdField,
  type MonetizationAdStatus,
  type MonetizationErrors
} from './monetizationForm';
import { AdBadge, ChipMultiSelect, FieldGroup, OptionCards, SegmentedChoice } from './MonetizationUi';
import { formatInteger, useMonetizationText, useSyncedText } from './monetizationUiHelpers';

const STATUS_CLASSES: Record<MonetizationAdStatus, string> = {
  live: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  paused: 'border-white/15 bg-white/5 text-white/55',
  scheduled: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  ended: 'border-amber-400/40 bg-amber-500/15 text-amber-200'
};

// Lundi en premier, valeurs du serveur : 0 = dimanche … 6 = samedi.
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0];

// Champs rangés dans le volet « Avancé » (ouvert d'office s'ils ont une erreur).
const ADVANCED_FIELDS: MonetizationAdField[] = ['startAt', 'endAt', 'hours', 'countries', 'perVisitorPerDay', 'globalPerDay', 'note'];

interface IconActionProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

// Bouton d'action compact : libellé visible dès `sm`, icône seule sur téléphone.
// Icône à plusieurs tracés : couleur pleine + opacité, jamais de blanc translucide.
const IconAction: React.FC<IconActionProps> = ({ icon: Icon, label, onClick, disabled, danger }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className={cn(
      'group inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 disabled:pointer-events-none disabled:opacity-30',
      danger
        ? 'border-red-400/25 text-red-200 hover:border-red-400/45 hover:bg-red-500/10'
        : 'border-white/10 text-white/70 hover:border-white/25 hover:bg-white/5 hover:text-white'
    )}
  >
    <Icon
      className={cn(
        'h-4 w-4 shrink-0 transition-opacity',
        danger ? 'text-red-300' : 'text-white opacity-70 group-hover:opacity-100'
      )}
      aria-hidden="true"
    />
    <span className="hidden sm:inline">{label}</span>
  </button>
);

const CountryListInput: React.FC<{
  id: string;
  countries: string[];
  invalid: boolean;
  placeholder: string;
  onChange: (next: string[]) => void;
}> = ({ id, countries, invalid, placeholder, onChange }) => {
  const [text, setText] = useSyncedText(countries, formatCountryList, parseCountryList);

  return (
    <Input
      id={id}
      type="text"
      autoComplete="off"
      spellCheck={false}
      value={text}
      placeholder={placeholder}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseCountryList(event.target.value));
      }}
      onBlur={() => setText(formatCountryList(parseCountryList(text)))}
      aria-invalid={invalid || undefined}
      aria-describedby={`${id}-message`}
      className={cn(settingsInputClass, 'uppercase', invalid && invalidInputClass)}
    />
  );
};

const AdvancedHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-sm font-semibold text-amber-100">{children}</h4>
);

export interface AdEditorProps {
  ad: MonetizationAd;
  index: number;
  total: number;
  settings: MonetizationSettings;
  errors: MonetizationErrors;
  stats: { today: number; week: number } | null;
  canDuplicate: boolean;
  onChange: (next: MonetizationAd) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const AdEditor: React.FC<AdEditorProps> = ({
  ad,
  index,
  total,
  settings,
  errors,
  stats,
  canDuplicate,
  onChange,
  onMove,
  onDuplicate,
  onDelete
}) => {
  const { t, locale, issueText } = useMonetizationText();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const baseId = `monetization-ad-${ad.id}`;
  const advancedPanelId = `${useId()}-advanced`;

  const fieldError = (field: MonetizationAdField) => issueText(errors[adFieldKey(ad.id, field)]);
  const update = (patch: Partial<MonetizationAd>) => onChange({ ...ad, ...patch });
  const updateSchedule = (patch: Partial<MonetizationAd['schedule']>) => update({ schedule: { ...ad.schedule, ...patch } });
  const updateTargeting = (patch: Partial<MonetizationAd['targeting']>) => update({ targeting: { ...ad.targeting, ...patch } });
  const updateCaps = (patch: Partial<MonetizationAd['caps']>) => update({ caps: { ...ad.caps, ...patch } });
  const setScheduleDate = (field: 'startAt' | 'endAt', value: string | null) => (
    updateSchedule(field === 'startAt' ? { startAt: value } : { endAt: value })
  );

  const displayName = ad.name.trim() || t('admin.monetization.ads.unnamed');
  const status = getAdStatus(ad);
  const errorCount = countAdErrors(errors, ad.id);
  const advancedErrorCount = ADVANCED_FIELDS.filter((field) => errors[adFieldKey(ad.id, field)]).length;
  const showAdvanced = advancedOpen || advancedErrorCount > 0;
  const advancedRules = countAdvancedRules(ad);
  const weightMeaning = getAdWeightMeaning(ad, settings);
  const testUrl = buildTestAdUrl(ad.url, ad.placements[0]);

  const nameError = fieldError('name');
  const urlError = fieldError('url');
  const placementsError = fieldError('placements');
  const weightError = fieldError('weight');
  const startError = fieldError('startAt');
  const endError = fieldError('endAt');
  const hoursError = fieldError('hours');
  const countriesError = fieldError('countries');
  const perVisitorError = fieldError('perVisitorPerDay');
  const globalError = fieldError('globalPerDay');
  const noteError = fieldError('note');

  const weightLabelKey = {
    sequence: 'labelSequence',
    random: 'labelRandom',
    mixed: 'labelMixed'
  }[weightMeaning];
  const weightHintKey = {
    sequence: 'hintSequence',
    random: 'hintRandom',
    mixed: 'hintMixed'
  }[weightMeaning];

  return (
    <li
      className={cn(
        'min-w-0 rounded-xl border p-3.5 transition-colors sm:p-4',
        errorCount > 0 ? 'border-red-400/30 bg-red-500/[0.03]' : ad.enabled ? 'border-white/10 bg-black/20' : 'border-white/5 bg-black/10'
      )}
    >
      {/* En-tête : lettre de l'aperçu, nom, état, chiffres, pause. */}
      <div className="flex items-start gap-3">
        <AdBadge index={index} className={cn(!ad.enabled && 'opacity-50')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={cn('min-w-0 truncate font-semibold', ad.enabled ? 'text-white' : 'text-white/55')}>{displayName}</p>
            <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_CLASSES[status])}>
              {t(`admin.monetization.ads.status.${status}`)}
            </span>
            {errorCount > 0 && (
              <span className="inline-flex items-center rounded-full border border-red-400/35 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-200">
                {t('admin.monetization.ads.errorCount', { count: errorCount })}
              </span>
            )}
          </div>
          {stats && (
            <p className="mt-1 text-xs tabular-nums text-white/45">
              {t('admin.monetization.ads.statsLine', {
                today: formatInteger(locale, stats.today),
                week: formatInteger(locale, stats.week)
              })}
            </p>
          )}
        </div>
        <Switch
          checked={ad.enabled}
          onCheckedChange={(next) => update({ enabled: next })}
          aria-label={t('admin.monetization.ads.enabledAria', { name: displayName })}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <IconAction icon={ArrowUp} label={t('admin.monetization.ads.moveUp')} onClick={() => onMove(-1)} disabled={index === 0} />
        <IconAction icon={ArrowDown} label={t('admin.monetization.ads.moveDown')} onClick={() => onMove(1)} disabled={index === total - 1} />
        <IconAction icon={Copy} label={t('admin.monetization.ads.duplicate')} onClick={onDuplicate} disabled={!canDuplicate} />
        <IconAction icon={Trash2} label={t('admin.monetization.ads.delete')} onClick={onDelete} danger />
      </div>

      {/* Champs principaux, toujours visibles. */}
      <div className="mt-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <SettingsField
            id={`${baseId}-name`}
            label={t('admin.monetization.ads.nameLabel')}
            hint={t('admin.monetization.ads.nameHint')}
            error={nameError}
            aside={(
              <span className="text-[11px] tabular-nums text-white/35">{ad.name.length}/{AD_NAME_MAX_LENGTH}</span>
            )}
          >
            <Input
              id={`${baseId}-name`}
              type="text"
              autoComplete="off"
              maxLength={AD_NAME_MAX_LENGTH}
              value={ad.name}
              placeholder={t('admin.monetization.ads.namePlaceholder')}
              onChange={(event) => update({ name: event.target.value })}
              aria-invalid={Boolean(nameError) || undefined}
              aria-describedby={`${baseId}-name-message`}
              className={cn(settingsInputClass, nameError && invalidInputClass)}
            />
          </SettingsField>

          <SettingsField
            id={`${baseId}-url`}
            label={t('admin.monetization.ads.urlLabel')}
            hint={t('admin.monetization.ads.urlHint', {
              macros: MONETIZATION_URL_MACROS.map((macro) => `{${macro}}`).join(', ')
            })}
            error={urlError}
          >
            <div className="flex gap-2">
              <Input
                id={`${baseId}-url`}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                maxLength={AD_URL_MAX_LENGTH + 50}
                value={ad.url}
                placeholder="https://"
                onChange={(event) => update({ url: event.target.value })}
                aria-invalid={Boolean(urlError) || undefined}
                aria-describedby={`${baseId}-url-message`}
                className={cn(settingsInputClass, 'min-w-0', urlError && invalidInputClass)}
              />
              <TestLink
                href={testUrl}
                label={t('admin.monetization.ads.open')}
                ariaLabel={t('admin.monetization.ads.openAria', { name: displayName })}
                showLabel
              />
            </div>
          </SettingsField>
        </div>

        <FieldGroup
          id={`${baseId}-placements`}
          legend={t('admin.monetization.ads.placementsLabel')}
          hint={t('admin.monetization.ads.placementsHint')}
          error={placementsError}
        >
          <ChipMultiSelect
            values={ad.placements}
            onChange={(placements) => update({ placements })}
            invalid={Boolean(placementsError)}
            options={MONETIZATION_PLACEMENT_IDS.map((id) => ({
              value: id,
              label: t(`admin.monetization.placements.names.${id}`)
            }))}
          />
        </FieldGroup>

        <FieldGroup id={`${baseId}-audience`} legend={t('admin.monetization.ads.audienceLabel')}>
          <OptionCards
            name={`${baseId}-audience`}
            value={ad.audience}
            onChange={(audience) => update({ audience })}
            className="sm:grid-cols-3"
            options={MONETIZATION_AUDIENCES.map((audience) => ({
              value: audience,
              label: t(`admin.monetization.ads.audience.${audience}.title`),
              description: t(`admin.monetization.ads.audience.${audience}.text`)
            }))}
          />
        </FieldGroup>

        <SettingsField
          id={`${baseId}-weight`}
          label={t(`admin.monetization.ads.weight.${weightLabelKey}`)}
          hint={weightMeaning === 'sequence'
            ? t('admin.monetization.ads.weight.hintSequence', { count: Number.isFinite(ad.weight) ? ad.weight : 1 })
            : t(`admin.monetization.ads.weight.${weightHintKey}`)}
          error={weightError}
          className="max-w-md"
        >
          <div className="max-w-[10rem]">
            <IntegerInput
              id={`${baseId}-weight`}
              value={ad.weight}
              onValueChange={(weight) => update({ weight })}
              suffix={weightMeaning === 'sequence' ? t('admin.monetization.ads.weight.suffixSequence') : undefined}
              invalid={Boolean(weightError)}
              aria-describedby={`${baseId}-weight-message`}
              className={weightMeaning === 'sequence' ? 'pr-12' : undefined}
            />
          </div>
        </SettingsField>
      </div>

      {/* Volet « Avancé » : créneau, ciblage, plafonds, référent, note. */}
      <button
        type="button"
        aria-expanded={showAdvanced}
        aria-controls={advancedPanelId}
        onClick={() => setAdvancedOpen(!showAdvanced)}
        className={cn(
          'mt-4 flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50',
          showAdvanced ? 'border-amber-300/25 bg-amber-300/[0.04]' : 'border-white/10 bg-white/[0.02] hover:border-white/20'
        )}
      >
        <span className="flex min-w-0 items-center gap-2 font-semibold text-white">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
          {t('admin.monetization.advanced.toggle')}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-white/50">
          {advancedErrorCount > 0 ? (
            <span className="text-red-300">{t('admin.monetization.ads.errorCount', { count: advancedErrorCount })}</span>
          ) : (
            <span>
              {advancedRules > 0
                ? t('admin.monetization.advanced.rules', { count: advancedRules })
                : t('admin.monetization.advanced.noRules')}
            </span>
          )}
          <ChevronDown
            className={cn('h-4 w-4 text-white opacity-60 transition-transform duration-200', showAdvanced && 'rotate-180')}
            aria-hidden="true"
          />
        </span>
      </button>

      {showAdvanced && (
        <div id={advancedPanelId} className="mt-3 space-y-6 rounded-xl border border-white/5 bg-black/20 p-3.5 sm:p-4">
          {/* Créneau */}
          <div className="space-y-4">
            <AdvancedHeading>{t('admin.monetization.advanced.scheduleTitle')}</AdvancedHeading>
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ['startAt', startError, 'startLabel'],
                ['endAt', endError, 'endLabel']
              ] as const).map(([field, error, labelKey]) => {
                const fieldId = `${baseId}-${field}`;
                const value = ad.schedule[field];
                return (
                  <SettingsField
                    key={field}
                    id={fieldId}
                    label={t(`admin.monetization.advanced.${labelKey}`)}
                    hint={t('admin.monetization.advanced.dateHint')}
                    error={error}
                    aside={value ? (
                      <button
                        type="button"
                        onClick={() => setScheduleDate(field, null)}
                        className="text-[11px] font-medium text-amber-200/80 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
                      >
                        {t('admin.monetization.advanced.clear')}
                      </button>
                    ) : null}
                  >
                    <Input
                      id={fieldId}
                      type="datetime-local"
                      value={toDateTimeLocalValue(value)}
                      onChange={(event) => setScheduleDate(field, fromDateTimeLocalValue(event.target.value))}
                      aria-invalid={Boolean(error) || undefined}
                      aria-describedby={`${fieldId}-message`}
                      className={cn(settingsInputClass, '[color-scheme:dark]', error && invalidInputClass)}
                    />
                  </SettingsField>
                );
              })}
            </div>

            <FieldGroup
              id={`${baseId}-days`}
              legend={t('admin.monetization.advanced.daysLabel')}
              hint={t('admin.monetization.advanced.daysHint')}
            >
              <ChipMultiSelect
                values={ad.schedule.days.map(String)}
                onChange={(days) => updateSchedule({ days: days.map(Number) })}
                options={WEEK_DAYS.map((day) => ({
                  value: String(day),
                  label: t(`admin.monetization.advanced.days.d${day}`)
                }))}
              />
            </FieldGroup>

            <div className="space-y-3">
              <ToggleRow
                id={`${baseId}-hours-toggle`}
                label={t('admin.monetization.advanced.hoursToggle')}
                description={ad.schedule.hours
                  ? t('admin.monetization.advanced.hoursOn')
                  : t('admin.monetization.advanced.hoursOff')}
                checked={ad.schedule.hours !== null}
                onCheckedChange={(next) => updateSchedule({ hours: next ? { from: 20, to: 2 } : null })}
              />
              {ad.schedule.hours && (
                <FieldGroup
                  id={`${baseId}-hours`}
                  legend={t('admin.monetization.advanced.hoursLabel')}
                  hint={t('admin.monetization.advanced.hoursHint')}
                  error={hoursError}
                >
                  <div className="grid max-w-xs grid-cols-2 gap-3">
                    {(['from', 'to'] as const).map((edge) => (
                      <label key={edge} className="min-w-0 text-xs text-white/50">
                        <span className="mb-1 block">{t(`admin.monetization.advanced.${edge}Label`)}</span>
                        <IntegerInput
                          value={ad.schedule.hours?.[edge] ?? Number.NaN}
                          onValueChange={(next) => {
                            const current = ad.schedule.hours ?? { from: 20, to: 2 };
                            updateSchedule({ hours: edge === 'from' ? { ...current, from: next } : { ...current, to: next } });
                          }}
                          suffix="h"
                          invalid={Boolean(hoursError)}
                          aria-describedby={`${baseId}-hours-message`}
                        />
                      </label>
                    ))}
                  </div>
                </FieldGroup>
              )}
            </div>
          </div>

          {/* Ciblage */}
          <div className="space-y-4">
            <AdvancedHeading>{t('admin.monetization.advanced.targetingTitle')}</AdvancedHeading>
            <FieldGroup
              id={`${baseId}-devices`}
              legend={t('admin.monetization.advanced.devicesLabel')}
              hint={t('admin.monetization.advanced.emptyMeansAll')}
            >
              <ChipMultiSelect
                values={ad.targeting.devices}
                onChange={(devices) => updateTargeting({ devices })}
                options={MONETIZATION_DEVICES.map((device) => ({
                  value: device,
                  label: t(`admin.monetization.advanced.devices.${device}`)
                }))}
              />
            </FieldGroup>
            <FieldGroup
              id={`${baseId}-os`}
              legend={t('admin.monetization.advanced.osLabel')}
              hint={t('admin.monetization.advanced.emptyMeansAll')}
            >
              <ChipMultiSelect
                values={ad.targeting.os}
                onChange={(os) => updateTargeting({ os })}
                options={MONETIZATION_OS_IDS.map((os) => ({
                  value: os,
                  label: t(`admin.monetization.advanced.os.${os}`)
                }))}
              />
            </FieldGroup>
            <FieldGroup id={`${baseId}-countries-mode`} legend={t('admin.monetization.advanced.countriesLabel')}>
              <SegmentedChoice
                ariaLabel={t('admin.monetization.advanced.countriesLabel')}
                value={ad.targeting.countriesMode}
                onChange={(countriesMode) => updateTargeting({ countriesMode })}
                options={MONETIZATION_COUNTRIES_MODES.map((mode) => ({
                  value: mode,
                  label: t(`admin.monetization.advanced.countriesMode.${mode}`)
                }))}
              />
            </FieldGroup>
            {ad.targeting.countriesMode !== 'all' && (
              <SettingsField
                id={`${baseId}-countries`}
                label={t('admin.monetization.advanced.countriesListLabel')}
                hint={t('admin.monetization.advanced.countriesHint')}
                warning={ad.targeting.countries.length === 0 && ad.targeting.countriesMode === 'include'
                  ? t('admin.monetization.advanced.countriesEmptyWarning')
                  : null}
                error={countriesError}
                className="max-w-md"
              >
                <CountryListInput
                  id={`${baseId}-countries`}
                  countries={ad.targeting.countries}
                  invalid={Boolean(countriesError)}
                  placeholder={t('admin.monetization.advanced.countriesPlaceholder')}
                  onChange={(countries) => updateTargeting({ countries })}
                />
              </SettingsField>
            )}
          </div>

          {/* Plafonds */}
          <div className="space-y-4">
            <AdvancedHeading>{t('admin.monetization.advanced.capsTitle')}</AdvancedHeading>
            <div className="grid gap-4 sm:grid-cols-2">
              <SettingsField
                id={`${baseId}-cap-visitor`}
                label={t('admin.monetization.advanced.perVisitorLabel')}
                hint={t('admin.monetization.advanced.perVisitorHint')}
                error={perVisitorError}
              >
                <IntegerInput
                  id={`${baseId}-cap-visitor`}
                  value={ad.caps.perVisitorPerDay}
                  onValueChange={(perVisitorPerDay) => updateCaps({ perVisitorPerDay })}
                  invalid={Boolean(perVisitorError)}
                  aria-describedby={`${baseId}-cap-visitor-message`}
                />
              </SettingsField>
              <SettingsField
                id={`${baseId}-cap-global`}
                label={t('admin.monetization.advanced.globalLabel')}
                hint={t('admin.monetization.advanced.globalHint')}
                error={globalError}
              >
                <IntegerInput
                  id={`${baseId}-cap-global`}
                  value={ad.caps.globalPerDay}
                  onValueChange={(globalPerDay) => updateCaps({ globalPerDay })}
                  invalid={Boolean(globalError)}
                  aria-describedby={`${baseId}-cap-global-message`}
                />
              </SettingsField>
            </div>
          </div>

          {/* Note */}
          <SettingsField
            id={`${baseId}-note`}
            label={t('admin.monetization.advanced.noteLabel')}
            error={noteError}
            aside={(
              <span className="text-[11px] tabular-nums text-white/35">{ad.note.length}/{AD_NOTE_MAX_LENGTH}</span>
            )}
          >
            <Textarea
              id={`${baseId}-note`}
              rows={2}
              maxLength={AD_NOTE_MAX_LENGTH}
              value={ad.note}
              placeholder={t('admin.monetization.advanced.notePlaceholder')}
              onChange={(event) => update({ note: event.target.value })}
              aria-invalid={Boolean(noteError) || undefined}
              aria-describedby={`${baseId}-note-message`}
              className={cn(settingsInputClass, 'resize-y', noteError && invalidInputClass)}
            />
          </SettingsField>
        </div>
      )}
    </li>
  );
};

export default AdEditor;
