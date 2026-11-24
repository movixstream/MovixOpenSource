import type { CSSProperties } from 'react';

/** Grille du site, la même que l'en-tête et le HeroSlider. */
export const DETAILS_GRID = 'px-3 sm:px-6 md:px-12 lg:px-20 mx-auto max-w-[1920px]';

/**
 * Bas de la grande image (`DetailsHeroBackdrop`). Un voile noir ne fait
 * qu'assombrir l'image : avec lui seul, une image claire s'arrête sur une ligne
 * et une image sombre traîne presque noire avec son grain, en taches sur un
 * écran OLED. Aucune courbe ne règle les deux. Deux pièces vont donc ensemble :
 * la coulure ci-dessous remplace le détail par les couleurs du bas de l'image,
 * puis le voile éteint ce qui reste. `tests/detailsHeroFade.browser.mjs` mesure
 * le résultat sur des images extrêmes : le lancer avant de retoucher ces valeurs.
 */

/**
 * Masque de la coulure, posée sur la moitié basse de l'image : elle remplace
 * peu à peu l'image nette et la couvre en entier à partir de la couture
 * (`DETAILS_HERO_SMEAR_STRETCH`). Celle-ci est plus haut sous 768 px, où le
 * voile du bas est plus fort. Au-delà, le passage est court (de 72 à 85 % de
 * la hauteur) : plus long, il étirait aussi les visages posés en bas de
 * l'image. Deux écritures par taille : l'ancien préfixe, pour les WebView qui
 * ne lisent que lui.
 */
export const DETAILS_HERO_SMEAR_MASK =
  '[-webkit-mask-image:linear-gradient(to_bottom,transparent,#000_42%)] [mask-image:linear-gradient(to_bottom,transparent,#000_42%)] md:[-webkit-mask-image:linear-gradient(to_bottom,transparent_44%,#000_70%)] md:[mask-image:linear-gradient(to_bottom,transparent_44%,#000_70%)]';

/**
 * Coulure qui sort de la section (`drip` de `DetailsHeroBackdrop`), à
 * toutes les tailles : elle coule 640 px (40rem) dans la page. Le fond
 * s'agrandit de ces 40rem (et des 56 px de la barre de sections sur les fiches
 * film et série, où l'image continue sous ses onglets jusqu'au filet), mais
 * l'image, sa coulure et leur couture gardent la boîte qu'elles auraient sans
 * coulure : même cadrage. Chaque hauteur retire donc ces 40rem (et les 3rem
 * dont le cadre du flou dépasse). Changer la longueur de la coulure, c'est
 * changer toutes ces valeurs, le masque ci-dessous et le voile
 * (`DETAILS_HERO_DRIP_FADE`).
 */
export const DETAILS_HERO_DRIP = {
  /**
   * Fond entier : l'image, puis la coulure. Sous 768 px, l'image garde sa
   * hauteur fixe (`--details-hero-phone-h`) et la coulure part de son bas.
   */
  frame: {
    /** Image jusqu'au filet de la barre de sections (56 px sous la section). */
    sectionNav: 'h-[calc(var(--details-hero-phone-h)+40rem)] md:h-[calc(100%+43.5rem)]',
    /** Image jusqu'au bas de la section (sagas). */
    section: 'h-[calc(var(--details-hero-phone-h)+40rem)] md:h-[calc(100%+40rem)]',
  },
  /** Image nette : sa boîte sans la coulure. */
  image: 'h-[calc(100%-40rem)]',
  /** Cadre masqué de la coulure : moitié basse de l'image, plus la coulure. */
  smear: 'h-[calc(50%+20rem)]',
  /** Cadre du flou : du haut de l'image à 3rem sous la coulure. */
  blur: 'h-[calc(200%-37rem)]',
  /** Image étirée : de nouveau la boîte jusqu'au filet. */
  smearImage: 'h-[calc(100%-43rem)]',
  /** Voile : 24rem au-dessus du bas de l'image, puis toute la coulure. */
  fade: 'h-[64rem]',
  /** Canevas du voile tramé (`dripCanvas.ts`) : toute la coulure sous l'image. */
  dither: 'h-[40rem]',
} as const;

