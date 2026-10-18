import React, { useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  CreditCard,
  Gift,
  Heart,
  KeyRound,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

import TurnstileWidget from '@/components/TurnstileWidget';
import { Button } from '@/components/ui/button';
import { useTurnstileBypass } from '@/hooks/useTurnstileBypass';
import { cn } from '@/lib/utils';
import {
  createVipInvoice,
  type VipDonationAvailability,
  type VipDonationMethodId,
  type VipDonationSettings,
  type VipRecipientMode
} from '@/services/vipDonationsService';
import { TURNSTILE_SITE_KEY } from '@/utils/vipDonationsUi';
import { rememberVipInvoice } from '@/utils/vipInvoiceHistory';
import GiftCardDonation from './GiftCardDonation';
import { CryptoLogo, GiftCardIcon, type CryptoLogoCoin } from './DonationMethodIcons';
import {
  formatDonationAmount,
  getDonationSuggestions,
  getEuroAffix,
  getInitialAmountState,
  getVipDurationForAmount,
  getVisibleDonationMethods,
  isValidDonationEmail
} from './donationUtils';

interface DonationFormProps {
  settings: VipDonationSettings;
  availability: VipDonationAvailability;
}

interface MethodCopy {
  title: string;
  subtitle: string;
  icon?: React.ComponentType<{ className?: string }>;
  logo?: CryptoLogoCoin;
}

// Le nom CryptoGate n'apparaît que dans le sous-titre de la carte bancaire.
const METHOD_COPY: Record<VipDonationMethodId, MethodCopy> = {
  giftcard: {
    icon: GiftCardIcon,
    title: 'vipDonations.donate.methods.giftcard.title',
    subtitle: 'vipDonations.donate.methods.giftcard.subtitle'
  },
  cryptogate: {
    icon: CreditCard,
    title: 'vipDonations.donate.methods.cryptogate.title',
    subtitle: 'vipDonations.donate.methods.cryptogate.subtitle'
  },
  btc: {
    logo: 'btc',
    title: 'vipDonations.donate.methods.btc.title',
    subtitle: 'vipDonations.donate.methods.btc.subtitle'
  },
  ltc: {
    logo: 'ltc',
    title: 'vipDonations.donate.methods.ltc.title',
    subtitle: 'vipDonations.donate.methods.ltc.subtitle'
  }
};

const AMOUNT_GRID_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  4: 'grid-cols-4'
};

const RECIPIENT_MODES: readonly VipRecipientMode[] = ['self', 'gift'];

const sectionLabelClass = 'text-sm font-semibold text-white';
const focusRingClass = 'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-yellow-400/60';
const inputClass = 'h-12 w-full rounded-xl border bg-black/40 text-base text-white outline-none transition-colors duration-150 placeholder:text-white/30 focus:border-yellow-400/60 focus:ring-2 focus:ring-yellow-400/15';

