import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Gift } from 'lucide-react';
import {
  getPendingReferralCode,
  getReferralConfig,
  normalizeReferralCode,
  setPendingReferralCode,
  type ReferralPublicConfig
} from '@/services/referralService';
import { formatDays } from './referralActions';

// Champ « code de parrainage » avant la connexion : menu de connexion (Google,
// Discord, phrase secrète) et création de compte. Le code est gardé dans ce
// navigateur ; ReferralManager l'envoie dès qu'un compte est connecté.

interface ReferralCodeFieldProps {
  /** `menu` : replié derrière un lien discret ; `form` : champ toujours visible. */
  variant: 'menu' | 'form';
  className?: string;
}

export default function ReferralCodeField({ variant, className = '' }: ReferralCodeFieldProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const hintId = useId();
  const [config, setConfig] = useState<ReferralPublicConfig | null>(null);
  const [value, setValue] = useState(() => getPendingReferralCode()?.code || '');
  const [open, setOpen] = useState(() => Boolean(getPendingReferralCode()));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let alive = true;
    getReferralConfig().then((next) => { if (alive) setConfig(next); });
    return () => { alive = false; };
  }, []);

  if (!config?.enabled) return null;

  const code = normalizeReferralCode(value);
  const invalid = touched && value.trim() !== '' && !code;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value.slice(0, 40);
    setValue(next);
    // Un code valide est gardé tout de suite ; un champ vidé efface le code gardé.
    if (normalizeReferralCode(next) || next.trim() === '') setPendingReferralCode(next, 'field');
  };

  const hint = invalid
    ? t('referral.field.invalid')
    : code
      ? t('referral.field.saved')
      : t('referral.field.hint', { days: formatDays(t, config.rewardDays) });

  const field = (
    <div className={variant === 'menu' ? 'px-1 pt-1' : ''}>
      {variant === 'menu' ? (
        <label htmlFor={inputId} className="mb-1.5 flex items-center gap-2 px-1 text-[13px] text-white/55">
          <Gift className="h-4 w-4 shrink-0 text-white opacity-60" aria-hidden="true" />
          {t('referral.field.label')}
        </label>
      ) : (
        <label htmlFor={inputId} className="mb-2 block text-sm font-medium text-gray-300">
          {t('referral.field.label')}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={handleChange}
          onBlur={() => setTouched(true)}
          placeholder={t('referral.field.placeholder')}
          aria-invalid={invalid || undefined}
          aria-describedby={hintId}
          className={
            variant === 'menu'
              ? 'h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 pr-9 text-[15px] uppercase tracking-[0.12em] text-white placeholder:normal-case placeholder:tracking-normal placeholder:text-white/35 focus:border-white/30 focus:outline-none'
              : 'w-full rounded-xl border border-gray-700 bg-gray-800/70 px-4 py-3 pr-11 uppercase tracking-[0.12em] text-white outline-none transition-all duration-300 placeholder:normal-case placeholder:tracking-normal focus:ring-2 focus:ring-red-500'
          }
        />
        {code && (
          <Check
            className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400 ${variant === 'menu' ? 'right-3' : 'right-4'}`}
            aria-hidden="true"
          />
        )}
      </div>
      <p id={hintId} className={`mt-1.5 text-xs leading-relaxed ${invalid ? 'text-red-300' : 'text-white/45'}`} aria-live="polite">
        {hint}
      </p>
    </div>
  );

  if (variant === 'form') return <div className={className}>{field}</div>;

  return (
    <div data-sheet-item className={className}>
      {open ? field : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Gift className="h-4 w-4 shrink-0 text-white opacity-60" aria-hidden="true" />
          <span>{t('referral.field.toggle')}</span>
        </button>
      )}
    </div>
  );
}
