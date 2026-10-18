// Dessins du décor Halloween plein écran (citrouilles, sorcière, bonbons,
// araignée, chauves-souris). Chargés avec HalloweenDecor, donc seulement quand
// le thème est actif.
import { useId } from 'react';
import { BAT_WING_LEFT, BAT_WING_RIGHT } from './HalloweenIcons';

// ─── Citrouilles de la brume ─────────────────────────────────────────────────
// Cadre 160 × 132. Trois couches de côtes, de l'arrière vers l'avant : chaque
// couche plus claire au centre et plus sombre sur ses bords, ce qui creuse
// les sillons entre les côtes.
const PUMPKIN_OUTER = 'M80 41C74 35 66 33 56 34C40 35 22 42 13 56C6 66 6 96 14 108C24 124 44 128 60 126C70 125 76 123 80 122C84 123 90 125 100 126C116 128 136 124 146 108C154 96 154 66 147 56C138 42 120 35 104 34C94 33 86 35 80 41Z';
const PUMPKIN_MIDDLE = 'M80 41C66 33 40 40 32 66C26 92 40 122 62 126C70 127 76 124 80 122C84 124 90 127 98 126C120 122 134 92 128 66C120 40 94 33 80 41Z';
const PUMPKIN_CENTER = 'M80 41C70 36 57 48 55 74C53 102 66 123 80 122C94 123 107 102 105 74C103 48 90 36 80 41Z';
const PUMPKIN_STEM = 'M72 42C73 35 74 28 77 22C78.5 18.5 83.5 17.5 86.5 20C84.5 25 85 33 89 42C84 44 77 44 72 42Z';
const PUMPKIN_STEM_RIBS = 'M76.5 42C76.5 35 77 28 79 21.5M82.5 42C81.8 35 82 28 83.5 21';
const PUMPKIN_VINE = 'M88 39C96 32 107 34 107 41C107 47 99 47 99.5 42.5C100 39.5 104 39.5 104 42';
const PUMPKIN_LEAF = 'M72 41C66 37 58 38 53 34C56 33 57 30 61 30C60 26 64 24 67 27C69 24 73 26 72 30C75 33 75 37 72 41Z';
const PUMPKIN_LEAF_VEINS = 'M71 39.5C67 36 62 33.5 57.5 32.5M66.5 35.5L65.5 29M62.5 33.6L59.5 30.6';

/**
 * Visages sculptés : `holes` est découpé dans la citrouille, `teeth` reste
 * dans la bouche (masque) et laisse voir la peau dessinée dessous.
 */
const PUMPKIN_FACES = {
  // Sourire classique : yeux et nez en triangle, deux dents carrées.
  grin: {
    holes: 'M44 73L58 50L71 71Q57 77 44 73Z'
      + 'M89 71L102 50L116 73Q103 77 89 71Z'
      + 'M73.5 88L80 77L86.5 88Q80 90.5 73.5 88Z'
      + 'M33 89Q80 107 127 89Q80 133 33 89Z',
    teeth: 'M64 86h11v19h-11zM86 103h11v19h-11z',
  },
  // Air malicieux : yeux en biais et sourire en dents de scie.
  sly: {
    holes: 'M44 60L71 69L62 78Q48 76 44 60Z'
      + 'M116 60L89 69L98 78Q112 76 116 60Z'
      + 'M75 87L80 78L85 87Z'
      + 'M32 82Q48 94 80 95Q112 94 128 82Q117 116 80 116Q43 116 32 82Z',
    teeth: 'M46 84L60 89L53 100ZM73 92L87 92L80 104ZM100 89L114 84L107 100Z'
      + 'M58 119L73 117L66 104ZM87 117L102 119L94 104Z',
  },
} as const;

type PumpkinFace = keyof typeof PUMPKIN_FACES;

// Couleurs de l'intérieur : `rim` est la tranche de chair coupée, visible au
// bas de chaque trou ; le dégradé part de la bougie (au centre du visage).
const CARVING_TONES = {
  dim: { rim: '#d9741a', stops: ['#f59e0b', '#d9620f', '#8f2d0a'] },
  lit: { rim: '#ffe7a3', stops: ['#fff8d8', '#ffd060', '#f7871f'] },
} as const;