const DonationForm: React.FC<DonationFormProps> = ({ settings, availability }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'fr';
  const navigate = useNavigate();
  const turnstileStatus = useTurnstileBypass();
  const fieldId = useId();

  const suggestions = useMemo(() => getDonationSuggestions(settings), [settings]);
  const methods = useMemo(() => getVisibleDonationMethods(settings, availability), [settings, availability]);

  const [initialAmount] = useState(() => getInitialAmountState(settings, suggestions));
  const [presetAmount, setPresetAmount] = useState<number | null>(initialAmount.preset);
  const [customAmount, setCustomAmount] = useState(initialAmount.custom);
  const [method, setMethod] = useState<VipDonationMethodId | null>(() => (
    methods.includes(settings.defaultMethod) ? settings.defaultMethod : methods[0] ?? null
  ));
  const [recipientMode, setRecipientMode] = useState<VipRecipientMode>('self');
  const [email, setEmail] = useState('');
  const [showEmailError, setShowEmailError] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const submittingRef = useRef(false);
  const emailInputRef = useRef<HTMLInputElement>(null);

  const recipient: VipRecipientMode = settings.giftOptionEnabled ? recipientMode : 'self';
  // Pas de carte cadeau pour offrir : la clé est envoyée à la main au donateur.
  const selectableMethods = recipient === 'gift' ? methods.filter((id) => id !== 'giftcard') : methods;
  const giftCardHiddenForGift = recipient === 'gift' && methods.includes('giftcard');
  const pickDefaultMethod = (list: VipDonationMethodId[]) => (
    list.includes(settings.defaultMethod) ? settings.defaultMethod : list[0] ?? null
  );
  const activeMethod = method && selectableMethods.includes(method) ? method : pickDefaultMethod(selectableMethods);
  const isGiftCard = activeMethod === 'giftcard';
  const needsEmail = activeMethod === 'cryptogate';
  const needsTurnstile = Boolean(TURNSTILE_SITE_KEY) && activeMethod !== null && !isGiftCard;

  const customValue = presetAmount === null && customAmount !== '' ? Number(customAmount) : null;
  const customOutOfRange = customValue !== null
    && (customValue < settings.minAmountEur || customValue > settings.maxAmountEur);
  const amount = presetAmount ?? (customValue !== null && !customOutOfRange ? customValue : null);
  const thanksDuration = amount !== null
    ? getVipDurationForAmount(t, amount, settings.eurosPerVipYear)
    : null;

  const emailIsValid = isValidDonationEmail(email);
  const emailErrorVisible = showEmailError && !emailIsValid;
  const euroAffix = getEuroAffix(locale);
  const amountRange = {
    min: formatDonationAmount(locale, settings.minAmountEur),
    max: formatDonationAmount(locale, settings.maxAmountEur)
  };

  const ids = {
    amount: `${fieldId}-amount`,
    custom: `${fieldId}-custom`,
    customError: `${fieldId}-custom-error`,
    method: `${fieldId}-method`,
    recipient: `${fieldId}-recipient`,
    email: `${fieldId}-email`,
    emailHint: `${fieldId}-email-hint`
  };

  const handleCustomAmountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Euros entiers uniquement : on garde les chiffres, sans zéro devant.
    const digits = event.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 6);
    setCustomAmount(digits);
    setPresetAmount(null);
  };

  const handlePresetChange = (value: number) => {
    setPresetAmount(value);
    setCustomAmount('');
  };

  const handleRecipientChange = (mode: VipRecipientMode) => {
    setRecipientMode(mode);
    // « Pour offrir » retire la carte cadeau : on repasse sur le moyen par défaut.
    if (mode === 'gift' && activeMethod === 'giftcard') {
      setMethod(pickDefaultMethod(methods.filter((id) => id !== 'giftcard')));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || amount === null || activeMethod === null || activeMethod === 'giftcard') {
      return;
    }

    if (needsEmail && !emailIsValid) {
      setShowEmailError(true);
      emailInputRef.current?.focus();
      return;
    }

    if (needsTurnstile && !turnstileToken) {
      toast.error(t('vipDonations.common.turnstileRequired'));
      return;
    }

    submittingRef.current = true;
    setIsCreating(true);
    try {
      const invoice = await createVipInvoice(amount, activeMethod, recipient, {
        payerEmail: needsEmail ? email.trim() : undefined,
        turnstileToken: needsTurnstile ? turnstileToken : undefined
      });
      rememberVipInvoice(invoice.publicId);
      if (invoice.paymentMethod === 'cryptogate' && invoice.checkoutUrl) {
        window.open(invoice.checkoutUrl, '_blank', 'noopener,noreferrer');
      }
      // Le bouton reste en chargement jusqu'au changement de page : sinon il
      // redevient cliquable le temps que la page de suivi se charge.
      navigate(invoice.invoicePath);
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : '';
      toast.error(message || t('vipDonations.donate.createError'));
      setTurnstileResetSignal((value) => value + 1);
      submittingRef.current = false;
      setIsCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h2 className="sr-only">{t('vipDonations.donate.cardTitle')}</h2>

      <div className="space-y-8">
        <fieldset>
          <legend className={sectionLabelClass}>{t('vipDonations.donate.amountTitle')}</legend>

          {suggestions.length > 0 && (
            <div className={cn('mt-3 grid gap-2', AMOUNT_GRID_COLUMNS[suggestions.length] ?? 'grid-cols-3')}>
              {suggestions.map((value) => {
                const checked = presetAmount === value;
                const duration = getVipDurationForAmount(t, value, settings.eurosPerVipYear);
                return (
                  <label
                    key={value}
                    className={cn(
                      'flex min-h-[4.25rem] min-w-0 cursor-pointer flex-col items-center justify-center rounded-xl border px-2 py-2.5 text-center transition-colors duration-150',
                      focusRingClass,
                      checked
                        ? 'border-yellow-400/70 bg-yellow-400/10'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                    )}
                  >
                    <input
                      type="radio"
                      name={ids.amount}
                      value={value}
                      checked={checked}
                      onChange={() => handlePresetChange(value)}
                      className="sr-only"
                    />
                    <span className="text-lg font-semibold tabular-nums leading-tight text-white">
                      {formatDonationAmount(locale, value)}
                    </span>
                    {duration && (
                      <span className={cn('mt-0.5 text-xs', checked ? 'text-yellow-200' : 'text-white/55')}>
                        {duration}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {settings.freeAmountEnabled && (
            <div className="mt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <label htmlFor={ids.custom} className="text-xs font-medium text-white/70">
                  {t('vipDonations.donate.customAmountLabel')}
                </label>
                <span className="text-xs text-white/50">
                  {t('vipDonations.donate.customAmountRange', amountRange)}
                </span>
              </div>
              <div className="relative mt-1.5">
                <input
                  id={ids.custom}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  enterKeyHint="done"
                  value={customAmount}
                  onChange={handleCustomAmountChange}
                  placeholder={t('vipDonations.donate.customAmountPlaceholder')}
                  aria-invalid={customOutOfRange || undefined}
                  aria-describedby={customOutOfRange ? ids.customError : undefined}
                  className={cn(
                    inputClass,
                    'tabular-nums',
                    euroAffix.before ? 'pl-9 pr-4' : 'pl-4 pr-10',
                    customOutOfRange
                      ? 'border-red-400/60'
                      : customValue !== null
                        ? 'border-yellow-400/60'
                        : 'border-white/10'
                  )}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none absolute inset-y-0 flex items-center text-base text-white/45',
                    euroAffix.before ? 'left-4' : 'right-4'
                  )}
                >
                  {euroAffix.symbol}
                </span>
              </div>
              {customOutOfRange && (
                <p id={ids.customError} aria-live="polite" className="mt-1.5 text-xs leading-5 text-red-300">
                  {t('vipDonations.donate.amountRangeError', amountRange)}
                </p>
              )}
            </div>
          )}

          {amount !== null && (
            <p aria-live="polite" className="mt-4 flex items-start gap-2 text-sm leading-6 text-yellow-100">
              <Gift className="mt-1 h-4 w-4 shrink-0 text-yellow-400" aria-hidden="true" />
              <span>
                {thanksDuration
                  ? t('vipDonations.donate.thankYou', { duration: thanksDuration })
                  : t('vipDonations.donate.thankYouNoVip')}
              </span>
            </p>
          )}
        </fieldset>

        {settings.giftOptionEnabled && (
          <fieldset>
            <legend className={sectionLabelClass}>{t('vipDonations.donate.recipientTitle')}</legend>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
              {RECIPIENT_MODES.map((mode) => {
                const checked = recipient === mode;
                const Icon = mode === 'self' ? KeyRound : Gift;
                return (
                  <label
                    key={mode}
                    className={cn(
                      'group flex min-h-[2.75rem] cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-center text-sm font-medium transition-colors duration-150',
                      focusRingClass,
                      checked
                        ? 'bg-yellow-400/15 text-yellow-100 ring-1 ring-inset ring-yellow-400/40'
                        : 'text-white/65 hover:bg-white/[0.06] hover:text-white'
                    )}
                  >
                    <input
                      type="radio"
                      name={ids.recipient}
                      value={mode}
                      checked={checked}
                      onChange={() => handleRecipientChange(mode)}
                      className="sr-only"
                    />
                    {/* Couleur pleine + opacité sur l'icône : une couleur
                        translucide éclaircit les endroits où ses traits se
                        croisent (ruban du cadeau, anneau de la clé). Sa
                        propre couleur dans les deux états : héritée, elle
                        passerait par du translucide pendant la transition
                        du libellé. */}
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0 transition-opacity duration-150',
                        checked ? 'text-yellow-100' : 'text-white opacity-65 group-hover:opacity-100'
                      )}
                      aria-hidden="true"
                    />
                    {mode === 'self'
                      ? t('vipDonations.donate.recipientSelf')
                      : t('vipDonations.donate.recipientGift')}
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-5 text-white/55">
              {recipient === 'gift'
                ? t('vipDonations.donate.recipientGiftHint')
                : isGiftCard
                  ? t('vipDonations.donate.recipientSelfHintGiftCard')
                  : t('vipDonations.donate.recipientSelfHint')}
            </p>
          </fieldset>
        )}

        <fieldset>
          <legend className={sectionLabelClass}>{t('vipDonations.donate.methodTitle')}</legend>
          {selectableMethods.length === 0 ? (
            <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/65">
              {t('vipDonations.donate.noMethod')}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {selectableMethods.map((id) => {
                const { icon: Icon, logo, title, subtitle } = METHOD_COPY[id];
                const checked = id === activeMethod;
                return (
                  <label
                    key={id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-150',
                      focusRingClass,
                      checked
                        ? 'border-yellow-400/70 bg-yellow-400/[0.08]'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                    )}
                  >
                    <input
                      type="radio"
                      name={ids.method}
                      value={id}
                      checked={checked}
                      onChange={() => setMethod(id)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-150',
                        checked ? 'bg-yellow-400/15 text-yellow-300' : 'bg-white/[0.06] text-white'
                      )}
                    >
                      {logo
                        ? <CryptoLogo coin={logo} className="h-6 w-6" />
                        : Icon
                          ? <Icon className={cn('h-5 w-5 transition-opacity duration-150', !checked && 'opacity-65')} />
                          : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium leading-snug text-white">
                        {t(title)}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-white/55">
                        {t(subtitle)}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
                        checked ? 'border-yellow-400' : 'border-white/25'
                      )}
                    >
                      {checked && <span className="h-2 w-2 rounded-full bg-yellow-400" />}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {giftCardHiddenForGift && selectableMethods.length > 0 && (
            <p className="mt-2 text-xs leading-5 text-white/55">{t('vipDonations.donate.giftCardNotForGift')}</p>
          )}
        </fieldset>

        {activeMethod !== null && (
          <motion.div
            key={isGiftCard ? 'giftcard' : 'direct'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-8"
          >
            {isGiftCard ? (
              <GiftCardDonation settings={settings} exampleAmount={amount} />
            ) : (
              <>
                {needsEmail && (
                  <div>
                    <label htmlFor={ids.email} className={sectionLabelClass}>
                      {t('vipDonations.donate.emailLabel')}
                    </label>
                    <input
                      ref={emailInputRef}
                      id={ids.email}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      onBlur={() => {
                        if (email.trim() !== '' && !emailIsValid) {
                          setShowEmailError(true);
                        }
                      }}
                      placeholder={t('vipDonations.page.cryptogateEmailPlaceholder')}
                      aria-invalid={emailErrorVisible || undefined}
                      aria-describedby={ids.emailHint}
                      className={cn(
                        inputClass,
                        'mt-2 px-4',
                        emailErrorVisible ? 'border-red-400/60' : 'border-white/10'
                      )}
                    />
                    <p
                      id={ids.emailHint}
                      aria-live="polite"
                      className={cn('mt-1.5 text-xs leading-5', emailErrorVisible ? 'text-red-300' : 'text-white/55')}
                    >
                      {emailErrorVisible
                        ? t('vipDonations.donate.emailError')
                        : t('vipDonations.donate.emailHint')}
                    </p>
                  </div>
                )}

                {needsTurnstile && (
                  // Même nœud quel que soit le statut : le widget n'est pas
                  // recréé quand la dispense admin se résout. Rien à afficher
                  // pour un admin dispensé, le widget pose seul son marqueur.
                  <div hidden={turnstileStatus !== 'challenge'}>
                    <p className={sectionLabelClass}>{t('vipDonations.donate.robotCheck')}</p>
                    {/* 300 px de large : réduit sur les petits téléphones pour
                        ne jamais déborder de la carte. */}
                    <div className="mt-2 overflow-hidden">
                      <TurnstileWidget
                        action="vip_invoice_create"
                        resetSignal={turnstileResetSignal}
                        onTokenChange={setTurnstileToken}
                        className="origin-top-left max-[379px]:scale-90 max-[359px]:scale-[0.8]"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={isCreating || amount === null}
                    aria-busy={isCreating || undefined}
                    className="h-12 w-full gap-2 rounded-xl bg-yellow-400 font-semibold text-black shadow-yellow-500/15 hover:bg-yellow-300 focus-visible:ring-yellow-300/70 active:scale-[0.98]"
                  >
                    {isCreating
                      ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                      : <Heart className="h-5 w-5" aria-hidden="true" />}
                    {isCreating
                      ? t('vipDonations.donate.submitting')
                      : amount !== null
                        ? t('vipDonations.donate.submit', { amount: formatDonationAmount(locale, amount) })
                        : t('vipDonations.donate.submitNoAmount')}
                  </Button>
                  <div className="mt-3 space-y-1.5 text-xs leading-5 text-white/55">
                    {needsEmail && <p>{t('vipDonations.donate.newTabNote')}</p>}
                    <p>
                      {recipient === 'gift'
                        ? t('vipDonations.donate.afterSubmitGift')
                        : t('vipDonations.donate.afterSubmitSelf')}
                    </p>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </div>
    </form>
  );
};

export default DonationForm;
