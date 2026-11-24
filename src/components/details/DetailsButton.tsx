import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { cn } from '@/lib/utils';
import { DETAILS_FOCUS, DETAILS_PRESS } from './layout';

interface DetailsButtonLook {
  /** `primary` : bouton rouge (Regarder). `glass` : bouton translucide (Bande-annonce, Télécharger). */
  variant?: 'primary' | 'glass';
  /** `hero` : bouton principal de l'image. `default` : boutons voisins. `compact` : bandeaux, fenêtres, barre du téléphone. `bar` : bandeau collé de la barre de sections (dès 768 px). */
  size?: 'hero' | 'default' | 'compact' | 'bar';
  /** Icône lucide avant le texte. */
  icon?: ReactNode;
  /** Icône lucide après le texte (flèche d'un lien). */
  trailingIcon?: ReactNode;
  /** Texte secondaire après un filet : temps de reprise, pourcentage estimé. */
  detail?: ReactNode;
  /** Avancement de 0 à 1 : dessine la barre au bas du bouton. */
  progress?: number | null;
}

export type DetailsButtonProps = DetailsButtonLook & ButtonHTMLAttributes<HTMLButtonElement>;

export interface DetailsLinkButtonProps extends DetailsButtonLook {
  /** Route interne ouverte par le lien. */
  to: string;
  className?: string;
  children: ReactNode;
}

const SIZES = {
  hero: 'h-14 px-3 text-base md:h-[54px] md:px-[22px]',
  default: 'h-12 px-3 text-[15px] md:h-[54px] md:px-[22px] md:text-base',
  compact: 'h-12 px-[18px] text-[15px] md:h-[46px] md:px-[22px]',
  bar: 'h-10 rounded-full px-4 text-sm [&>svg]:size-4 md:gap-2',
} as const;

const VARIANTS = {
  primary: 'border-red-600 bg-red-600 hover:border-red-700 hover:bg-red-700',
  glass: 'border-white/[.22] bg-white/[.14] hover:bg-white/[.22]',
} as const;

const buttonClass = ({ variant = 'glass', size = 'default' }: DetailsButtonLook, className?: string) => cn(
  'relative inline-flex select-none items-center justify-center gap-[9px] overflow-hidden whitespace-nowrap rounded-[14px] border font-semibold text-white md:gap-2.5',
  '[&>svg]:size-5 [&>svg]:flex-none disabled:pointer-events-none disabled:opacity-50',
  DETAILS_PRESS,
  DETAILS_FOCUS,
  SIZES[size],
  VARIANTS[variant],
  className,
);

function ButtonContent({ icon, trailingIcon, detail, progress, children }: DetailsButtonLook & { children: ReactNode }) {
  const ratio = typeof progress === 'number' && Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : null;
  return (
    <>
      {icon}
      {children}
      {detail && (
        <small className="ml-0.5 border-l border-white/35 pl-[11px] text-[13px] font-medium tabular-nums opacity-90 md:pl-3">
          {detail}
        </small>
      )}
      {trailingIcon}
      {ratio !== null && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-black/35">
          <span className="block h-full bg-white" style={{ width: `${ratio * 100}%` }} />
        </span>
      )}
    </>
  );
}

/** Bouton des fiches : principal rouge avec temps et barre d'avancement, ou translucide. */
export const DetailsButton = forwardRef<HTMLButtonElement, DetailsButtonProps>(function DetailsButton(
  { variant, size, icon, trailingIcon, detail, progress, className, children, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass({ variant, size }, className)} {...rest}>
      <ButtonContent icon={icon} trailingIcon={trailingIcon} detail={detail} progress={progress}>{children}</ButtonContent>
    </button>
  );
});

/** Même habillage que `DetailsButton`, pour un lien vers une autre page du site. */
export function DetailsLinkButton({ to, variant, size, icon, trailingIcon, detail, progress, className, children }: DetailsLinkButtonProps) {
  return (
    <Link to={to} className={buttonClass({ variant, size }, className)}>
      <ButtonContent icon={icon} trailingIcon={trailingIcon} detail={detail} progress={progress}>{children}</ButtonContent>
    </Link>
  );
}

export default DetailsButton;