/**
 * Masque de la coulure qui sort de la section : chaque palier retire la part
 * de la coulure (0,42 × 40rem sous 768 px ; 0,44 × 40rem, 0,70 × 40rem
 * au-delà) pour tomber au même endroit de l'image que
 * `DETAILS_HERO_SMEAR_MASK`.
 */
export const DETAILS_HERO_SMEAR_MASK_UNDER_NAV =
  '[-webkit-mask-image:linear-gradient(to_bottom,transparent,#000_calc(42%_-_16.8rem))] [mask-image:linear-gradient(to_bottom,transparent,#000_calc(42%_-_16.8rem))] md:[-webkit-mask-image:linear-gradient(to_bottom,transparent_calc(44%_-_17.6rem),#000_calc(70%_-_28rem))] md:[mask-image:linear-gradient(to_bottom,transparent_calc(44%_-_17.6rem),#000_calc(70%_-_28rem))]';

/**
 * Étirement de la coulure : la même image, au même cadrage, étirée 40 fois en
 * hauteur autour de la couture, là où le masque devient plein (71 % de la
 * hauteur sous 768 px, 85 % au-delà). Sous la couture, chaque colonne garde la
 * couleur des dernières lignes de l'image : la coulure part donc des pixels
 * exacts de l'image, sans bord possible. Le flou posé autour lisse les bandes.
 * Un peu plus large, pour que le flou reste plein jusqu'aux bords : à 1,06,
 * les rayures de l'image nette réapparaissaient sur les côtés d'un téléphone.
 * Changer une couture, c'est changer le masque avec elle.
 */
export const DETAILS_HERO_SMEAR_STRETCH =
  'origin-[50%_71%] md:origin-[50%_85%] scale-x-[1.15] md:scale-x-[1.1] scale-y-[40]';

const HERO_FADE_STEPS = 24;

/**
 * Opacité du voile le long de sa hauteur, `t` de 0 (haut) à 1 (bas) : l'image
 * garde `(1 - t²)^1,5` de sa lumière. Départ doux, puis arrivée au noir à pente
 * nulle, tout en bas : ni ligne où l'image s'arrête, ni bande noire vide avant
 * la barre de sections.
 */
const heroFadeOpacity = (t: number) => 1 - Math.pow(1 - t * t, 1.5);


/**
 * Voile en dégradé : paliers resserrés vers le bas, là où la courbe tourne. La
 * couleur est le noir du thème, comme le fond de la page : un thème qui le
 * change (Halloween) garderait sinon une marche au bas de l'image. Posé en
 * `style` : les classes de dégradé de Tailwind ne portent que trois paliers.
 */
const heroFade = (opacityAt: (t: number) => number): CSSProperties => {
  const stops = Array.from({ length: HERO_FADE_STEPS + 1 }, (_, index) => {
    const t = 1 - Math.pow(1 - index / HERO_FADE_STEPS, 2);
    return `rgb(var(--movix-black, 0 0 0) / ${opacityAt(t).toFixed(4)}) ${(t * 100).toFixed(2)}%`;
  });
  return { backgroundImage: `linear-gradient(to bottom, ${stops.join(', ')})` };
};

/** Voile du bas de la grande image à partir de 768 px. */
export const DETAILS_HERO_FADE = heroFade(heroFadeOpacity);

/**
 * Voile de la coulure (`DETAILS_HERO_DRIP.fade`), `t` de 0 (24rem au-dessus
 * du bas de l'image) à 1 (bout de la coulure) : deux arcs de parabole, `2t²`
 * puis `1 - 2(1 - t)²`. La pente part de zéro, grandit, puis revient à zéro,
 * toujours au même rythme : sur une hauteur donnée, aucune courbe du clair au
 * noir ne tourne moins vite (comme accélérer à fond puis freiner à fond), et
 * elle n'a aucun coude. Le changement de pente le plus fort baisse avec le
 * carré de la hauteur : sur 1 024 px, il ne vaut plus qu'un quart de ce qu'il
 * était sur 512, et il passe sous les marches de l'arrondi des couleurs à
 * l'entier (8 bits) ; plus long, l'écran n'en montrerait rien de plus. Au bas
 * de l'image (le filet de la barre sur les fiches film et série), la coulure
 * garde 72 % de sa lumière, et 55 % 100 px plus bas. Une pente droite qui
 * s'aplatit d'un coup se voit comme un trait (bandes de Mach) ; un coude au
 * bas de l'image se verrait sur une saga, qui n'a pas de filet pour le cacher.
 */
