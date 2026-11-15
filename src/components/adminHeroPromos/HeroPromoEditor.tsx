import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Eye,
  Images,
  Link2,
  Megaphone,
  MonitorSmartphone,
  Trash2,
  Type,
  type LucideIcon
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  HERO_PROMO_AD_LABEL_POSITIONS,
  HERO_PROMO_IMAGE_POSITIONS,
  HERO_PROMO_LANGUAGES,
  HERO_PROMO_MIN_AGES,
  HERO_PROMO_NAME_MAX_LENGTH,
  HERO_PROMO_PAGES,
  HERO_PROMO_TEXT_LIMITS,
  MAX_HERO_PROMO_POSITION,
  isInternalHeroPromoLink,
  type HeroPromo,
  type HeroPromoClickStats,
  type HeroPromoLanguage,
  type HeroPromoTextKey
} from '../../services/heroPromoService';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../adminMonetization/monetizationForm';
import { ChipMultiSelect, FieldGroup, SegmentedChoice } from '../adminMonetization/MonetizationUi';
import { SettingsField, TestLink, ToggleRow, invalidInputClass, settingsInputClass } from '../adminVipDonations/SettingsUi';
import { getReadableTextColor } from '../hero/heroPromoStyle';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import HeroPromoImageField from './HeroPromoImageField';
import HeroPromoPreview from './HeroPromoPreview';
import {
  countHeroPromoErrors,
  getHeroPromoStatus,
  heroPromoFieldKey,
  type HeroPromoErrors,
  type HeroPromoField,
  type HeroPromoStatus
} from './heroPromoForm';

const STATUS_CLASSES: Record<HeroPromoStatus, string> = {
  live: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  paused: 'border-white/15 bg-white/5 text-white/55',
  scheduled: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  ended: 'border-amber-400/40 bg-amber-500/15 text-amber-200'
};

const ACCENT_PRESETS = ['#ef4444', '#f59e0b', '#22c55e', '#0ea5e9', '#8b5cf6', '#ec4899'];

// Champs de texte par langue, dans l'ordre d'affichage de la slide.
const TEXT_FIELDS: { key: Exclude<HeroPromoTextKey, 'adLabel'>; multiline?: boolean }[] = [
  { key: 'badge' },
  { key: 'tagline' },
  { key: 'title' },
  { key: 'description', multiline: true },
  { key: 'ctaLabel' }
];

const IconAction: React.FC<{ icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }> = ({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger
}) => (
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
      className={cn('h-4 w-4 shrink-0 transition-opacity', danger ? 'text-red-300' : 'text-white opacity-70 group-hover:opacity-100')}
      aria-hidden="true"
    />
    <span className="hidden sm:inline">{label}</span>
  </button>
);

const SectionTitle: React.FC<{ icon: LucideIcon; children: React.ReactNode }> = ({ icon: Icon, children }) => (
  <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
    <Icon className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
    {children}
  </h4>
);

export interface HeroPromoEditorProps {
  promo: HeroPromo;
  index: number;
  total: number;
  errors: HeroPromoErrors;
  /** undefined : pas encore enregistrée ; null : clics illisibles. */
  stats: HeroPromoClickStats | null | undefined;
  canDuplicate: boolean;
  defaultOpen?: boolean;
  onChange: (next: HeroPromo) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const HeroPromoEditor: React.FC<HeroPromoEditorProps> = ({
  promo,
  index,
  total,
  errors,
  stats,
  canDuplicate,
  defaultOpen = false,
  onChange,
  onMove,
  onDuplicate,
  onDelete
}) => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const [language, setLanguage] = useState<HeroPromoLanguage>('fr');
  const baseId = `hero-promo-${promo.id}`;
  const errorCount = countHeroPromoErrors(errors, promo.id);
  const showBody = open || errorCount > 0;
  const status = getHeroPromoStatus(promo);
  const displayName = promo.name.trim() || promo.texts.fr.title.trim() || t('heroPromo.admin.promo.unnamed');
  const numberFormat = new Intl.NumberFormat(i18n.language);

