import { useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  DETAILS_HERO_DRIP, DETAILS_HERO_DRIP_FADE, DETAILS_HERO_DRIP_FADE_TOP, DETAILS_HERO_DRIP_TINT, DETAILS_HERO_FADE, DETAILS_HERO_SMEAR_MASK,
  DETAILS_HERO_SMEAR_MASK_UNDER_NAV, DETAILS_HERO_SMEAR_STRETCH,
} from './layout';
import { DetailsHeroDrips } from './DetailsHeroDrips';
import { dripDitherMask } from './dripDither';
import { useDripDither } from './useDripDither';

export interface DetailsHeroBackdropProps {
  /** Image de fond (`src`, et `srcSet` + `sizes` si connus) ; sans elle, le haut de page reste noir. */
  image?: { src: string; srcSet?: string; sizes?: string } | null;
  /** Hauteur de l'image sous 768 px (`'520px'`) ; au-delà elle couvre toute la section. */
  phoneHeight: string;
  /** Cadrage de l'image (`object-[…]`), repris par sa copie floue. */
  positionClass: string;
  /** Hauteur du voile du bas sous 768 px (`h-[…]`), sans coulure seulement. */
  phoneFadeClass: string;
  /** Calques posés sur l'image, sous le voile du bas : teinte, voile de gauche. */
  children?: ReactNode;
  /**
   * La coulure sort de la section (sous 768 px, du bas de l'image) et coule
   * encore 640 px dans le haut de la page avant de s'éteindre (`DETAILS_HERO_DRIP`,
   * `DETAILS_HERO_DRIP_FADE`). Le contenu qui suit doit être positionné
   * (`relative`) pour passer au-dessus.
   * - `'sectionNav'` : la barre de sections (`DetailsSectionNav`) suit la
   *   section. L'image nette continue sous ses onglets (`md:h-14`, 56 px)
   *   jusqu'à son filet, et seule la coulure passe sous le trait.
   * - `'section'` : rien entre la section et la page (sagas) ; l'image
   *   s'arrête au bas de la section, la coulure continue dessous.
   * Sans valeur, tout s'éteint dans la section.
   */
  drip?: 'sectionNav' | 'section';
  /**
   * Couleur de l'image (`useMediaColor`, `#rrggbb`) : la coulure garde ses
   * filets, multipliés peu à peu par cette couleur (`DETAILS_HERO_DRIP_TINT`).
   * En bas, elle n'est donc jamais plus claire que la couleur : avec une
   * image claire, la coulure restait claire sous le texte blanc. Sans couleur (réglage coupé), la
   * coulure garde les couleurs de l'image.
   */
  dripColor?: string | null;
}

/**
 * Fond de la grande image des fiches film, série et saga : l'image, sa coulure
 * dans le bas, les calques de la page, puis le voile qui fond le tout dans le
 * noir de la page. À poser en premier enfant d'une section `relative`.
 *
 * La coulure est un simple décor : le mode léger la retire
 * (`html[data-no-blur]`, voir `light-mode.css`) et il reste le voile seul.
 *
 * Fin de la coulure (`drip`) : un voile CSS ne laisse près du noir que les
 * niveaux 3, 2, 1 puis 0, en larges bandes visibles sur un écran OLED. Dès
 * que l'image est lue, un canevas peint donc cette fin pixel par pixel, avec
 * un vrai tramage (`dripCanvas.ts`, `useDripDither`). Les pièces du fond
 * portent `data-details-hero-part` : tout autre enfant est un calque de la
 * page, que le canevas doit connaître pour estimer la couleur sous le voile.
 */