/** Visage sculpté, éclairé (`lit`) ou dans la pénombre (`dim`). */
const PumpkinCarving = ({ id, face, tone }: { id: string; face: PumpkinFace; tone: keyof typeof CARVING_TONES }) => {
  const { holes, teeth } = PUMPKIN_FACES[face];
  const { rim, stops } = CARVING_TONES[tone];
  return (
    <>
      <defs>
        <mask id={`${id}m`}>
          <path d={holes} fill="#fff" />
          <path d={teeth} fill="#000" />
        </mask>
        <radialGradient id={`${id}g`} gradientUnits="userSpaceOnUse" cx="80" cy="96" r="56">
          <stop offset="0" stopColor={stops[0]} />
          <stop offset="0.45" stopColor={stops[1]} />
          <stop offset="1" stopColor={stops[2]} />
        </radialGradient>
      </defs>
      {/* Le fond du trou est décalé vers le haut : le bas de chaque trou
          laisse voir la tranche coupée, comme vue d'un peu au-dessus. */}
      <g mask={`url(#${id}m)`}>
        <rect x="24" y="44" width="112" height="84" fill={rim} />
        <path d={holes} transform="translate(0 -2.6)" fill={`url(#${id}g)`} />
      </g>
    </>
  );
};

/**
 * Citrouille de la brume. Le corps est dessiné une fois ; avec `face`, la
 * lumière du visage est un second dessin posé par-dessus, dans son propre
 * <span>, et le halo un autre <span> derrière : seule leur opacité vacille
 * (CSS), la flamme tremble sans rien repeindre. Sans `face`, une citrouille
 * entière, sans lumière.
 */
export const HalloweenPumpkin = ({ className, face }: { className: string; face?: PumpkinFace }) => {
  // Identifiants des dégradés propres à chaque citrouille de la page.
  const id = `hwp${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <span className={className}>
      {face && <span className="halloween-pumpkin-halo" />}
      <svg className="halloween-pumpkin-art" viewBox="0 0 160 132">
        <defs>
          <radialGradient id={`${id}o`} cx="0.5" cy="0.4" r="0.6">
            <stop offset="0" stopColor="#e2600f" />
            <stop offset="0.6" stopColor="#c2440c" />
            <stop offset="0.88" stopColor="#8f300b" />
            <stop offset="1" stopColor="#5e1e08" />
          </radialGradient>
          <radialGradient id={`${id}m`} cx="0.5" cy="0.38" r="0.62">
            <stop offset="0" stopColor="#f57a1f" />
            <stop offset="0.55" stopColor="#e2600f" />
            <stop offset="0.9" stopColor="#b5420c" />
            <stop offset="1" stopColor="#8a2f0a" />
          </radialGradient>
          <radialGradient id={`${id}c`} cx="0.46" cy="0.34" r="0.66">
            <stop offset="0" stopColor="#ff9a3c" />
            <stop offset="0.5" stopColor="#f7781c" />
            <stop offset="0.85" stopColor="#df5c0f" />
            <stop offset="1" stopColor="#b9470c" />
          </radialGradient>
          {/* Bas assombri (posé dans la brume) et liseré clair en haut,
              comme éclairé par le ciel. */}
          <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.42" stopColor="#280a04" stopOpacity="0" />
            <stop offset="1" stopColor="#280a04" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e6d8ff" stopOpacity="0.45" />
            <stop offset="0.35" stopColor="#e6d8ff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#7d8a3a" />
            <stop offset="0.5" stopColor="#56672a" />
            <stop offset="1" stopColor="#2e3a12" />
          </linearGradient>
          <radialGradient id={`${id}h`}>
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d={PUMPKIN_OUTER} fill={`url(#${id}o)`} />
        <path d={PUMPKIN_MIDDLE} fill={`url(#${id}m)`} stroke="#5c1d08" strokeOpacity="0.45" strokeWidth="1.4" />
        <path d={PUMPKIN_CENTER} fill={`url(#${id}c)`} stroke="#5c1d08" strokeOpacity="0.4" strokeWidth="1.3" />
        <ellipse cx="70" cy="58" rx="6" ry="14" transform="rotate(18 70 58)" fill={`url(#${id}h)`} opacity="0.8" />
        <ellipse cx="40" cy="64" rx="4" ry="12" transform="rotate(24 40 64)" fill={`url(#${id}h)`} opacity="0.55" />
        <ellipse cx="15" cy="76" rx="3" ry="12" transform="rotate(8 15 76)" fill={`url(#${id}h)`} opacity="0.35" />
        <path d={PUMPKIN_OUTER} fill={`url(#${id}s)`} stroke={`url(#${id}r)`} strokeWidth="1.4" />
        {face && <PumpkinCarving id={`${id}d`} face={face} tone="dim" />}
        <ellipse cx="80" cy="41" rx="13" ry="4" fill="#3d1405" opacity="0.55" />
        <path d={PUMPKIN_LEAF} fill="#4d7c0f" stroke="#2f4a0a" strokeWidth="0.7" />
        <path d={PUMPKIN_LEAF_VEINS} stroke="#365314" strokeWidth="0.8" fill="none" strokeLinecap="round" />
        <path d={PUMPKIN_STEM} fill={`url(#${id}t)`} stroke="#25300d" strokeWidth="0.8" />
        <path d={PUMPKIN_STEM_RIBS} stroke="#2e3a12" strokeOpacity="0.6" strokeWidth="0.9" fill="none" />
        <ellipse cx="81.8" cy="20.3" rx="4.8" ry="2" fill="#b8b07a" stroke="#56672a" strokeWidth="0.6" />
        <path d={PUMPKIN_VINE} stroke="#3f5a1e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
      {face && (
        <span className="halloween-pumpkin-light">
          <svg viewBox="0 0 160 132">
            <defs>
              <radialGradient id={`${id}b`} gradientUnits="userSpaceOnUse" cx="80" cy="90" r="62">
                <stop offset="0" stopColor="#ffd678" stopOpacity="0.4" />
                <stop offset="0.55" stopColor="#ff9632" stopOpacity="0.14" />
                <stop offset="1" stopColor="#ff7a1e" stopOpacity="0" />
              </radialGradient>
            </defs>
            {/* Lueur de la bougie à travers la chair, autour du visage. */}
            <path d={PUMPKIN_OUTER} fill={`url(#${id}b)`} />
            <PumpkinCarving id={`${id}l`} face={face} tone="lit" />
          </svg>
        </span>
      )}
    </span>
  );
};