  const fieldError = (field: HeroPromoField) => {
    const code = errors[heroPromoFieldKey(promo.id, field)];
    return code ? t(`heroPromo.admin.errors.${code}`) : null;
  };
  const update = (patch: Partial<HeroPromo>) => onChange({ ...promo, ...patch });
  const updateText = (lang: HeroPromoLanguage, key: HeroPromoTextKey, value: string) => update({
    texts: { ...promo.texts, [lang]: { ...promo.texts[lang], [key]: value } }
  });

  const linkError = fieldError('linkUrl');
  const endError = fieldError('endAt');
  const pagesError = fieldError('pages');
  const titleError = fieldError('title');
  const testLink = promo.linkUrl && !linkError
    ? (isInternalHeroPromoLink(promo.linkUrl) ? `${window.location.origin}${promo.linkUrl}` : promo.linkUrl)
    : null;

  return (
    <li
      className={cn(
        'min-w-0 rounded-xl border p-3.5 transition-colors sm:p-4',
        errorCount > 0 ? 'border-red-400/30 bg-red-500/[0.03]' : promo.enabled ? 'border-white/10 bg-black/20' : 'border-white/5 bg-black/10'
      )}
    >
      {/* En-tête : couleur, nom, état, clics, interrupteur. */}
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn('mt-0.5 inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-sm font-bold tabular-nums', !promo.enabled && 'opacity-50')}
          style={{ backgroundColor: promo.accentColor, color: getReadableTextColor(promo.accentColor) }}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={cn('min-w-0 truncate font-semibold', promo.enabled ? 'text-white' : 'text-white/55')}>{displayName}</p>
            <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_CLASSES[status])}>
              {t(`heroPromo.admin.promo.status.${status}`)}
            </span>
            {errorCount > 0 && (
              <span className="inline-flex items-center rounded-full border border-red-400/35 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-200">
                {t('heroPromo.admin.promo.errorCount', { count: errorCount })}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs tabular-nums text-white/45">
            {stats
              ? t('heroPromo.admin.promo.statsLine', {
                today: numberFormat.format(stats.today),
                week: numberFormat.format(stats.week),
                month: numberFormat.format(stats.month),
                total: numberFormat.format(stats.total)
              })
              : stats === null
                ? t('heroPromo.admin.promo.statsUnavailable')
                : t('heroPromo.admin.promo.statsNone')}
          </p>
        </div>
        <Switch
          checked={promo.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
          aria-label={t('heroPromo.admin.promo.enabledAria', { name: displayName })}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <IconAction icon={ArrowUp} label={t('heroPromo.admin.promo.moveUp')} onClick={() => onMove(-1)} disabled={index === 0} />
        <IconAction icon={ArrowDown} label={t('heroPromo.admin.promo.moveDown')} onClick={() => onMove(1)} disabled={index === total - 1} />
        <IconAction icon={Copy} label={t('heroPromo.admin.promo.duplicate')} onClick={onDuplicate} disabled={!canDuplicate} />
        <IconAction icon={Trash2} label={t('heroPromo.admin.promo.delete')} onClick={onDelete} danger />
        <button
          type="button"
          aria-expanded={showBody}
          aria-controls={`${baseId}-body`}
          onClick={() => setOpen(!showBody)}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300/25 px-3 text-xs font-semibold text-amber-100 transition-colors hover:border-amber-300/45 hover:bg-amber-300/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
        >
          {showBody ? t('heroPromo.admin.promo.collapse') : t('heroPromo.admin.promo.expand')}
          <ChevronDown className={cn('h-4 w-4 text-amber-200 transition-transform duration-200', showBody && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>

      {showBody && (
        <div id={`${baseId}-body`} className="mt-4 space-y-6">
          {/* Aperçu, dans la langue choisie pour les textes ci-dessous. */}
          <div className="space-y-3">
            <SectionTitle icon={Eye}>{t('heroPromo.admin.sections.preview')}</SectionTitle>
            <HeroPromoPreview promo={promo} language={language} />
          </div>

          {/* Textes */}
          <div className="space-y-4">
            <SectionTitle icon={Type}>{t('heroPromo.admin.sections.content')}</SectionTitle>
            <SettingsField
              id={`${baseId}-name`}
              label={t('heroPromo.admin.fields.name')}
              hint={t('heroPromo.admin.fields.nameHint')}
              aside={<span className="text-[11px] tabular-nums text-white/35">{promo.name.length}/{HERO_PROMO_NAME_MAX_LENGTH}</span>}
              className="max-w-md"
            >
              <Input
                id={`${baseId}-name`}
                type="text"
                autoComplete="off"
                maxLength={HERO_PROMO_NAME_MAX_LENGTH}
                value={promo.name}
                placeholder={t('heroPromo.admin.fields.namePlaceholder')}
                onChange={(event) => update({ name: event.target.value })}
                aria-describedby={`${baseId}-name-message`}
                className={settingsInputClass}
              />
            </SettingsField>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/50">{t('heroPromo.admin.fields.language')}</span>
              <SegmentedChoice
                ariaLabel={t('heroPromo.admin.fields.language')}
                value={language}
                onChange={setLanguage}
                options={HERO_PROMO_LANGUAGES.map((lang) => ({ value: lang, label: t(`heroPromo.admin.fields.languages.${lang}`) }))}
              />
              {language === 'en' && <span className="text-xs text-white/45">{t('heroPromo.admin.fields.enHint')}</span>}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {TEXT_FIELDS.map(({ key, multiline }) => {
                const fieldId = `${baseId}-${language}-${key}`;
                const value = promo.texts[language][key];
                const max = HERO_PROMO_TEXT_LIMITS[key];
                const fallback = language === 'en' ? promo.texts.fr[key] : '';
                const placeholder = fallback || t(`heroPromo.admin.fields.${key}Placeholder`);
                const error = key === 'title' ? titleError : null;
                const common = {
                  id: fieldId,
                  maxLength: max,
                  value,
                  placeholder,
                  autoComplete: 'off',
                  'aria-invalid': Boolean(error) || undefined,
                  'aria-describedby': `${fieldId}-message`
                };
                return (
                  <SettingsField
                    key={key}
                    id={fieldId}
                    label={t(`heroPromo.admin.fields.${key}`)}
                    hint={t(`heroPromo.admin.fields.${key}Hint`)}
                    error={error}
                    aside={<span className="text-[11px] tabular-nums text-white/35">{value.length}/{max}</span>}
                    className={multiline ? 'md:col-span-2' : undefined}
                  >
                    {multiline ? (
                      <Textarea
                        {...common}
                        rows={3}
                        onChange={(event) => updateText(language, key, event.target.value)}
                        className={cn(settingsInputClass, 'resize-y', error && invalidInputClass)}
                      />
                    ) : (
                      <Input
                        {...common}
                        type="text"
                        onChange={(event) => updateText(language, key, event.target.value)}
                        className={cn(settingsInputClass, error && invalidInputClass)}
                      />
                    )}
                  </SettingsField>
                );
              })}
            </div>
          </div>

          {/* Images */}
          <div className="space-y-4">
            <SectionTitle icon={Images}>{t('heroPromo.admin.sections.images')}</SectionTitle>
            <HeroPromoImageField
              id={`${baseId}-image`}
              label={t('heroPromo.admin.fields.image')}
              hint={t('heroPromo.admin.fields.imageHint')}
              kind="backdrop"
              value={promo.imageUrl}
              error={fieldError('imageUrl')}
              onChange={(imageUrl) => update({ imageUrl })}
            />
            <FieldGroup id={`${baseId}-image-position`} legend={t('heroPromo.admin.fields.imagePosition')} hint={t('heroPromo.admin.fields.imagePositionHint')}>
              <SegmentedChoice
                ariaLabel={t('heroPromo.admin.fields.imagePosition')}
                value={promo.imagePosition}
                onChange={(imagePosition) => update({ imagePosition })}
                options={HERO_PROMO_IMAGE_POSITIONS.map((position) => ({
                  value: position,
                  label: t(`heroPromo.admin.fields.imagePositions.${position}`)
                }))}
              />
            </FieldGroup>
            <div className="grid gap-4 lg:grid-cols-2">
              <HeroPromoImageField
                id={`${baseId}-mobile-image`}
                label={t('heroPromo.admin.fields.mobileImage')}
                hint={t('heroPromo.admin.fields.mobileImageHint')}
                kind="mobile"
                value={promo.mobileImageUrl}
                error={fieldError('mobileImageUrl')}
                onChange={(mobileImageUrl) => update({ mobileImageUrl })}
              />
              <HeroPromoImageField
                id={`${baseId}-logo`}
                label={t('heroPromo.admin.fields.logo')}
                hint={t('heroPromo.admin.fields.logoHint')}
                kind="logo"
                value={promo.logoUrl}
                error={fieldError('logoUrl')}
                onChange={(logoUrl) => update({ logoUrl })}
              />
            </div>
          </div>

          {/* Lien */}
          <div className="space-y-4">
            <SectionTitle icon={Link2}>{t('heroPromo.admin.sections.link')}</SectionTitle>
            <SettingsField id={`${baseId}-link`} label={t('heroPromo.admin.fields.link')} hint={t('heroPromo.admin.fields.linkHint')} error={linkError}>
              <div className="flex gap-2">
                <Input
                  id={`${baseId}-link`}
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={promo.linkUrl}
                  placeholder="https://"
                  onChange={(event) => update({ linkUrl: event.target.value })}
                  aria-invalid={Boolean(linkError) || undefined}
                  aria-describedby={`${baseId}-link-message`}
                  className={cn(settingsInputClass, 'min-w-0', linkError && invalidInputClass)}
                />
                <TestLink href={testLink} label={t('heroPromo.admin.fields.linkTest')} showLabel />
              </div>
            </SettingsField>
            <ToggleRow
              id={`${baseId}-new-tab`}
              label={t('heroPromo.admin.fields.newTab')}
              description={t('heroPromo.admin.fields.newTabHint')}
              checked={promo.openInNewTab}
              onCheckedChange={(openInNewTab) => update({ openInNewTab })}
            />
          </div>

          {/* Mention « Pub » */}
          <div className="space-y-4">
            <SectionTitle icon={Megaphone}>{t('heroPromo.admin.sections.adLabel')}</SectionTitle>
            <ToggleRow
              id={`${baseId}-ad-label`}
              label={t('heroPromo.admin.fields.adLabelShow')}
              description={promo.adLabel.show ? t('heroPromo.admin.fields.adLabelShowOn') : t('heroPromo.admin.fields.adLabelShowOff')}
              checked={promo.adLabel.show}
              onCheckedChange={(show) => update({ adLabel: { ...promo.adLabel, show } })}
            />
            {promo.adLabel.show && (
              <div className="space-y-4 rounded-xl border border-white/5 bg-black/20 p-3.5 sm:p-4">
                <FieldGroup id={`${baseId}-ad-label-position`} legend={t('heroPromo.admin.fields.adLabelPosition')}>
                  <SegmentedChoice
                    ariaLabel={t('heroPromo.admin.fields.adLabelPosition')}
                    value={promo.adLabel.position}
                    onChange={(position) => update({ adLabel: { ...promo.adLabel, position } })}
                    options={HERO_PROMO_AD_LABEL_POSITIONS.map((position) => ({
                      value: position,
                      label: t(`heroPromo.admin.fields.adLabelPositions.${position}`)
                    }))}
                  />
                </FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  {HERO_PROMO_LANGUAGES.map((lang) => {
                    const fieldId = `${baseId}-ad-label-${lang}`;
                    return (
                      <SettingsField
                        key={lang}
                        id={fieldId}
                        label={t('heroPromo.admin.fields.adLabelText', { language: t(`heroPromo.admin.fields.languages.${lang}`) })}
                        hint={t('heroPromo.admin.fields.adLabelTextHint')}
                      >
                        <Input
                          id={fieldId}
                          type="text"
                          autoComplete="off"
                          maxLength={HERO_PROMO_TEXT_LIMITS.adLabel}
                          value={promo.texts[lang].adLabel}
                          placeholder={lang === 'en' ? (promo.texts.fr.adLabel || 'Ad') : t('heroPromo.admin.fields.adLabelPlaceholder')}
                          onChange={(event) => updateText(lang, 'adLabel', event.target.value)}
                          aria-describedby={`${fieldId}-message`}
                          className={settingsInputClass}
                        />
                      </SettingsField>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Affichage */}
          <div className="space-y-4">
            <SectionTitle icon={MonitorSmartphone}>{t('heroPromo.admin.sections.display')}</SectionTitle>
            <FieldGroup id={`${baseId}-pages`} legend={t('heroPromo.admin.fields.pages')} hint={t('heroPromo.admin.fields.pagesHint')} error={pagesError}>
              <ChipMultiSelect
                values={promo.pages}
                onChange={(pages) => update({ pages })}
                invalid={Boolean(pagesError)}
                options={HERO_PROMO_PAGES.map((page) => ({ value: page, label: t(`heroPromo.admin.fields.pageNames.${page}`) }))}
              />
            </FieldGroup>
            <FieldGroup id={`${baseId}-position`} legend={t('heroPromo.admin.fields.position')} hint={t('heroPromo.admin.fields.positionHint')}>
              <SegmentedChoice
                ariaLabel={t('heroPromo.admin.fields.position')}
                value={String(promo.position)}
                onChange={(position) => update({ position: Number(position) })}
                options={Array.from({ length: MAX_HERO_PROMO_POSITION }, (_, offset) => ({
                  value: String(offset + 1),
                  label: String(offset + 1)
                }))}
              />
            </FieldGroup>
            <FieldGroup id={`${baseId}-accent`} legend={t('heroPromo.admin.fields.accent')} hint={t('heroPromo.admin.fields.accentHint')}>
              <div className="flex flex-wrap items-center gap-2">
                {ACCENT_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => update({ accentColor: color })}
                    aria-label={color}
                    aria-pressed={promo.accentColor === color}
                    className={cn(
                      'h-8 w-8 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 active:scale-95',
                      promo.accentColor === color ? 'border-white' : 'border-transparent hover:border-white/40'
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <label className="relative inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 pl-1 pr-2.5 text-xs text-white/70">
                  <input
                    type="color"
                    value={promo.accentColor}
                    onChange={(event) => update({ accentColor: event.target.value.toLowerCase() })}
                    className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                    aria-label={t('heroPromo.admin.fields.accentCustom')}
                  />
                  <span className="font-mono uppercase tabular-nums">{promo.accentColor}</span>
                </label>
              </div>
            </FieldGroup>
            <FieldGroup id={`${baseId}-min-age`} legend={t('heroPromo.admin.fields.minAge')} hint={t('heroPromo.admin.fields.minAgeHint')}>
              <SegmentedChoice
                ariaLabel={t('heroPromo.admin.fields.minAge')}
                value={String(promo.minAge)}
                onChange={(minAge) => update({ minAge: Number(minAge) })}
                options={HERO_PROMO_MIN_AGES.map((age) => ({ value: String(age), label: t(`heroPromo.admin.fields.minAges.a${age}`) }))}
              />
            </FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              {(['startAt', 'endAt'] as const).map((field) => {
                const fieldId = `${baseId}-${field}`;
                const value = promo[field];
                const error = field === 'endAt' ? endError : null;
                const setDate = (next: string | null) => update(field === 'startAt' ? { startAt: next } : { endAt: next });
                return (
                  <SettingsField
                    key={field}
                    id={fieldId}
                    label={t(`heroPromo.admin.fields.${field}`)}
                    hint={t('heroPromo.admin.fields.dateHint')}
                    error={error}
                    aside={value ? (
                      <button
                        type="button"
                        onClick={() => setDate(null)}
                        className="text-[11px] font-medium text-amber-200/80 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
                      >
                        {t('heroPromo.admin.fields.clear')}
                      </button>
                    ) : null}
                  >
                    <Input
                      id={fieldId}
                      type="datetime-local"
                      value={toDateTimeLocalValue(value)}
                      onChange={(event) => setDate(fromDateTimeLocalValue(event.target.value))}
                      aria-invalid={Boolean(error) || undefined}
                      aria-describedby={`${fieldId}-message`}
                      className={cn(settingsInputClass, '[color-scheme:dark]', error && invalidInputClass)}
                    />
                  </SettingsField>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </li>
  );
};

export default HeroPromoEditor;
