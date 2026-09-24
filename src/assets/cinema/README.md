# Icônes de cinéma

Sélection approuvée pour le décor de la popup : **13 icônes Phosphor Icons
(Fill)** et **2 icônes MingCute (Filled)**. Les tracés téléchargés sont conservés ;
seule la couleur est adaptée au blanc `#f8fafc`.

| Fichier local | Icône d'origine | Bibliothèque |
| --- | --- | --- |
| [popcorn.svg](popcorn.svg) | popcorn-fill | Phosphor |
| [camera.svg](camera.svg) | video-camera-fill | Phosphor |
| [clapperboard.svg](clapperboard.svg) | film-slate-fill | Phosphor |
| [reel.svg](reel.svg) | film-reel-fill | Phosphor |
| [ticket.svg](ticket.svg) | ticket-fill | Phosphor |
| [star.svg](star.svg) | star-fill | Phosphor |
| [filmstrip.svg](filmstrip.svg) | film-strip-fill | Phosphor |
| [glasses.svg](glasses.svg) | eyeglasses-fill | Phosphor |
| [seat.svg](seat.svg) | armchair-fill | Phosphor |
| [screen.svg](screen.svg) | projector-screen-fill | Phosphor |
| [trophy.svg](trophy.svg) | trophy-fill | Phosphor |
| [comedy.svg](comedy.svg) | mask-happy-fill | Phosphor |
| [tragedy.svg](tragedy.svg) | mask-sad-fill | Phosphor |
| [projector.svg](projector.svg) | devices/projector | MingCute |
| [soda.svg](soda.svg) | food/glass_cup | MingCute |

Les URL exactes et les empreintes des fichiers installés figurent dans
[sources.json](sources.json). Les fichiers gardent leurs licences propres :
[MIT pour Phosphor](LICENSE-Phosphor.txt) et
[Apache 2.0 pour MingCute](LICENSE-MingCute.txt).
Sources : [Phosphor Icons](https://github.com/phosphor-icons/core) et
[MingCute](https://github.com/mingcute-design/mingcute-icons).

## Rendu

La disposition, la lumière et les trois plans de la popup sont conservés.
Le catalogue `src/data/cinemaMotifs.ts` répartit 34 objets et 231 points, avec les
quinze motifs représentés et les popcorns, caméras et claps plus fréquents.

Les icônes Phosphor utilisent un viewBox carré de 256 unités ; MingCute utilise
24 unités. Le rendu respecte ces proportions natives, sans redessiner les icônes.

Le faisceau auxiliaire [projector-beam.svg](projector-beam.svg), créé pour Movix,
reste sous la licence générale du dépôt. Son origine suit la lentille MingCute
en **(16, 14)** dans le viewBox 24 × 24, soit `[16 / 24, 14 / 24]` dans le catalogue.
Il conserve la transformation du projecteur et son atténuation près des textes.