// ─── Sorcière sur son balai ──────────────────────────────────────────────────
// Cadre 240 × 140, de profil vers la droite. Balai incliné qui monte vers
// l'avant ; chat noir assis à l'arrière, paille du balai derrière lui.
const WITCH_STICK = 'M26 100L232 80';
const WITCH_STICK_LIGHT = 'M60 95.7L228 79.4';
const WITCH_BRISTLES = 'M54 95.5C42 92 24 84 6 80L12 87L3 92L11 97L2 102L11 107L4 113L14 116C28 112 42 106 54 101Z';
const WITCH_BRISTLE_STRANDS = 'M52 96.5C40 93 24 88 10 86M52 98.5C38 97 22 96 6 96M52 100C38 102 22 105 8 107M52 101C40 104 28 109 15 113';
const WITCH_BINDING = 'M49 94.5L57 93.6L57.8 102.4L49.8 103.3Z';
const WITCH_CAT = 'M75 93C74 86 77 80 82 79C81 76 80 72 81 69L83.5 72C85 71.4 87 71.4 88.5 72L91 69C92 72 91.5 76 90 79C94 81 95 87 93 93Z';
const WITCH_CAT_TAIL = 'M76 91C68 90 64 82 68 76C70 73 73 74 72 77';
const WITCH_CAPE = 'M161 52C147 50 121 52 97 58C105 62 99 66 89 70C101 72 97 78 87 84C111 82 131 76 147 70C153 65 157 59 161 52Z';
const WITCH_CAPE_LINING = 'M147 70C131 76 111 82 87 84C105 79 125 73 141 65Z';
const WITCH_SKIRT_TAIL = 'M139 84C125 86 109 90 95 92L101 96L93 100L105 101L99 106C115 102 129 98 137 96Z';
const WITCH_HAIR = 'M170 29C161 25 149 29 136 26C141 30 137 34 125 35C133 38 136 40 126 44C134 46 138 48 130 53C142 50 151 48 158 48C162 45 165 41 166 36Z';
const WITCH_HAIR_STRANDS = 'M164 31C155 30 146 31 139 30M163 37C153 37 144 38 133 39M162 43C154 44 146 46 138 49';
const WITCH_SKIRT = 'M130 82C138 79 150 80 156 84C160 90 159 97 155 102L149 99L144 104L138 100L132 104L127 99L121 101C122 94 125 87 130 82Z';
const WITCH_TORSO = 'M132 86C130 76 136 64 146 56C150 53 156 51 162 51C166 58 164 68 158 76C156 80 154 84 152 86Z';
const WITCH_LEG = 'M151 100L159 102L156 116';
const WITCH_BOOT = 'M152.5 114.5L159.5 114.5C163 116.5 169 117.5 174 113.5C173 119 166 122 156 122C153 122 151.5 118 152.5 114.5Z';
// Bras plié, manche évasée au poignet.
const WITCH_ARM = 'M153 58C155 66 158 74 162 79C168 82 176 84 182 86L187 89L190 76L184 78C178 77 173 75 170 72C167 66 165 60 162 55Z';
const WITCH_FACE = 'M163 34C165 29 172 27 177 30L180 33.5L193 38.5L181 40.5C182 43.5 181 46 178.5 47.5L182 52.5C176 53 169 50 165.5 45C162.5 41.5 162 37.5 163 34Z';
const WITCH_HAT_BRIM = 'M150 31.5C158 26.5 182 23.5 194 27C188 31.5 162 34.5 150 31.5Z';
const WITCH_HAT_CROWN = 'M161 29C163 23 165 19 166 15C162 11 157 7 150 3C159 4.5 167 8.5 173 12.5C176 18 179.5 23 182.5 27.5Z';
const WITCH_HAT_BAND = 'M161.6 26.2L181.2 24.6L182.6 27.6L160.9 29.1Z';

