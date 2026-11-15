import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ArrowRight,
  AtSign,
  Contact,
  CreditCard,
  Crown,
  Euro,
  Eye,
  EyeOff,
  Gift,
  Hash,
  Link2,
  Mail,
  MessageCircle,
  PauseCircle,
  Plus,
  Power,
  Send,
  ServerOff,
  Star,
  Ticket,
  Wallet,
  X,
  type LucideIcon
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  VIP_DONATION_METHOD_IDS,
  VIP_GIFT_CARD_IDS,
  type VipDonationAvailability,
  type VipDonationContacts,
  type VipDonationMethodId,
  type VipDonationSettings,
  type VipGiftCardId
} from '../../services/vipDonationsService';
import {
  VIP_GIFT_CARD_NAMES,
  getVipDonationContactLinks,
  getVipDurationLabel,
  getVipMonthsForAmount,
  formatVipFiat,
  type VipDonationContactLinks
} from '../../utils/vipDonationsUi';
import { CryptoLogo, GiftCardIcon } from '../vipDonation/DonationMethodIcons';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import {
  IntegerInput,
  SettingsField,
  SettingsNotice,
  SettingsSection,
  TestLink,
  ToggleRow,
  invalidInputClass,
  settingsInputClass
} from './SettingsUi';
import {
  VIP_CONTACT_FIELDS,
  VIP_SETTINGS_AMOUNT_LIMIT,
  VIP_SETTINGS_CONTACT_MAX_LENGTH,
  VIP_SETTINGS_PAUSED_MESSAGE_MAX_LENGTH,
  VIP_SETTINGS_SUGGESTED_LIMIT,
  contactFieldKey,
  formatEuroAmount,
  formatVipSettingsIssue,
  getVipAmountRange,
  getVipPreviewAmounts,
  getVisibleVipMethods,
  giftCardFieldKey,
  isHttpUrl,
  parseIntegerInput,
  type VipSettingsErrors,
  type VipSettingsIssue
} from './vipDonationSettingsForm';

export interface DonationSettingsSectionProps {
  settings: VipDonationSettings;
  errors: VipSettingsErrors;
  modified: boolean;
  onChange: (patch: Partial<VipDonationSettings>) => void;
}

const useSettingsText = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  return {
    t,
    locale,
    issueText: (issue: VipSettingsIssue | undefined) => formatVipSettingsIssue(t, locale, issue),
    modifiedLabel: (modified: boolean) => (modified ? t('vipDonations.settings.modified') : null)
  };
};

// ─── 1. État des dons ──────────────────────────────────────────────────────

