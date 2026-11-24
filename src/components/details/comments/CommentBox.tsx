import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import MarkdownToolbar from '@/components/MarkdownToolbar';
import { cn } from '@/lib/utils';
import { DetailsButton } from '../DetailsButton';
import { commentMarkdownComponents } from './markdownComponents';

/** Longueur maximale d'un commentaire ou d'une réponse, la même que côté serveur. */
export const COMMENT_MAX_LENGTH = 500;

export interface CommentBoxProps {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Nom accessible du champ. */
  label: string;
  spoiler: boolean;
  onSpoilerChange: (spoiler: boolean) => void;
  submitLabel: string;
  onSubmit: () => void;
  /** Envoi bloqué (vérification en attente, limite atteinte). Un champ vide le bloque déjà. */
  disabled?: boolean;
  /** `reply` : champ plus bas, qui prend le curseur à l'ouverture. */
  variant?: 'comment' | 'reply';
  /** Ligne au-dessus du champ (« Répondre à @… »). */
  header?: ReactNode;
  /** Bloc entre le champ et la barre du bas (vérification anti-robot). */
  children?: ReactNode;
  className?: string;
}

/** Case « Spoiler » : une vraie case à cocher, dessinée aux couleurs des fiches. */
function SpoilerCheck({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <label className="group inline-flex min-h-11 cursor-pointer select-none items-center gap-2 md:min-h-0">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={cn(
          'flex size-[18px] flex-none items-center justify-center rounded-[5px] border border-white/35',
          'transition-colors duration-200 group-hover:border-white/60 motion-reduce:transition-none',
          'peer-checked:border-red-600 peer-checked:bg-red-600 peer-focus-visible:ring-2 peer-focus-visible:ring-white',
          '[&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100',
        )}
      >
        <Check className="size-3 text-white transition-opacity duration-150 motion-reduce:transition-none" strokeWidth={3} />
      </span>
      <span className="transition-colors duration-200 group-hover:text-white peer-checked:text-white motion-reduce:transition-none">
        {t('common.spoiler')}
      </span>
    </label>
  );
}

/**
 * Champ de saisie des fiches : texte, mise en forme, puis une barre avec la
 * case « Spoiler », le compteur et le bouton d'envoi. Ctrl + Entrée envoie.
 */
export function CommentBox({
  textareaRef, value, onChange, placeholder, label, spoiler, onSpoilerChange, submitLabel, onSubmit,
  disabled = false, variant = 'comment', header, children, className,
}: CommentBoxProps) {
  const blocked = disabled || !value.trim() || value.length > COMMENT_MAX_LENGTH;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || blocked) return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[.12] bg-white/[.04] p-3.5 transition-colors duration-200 focus-within:border-white/30 motion-reduce:transition-none md:p-4',
        className,
      )}
    >
      {header}
      {/* 16 px sous 768 px : en dessous, Safari sur iPhone zoome dans le champ. */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={label}
        maxLength={COMMENT_MAX_LENGTH}
        autoFocus={variant === 'reply'}
        className={cn(
          'block w-full resize-none border-0 bg-transparent p-0 text-base leading-normal text-white placeholder:text-white/45 focus:outline-none focus:ring-0 md:text-[15px]',
          variant === 'reply' ? 'h-14' : 'h-[72px] md:h-24',
        )}
      />
      <div className="mt-1.5">
        <MarkdownToolbar
          textareaRef={textareaRef}
          value={value}
          onChange={onChange}
          maxLength={COMMENT_MAX_LENGTH}
          tone="details"
          markdownComponents={commentMarkdownComponents}
        />
      </div>
      {children}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-white/[.12] pt-2.5 text-[13px] text-white/60 md:mt-3 md:gap-x-4 md:pt-3">
        <SpoilerCheck checked={spoiler} onChange={onSpoilerChange} />
        <span className={cn('tabular-nums', value.length >= COMMENT_MAX_LENGTH && 'text-red-400')}>
          {value.length} / {COMMENT_MAX_LENGTH}
        </span>
        <DetailsButton
          variant="primary"
          size="compact"
          onClick={onSubmit}
          disabled={blocked}
          className="ml-auto h-11 rounded-xl px-[18px] text-sm md:h-10 md:rounded-[10px] md:px-[18px] md:text-sm"
        >
          {submitLabel}
        </DetailsButton>
      </div>
    </div>
  );
}

export default CommentBox;