export function DetailsHeroBackdrop({
  image, phoneHeight, positionClass, phoneFadeClass, children, drip, dripColor,
}: DetailsHeroBackdropProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dithered = useDripDither(frameRef, canvasRef, drip && image ? image.src : null, children, dripColor);
  // Avec la coulure, le fond descend jusqu'à son bout, mais l'image garde la
  // boîte qu'elle aurait sans elle (`DETAILS_HERO_DRIP`).
  return (
    <div
      ref={frameRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 overflow-hidden',
        drip ? DETAILS_HERO_DRIP.frame[drip] : 'h-[var(--details-hero-phone-h)] md:h-full',
      )}
      style={{ '--details-hero-phone-h': phoneHeight } as CSSProperties}
    >
      {image && (
        <>
          <img
            data-details-backdrop
            data-details-hero-part
            {...image}
            alt=""
            decoding="async"
            draggable={false}
            className={cn('absolute inset-0 h-full w-full object-cover', drip && DETAILS_HERO_DRIP.image, positionClass)}
          />
          {/* Coulure : même image, même cadrage, étirée en hauteur autour de la
              couture (`DETAILS_HERO_SMEAR_STRETCH`) puis floutée. Le flou est
              posé sur un cadre de la taille de l'image qui dépasse de 48 px en
              bas : le bord du flou, qui s'efface, tombe hors de vue au lieu de
              laisser voir l'image nette dessous. Posé sur l'image étirée, le
              flou serait calculé sur une surface 40 fois plus haute. Dès
              768 px, le flou reste léger : assez pour lisser le grain, pas
              assez pour effacer les filets de couleur qui coulent. */}
          <div
            data-details-hero-soft
            data-details-hero-part
            className={cn(
              'absolute inset-x-0 bottom-0 isolate h-1/2 overflow-hidden',
              drip ? cn(DETAILS_HERO_DRIP.smear, DETAILS_HERO_SMEAR_MASK_UNDER_NAV) : DETAILS_HERO_SMEAR_MASK,
            )}
          >
            <div
              className={cn(
                'absolute inset-x-0 -bottom-12 h-[calc(200%+3rem)] blur-lg md:blur-[10px]',
                drip && DETAILS_HERO_DRIP.blur,
              )}
            >
              <img
                {...image}
                alt=""
                decoding="async"
                draggable={false}
                className={cn(
                  'absolute inset-x-0 top-0 h-[calc(100%-3rem)] w-full object-cover',
                  drip && DETAILS_HERO_DRIP.smearImage,
                  positionClass,
                  DETAILS_HERO_SMEAR_STRETCH,
                )}
              />
            </div>
            {/* Teinte de la coulure : les filets multipliés par la couleur de
                l'image, du blanc (rien ne change) à la couleur pleine
                (`DETAILS_HERO_DRIP_TINT`). Le cadre est isolé : le mélange ne
                touche que la coulure. */}
            {dripColor && (
              <div
                className="absolute inset-0 mix-blend-multiply"
                style={{
                  backgroundImage: `linear-gradient(to bottom, #fff calc(100% - ${DETAILS_HERO_DRIP_TINT.fromRem}rem), ${dripColor} calc(100% - ${DETAILS_HERO_DRIP_TINT.toRem}rem))`,
                }}
              />
            )}
          </div>
        </>
      )}
      {children}
      {/* Voile du bas. Deux éléments, un par taille : un `md:via-*` posé sur le
          premier remettrait la fin du dégradé en transparent, et l'image
          reparaîtrait tout en bas. */}
      {!drip && <div data-details-hero-part className={cn('absolute inset-x-0 bottom-0 bg-gradient-to-b from-transparent via-black/85 via-60% to-black md:hidden', phoneFadeClass)} />}
      {/* Bout de la coulure en gouttes, sous le voile. Une fois le canevas
          tramé peint, c'est lui qui porte les gouttes : deux assombrissements
          l'un sur l'autre laisseraient des bandes près du noir. */}
      {drip && image && !dithered && <DetailsHeroDrips />}
      {/* Voile. Avec la coulure et sans canevas, il va jusqu'au noir et porte
          un tramage léger (`dripDitherMask`). Avec le canevas, il s'arrête au
          bas de l'image et le canevas fait la suite. */}
      <div
        data-details-hero-part
        className={cn('absolute inset-x-0 bottom-0', drip ? DETAILS_HERO_DRIP.fade : 'hidden h-[60%] md:block')}
        style={drip ? (dithered ? DETAILS_HERO_DRIP_FADE_TOP : { ...DETAILS_HERO_DRIP_FADE, ...dripDitherMask() }) : DETAILS_HERO_FADE}
      />
      {/* Fin de la coulure, tramée pixel par pixel. Caché tant qu'il n'est pas
          peint ; décor de la coulure, retiré avec elle en mode léger. */}
      {drip && image && (
        <canvas
          ref={canvasRef}
          data-details-hero-part
          data-details-hero-soft
          data-details-hero-dither={dithered ? 'on' : 'off'}
          className={cn('absolute inset-x-0 bottom-0 w-full', DETAILS_HERO_DRIP.dither)}
          style={{ visibility: dithered ? 'visible' : 'hidden' }}
        />
      )}
    </div>
  );
}

export default DetailsHeroBackdrop;
