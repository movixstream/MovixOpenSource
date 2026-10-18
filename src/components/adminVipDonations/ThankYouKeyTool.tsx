import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowRight, CheckCircle2, Copy, HeartHandshake, KeyRound, Mail, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SITE_URL } from '../../config/runtime';
import { adminCreateVipThankYouKey } from '../../services/vipDonationsService';
import { copyText } from '../../utils/clipboard';
import { getVipDurationLabel, getVipMonthsForAmount } from '../../utils/vipDonationsUi';
import { Button } from '../ui/button';
import ConfirmDialog from '../ui/confirm-dialog';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { SettingsField, SettingsNotice, invalidInputClass, settingsInputClass } from './SettingsUi';
import {
  VIP_SETTINGS_AMOUNT_LIMIT,
  buildThankYouMailto,
  formatEuroAmount,
  isValidEmailAddress,
  parseEuroAmountInput
} from './vipDonationSettingsForm';

interface ThankYouKeyToolProps {
  // Tarif enregistré sur le serveur : c'est lui qui fait foi, pas le brouillon.
  eurosPerVipYear: number;
  hasPendingRateChange: boolean;
}

interface GeneratedThankYouKey {
  key: string;
  amount: number;
  duration: string;
}

const getDonorSiteUrl = () => SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '');

