import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useMediaColor } from '@/hooks/useMediaColor';
import { DetailsHeroBackdrop } from './DetailsHeroBackdrop';
import { DETAILS_GRID } from './layout';

export interface DetailsHeroProps {
  /** Image de fond (arrière-plan TMDB) ; sans elle le haut de page reste noir. */
  backdropUrl?: string | null;
  /** Visuel au-dessus des pastilles (portrait d'une personne). */
  media?: ReactNode;
  /** Pastilles au-dessus du titre (`DetailsPill`). */
  pills?: ReactNode;
  /** Titre : `DetailsTitle` (logo ou h1). */
  title: ReactNode;
  /** Ligne d'infos sous le titre (`DetailsMetaLine`). */
  meta?: ReactNode;
  /** Petit texte sous la ligne d'infos (note de sortie, etc.). */
  note?: ReactNode;
  /** Synopsis court (`DetailsSynopsis`). */
  synopsis?: ReactNode;
  /** Boutons principaux (`DetailsButton`). */
  actions?: ReactNode;
  /** Boutons discrets (`DetailsActionRow`). */
  secondaryActions?: ReactNode;
  /** Pouces : en bas à droite de l'image dès 768 px, sous le synopsis avant. */
  votes?: ReactNode;
  className?: string;
}

/**
 * Grande image du haut de la fiche. Elle passe sous l'en-tête fixe du site.
 * Sous 768 px l'image fait 520 px de haut et ne porte que pastilles, titre et
 * infos ; boutons, synopsis et pouces suivent sur fond noir. Au-delà, tout
 * tient dans l'image, en bas à gauche, et l'image continue sous la barre de
 * sections posée juste après (`DetailsSectionNav`, toujours présente sur les
 * fiches film et série). Un seul arbre DOM pour les deux cas : chaque
 * emplacement n'est monté qu'une fois.
 */
export function DetailsHero({
  backdropUrl, media, pills, title, meta, note, synopsis, actions, secondaryActions, votes, className,
}: DetailsHeroProps) {
  // Teinte de l'image, comme le HeroSlider : mêmes réglages (Apparence →
  // couleurs du hero), donc rien si l'utilisateur l'a coupée.
  const palette = useMediaColor('hero', backdropUrl ?? null, Boolean(backdropUrl), true);
  return (
    <section
      className={cn(
        // Ni `isolate` ni `z-index` ici : une fenêtre `fixed` ouverte depuis un
        // bouton de l'image (partage) doit rester au-dessus de l'en-tête.
        'relative bg-black md:flex md:min-h-[560px] md:items-end xl:min-h-[680px] min-[1440px]:min-h-[760px] 2xl:min-h-[820px] min-[1700px]:min-h-[900px]',
        className,
      )}
    >
      <DetailsHeroBackdrop
        image={backdropUrl ? { src: backdropUrl } : null}
        phoneHeight="520px"
        positionClass="object-[50%_20%] md:object-[50%_22%]"
        phoneFadeClass="h-[72%]"
        drip="sectionNav"
        dripColor={palette?.color}
      >
        {/* Lueur colorée du HeroSlider, posée sur l'image mais sous les voiles
            noirs : elle teinte l'image sans éclaircir le noir. Posée au-dessus,
            une couleur claire donnait un voile laiteux puis une coupure nette
            là où un masque l'éteignait. */}
        {palette && <div className="absolute inset-0" style={{ background: palette.heroGradient }} />}
        {/* Voile de gauche : lisibilité du texte posé sur l'image. */}
        <div className="absolute inset-0 hidden bg-gradient-to-r from-black/85 via-black/50 via-60% to-black/30 md:block lg:from-black/[.92] lg:via-black/[.72] lg:via-30% lg:to-transparent lg:to-[68%]" />
      </DetailsHeroBackdrop>

      <div
        className={cn(
          DETAILS_GRID,
          'relative flex w-full flex-col gap-2.5 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-8 md:pb-9 md:pt-[120px]',
        )}
      >
        <div className="contents md:flex md:max-w-full md:flex-col md:gap-[18px] lg:max-w-[680px] 2xl:max-w-[720px] 2xl:gap-[22px]">
          <div className="mb-1.5 flex min-h-[520px] flex-col justify-end gap-3 pb-0.5 pt-20 md:order-1 md:mb-0 md:min-h-0 md:gap-[18px] md:p-0 2xl:gap-[22px]">
            {media}
            {pills && <div className="flex flex-wrap gap-1.5 md:gap-2">{pills}</div>}
            {title}
            {meta}
            {note}
          </div>
          {actions && <div className="md:order-3 md:mt-1.5">{actions}</div>}
          {secondaryActions && <div className="mt-1.5 md:order-4 md:mt-0">{secondaryActions}</div>}
          {synopsis && <div className="mt-2.5 md:order-2 md:mt-0">{synopsis}</div>}
        </div>
        {votes && (
          // Les boutons de vote prennent la forme des pastilles de la maquette.
          <div className="mt-1 md:mb-1 md:mt-0 [&_button]:min-h-11 [&_button]:rounded-full [&_button]:border [&_button]:border-white/[.18] [&_button]:font-semibold">
            {votes}
          </div>
        )}
      </div>
    </section>
  );
}

export default DetailsHero;