/** Étincelle à quatre branches, centre (x ; y), rayon r. */
const sparkle = (x: number, y: number, r: number) =>
  `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;

// Traînée de paillettes derrière la paille, en deux groupes qui scintillent
// à tour de rôle (cadre 60 × 40, le balai part du bord droit).
const WITCH_SPARKLES_A = sparkle(52, 19, 5) + sparkle(31, 27, 3.6) + sparkle(11, 15, 2.6);
const WITCH_SPARKLES_B = sparkle(42, 9, 3.2) + sparkle(21, 33, 2.8) + sparkle(4, 25, 2);

/**
 * Sorcière en vol. La cape, les cheveux et la traîne de la robe sont dans
 * leur propre <span>, qui ondule au vent ; le chat aussi, posé par-dessus,
 * pour se cramponner au balai quand elle file (HalloweenWitchFlight). Le
 * reste est dessiné une fois. Comme pour la chauve-souris, les animations
 * portent sur des <span> et le liseré clair des parties sombres est un trait
 * SVG, pas un filtre.
 */
export const HalloweenWitch = () => (
  <span className="halloween-witch-frame">
    <span className="halloween-witch-sparkles">
      <svg viewBox="0 0 60 40"><path d={WITCH_SPARKLES_A} fill="#fde68a" /></svg>
    </span>
    <span className="halloween-witch-sparkles halloween-witch-sparkles-b">
      <svg viewBox="0 0 60 40"><path d={WITCH_SPARKLES_B} fill="#e9d5ff" /></svg>
    </span>
    <span className="halloween-witch-flutter">
      <svg className="halloween-witch-part" viewBox="0 0 240 140">
        <path className="halloween-witch-rim" d={WITCH_CAPE} fill="#23113a" />
        <path d={WITCH_CAPE_LINING} fill="#6d28d9" />
        <path className="halloween-witch-rim" d={WITCH_SKIRT_TAIL} fill="#1a1024" />
        <path d={WITCH_HAIR} fill="#f97316" stroke="#9a3412" strokeWidth="0.8" />
        <path d={WITCH_HAIR_STRANDS} stroke="#c2410c" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      </svg>
    </span>
    <svg className="halloween-witch-part" viewBox="0 0 240 140">
      <path d={WITCH_STICK} stroke="#4a2b16" strokeWidth="4.4" strokeLinecap="round" />
      <path d={WITCH_STICK_LIGHT} stroke="#8b5a2b" strokeWidth="1.1" strokeLinecap="round" />
      <path d={WITCH_BRISTLES} fill="#c99a45" stroke="#7a5420" strokeWidth="0.8" strokeLinejoin="round" />
      <path d={WITCH_BRISTLE_STRANDS} stroke="#8a6428" strokeWidth="0.8" fill="none" />
      <path d={WITCH_BINDING} fill="#7e22ce" />
      <path d="M53 94L53.8 102.9" stroke="#f97316" strokeWidth="1.4" />
      <path className="halloween-witch-rim" d={WITCH_SKIRT} fill="#1a1024" />
      <path d={WITCH_LEG} stroke="#f97316" strokeWidth="6" fill="none" strokeLinejoin="round" />
      <path d={WITCH_LEG} stroke="#1a1024" strokeWidth="6" strokeDasharray="3 3" fill="none" strokeLinejoin="round" />
      <path className="halloween-witch-rim" d={WITCH_BOOT} fill="#120a10" />
      <path className="halloween-witch-rim" d={WITCH_TORSO} fill="#1a1024" />
      <path className="halloween-witch-rim" d={WITCH_ARM} fill="#1a1024" />
      <circle cx="191" cy="82.5" r="3.4" fill="#93c47d" stroke="#4d7c3a" strokeWidth="0.7" />
      <path d={WITCH_FACE} fill="#93c47d" stroke="#4d7c3a" strokeWidth="0.8" strokeLinejoin="round" />
      <circle cx="174.5" cy="34.5" r="1.2" fill="#1a1024" />
      <circle cx="173.5" cy="41" r="2" fill="#f9a8d4" opacity="0.5" />
      <path d="M176 46.5Q178.5 47.6 180.2 45.4" stroke="#1a1024" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      <path className="halloween-witch-rim" d={WITCH_HAT_CROWN} fill="#160d20" />
      <path d={WITCH_HAT_BAND} fill="#f97316" />
      <rect x="169" y="24.3" width="4.4" height="3.8" fill="none" stroke="#fbbf24" strokeWidth="1" transform="rotate(-4 171.2 26.2)" />
      <path className="halloween-witch-rim" d={WITCH_HAT_BRIM} fill="#160d20" />
    </svg>
    {/* Rien d'autre ne passe sur le chat : par-dessus tout, il reste dessiné
        comme avant, devant le manche et le bout de la cape. */}
    <span className="halloween-witch-cat">
      <svg className="halloween-witch-part" viewBox="0 0 240 140">
        <path className="halloween-witch-rim" d={WITCH_CAT_TAIL} stroke="#0f0a14" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path className="halloween-witch-rim" d={WITCH_CAT} fill="#0f0a14" />
        <ellipse cx="84" cy="75.5" rx="1.3" ry="1" fill="#facc15" />
        <ellipse cx="88" cy="75.5" rx="1.3" ry="1" fill="#facc15" />
      </svg>
    </span>
  </span>
);

// Corps de la chauve-souris en deux morceaux (mêmes formes que BAT_BODY) :
// la tête porte le liseré clair, le torse non, et ce dernier est dessiné
// par-dessus pour couvrir le liseré de la tête et des ailes à l'épaule.
const BAT_HEAD = 'M45.6 15.5a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0-8.8 0ZM46.4 13.2L45.2 6.6L49 11.6ZM53.6 13.2L54.8 6.6L51 11.6Z';
const BAT_TORSO = 'M44.8 25a5.2 8.5 0 1 0 10.4 0a5.2 8.5 0 1 0-10.4 0Z';

/**
 * Chauve-souris en vol. Chaque aile est dans son propre <span> qui tourne
 * autour de l'épaule (CSS) : la carte graphique déplace des images déjà
 * dessinées, sans recalcul de style ni repeinture à chaque image. L'animation
 * porte sur le <span> et non sur le <svg> : Chrome ne confie pas à la carte
 * graphique une animation posée sur un élément SVG. Le liseré clair est un
 * trait SVG sous le remplissage (paint-order), pas un filtre : un filtre sur
 * un groupe animé se recompose à chaque image. Les trois dessins partagent
 * le même cadre 100 × 38.
 */
export const HalloweenFlyingBat = () => (
  <span className="halloween-bat-frame">
    <span className="halloween-bat-wing halloween-bat-wing-l">
      <svg className="halloween-bat-part" viewBox="0 0 100 38"><path d={BAT_WING_LEFT} /></svg>
    </span>
    <span className="halloween-bat-wing halloween-bat-wing-r">
      <svg className="halloween-bat-part" viewBox="0 0 100 38"><path d={BAT_WING_RIGHT} /></svg>
    </span>
    <svg className="halloween-bat-part" viewBox="0 0 100 38">
      <path d={BAT_HEAD} />
      <path className="halloween-bat-torso" d={BAT_TORSO} />
    </svg>
  </span>
);

const SPIDER_LEGS = 'M23.5 17.5L31 11l5 4M24.2 19.5l8.8-3 5.5 5.5M24.2 21.5L32 23l3.5 7M23.2 23.5l4.8 5 .5 5'
  + 'M16.5 17.5L9 11l-5 4M15.8 19.5l-8.8-3L1.5 22M15.8 21.5L8 23l-3.5 7M16.8 23.5l-4.8 5-.5 5';

// Araignées lumineuses des toiles de coin : corps clair au centre, pattes
// plus sombres, halo peint une fois dans le <span> du corps (il suit le
// corps sans filtre ni repeinture).
const GLOWING_SPIDERS = {
  ember: { legs: '#d9620f', body: '#ff9a3c', core: '#ffd69a', head: '#f97316', thread: 'rgb(255 196 140 / 0.7)' },
  ghost: { legs: '#9d8de0', body: '#c9bbff', core: '#f1ecff', head: '#ab9cf0', thread: 'rgb(214 204 255 / 0.65)' },
} as const;

const GlowingSpider = ({ tone }: { tone: keyof typeof GLOWING_SPIDERS }) => {
  const c = GLOWING_SPIDERS[tone];
  return (
    <svg viewBox="0 0 40 34">
      <path d={SPIDER_LEGS} stroke={c.legs} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="20" cy="9.2" rx="6.2" ry="7.8" fill={c.body} />
      <ellipse cx="19.2" cy="8" rx="3.2" ry="4.2" fill={c.core} opacity="0.85" />
      <circle cx="20" cy="20.4" r="4.4" fill={c.head} />
      <circle cx="19.4" cy="19.6" r="2" fill={c.core} opacity="0.7" />
    </svg>
  );
};

/**
 * Araignée pendue à son fil, `thread` sous son point d'accroche (le haut de
 * l'élément ; nombre de px ou longueur CSS). Le fil part de l'accroche et
 * entre dans l'abdomen : le fil s'allonge (scaleY) pendant que l'araignée
 * descend d'autant, donc ils restent collés à chaque image (voir
 * halloween-decor.css). Le corps est animé via son <span>, pas via le <svg>
 * (voir la chauve-souris). `tone` : araignée sombre, ou lumineuse (braise
 * orange, lavande).
 */
export const HalloweenSpider = ({ className = '', thread = 80, tone = 'dark' }: {
  className?: string;
  thread?: number | string;
  tone?: 'dark' | keyof typeof GLOWING_SPIDERS;
}) => (
  <div
    className={`halloween-hanging-spider ${className}`}
    style={{
      ['--thread' as string]: typeof thread === 'number' ? `${thread}px` : thread,
      ...(tone === 'dark' ? null : { ['--spider-thread' as string]: GLOWING_SPIDERS[tone].thread }),
    }}
    data-tone={tone}
    aria-hidden="true"
  >
    <span className="halloween-hanging-spider-thread" />
    <span className="halloween-hanging-spider-body">
      {tone !== 'dark' && <span className="halloween-hanging-spider-halo" />}
      {tone !== 'dark' ? <GlowingSpider tone={tone} /> : <svg viewBox="0 0 40 34">
        {/* Liseré clair sous la silhouette, dessiné une fois : remplace un
            filtre drop-shadow recalculé à chaque image de l'animation. */}
        <g stroke="rgb(200,180,230)" opacity="0.45" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={SPIDER_LEGS} strokeWidth="3.1" />
          <ellipse cx="20" cy="9.2" rx="6.6" ry="8.2" strokeWidth="1.8" />
          <circle cx="20" cy="20.4" r="4.6" strokeWidth="1.8" />
        </g>
        <path d={SPIDER_LEGS} stroke="#120d16" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <ellipse cx="20" cy="9.2" rx="6.6" ry="8.2" fill="#120d16" />
        <path d="M18 5.5h4l-2 3.2zM18 12.5h4l-2-3.2z" fill="#f97316" opacity="0.9" />
        <ellipse cx="17.6" cy="5.4" rx="2" ry="1.1" fill="#fff" opacity="0.18" transform="rotate(-30 17.6 5.4)" />
        <circle cx="20" cy="20.4" r="4.6" fill="#120d16" />
        <circle cx="18.3" cy="21.4" r="1.05" fill="#fb923c" />
        <circle cx="21.7" cy="21.4" r="1.05" fill="#fb923c" />
        <circle cx="18.6" cy="21.1" r="0.35" fill="#fff" />
        <circle cx="22" cy="21.1" r="0.35" fill="#fff" />
        <path d="M19 24.6l.5 1.4M21 24.6l-.5 1.4" stroke="#120d16" strokeWidth="0.9" strokeLinecap="round" />
      </svg>}
    </span>
  </div>
);

// ─── Bonbons qui tombent ─────────────────────────────────────────────────────
// Couleurs à plat et reflets blancs, sans dégradé : un dégradé SVG passe par
// un identifiant (url(#id)), dupliqué à chaque bonbon dans la page.

/** Spirale de la sucette (centre 20,13), calculée une fois. */
const LOLLIPOP_SPIRAL = (() => {
  const turns = 3;
  const max = turns * 2 * Math.PI;
  const points: string[] = [];
  for (let a = 0.6; a <= max; a += 0.22) {
    const r = (9.2 * a) / max;
    points.push(`${(20 + Math.cos(a) * r).toFixed(2)} ${(13 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${points.join('L')}`;
})();

/** Quatre tourbillons du bonbon à la menthe (centre 20,20, rayon 11). */
const SWIRL_WEDGES = (() => {
  const R = 11;
  const at = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(20 + Math.cos(a) * r).toFixed(2)} ${(20 + Math.sin(a) * r).toFixed(2)}`;
  };
  return [0, 90, 180, 270].map((a0) => {
    const a1 = a0 + 45;
    return `M20 20Q${at(a0 - 35, R * 0.55)} ${at(a0, R)}A${R} ${R} 0 0 1 ${at(a1, R)}Q${at(a1 - 35, R * 0.55)} 20 20Z`;
  }).join('');
})();