export const StatusSection: React.FC<DonationSettingsSectionProps> = ({ settings, errors, modified, onChange }) => {
  const { t, issueText, modifiedLabel } = useSettingsText();
  const enabled = settings.donationsEnabled;
  const pausedMessageError = issueText(errors.pausedMessage);

  return (
    <SettingsSection
      id="vip-settings-status"
      icon={Power}
      title={t('vipDonations.settings.status.title')}
      description={t('vipDonations.settings.status.description')}
      modifiedLabel={modifiedLabel(modified)}
    >
      <div className="space-y-4">
        <div
          className={cn(
            'flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors',
            enabled ? 'border-emerald-400/25 bg-emerald-400/[0.06]' : 'border-amber-400/35 bg-amber-400/[0.08]'
          )}
        >
          <div className="min-w-0">
            <label htmlFor="vip-settings-donations-enabled" className="cursor-pointer text-base font-semibold text-white">
              {t('vipDonations.settings.status.toggleLabel')}
            </label>
            <p className="mt-1 text-sm leading-6 text-white/60">
              {enabled ? t('vipDonations.settings.status.enabledHint') : t('vipDonations.settings.status.disabledHint')}
            </p>
          </div>
          <Switch
            id="vip-settings-donations-enabled"
            checked={enabled}
            onCheckedChange={(next) => onChange({ donationsEnabled: next })}
          />
        </div>

        {!enabled && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/45 bg-amber-500/15 p-4 text-amber-50 sm:p-5">
            <PauseCircle className="mt-0.5 h-7 w-7 shrink-0 text-amber-300" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-base font-semibold sm:text-lg">{t('vipDonations.settings.status.pausedNoticeTitle')}</p>
              <p className="mt-1 text-sm leading-6 text-amber-50/80">{t('vipDonations.settings.status.pausedNoticeText')}</p>
            </div>
          </div>
        )}

        <SettingsField
          id="vip-settings-paused-message"
          label={t('vipDonations.settings.status.pausedMessageLabel')}
          hint={t('vipDonations.settings.status.pausedMessageHint')}
          error={pausedMessageError}
          aside={(
            <span className="text-[11px] tabular-nums text-white/35">
              {settings.pausedMessage.length}/{VIP_SETTINGS_PAUSED_MESSAGE_MAX_LENGTH}
            </span>
          )}
        >
          <Textarea
            id="vip-settings-paused-message"
            rows={3}
            maxLength={VIP_SETTINGS_PAUSED_MESSAGE_MAX_LENGTH}
            value={settings.pausedMessage}
            onChange={(event) => onChange({ pausedMessage: event.target.value })}
            placeholder={t('vipDonations.settings.status.pausedMessagePlaceholder')}
            aria-invalid={Boolean(pausedMessageError) || undefined}
            aria-describedby="vip-settings-paused-message-message"
            className={cn(settingsInputClass, 'resize-y', pausedMessageError && invalidInputClass)}
          />
        </SettingsField>
      </div>
    </SettingsSection>
  );
};

// ─── 2. VIP offert en remerciement ─────────────────────────────────────────

