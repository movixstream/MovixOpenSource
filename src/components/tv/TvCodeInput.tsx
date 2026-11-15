import { useContext } from 'react';
import { OTPInput, OTPInputContext } from 'input-otp';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { TV_CODE_ALPHABET, TV_CODE_LENGTH, sanitizeTvCode } from '@/services/tvLinkService';
import { FocusBrackets } from './FocusBrackets';
import { TV_EASE } from './tvMotion';

/*
 * Saisie du code de la télé en 5 cases, adaptée de « AnimatedOTPInput » de
 * SmoothUI (Eduardo Calvo, https://smoothui.dev/docs/components/otp-slots,
 * registre https://smoothui.dev/r/animated-o-t-p-input.json, dépôt
 * educlopez/smoothui au commit d48a89e3). Licence MIT.
 * Copyright (c) 2024 Eduardo Calvo.
 *
 * Construite sur le paquet `input-otp` (Guilherme Rodz, MIT) : un seul vrai
 * champ, accessible, avec collage et autoremplissage.
 *
 * Adaptations pour Movix :
 * - framer-motion 11 du projet au lieu de motion 12 ;
 * - alphabet des codes télé (pas de 0/O ni 1/I/L), minuscules acceptées puis
 *   mises en majuscules, collage d'un lien complet `…/tv?code=K7P2Q` ;
 * - clavier texte sur téléphone (input-otp ouvre le pavé numérique par défaut) ;
 * - la case active porte les crochets du logo, qui glissent de case en case
 *   comme le focus de l'appli télé ; pas de séparateur (5 caractères).
 */

const CODE_PATTERN = `^[${TV_CODE_ALPHABET}${TV_CODE_ALPHABET.toLowerCase()}]+$`;

interface SlotProps {
  index: number;
  invalid: boolean;
  calm: boolean;
}

function CodeSlot({ index, invalid, calm }: SlotProps) {
  const context = useContext(OTPInputContext);
  const slot = context?.slots[index];
  const char = slot?.char ?? null;
  const isActive = Boolean(slot?.isActive);

  return (
    <motion.div
      initial={calm ? false : { opacity: 0, y: 10, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={calm ? { duration: 0 } : { delay: index * 0.05, duration: 0.22, ease: TV_EASE }}
      className={cn(
        'relative flex h-16 w-12 items-center justify-center rounded-xl font-mono text-3xl font-bold uppercase text-white transition-colors sm:h-20 sm:w-16 sm:text-4xl',
        isActive ? 'bg-white/[0.1]' : char ? 'bg-white/[0.07]' : 'bg-white/[0.04]',
        invalid ? 'ring-2 ring-inset ring-red-500/70' : 'ring-1 ring-inset ring-white/10',
      )}
    >
      {isActive && (
        <FocusBrackets layoutId="tv-code-focus" size="sm" transition={{ duration: 0.22, ease: TV_EASE }} />
      )}
      <AnimatePresence mode="wait" initial={false}>
        {char ? (
          <motion.span
            key={char}
            initial={calm ? false : { opacity: 0, rotateX: -80, y: -4 }}
            animate={{ opacity: 1, rotateX: 0, y: 0 }}
            exit={calm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, rotateX: 80, y: 4 }}
            transition={{ duration: calm ? 0 : 0.18, ease: TV_EASE }}
            style={{ transformPerspective: 400 }}
          >
            {char}
          </motion.span>
        ) : null}
      </AnimatePresence>
      {slot?.hasFakeCaret && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute h-8 w-0.5 rounded-full bg-red-500 sm:h-10',
            calm ? '' : 'animate-[tv-caret_1s_steps(1,end)_infinite]',
          )}
        />
      )}
    </motion.div>
  );
}

interface TvCodeInputProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  calm: boolean;
  label: string;
  describedBy?: string;
  autoFocus?: boolean;
}

export function TvCodeInput({
  value,
  onChange,
  disabled,
  invalid = false,
  calm,
  label,
  describedBy,
  autoFocus,
}: TvCodeInputProps) {
  return (
    <>
      <style>{'@keyframes tv-caret{0%,100%{opacity:1}50%{opacity:0}}'}</style>
      <LayoutGroup id="tv-code-input">
        <OTPInput
          value={value}
          onChange={(next) => onChange(sanitizeTvCode(next))}
          maxLength={TV_CODE_LENGTH}
          pattern={CODE_PATTERN}
          pasteTransformer={sanitizeTvCode}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          containerClassName="flex items-center justify-center gap-2 has-[:disabled]:opacity-60 sm:gap-3"
          className="disabled:cursor-not-allowed"
        >
          {Array.from({ length: TV_CODE_LENGTH }, (_, index) => (
            <CodeSlot key={index} index={index} invalid={invalid} calm={calm} />
          ))}
        </OTPInput>
      </LayoutGroup>
    </>
  );
}

export default TvCodeInput;