export const dripFadeOpacity = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

/** Paliers du voile de la coulure, tous les 2,5 % de sa hauteur. */
const DRIP_FADE_STOPS = Array.from({ length: 41 }, (_, index) => {
  const t = index / 40;
  return `rgb(var(--movix-black, 0 0 0) / ${dripFadeOpacity(t).toFixed(4)}) ${(t * 100).toFixed(2)}%`;
});

/**
 * Bas de l'image dans le voile de la coulure : 24rem sur ses 64rem, pile sur
 * un palier (le seizième). Dessous commence la coulure seule.
 */
export const DETAILS_HERO_DRIP_SPLIT = 24 / 64;

/**
 * Teinte de la coulure (`dripColor` de `DetailsHeroBackdrop`) : la couleur
 * de l'image multiplie la coulure peu à peu, de 46rem à 32rem au-dessus du
 * bas du fond (6rem au-dessus du bas de l'image, 8rem dessous). Plus haut,
 * la coulure garde les couleurs de l'image : une teinte pleine dès la
 * couture changeait les couleurs d'un coup, sur une ligne.
 */
export const DETAILS_HERO_DRIP_TINT = { fromRem: 46, toRem: 32 } as const;

/**
 * Voile de la coulure quand le canevas tramé (`dripCanvas.ts`) peint la fin :
 * le même jusqu'au bas de l'image, puis il ne bouge plus. Le canevas, posé
 * dessous, retire le reste de la lumière ; il part de zéro, donc sans bord.
 */
export const DETAILS_HERO_DRIP_FADE_TOP: CSSProperties = {
  backgroundImage: `linear-gradient(to bottom, ${DRIP_FADE_STOPS.slice(0, 40 * DETAILS_HERO_DRIP_SPLIT + 1).join(', ')})`,
};

/** Voile de la coulure qui sort de la section (`drip`), en 41 paliers réguliers. */
export const DETAILS_HERO_DRIP_FADE: CSSProperties = {
  backgroundImage: `linear-gradient(to bottom, ${DRIP_FADE_STOPS.join(', ')})`,
};

/** Anneau de focus clavier commun aux éléments cliquables des fiches. */
export const DETAILS_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black';

/**
 * Liseré clair d'une vignette, posé par-dessus l'image (sur un élément
 * `relative` arrondi). En bordure, il se peignait sur le fond bleu nuit de la
 * vignette (`bg-gray-900`) et tirait sur le bleu, sur une page noire ; posé
 * dessus, il éclaircit l'image elle-même et n'a plus de couleur à lui.
 */
export const DETAILS_IMAGE_EDGE =
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-white/10 after:content-['']";

/** Survol, appui et transitions communs (200 ms, coupés si l'utilisateur réduit les animations). */
export const DETAILS_PRESS =
  'transition-[transform,background-color,border-color,color,opacity] duration-200 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100';

/**
 * Rangée qui défile à l'horizontale sous 768 px et va jusqu'au bord droit de
 * l'écran. La marge verticale laisse la place de l'anneau de focus. Ces
 * classes fixent marges et espacements internes : en poser d'autres sur un
 * parent, pas sur le même élément.
 */
export const DETAILS_PHONE_SCROLL =
  'flex gap-3 overflow-x-auto scrollbar-hide -my-1 py-1 -ml-1 pl-1 -mr-3 pr-3 sm:-mr-6 sm:pr-6 md:m-0 md:p-0 md:overflow-visible';

/** Valeurs ignorées dans les listes d'éléments : permet d'écrire `condition && { … }`. */
export type DetailsFalsy = false | null | undefined | '' | 0;

/** Hauteur de l'en-tête fixe du site, en pixels. */
export const DETAILS_HEADER_HEIGHT = 64;