export const RateSection: React.FC<DonationSettingsSectionProps> = ({ settings, errors, modified, onChange }) => {
  const { t, locale, issueText, modifiedLabel } = useSettingsText();
  const rate = settings.eurosPerVipYear;
  const rateError = issueText(errors.eurosPerVipYear);
  const previewAmounts = rateError ? [] : getVipPreviewAmounts(settings);

  return (
    <SettingsSection
      id="vip-settings-rate"
      icon={Crown}
      title={t('vipDonations.settings.rate.title')}
      description={t('vipDonations.settings.rate.description')}
      modifiedLabel={modifiedLabel(modified)}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <SettingsField
          id="vip-settings-rate-input"
          label={t('vipDonations.settings.rate.label')}
          error={rateError}
          hint={t('vipDonations.settings.rate.perMonthHint', { amount: formatVipFiat(locale, rate / 12, 'EUR') })}
        >
          <IntegerInput
            id="vip-settings-rate-input"
            value={rate}
            onValueChange={(next) => onChange({ eurosPerVipYear: next })}
            suffix="€"
            invalid={Boolean(rateError)}
            aria-describedby="vip-settings-rate-input-message"
          />
        </SettingsField>

        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/50">
            {t('vipDonations.settings.rate.previewTitle')}
          </p>
          {previewAmounts.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {previewAmounts.map((amount) => {
                const months = getVipMonthsForAmount(amount, rate);
                const tag = amount === settings.minAmountEur
                  ? t('vipDonations.settings.rate.minTag')
                  : amount === settings.maxAmountEur
                    ? t('vipDonations.settings.rate.maxTag')
                    : null;

                return (
                  <li
                    key={amount}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
                      months >= 1 ? 'border-white/10 bg-white/[0.04] text-white/80' : 'border-red-400/35 bg-red-500/10 text-red-200'
                    )}
                  >
                    <span className="font-semibold text-white">{formatEuroAmount(locale, amount)}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-white opacity-35" aria-hidden="true" />
                    <span className={months >= 1 ? 'font-medium text-amber-200' : undefined}>
                      {months >= 1
                        ? getVipDurationLabel(t, months / 12, 'plain')
                        : t('vipDonations.settings.rate.lessThanMonth')}
                    </span>
                    {tag && <span className="text-[10px] uppercase tracking-wider text-white/35">{tag}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-white/40">{t('vipDonations.settings.rate.previewEmpty')}</p>
          )}
          <p className="mt-2 text-xs leading-5 text-white/40">{t('vipDonations.settings.rate.roundingHint')}</p>
        </div>
      </div>
    </SettingsSection>
  );
};

// ─── 3. Montants ───────────────────────────────────────────────────────────

export const AmountsSection: React.FC<DonationSettingsSectionProps> = ({ settings, errors, modified, onChange }) => {
  const { t, locale, issueText, modifiedLabel } = useSettingsText();
  const [newAmountText, setNewAmountText] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const range = getVipAmountRange(settings);
  const suggested = settings.suggestedAmounts;
  const isFull = suggested.length >= VIP_SETTINGS_SUGGESTED_LIMIT;
  const minError = issueText(errors.minAmountEur);
  const maxError = issueText(errors.maxAmountEur);
  const defaultError = issueText(errors.defaultAmountEur);
  const suggestedError = issueText(errors.suggestedAmounts);

  const handleAddSuggested = () => {
    const amount = parseIntegerInput(newAmountText);

    if (isFull) {
      setAddError(t('vipDonations.settings.amounts.suggestedFull', { limit: VIP_SETTINGS_SUGGESTED_LIMIT }));
      return;
    }
    if (!Number.isInteger(amount)) {
      setAddError(t('vipDonations.settings.errors.integerRequired'));
      return;
    }
    if (amount < 1 || amount > VIP_SETTINGS_AMOUNT_LIMIT) {
      setAddError(t('vipDonations.settings.errors.amountRange', {
        min: formatEuroAmount(locale, 1),
        max: formatEuroAmount(locale, VIP_SETTINGS_AMOUNT_LIMIT)
      }));
      return;
    }
    if (suggested.includes(amount)) {
      setAddError(t('vipDonations.settings.amounts.suggestedDuplicate'));
      return;
    }
    if (range && (amount < range.min || amount > range.max)) {
      setAddError(t('vipDonations.settings.amounts.suggestedAddOutOfRange', {
        min: formatEuroAmount(locale, range.min),
        max: formatEuroAmount(locale, range.max)
      }));
      return;
    }

    onChange({ suggestedAmounts: [...suggested, amount].sort((a, b) => a - b) });
    setNewAmountText('');
    setAddError(null);
  };

  const handleRemoveSuggested = (amount: number) => {
    const remaining = suggested.filter((value) => value !== amount);
    const patch: Partial<VipDonationSettings> = { suggestedAmounts: remaining };

    // Sans montant libre, la présélection doit rester un montant suggéré :
    // elle passe sur le montant restant le plus proche.
    if (!settings.freeAmountEnabled && settings.defaultAmountEur === amount && remaining.length > 0) {
      patch.defaultAmountEur = remaining.reduce((closest, value) => (
        Math.abs(value - amount) < Math.abs(closest - amount) ? value : closest
      ), remaining[0]);
    }

    onChange(patch);
    setAddError(null);
  };

  return (
    <SettingsSection
      id="vip-settings-amounts"
      icon={Euro}
      title={t('vipDonations.settings.amounts.title')}
      description={t('vipDonations.settings.amounts.description')}
      modifiedLabel={modifiedLabel(modified)}
    >
      <div className="space-y-5">
        <ToggleRow
          id="vip-settings-free-amount"
          label={t('vipDonations.settings.amounts.freeAmountLabel')}
          description={settings.freeAmountEnabled
            ? t('vipDonations.settings.amounts.freeAmountOn')
            : t('vipDonations.settings.amounts.freeAmountOff')}
          checked={settings.freeAmountEnabled}
          onCheckedChange={(next) => onChange({ freeAmountEnabled: next })}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <SettingsField id="vip-settings-min-amount" label={t('vipDonations.settings.amounts.minLabel')} error={minError}>
            <IntegerInput
              id="vip-settings-min-amount"
              value={settings.minAmountEur}
              onValueChange={(next) => onChange({ minAmountEur: next })}
              suffix="€"
              invalid={Boolean(minError)}
              aria-describedby="vip-settings-min-amount-message"
            />
          </SettingsField>
          <SettingsField id="vip-settings-max-amount" label={t('vipDonations.settings.amounts.maxLabel')} error={maxError}>
            <IntegerInput
              id="vip-settings-max-amount"
              value={settings.maxAmountEur}
              onValueChange={(next) => onChange({ maxAmountEur: next })}
              suffix="€"
              invalid={Boolean(maxError)}
              aria-describedby="vip-settings-max-amount-message"
            />
          </SettingsField>
          <SettingsField
            id="vip-settings-default-amount"
            label={t('vipDonations.settings.amounts.defaultLabel')}
            error={defaultError}
            hint={settings.freeAmountEnabled
              ? t('vipDonations.settings.amounts.defaultHintFree')
              : t('vipDonations.settings.amounts.defaultHintSuggested')}
          >
            <IntegerInput
              id="vip-settings-default-amount"
              value={settings.defaultAmountEur}
              onValueChange={(next) => onChange({ defaultAmountEur: next })}
              suffix="€"
              invalid={Boolean(defaultError)}
              aria-describedby="vip-settings-default-amount-message"
            />
            {suggested.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-white/40">{t('vipDonations.settings.amounts.defaultQuickPick')}</span>
                {suggested.map((amount) => {
                  const isSelected = settings.defaultAmountEur === amount;
                  return (
                    <button
                      key={amount}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onChange({ defaultAmountEur: amount })}
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50',
                        isSelected
                          ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                          : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white'
                      )}
                    >
                      {formatEuroAmount(locale, amount)}
                    </button>
                  );
                })}
              </div>
            )}
          </SettingsField>
        </div>

        <SettingsField
          id="vip-settings-suggested-new"
          label={t('vipDonations.settings.amounts.suggestedLabel')}
          error={addError || suggestedError}
          hint={t('vipDonations.settings.amounts.suggestedHint', { limit: VIP_SETTINGS_SUGGESTED_LIMIT })}
          aside={(
            <span className="text-[11px] tabular-nums text-white/35">
              {suggested.length}/{VIP_SETTINGS_SUGGESTED_LIMIT}
            </span>
          )}
        >
          <div className="space-y-3">
            {suggested.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {suggested.map((amount) => {
                  const outOfRange = range !== null && (amount < range.min || amount > range.max);
                  const formatted = formatEuroAmount(locale, amount);

                  return (
                    <li
                      key={amount}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1 text-sm font-semibold tabular-nums',
                        outOfRange
                          ? 'border-red-400/45 bg-red-500/10 text-red-200'
                          : 'border-amber-300/30 bg-amber-300/10 text-amber-100'
                      )}
                    >
                      {formatted}
                      {settings.defaultAmountEur === amount && (
                        <Star
                          role="img"
                          className="h-3 w-3 fill-current"
                          aria-label={t('vipDonations.settings.amounts.suggestedDefaultTag')}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveSuggested(amount)}
                        aria-label={t('vipDonations.settings.amounts.suggestedRemove', { amount: formatted })}
                        title={t('vipDonations.settings.amounts.suggestedRemove', { amount: formatted })}
                        className="rounded-full p-1 opacity-70 transition-[opacity,background-color] hover:bg-white/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex max-w-xs gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  id="vip-settings-suggested-new"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={newAmountText}
                  disabled={isFull}
                  placeholder={t('vipDonations.settings.amounts.suggestedPlaceholder')}
                  onChange={(event) => {
                    setNewAmountText(event.target.value);
                    setAddError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleAddSuggested();
                    }
                  }}
                  aria-invalid={Boolean(addError) || undefined}
                  aria-describedby="vip-settings-suggested-new-message"
                  className={cn(settingsInputClass, 'pr-9 tabular-nums', addError && invalidInputClass)}
                />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-white/40">€</span>
              </div>
              <button
                type="button"
                onClick={handleAddSuggested}
                disabled={isFull || !newAmountText.trim()}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 disabled:pointer-events-none disabled:opacity-40"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('vipDonations.settings.amounts.suggestedAdd')}
              </button>
            </div>
            {isFull && (
              <p className="text-xs text-white/40">
                {t('vipDonations.settings.amounts.suggestedFull', { limit: VIP_SETTINGS_SUGGESTED_LIMIT })}
              </p>
            )}
          </div>
        </SettingsField>
      </div>
    </SettingsSection>
  );
};

// ─── 4. Moyens de paiement ─────────────────────────────────────────────────

// Mêmes visuels que la page de don : logos pour BTC/LTC, icônes sinon.
// Icônes en couleur pleine, transparence via `opacity` : une couleur
// translucide éclaircirait les points où leurs tracés se chevauchent.
const METHOD_VISUALS: Record<VipDonationMethodId, React.ReactNode> = {
  giftcard: <GiftCardIcon className="h-5 w-5 text-white opacity-85" />,
  cryptogate: <CreditCard className="h-5 w-5 text-white opacity-85" aria-hidden="true" />,
  btc: <CryptoLogo coin="btc" className="h-5 w-5" />,
  ltc: <CryptoLogo coin="ltc" className="h-5 w-5" />
};

interface MethodsSectionProps extends DonationSettingsSectionProps {
  availability: VipDonationAvailability;
}

export const MethodsSection: React.FC<MethodsSectionProps> = ({ settings, modified, onChange, availability }) => {
  const { t, modifiedLabel } = useSettingsText();
  const visibleMethods = getVisibleVipMethods(settings, availability);
  const methodName = (id: VipDonationMethodId) => t(`vipDonations.settings.methods.names.${id}`);

  const handleEnabledChange = (id: VipDonationMethodId, enabled: boolean) => {
    const methods = { ...settings.methods, [id]: { ...settings.methods[id], enabled } };
    let defaultMethod = settings.defaultMethod;

    // Couper le moyen présélectionné : la présélection passe sur un autre moyen
    // activé, de préférence configuré côté serveur.
    if (!enabled && settings.defaultMethod === id) {
      const candidates = VIP_DONATION_METHOD_IDS.filter((other) => other !== id && methods[other].enabled);
      const fallback = candidates.find((other) => availability[other] !== false) ?? candidates[0];
      if (fallback) {
        defaultMethod = fallback;
        toast.info(t('vipDonations.settings.methods.defaultMoved', { name: methodName(fallback) }));
      }
    }

    onChange({ methods, defaultMethod });
  };

  return (
    <SettingsSection
      id="vip-settings-methods"
      icon={Wallet}
      title={t('vipDonations.settings.methods.title')}
      description={t('vipDonations.settings.methods.description')}
      modifiedLabel={modifiedLabel(modified)}
    >
      <div className="space-y-3">
        {visibleMethods.length === 0 ? (
          <SettingsNotice tone="danger">{t('vipDonations.settings.methods.noneVisible')}</SettingsNotice>
        ) : !visibleMethods.includes(settings.defaultMethod) ? (
          <SettingsNotice tone="warning">{t('vipDonations.settings.methods.defaultHidden')}</SettingsNotice>
        ) : null}

        <fieldset>
          <legend className="sr-only">{t('vipDonations.settings.methods.legend')}</legend>
          <ul className="space-y-3">
            {VIP_DONATION_METHOD_IDS.map((id) => {
              const enabled = settings.methods[id].enabled;
              const available = availability[id] !== false;
              const isDefault = settings.defaultMethod === id;
              const badge = !available
                ? {
                  label: t('vipDonations.settings.methods.badgeUnavailable'),
                  className: 'border-amber-400/45 bg-amber-500/15 text-amber-200',
                  icon: ServerOff
                }
                : enabled
                  ? {
                    label: t('vipDonations.settings.methods.badgeVisible'),
                    className: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
                    icon: Eye
                  }
                  : {
                    label: t('vipDonations.settings.methods.badgeHidden'),
                    className: 'border-white/15 bg-white/5 text-white/50',
                    // Texte translucide : l'icône garde une couleur pleine et
                    // prend l'opacité, sinon ses tracés se cumulent en plus clair.
                    iconClassName: 'text-white opacity-50',
                    icon: EyeOff
                  };
              const BadgeIcon = badge.icon;

              return (
                <li
                  key={id}
                  className={cn(
                    'rounded-xl border p-3.5 transition-colors sm:p-4',
                    isDefault && enabled && available ? 'border-amber-300/35 bg-amber-300/[0.05]' : 'border-white/10 bg-black/20'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn('shrink-0 rounded-lg bg-white/5 p-2 ring-1 ring-white/10', !enabled && 'opacity-50')}>
                      {METHOD_VISUALS[id]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <label htmlFor={`vip-settings-method-${id}`} className="cursor-pointer font-semibold text-white">
                          {methodName(id)}
                        </label>
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', badge.className)}>
                          <BadgeIcon className={cn('h-3 w-3', badge.iconClassName)} aria-hidden="true" />
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-white/50">
                        {t(`vipDonations.settings.methods.descriptions.${id}`)}
                      </p>
                      {!available && (
                        <p className="mt-2 text-xs leading-5 text-amber-200/90">
                          {t('vipDonations.settings.methods.unavailableHint')}
                        </p>
                      )}
                      <label
                        className={cn(
                          'mt-3 inline-flex items-center gap-2 text-xs',
                          enabled ? 'cursor-pointer text-white/70' : 'cursor-not-allowed text-white/30'
                        )}
                      >
                        <input
                          type="radio"
                          name="vip-settings-default-method"
                          value={id}
                          checked={isDefault}
                          disabled={!enabled}
                          onChange={() => onChange({ defaultMethod: id })}
                          className="h-4 w-4 accent-amber-400"
                        />
                        {t('vipDonations.settings.methods.defaultLabel')}
                      </label>
                    </div>
                    <Switch
                      id={`vip-settings-method-${id}`}
                      checked={enabled}
                      onCheckedChange={(next) => handleEnabledChange(id, next)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </fieldset>
      </div>
    </SettingsSection>
  );
};

// ─── 5. Option « pour offrir » ─────────────────────────────────────────────

export const GiftOptionSection: React.FC<DonationSettingsSectionProps> = ({ settings, modified, onChange }) => {
  const { t, modifiedLabel } = useSettingsText();

  return (
    <SettingsSection
      id="vip-settings-gift-option"
      icon={Gift}
      title={t('vipDonations.settings.giftOption.title')}
      description={t('vipDonations.settings.giftOption.description')}
      modifiedLabel={modifiedLabel(modified)}
    >
      <ToggleRow
        id="vip-settings-gift-option-toggle"
        label={t('vipDonations.settings.giftOption.label')}
        description={settings.giftOptionEnabled
          ? t('vipDonations.settings.giftOption.on')
          : t('vipDonations.settings.giftOption.off')}
        checked={settings.giftOptionEnabled}
        onCheckedChange={(next) => onChange({ giftOptionEnabled: next })}
      />
    </SettingsSection>
  );
};

// ─── 6. Cartes cadeaux ─────────────────────────────────────────────────────

export const GiftCardsSection: React.FC<DonationSettingsSectionProps> = ({ settings, errors, modified, onChange }) => {
  const { t, issueText, modifiedLabel } = useSettingsText();
  const methodEnabled = settings.methods.giftcard.enabled;
  const noCardEnabled = VIP_GIFT_CARD_IDS.every((id) => !settings.giftCards[id].enabled);

  const updateCard = (id: VipGiftCardId, patch: Partial<VipDonationSettings['giftCards'][VipGiftCardId]>) => {
    onChange({ giftCards: { ...settings.giftCards, [id]: { ...settings.giftCards[id], ...patch } } });
  };

  return (
    <SettingsSection
      id="vip-settings-gift-cards"
      icon={Ticket}
      title={t('vipDonations.settings.giftCards.title')}
      description={t('vipDonations.settings.giftCards.description')}
      modifiedLabel={modifiedLabel(modified)}
    >
      <div className="space-y-3">
        {!methodEnabled ? (
          <SettingsNotice tone="info">{t('vipDonations.settings.giftCards.methodDisabled')}</SettingsNotice>
        ) : noCardEnabled ? (
          <SettingsNotice tone="warning">{t('vipDonations.settings.giftCards.noneEnabled')}</SettingsNotice>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          {VIP_GIFT_CARD_IDS.map((id) => {
            const card = settings.giftCards[id];
            const name = VIP_GIFT_CARD_NAMES[id];
            const trimmedUrl = card.url.trim();
            const urlError = issueText(errors[giftCardFieldKey(id)]);
            const fieldId = `vip-settings-gift-card-${id}-url`;

            return (
              <div
                key={id}
                className={cn(
                  'min-w-0 rounded-xl border p-4 transition-colors',
                  card.enabled ? 'border-white/10 bg-black/20' : 'border-white/5 bg-black/10'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor={`vip-settings-gift-card-${id}`}
                    className={cn('flex min-w-0 cursor-pointer items-center gap-2 font-semibold', card.enabled ? 'text-white' : 'text-white/50')}
                  >
                    <Ticket className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                    <span className="truncate">{name}</span>
                  </label>
                  <Switch
                    id={`vip-settings-gift-card-${id}`}
                    size="sm"
                    checked={card.enabled}
                    onCheckedChange={(next) => updateCard(id, { enabled: next })}
                  />
                </div>
                <SettingsField
                  id={fieldId}
                  label={t('vipDonations.settings.giftCards.urlLabel')}
                  error={urlError}
                  hint={trimmedUrl ? null : t('vipDonations.settings.giftCards.urlEmptyHint')}
                  className="mt-3"
                >
                  <div className="flex gap-2">
                    <Input
                      id={fieldId}
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      value={card.url}
                      placeholder="https://"
                      onChange={(event) => updateCard(id, { url: event.target.value })}
                      aria-invalid={Boolean(urlError) || undefined}
                      aria-describedby={`${fieldId}-message`}
                      className={cn(settingsInputClass, 'min-w-0', urlError && invalidInputClass)}
                    />
                    <TestLink
                      href={trimmedUrl && isHttpUrl(trimmedUrl) ? trimmedUrl : null}
                      label={t('vipDonations.settings.giftCards.open')}
                      ariaLabel={t('vipDonations.settings.giftCards.openAria', { name })}
                      showLabel
                    />
                  </div>
                </SettingsField>
              </div>
            );
          })}
        </div>
      </div>
    </SettingsSection>
  );
};

// ─── 7. Contacts affichés ──────────────────────────────────────────────────

const CONTACT_FIELD_META: Record<keyof VipDonationContacts, {
  icon: LucideIcon;
  type: 'email' | 'url' | 'text';
  link?: keyof VipDonationContactLinks;
}> = {
  email: { icon: Mail, type: 'email', link: 'email' },
  discordUsername: { icon: MessageCircle, type: 'text' },
  discordUrl: { icon: Link2, type: 'url', link: 'discord' },
  telegramUsername: { icon: Send, type: 'text', link: 'telegram' },
  matrixUserId: { icon: AtSign, type: 'text', link: 'matrixUser' },
  matrixRoomUrl: { icon: Hash, type: 'url', link: 'matrixRoom' }
};

// Avertissements non bloquants : le serveur accepte ces valeurs, mais le lien
// généré pour les donateurs serait cassé.
const getContactWarningKey = (field: keyof VipDonationContacts, value: string): string | null => {
  if (!value) {
    return null;
  }
  if (field === 'telegramUsername' && /[/:]|t\.me/i.test(value)) {
    return 'vipDonations.settings.contacts.telegramWarning';
  }
  if (field === 'matrixUserId' && !/^@?[^\s:@]+:\S+$/.test(value)) {
    return 'vipDonations.settings.contacts.matrixWarning';
  }
  return null;
};

export const ContactsSection: React.FC<DonationSettingsSectionProps> = ({ settings, errors, modified, onChange }) => {
  const { t, issueText, modifiedLabel } = useSettingsText();
  const trimmedContacts = Object.fromEntries(
    VIP_CONTACT_FIELDS.map((field) => [field, settings.contacts[field].trim()])
  ) as Record<keyof VipDonationContacts, string>;
  const links = getVipDonationContactLinks(trimmedContacts);
  const hasAnyContact = VIP_CONTACT_FIELDS.some((field) => trimmedContacts[field] !== '');

  return (
    <SettingsSection
      id="vip-settings-contacts"
      icon={Contact}
      title={t('vipDonations.settings.contacts.title')}
      description={t('vipDonations.settings.contacts.description')}
      modifiedLabel={modifiedLabel(modified)}
    >
      <div className="space-y-4">
        {!hasAnyContact && settings.methods.giftcard.enabled && (
          <SettingsNotice tone="warning">{t('vipDonations.settings.contacts.noContact')}</SettingsNotice>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {VIP_CONTACT_FIELDS.map((field) => {
            const meta = CONTACT_FIELD_META[field];
            const Icon = meta.icon;
            const fieldId = `vip-settings-contact-${field}`;
            const error = issueText(errors[contactFieldKey(field)]);
            const warningKey = error ? null : getContactWarningKey(field, trimmedContacts[field]);
            const href = meta.link && !error && !warningKey ? links[meta.link] : null;
            const fieldLabel = t(`vipDonations.settings.contacts.${field}Label`);

            return (
              <SettingsField
                key={field}
                id={fieldId}
                label={(
                  <span className="inline-flex items-center gap-1.5">
                    {/* Même rendu que le libellé (blanc à 50 %), sans cumul des tracés. */}
                    <Icon className="h-3.5 w-3.5 text-white opacity-50" aria-hidden="true" />
                    {fieldLabel}
                  </span>
                )}
                error={error}
                warning={warningKey ? t(warningKey) : null}
              >
                <div className="flex gap-2">
                  <Input
                    id={fieldId}
                    type={meta.type}
                    inputMode={meta.type === 'text' ? undefined : meta.type}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={VIP_SETTINGS_CONTACT_MAX_LENGTH}
                    value={settings.contacts[field]}
                    placeholder={t(`vipDonations.settings.contacts.${field}Placeholder`)}
                    onChange={(event) => onChange({ contacts: { ...settings.contacts, [field]: event.target.value } })}
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={`${fieldId}-message`}
                    className={cn(settingsInputClass, 'min-w-0', error && invalidInputClass)}
                  />
                  {meta.link && (
                    <TestLink
                      href={href}
                      label={t('vipDonations.settings.contacts.testLink')}
                      ariaLabel={t('vipDonations.settings.contacts.testLinkAria', { field: fieldLabel })}
                    />
                  )}
                </div>
              </SettingsField>
            );
          })}
        </div>
      </div>
    </SettingsSection>
  );
};