const TWIST_COLORS = {
  orange: { body: '#f97316', stripe: '#fed7aa', wrap: '#fdba74', fold: '#c2410c', edge: '#7c2d12' },
  purple: { body: '#9333ea', stripe: '#e9d5ff', wrap: '#d8b4fe', fold: '#7e22ce', edge: '#3b0764' },
};

/** Bonbon emballé, papillotes torsadées de chaque côté. */
const TwistCandy = ({ tone }: { tone: keyof typeof TWIST_COLORS }) => {
  const c = TWIST_COLORS[tone];
  return (
    <>
      <path d="M11.5 20L2.5 12.5Q4.8 20 2.5 27.5Z" fill={c.wrap} opacity="0.9" />
      <path d="M11.5 20L5 15.5M11.5 20H4.4M11.5 20L5 24.5" stroke={c.fold} strokeWidth="0.8" />
      <path d="M28.5 20L37.5 12.5Q35.2 20 37.5 27.5Z" fill={c.wrap} opacity="0.9" />
      <path d="M28.5 20L35 15.5M28.5 20H35.6M28.5 20L35 24.5" stroke={c.fold} strokeWidth="0.8" />
      <ellipse cx="20" cy="20" rx="10" ry="8" fill={c.body} />
      <path d="M14 13.8L19 26.6M20 12.6L24.4 26.8M25.8 14L28.4 21" stroke={c.stripe} strokeWidth="2.2" strokeLinecap="round" opacity="0.9" />
      <ellipse cx="16.5" cy="16" rx="4.2" ry="2.2" fill="#fff" opacity="0.45" transform="rotate(-20 16.5 16)" />
      <ellipse cx="20" cy="20" rx="10" ry="8" fill="none" stroke={c.edge} strokeOpacity="0.55" strokeWidth="0.8" />
    </>
  );
};

