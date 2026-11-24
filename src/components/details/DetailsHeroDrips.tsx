import { DRIP_CAP_PATH } from './dripCanvas';

/**
 * Gouttes au bout de la coulure (`drip` de `DetailsHeroBackdrop`).
 *
 * Un fondu vers le noir finit toujours quelque part : sur un écran OLED, les
 * pixels s'y éteignent, et un fondu horizontal les éteint tous sur la même
 * ligne, que l'œil lit comme une coupure. Ici, une nappe du noir de la page
 * monte par-dessus la fin de la coulure, avec un bord découpé en gouttes :
 * entre elles, la coulure s'arrête plus tôt ; dans chaque goutte, elle descend
 * plus bas, chacune à sa longueur. Le flou adoucit le bord : plus de trait
 * droit, seulement des langues de couleur qui s'éteignent.
 *
 * Dessin en unités : 1 000 de large, étiré à la largeur de la page (les
 * gouttes s'élargissent avec elle) ; 480 de haut, 1 unité = 1 px. Le bord
 * part à 170, soit 310 px au-dessus du bout du fond. Les gouttes s'arrêtent
 * au plus à 340 (140 px du bout) : plus bas, le voile éteindrait leur pointe
 * sur une ligne droite. Le dessin déborde de 4rem de chaque côté, pour que le
 * flou reste plein jusqu'aux bords. Le tracé est dans `dripCanvas.ts` : dès que
 * le voile tramé est peint, c'est lui qui porte la nappe, et ce dessin est
 * retiré.
 */

export function DetailsHeroDrips() {
  return (
    <svg
      // Décor de la coulure : le mode léger le retire avec elle (`light-mode.css`).
      data-details-hero-soft
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 1000 480"
      preserveAspectRatio="none"
      className="pointer-events-none absolute -left-16 bottom-0 h-[30rem] w-[calc(100%+8rem)] blur-[24px]"
    >
      <path d={DRIP_CAP_PATH} style={{ fill: 'rgb(var(--movix-black, 0 0 0))' }} />
    </svg>
  );
}

export default DetailsHeroDrips;
