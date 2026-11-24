import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DETAILS_FOCUS, DETAILS_PRESS } from './layout';

export interface DetailsActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Icône lucide (le composant, pas un élément). */
  icon: LucideIcon;
  /** Libellé affiché dès 768 px, et nom accessible du bouton. */
  label: string;
  /** Libellé plus court sous 768 px (« Liste » pour « Ajouter à une liste »). */
  shortLabel?: string;
  /** État activé (dans la liste, en favori, vu) : icône rouge. */
  active?: boolean;
  /** Remplit l'icône quand le bouton est activé (signet, cœur). */
  fillWhenActive?: boolean;
}

const ACTION_CLASS = cn(
  'flex min-h-[60px] min-w-0 flex-col items-center gap-1.5 rounded-[10px] py-2 text-xs font-medium text-white hover:bg-white/10',
  'md:inline-flex md:h-11 md:min-h-0 md:flex-row md:gap-2 md:px-3 md:py-0 md:text-sm',
  DETAILS_PRESS,
  DETAILS_FOCUS,
);

/** Icône et libellé, communs au bouton et au lien. */
function ActionContent({ icon: Icon, label, shortLabel, active = false, fillWhenActive = false }: Pick<DetailsActionButtonProps, 'icon' | 'label' | 'shortLabel' | 'active' | 'fillWhenActive'>) {
  return (
    <>
      <Icon
        aria-hidden="true"
        className={cn(
          'size-[22px] flex-none transition-[color,opacity] duration-200 motion-reduce:transition-none md:size-[18px]',
          active ? 'text-red-500 opacity-100' : 'text-white opacity-[.85] md:opacity-75',
          active && fillWhenActive && 'fill-current',
        )}
      />
      {shortLabel ? (
        <>
          <span className="max-w-full truncate md:hidden">{shortLabel}</span>
          <span className="hidden md:inline">{label}</span>
        </>
      ) : (
        <span className="max-w-full truncate">{label}</span>
      )}
    </>
  );
}

/**
 * Bouton discret avec icône et libellé : À voir, Favoris, Vu, Liste, Partager.
 * Icône au-dessus du libellé sous 768 px, à gauche au-delà.
 */
export const DetailsActionButton = forwardRef<HTMLButtonElement, DetailsActionButtonProps>(function DetailsActionButton(
  { icon, label, shortLabel, active = false, fillWhenActive = false, className, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={shortLabel ? label : undefined}
      className={cn(ACTION_CLASS, className)}
      {...rest}
    >
      <ActionContent icon={icon} label={label} shortLabel={shortLabel} active={active} fillWhenActive={fillWhenActive} />
    </button>
  );
});

export interface DetailsActionLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'href'> {
  /** Adresse externe, ouverte dans un nouvel onglet. */
  href: string;
  icon: LucideIcon;
  label: string;
  shortLabel?: string;
}

/** Lien externe à l'allure de `DetailsActionButton` (IMDb, TMDB, réseaux d'une personne). */
export function DetailsActionLink({ href, icon, label, shortLabel, className, ...rest }: DetailsActionLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={shortLabel ? label : undefined}
      className={cn(ACTION_CLASS, className)}
      {...rest}
    >
      <ActionContent icon={icon} label={label} shortLabel={shortLabel} />
    </a>
  );
}

export interface DetailsActionRowProps {
  /** Nombre de colonnes sous 768 px (un bouton par colonne). */
  columns?: 3 | 4 | 5 | 6;
  className?: string;
  children: ReactNode;
}

const COLUMNS = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6' } as const;

/** Rangée de `DetailsActionButton` : grille sous 768 px, ligne qui se replie au-delà. */
export function DetailsActionRow({ columns = 5, className, children }: DetailsActionRowProps) {
  return (
    <div className={cn('-mx-1.5 grid md:mx-0 md:-ml-3 md:flex md:flex-wrap md:items-center md:gap-0.5', COLUMNS[columns], className)}>
      {children}
    </div>
  );
}

/**
 * Indication glissée dans une `DetailsActionRow` (« Vu sur un autre appareil ») :
 * à la suite du bouton dès 768 px, sur sa propre ligne en dessous avant.
 */
export function DetailsActionNote({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('order-last col-span-full flex justify-center md:order-none md:col-auto md:justify-start', className)}>
      {children}
    </div>
  );
}

export interface DetailsBarIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Nom accessible et bulle au survol : le bouton n'a pas de texte. */
  label: string;
  /** État activé (dans la liste, en favori) : icône rouge. */
  active?: boolean;
  /** Remplit l'icône quand le bouton est activé (signet, cœur). */
  fillWhenActive?: boolean;
}

/** Bouton rond, icône seule : bandeau collé de la barre de sections. */
export function DetailsBarIconButton({
  icon: Icon, label, active = false, fillWhenActive = false, className, type = 'button', ...rest
}: DetailsBarIconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-10 flex-none items-center justify-center rounded-full border border-white/[.18] bg-white/10 text-white hover:bg-white/20',
        DETAILS_PRESS,
        DETAILS_FOCUS,
        className,
      )}
      {...rest}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'size-[18px] transition-colors duration-200 motion-reduce:transition-none',
          active ? 'text-red-500' : 'text-white',
          active && fillWhenActive && 'fill-current',
        )}
      />
    </button>
  );
}

export default DetailsActionButton;
