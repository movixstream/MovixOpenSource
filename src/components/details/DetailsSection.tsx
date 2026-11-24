import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { DETAILS_FOCUS } from './layout';
import { DetailsLabelSwap } from './motion';

export interface DetailsSectionProps {
  /** Ancre de la section : cible de la barre de sections. */
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Section de la fiche. L'espace du haut fait partie du bloc ; la marge de
 * défilement arrête le titre juste sous l'en-tête et la barre de sections.
 * Dès 768 px, elle compte aussi le bandeau collé (56 px) que la barre fait
 * descendre au-dessus des onglets : titre à 200 px du haut de l'écran.
 */
export function DetailsSection({ id, className, children }: DetailsSectionProps) {
  return (
    <section
      id={id}
      className={cn('scroll-mt-[102px] pt-[34px] md:scroll-mt-[136px] md:pt-16 2xl:scroll-mt-[120px] 2xl:pt-20', className)}
    >
      {children}
    </section>
  );
}

/**
 * Recale une rangée `EmblaCarousel` sur la grille de la fiche : la rangée du
 * site rentre son titre et ses cartes de 4 px, puis 8 px dès `md`.
 */
export const DETAILS_CAROUSEL_ALIGN = '-mx-1 md:-mx-2';

/**
 * Titre d'une rangée `EmblaCarousel` posée dans une fiche (prop `title`) :
 * même taille que les autres titres de section.
 */
export function DetailsCarouselTitle({ children }: { children: ReactNode }) {
  return (
    <span className="text-xl font-bold leading-[1.2] tracking-[-0.01em] text-white md:text-2xl 2xl:text-[28px]">
      {children}
    </span>
  );
}

export interface DetailsSectionHeaderProps {
  title: string;
  /** Nombre affiché après le titre (commentaires). */
  count?: number | null;
  /** Contenu libre à droite ; prioritaire sur le lien « Tout voir ». */
  action?: ReactNode;
  /** Avec `onToggle` : affiche le lien « Tout voir » / « Réduire » de la section. */
  expanded?: boolean;
  onToggle?: () => void;
  /** Libellé du lien replié dès 768 px (par défaut « Tout voir »). */
  moreLabel?: string;
  /** Libellé du lien replié sous 768 px (par défaut « Tout voir »). */
  moreLabelShort?: string;
  /** Libellé du lien déplié (par défaut « Réduire »). */
  lessLabel?: string;
  /** Identifiant du bloc déplié, pour `aria-controls`. */
  controls?: string;
  className?: string;
}

/** En-tête de section : titre, nombre éventuel, et lien qui déplie la section sur place. */
export function DetailsSectionHeader({
  title, count, action, expanded = false, onToggle, moreLabel, moreLabelShort, lessLabel, controls, className,
}: DetailsSectionHeaderProps) {
  const { t } = useTranslation();
  const viewAll = t('details.viewAll', 'Tout voir');
  const collapsedShort = moreLabelShort ?? viewAll;
  const collapsedLong = moreLabel ?? collapsedShort;

  return (
    <div className={cn('mb-3.5 flex items-center justify-between gap-3 md:mb-[22px] md:gap-4', className)}>
      {/* `text-xl` reste dans la liste : le thème Halloween cible `h2.text-xl`. */}
      <h2 className="min-w-0 text-xl font-bold leading-[1.2] tracking-[-0.01em] text-white md:text-2xl 2xl:text-[28px]">
        {title}
        {/* `leading-none` : l'interligne de `text-sm` dépasserait celui du titre et
            l'en-tête grandirait d'un pixel quand le nombre arrive. */}
        {typeof count === 'number' && (
          <span className="ml-2 text-sm font-medium leading-none tracking-normal text-white/55 md:ml-2.5 md:text-[15px]">{count}</span>
        )}
      </h2>
      {action ?? (onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={controls}
          className={cn('group -my-2 inline-flex min-h-11 flex-none items-center gap-1 whitespace-nowrap rounded-md text-[13px] font-medium text-white md:gap-1.5 md:text-sm', DETAILS_FOCUS)}
        >
          <span className="relative text-white/70 transition-colors duration-200 group-hover:text-white motion-reduce:transition-none">
            <DetailsLabelSwap swapKey={expanded ? 'less' : 'more'} className="inline-block">
              {expanded ? (lessLabel ?? t('details.collapse', 'Réduire')) : (
                collapsedLong === collapsedShort ? collapsedShort : (
                  <>
                    <span className="md:hidden">{collapsedShort}</span>
                    <span className="hidden md:inline">{collapsedLong}</span>
                  </>
                )
              )}
            </DetailsLabelSwap>
          </span>
          {/* Une seule flèche qui pivote vers le haut une fois la section dépliée. */}
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-[15px] text-white opacity-70 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:opacity-100 motion-reduce:transition-none md:size-4',
              expanded && '-rotate-90',
            )}
          />
        </button>
      ))}
    </div>
  );
}

export default DetailsSection;