const CANDIES = [
  // Bonbon maïs (candy corn) : base jaune, bande orange, pointe blanche.
  () => (
    <>
      <path d="M18.8 5Q20 2.8 21.2 5L33 31Q33.5 34.5 20 34.5Q6.5 34.5 7 31Z" fill="#facc15" />
      <path d="M15.17 13Q20 14.6 24.83 13L29.37 23Q20 26 10.63 23Z" fill="#f97316" />
      <path d="M18.8 5Q20 2.8 21.2 5L24.83 13Q20 14.6 15.17 13Z" fill="#fff7ed" />
      <path d="M17.6 8.5L12.2 21" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M18.8 5Q20 2.8 21.2 5L33 31Q33.5 34.5 20 34.5Q6.5 34.5 7 31Z" fill="none" stroke="#9a3412" strokeOpacity="0.45" strokeWidth="0.9" />
    </>
  ),
  () => <TwistCandy tone="orange" />,
  // Sucette à spirale, petit nœud violet sur le bâton.
  () => (
    <>
      <rect x="18.9" y="21" width="2.2" height="17" rx="1.1" fill="#f5f0e6" stroke="#a8a29e" strokeWidth="0.5" />
      <circle cx="20" cy="13" r="10.5" fill="#f97316" />
      <path d={LOLLIPOP_SPIRAL} fill="none" stroke="#fff7ed" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="13" r="10.5" fill="none" stroke="#9a3412" strokeOpacity="0.5" strokeWidth="0.8" />
      <ellipse cx="16" cy="8.5" rx="3.2" ry="1.8" fill="#fff" opacity="0.5" transform="rotate(-30 16 8.5)" />
      <path d="M20 25l-4-2.5v5zM20 25l4-2.5v5z" fill="#a855f7" />
    </>
  ),
  () => <TwistCandy tone="purple" />,
  // Bonbon à la menthe, tourbillons violets.
  () => (
    <>
      <circle cx="20" cy="20" r="11" fill="#faf5ff" />
      <path d={SWIRL_WEDGES} fill="#a855f7" />
      <ellipse cx="15.5" cy="14.5" rx="3.4" ry="1.8" fill="#fff" opacity="0.6" transform="rotate(-35 15.5 14.5)" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="#581c87" strokeOpacity="0.55" strokeWidth="0.8" />
    </>
  ),
  // Chewing-gum œil, veines rouges.
  () => (
    <>
      <circle cx="20" cy="20" r="11.5" fill="#f8fafc" />
      <path d="M27.3 27.3A10.3 10.3 0 0 1 14.85 28.9" stroke="#cbd5e1" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.7" />
      <path d="M9.5 16c3 1 5 0 6.5 2M30.5 24c-3-.5-4.5 1-6 0M12 27c2.5-1 4.5 0 5.5-1.5M28 12c-2 1.5-3.5 1.5-5 3.5" stroke="#dc2626" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      <circle cx="21" cy="19" r="5.4" fill="#16a34a" stroke="#14532d" strokeWidth="0.8" />
      <circle cx="21" cy="19" r="2.5" fill="#0a0a0a" />
      <circle cx="22.6" cy="17.3" r="1.2" fill="#fff" />
      <ellipse cx="15" cy="13.5" rx="3" ry="1.6" fill="#fff" opacity="0.8" transform="rotate(-35 15 13.5)" />
      <circle cx="20" cy="20" r="11.5" fill="none" stroke="#94a3b8" strokeWidth="0.9" />
    </>
  ),
  // Ver en gomme, vert puis orange, grains de sucre.
  () => (
    <>
      <path d="M5 27c3-6 7-6 9-2s6 4 8-1" stroke="#14532d" strokeWidth="7.2" strokeLinecap="round" fill="none" />
      <path d="M22 24c2-5 6-6 8.5-3s4.5 1 5-4" stroke="#9a3412" strokeWidth="7.2" strokeLinecap="round" fill="none" />
      <path d="M5 27c3-6 7-6 9-2s6 4 8-1" stroke="#22c55e" strokeWidth="6" strokeLinecap="round" fill="none" />
      <path d="M22 24c2-5 6-6 8.5-3s4.5 1 5-4" stroke="#f97316" strokeWidth="6" strokeLinecap="round" fill="none" />
      <g transform="translate(-.4 -1.6)" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.4" fill="none" strokeLinecap="round">
        <path d="M5 27c3-6 7-6 9-2s6 4 8-1" />
        <path d="M22 24c2-5 6-6 8.5-3s4.5 1 5-4" />
      </g>
      <g fill="#fff" opacity="0.6">
        <circle cx="9" cy="26.5" r="0.5" />
        <circle cx="17" cy="27" r="0.45" />
        <circle cx="26" cy="21.5" r="0.5" />
        <circle cx="33" cy="19" r="0.45" />
      </g>
    </>
  ),
  // Citrouille en guimauve (mellowcreme).
  () => (
    <>
      <path d="M18.6 12.5c-.2-3.2 1-5.6 3.6-6.6l.9 1.7c-1.8.8-2.5 2.6-2.3 4.9z" fill="#3f6212" />
      <ellipse cx="20" cy="22" rx="13" ry="11" fill="#ea580c" />
      <ellipse cx="14" cy="22" rx="6.5" ry="10.5" fill="#f97316" />
      <ellipse cx="26" cy="22" rx="6.5" ry="10.5" fill="#f97316" />
      <ellipse cx="20" cy="22" rx="5" ry="11" fill="#fb923c" />
      <ellipse cx="15" cy="16" rx="2.6" ry="1.4" fill="#fff" opacity="0.45" transform="rotate(-30 15 16)" />
      <ellipse cx="20" cy="22" rx="13" ry="11" fill="none" stroke="#7c2d12" strokeOpacity="0.5" strokeWidth="0.8" />
    </>
  ),
];

/** Nombre de sortes de bonbons disponibles. */
export const CANDY_KINDS = CANDIES.length;

/** Un bonbon ; `kind` choisit la sorte (modulo le nombre de sortes). */
export const HalloweenCandy = ({ kind }: { kind: number }) => {
  const Candy = CANDIES[kind % CANDIES.length];
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <Candy />
    </svg>
  );
};