const ThankYouKeyTool: React.FC<ThankYouKeyToolProps> = ({ eurosPerVipYear, hasPendingRateChange }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [amountText, setAmountText] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedThankYouKey | null>(null);
  const [message, setMessage] = useState('');
  const [donorEmail, setDonorEmail] = useState('');

  const amount = parseEuroAmountInput(amountText);
  const hasAmount = amountText.trim() !== '';
  const amountIsValid = Number.isFinite(amount) && amount > 0;
  const amountTooHigh = amountIsValid && amount > VIP_SETTINGS_AMOUNT_LIMIT;
  const months = amountIsValid && !amountTooHigh ? getVipMonthsForAmount(amount, eurosPerVipYear) : 0;
  const duration = months >= 1 ? getVipDurationLabel(t, months / 12, 'plain') : null;
  const canGenerate = duration !== null && !isGenerating;

  const amountError = !hasAmount
    ? null
    : !amountIsValid
      ? t('vipDonations.settings.thankYou.amountInvalid')
      : amountTooHigh
        ? t('vipDonations.settings.thankYou.amountTooHigh', { max: formatEuroAmount(locale, VIP_SETTINGS_AMOUNT_LIMIT) })
        : null;

  const trimmedEmail = donorEmail.trim();
  const emailError = trimmedEmail && !isValidEmailAddress(trimmedEmail)
    ? t('vipDonations.settings.thankYou.emailInvalid')
    : null;
  const mailtoHref = generated && !emailError
    ? buildThankYouMailto(trimmedEmail, t('vipDonations.settings.thankYou.emailSubject'), message)
    : null;

  const handleGenerate = async () => {
    if (!canGenerate || !duration) {
      return;
    }

    setIsGenerating(true);
    try {
      const created = await adminCreateVipThankYouKey(months);
      setGenerated({ key: created.key, amount, duration });
      setMessage(t('vipDonations.settings.thankYou.messageTemplate', {
        duration,
        key: created.key,
        siteUrl: getDonorSiteUrl()
      }));
      setDonorEmail('');
      toast.success(t('vipDonations.settings.thankYou.success', { duration }));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('vipDonations.settings.thankYou.error'));
    } finally {
      setIsGenerating(false);
      setConfirmOpen(false);
    }
  };

  const handleCopy = async (value: string, successMessage: string) => {
    if (await copyText(value)) {
      toast.success(successMessage);
    } else {
      toast.error(t('vipDonations.settings.thankYou.copyFailed'));
    }
  };

  const handleReset = () => {
    setGenerated(null);
    setMessage('');
    setDonorEmail('');
    setAmountText('');
  };

  return (
    <section
      id="vip-settings-thank-you"
      aria-labelledby="vip-settings-thank-you-title"
      className="scroll-mt-24 rounded-2xl border border-amber-300/25 bg-gradient-to-br from-amber-400/[0.08] via-white/[0.02] to-transparent p-4 sm:p-5"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="shrink-0 rounded-xl bg-amber-400/15 p-2.5 ring-1 ring-amber-300/30">
          <HeartHandshake className="h-5 w-5 text-amber-300" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="vip-settings-thank-you-title" className="text-base font-semibold text-white sm:text-lg">
            {t('vipDonations.settings.thankYou.title')}
          </h3>
          <p className="mt-1 text-sm leading-6 text-white/55">{t('vipDonations.settings.thankYou.description')}</p>
        </div>
      </div>

      {!generated ? (
        <div className="space-y-4">
          <p className="text-xs leading-5 text-white/45">
            {t('vipDonations.settings.thankYou.rateInfo', { amount: formatEuroAmount(locale, eurosPerVipYear) })}
          </p>
          {hasPendingRateChange && (
            <SettingsNotice tone="info">{t('vipDonations.settings.thankYou.rateDraftNotice')}</SettingsNotice>
          )}

          <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-start">
            <SettingsField
              id="vip-settings-thank-you-amount"
              label={t('vipDonations.settings.thankYou.amountLabel')}
              error={amountError}
            >
              <div className="relative">
                <Input
                  id="vip-settings-thank-you-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amountText}
                  placeholder={t('vipDonations.settings.thankYou.amountPlaceholder')}
                  onChange={(event) => setAmountText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canGenerate) {
                      event.preventDefault();
                      setConfirmOpen(true);
                    }
                  }}
                  aria-invalid={Boolean(amountError) || undefined}
                  aria-describedby="vip-settings-thank-you-amount-message"
                  className={cn(settingsInputClass, 'pr-9 tabular-nums', amountError && invalidInputClass)}
                />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-white/40">€</span>
              </div>
            </SettingsField>

            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/50">
                {t('vipDonations.settings.thankYou.durationLabel')}
              </p>
              <div
                aria-live="polite"
                className={cn(
                  'flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                  duration
                    ? 'border-amber-300/35 bg-amber-300/10 font-semibold text-amber-100'
                    : 'border-white/10 bg-white/[0.03] text-white/45'
                )}
              >
                {duration ? (
                  <>
                    <span className="tabular-nums text-white">{formatEuroAmount(locale, amount)}</span>
                    <ArrowRight className="h-4 w-4 text-white opacity-40" aria-hidden="true" />
                    <span>{duration}</span>
                  </>
                ) : amountIsValid && !amountTooHigh ? (
                  <span className="text-red-300">{t('vipDonations.settings.thankYou.durationTooLow')}</span>
                ) : (
                  <span>{t('vipDonations.settings.thankYou.durationPending')}</span>
                )}
              </div>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!canGenerate}
            className="w-full bg-amber-400 font-semibold text-black shadow-lg shadow-amber-500/20 hover:bg-amber-300 focus-visible:ring-amber-400/60 sm:w-auto"
          >
            <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('vipDonations.settings.thankYou.generate')}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold text-white">
                {t('vipDonations.settings.thankYou.resultTitle', {
                  duration: generated.duration,
                  amount: formatEuroAmount(locale, generated.amount)
                })}
              </p>
              <p className="mt-1 text-xs leading-5 text-white/55">{t('vipDonations.settings.thankYou.keyWarning')}</p>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/50">
              {t('vipDonations.settings.thankYou.keyLabel')}
            </p>
            <div className="flex flex-col gap-2 rounded-xl bg-black/30 p-3 ring-1 ring-inset ring-white/10 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all font-mono text-sm font-semibold text-white">{generated.key}</code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleCopy(generated.key, t('vipDonations.settings.thankYou.keyCopied'))}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {t('vipDonations.settings.thankYou.copyKey')}
              </Button>
            </div>
          </div>

          <SettingsField
            id="vip-settings-thank-you-message"
            label={t('vipDonations.settings.thankYou.messageLabel')}
            hint={t('vipDonations.settings.thankYou.messageHint')}
            aside={(
              <button
                type="button"
                onClick={() => void handleCopy(message, t('vipDonations.settings.thankYou.messageCopied'))}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-300/10 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                {t('vipDonations.settings.thankYou.copyMessage')}
              </button>
            )}
          >
            <Textarea
              id="vip-settings-thank-you-message"
              rows={9}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              aria-describedby="vip-settings-thank-you-message-message"
              className={cn(settingsInputClass, 'resize-y leading-6')}
            />
          </SettingsField>

          <SettingsField
            id="vip-settings-thank-you-email"
            label={t('vipDonations.settings.thankYou.emailLabel')}
            error={emailError}
            hint={t('vipDonations.settings.thankYou.sendEmailHint', {
              subject: t('vipDonations.settings.thankYou.emailSubject')
            })}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="vip-settings-thank-you-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                value={donorEmail}
                placeholder={t('vipDonations.settings.thankYou.emailPlaceholder')}
                onChange={(event) => setDonorEmail(event.target.value)}
                aria-invalid={Boolean(emailError) || undefined}
                aria-describedby="vip-settings-thank-you-email-message"
                className={cn(settingsInputClass, 'min-w-0', emailError && invalidInputClass)}
              />
              {mailtoHref ? (
                <a
                  href={mailtoHref}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-amber-400 px-4 text-sm font-semibold text-black shadow-lg shadow-amber-500/20 transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                >
                  <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('vipDonations.settings.thankYou.sendEmail')}
                </a>
              ) : (
                <Button type="button" disabled className="shrink-0 bg-amber-400 font-semibold text-black">
                  <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('vipDonations.settings.thankYou.sendEmail')}
                </Button>
              )}
            </div>
          </SettingsField>

          <div className="flex justify-end border-t border-white/10 pt-4">
            <Button type="button" variant="outline" onClick={handleReset}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('vipDonations.settings.thankYou.newDonation')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        title={t('vipDonations.settings.thankYou.confirmTitle')}
        message={duration
          ? t('vipDonations.settings.thankYou.confirmMessage', { duration, amount: formatEuroAmount(locale, amount) })
          : ''}
        confirmLabel={isGenerating
          ? t('vipDonations.settings.thankYou.generating')
          : t('vipDonations.settings.thankYou.confirmButton')}
        busy={isGenerating}
        onConfirm={() => void handleGenerate()}
        onCancel={() => {
          if (!isGenerating) {
            setConfirmOpen(false);
          }
        }}
      />
    </section>
  );
};

export default ThankYouKeyTool;
