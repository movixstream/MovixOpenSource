import React, { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Info, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input, type InputProps } from '../ui/input';
import { Switch } from '../ui/switch';
import { parseIntegerInput } from './vipDonationSettingsForm';

// Anneau de focus doré pour tout le panneau (les champs du site sont en rouge).
export const settingsInputClass = 'focus-visible:ring-amber-400/50';
export const invalidInputClass = 'border-red-400/50 bg-red-500/[0.06] hover:bg-red-500/[0.08] focus:bg-red-500/[0.1]';

interface SettingsSectionProps {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  modifiedLabel?: string | null;
  children: React.ReactNode;
  className?: string;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  id,
  icon: Icon,
  title,
  description,
  modifiedLabel,
  children,
  className
}) => (
  <section
    id={id}
    aria-labelledby={`${id}-title`}
    className={cn('scroll-mt-24 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5', className)}
  >
    <div className="mb-4 flex items-start gap-3">
      <div className="shrink-0 rounded-xl bg-amber-400/10 p-2.5 ring-1 ring-amber-300/20">
        <Icon className="h-5 w-5 text-amber-300" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${id}-title`} className="text-base font-semibold text-white sm:text-lg">{title}</h3>
          {modifiedLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
              {modifiedLabel}
            </span>
          )}
        </div>
        {description && <p className="mt-1 text-sm leading-6 text-white/55">{description}</p>}
      </div>
    </div>
    {children}
  </section>
);

interface SettingsFieldProps {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  warning?: string | null;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

// Le message (erreur, avertissement ou aide) porte l'id `${id}-message`,
// à relier au champ via `aria-describedby`.
export const SettingsField: React.FC<SettingsFieldProps> = ({
  id,
  label,
  hint,
  error,
  warning,
  aside,
  children,
  className
}) => {
  const message = error || warning || hint;

  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1.5 flex items-end justify-between gap-3">
        <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wider text-white/50">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {message && (
        <p
          id={`${id}-message`}
          className={cn(
            'mt-1.5 flex items-start gap-1.5 text-xs leading-5',
            error ? 'text-red-300' : warning ? 'text-amber-200/90' : 'text-white/40'
          )}
        >
          {/* Avertissement en ambre translucide : couleur pleine + opacité sur
              l'icône, pour que ses tracés ne se cumulent pas en plus clair. */}
          {(error || warning) && (
            <AlertTriangle
              className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', !error && 'text-amber-200 opacity-90')}
              aria-hidden="true"
            />
          )}
          <span className="min-w-0">{message}</span>
        </p>
      )}
    </div>
  );
};

interface ToggleRowProps {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export const ToggleRow: React.FC<ToggleRowProps> = ({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className
}) => (
  <div className={cn('flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-black/20 p-4', className)}>
    <div className="min-w-0">
      <label htmlFor={id} className="cursor-pointer text-sm font-semibold text-white">
        {label}
      </label>
      {description && <p className="mt-1 text-xs leading-5 text-white/50">{description}</p>}
    </div>
    <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
  </div>
);

type NoticeTone = 'info' | 'warning' | 'danger';

// Texte translucide : l'icône reçoit la couleur pleine et l'opacité à part,
// sinon ses tracés se superposent en points plus clairs.
const NOTICE_TONES: Record<NoticeTone, { className: string; icon: LucideIcon; iconClassName?: string }> = {
  info: { className: 'border-white/10 bg-white/[0.04] text-white/65', icon: Info, iconClassName: 'text-white opacity-65' },
  warning: { className: 'border-amber-400/30 bg-amber-500/10 text-amber-100', icon: AlertTriangle },
  danger: { className: 'border-red-400/35 bg-red-500/10 text-red-100', icon: AlertTriangle }
};

export const SettingsNotice: React.FC<{ tone: NoticeTone; children: React.ReactNode; className?: string }> = ({
  tone,
  children,
  className
}) => {
  const { className: toneClassName, icon: Icon, iconClassName } = NOTICE_TONES[tone];

  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-6', toneClassName, className)}>
      <Icon className={cn('mt-1 h-4 w-4 shrink-0', iconClassName)} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
};

interface IntegerInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'inputMode'> {
  value: number;
  onValueChange: (next: number) => void;
  suffix?: string;
  invalid?: boolean;
}

const toIntegerText = (value: number) => (Number.isFinite(value) ? String(value) : '');
const isSameInteger = (a: number, b: number) => (Number.isNaN(a) && Number.isNaN(b)) || a === b;

// Champ entier : garde le texte tapé (même invalide) et remonte NaN tant qu'il
// ne forme pas un entier, pour que la validation l'affiche au lieu de le corriger.
export const IntegerInput: React.FC<IntegerInputProps> = ({
  value,
  onValueChange,
  suffix,
  invalid,
  className,
  onBlur,
  ...props
}) => {
  const [text, setText] = useState(() => toIntegerText(value));

  // Valeur changée de l'extérieur (annulation, valeurs par défaut) : resynchroniser.
  useEffect(() => {
    setText((current) => (isSameInteger(parseIntegerInput(current), value) ? current : toIntegerText(value)));
  }, [value]);

  return (
    <div className="relative">
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setText(event.target.value);
          onValueChange(parseIntegerInput(event.target.value));
        }}
        onBlur={(event) => {
          const parsed = parseIntegerInput(text);
          if (Number.isFinite(parsed)) {
            setText(String(parsed));
          }
          onBlur?.(event);
        }}
        className={cn(settingsInputClass, 'tabular-nums', suffix && 'pr-9', invalid && invalidInputClass, className)}
      />
      {suffix && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-white/40">
          {suffix}
        </span>
      )}
    </div>
  );
};

interface TestLinkProps {
  href: string | null;
  label: string;
  // Nom accessible plus précis que le libellé visible (plusieurs liens identiques).
  ariaLabel?: string;
  showLabel?: boolean;
}

// Lien de test à côté d'un champ ; grisé tant que la valeur n'est pas exploitable.
// L'icône ne reprend pas le blanc translucide du lien (tracés cumulés en plus
// clair) : couleur pleine, opacité sur l'icône, et survol via `group-hover`.
export const TestLink: React.FC<TestLinkProps> = ({ href, label, ariaLabel, showLabel = false }) => {
  const sizeClassName = showLabel ? 'h-10 gap-1.5 px-3 text-sm' : 'h-10 w-10';

  if (!href) {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-flex shrink-0 items-center justify-center rounded-lg border border-white/5 text-white/20', sizeClassName)}
      >
        <ExternalLink className="h-4 w-4 text-white opacity-20" />
        {showLabel && <span>{label}</span>}
      </span>
    );
  }

  const isMailto = href.startsWith('mailto:');

  return (
    <a
      href={href}
      target={isMailto ? undefined : '_blank'}
      rel={isMailto ? undefined : 'noopener noreferrer'}
      title={ariaLabel ?? label}
      aria-label={ariaLabel ?? (showLabel ? undefined : label)}
      className={cn(
        'group inline-flex shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/65 transition-colors',
        'hover:border-white/25 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50',
        sizeClassName
      )}
    >
      <ExternalLink className="h-4 w-4 text-white opacity-65 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      {showLabel && <span>{label}</span>}
    </a>
  );
};
