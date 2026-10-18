# Particules P-Stream

Le moteur de particules de `src/components/AdPopupCinemaRain.tsx` est adapté de
[Lightbar.tsx de P-Stream](https://github.com/xp-technologies-dev/p-stream/blob/production/src/components/utils/Lightbar.tsx),
par les contributeurs de P-Stream / movie-web. Source récupérée le 8 septembre 2026,
blob Git `85ef67bc5ae344eff7583e90cbb98e6d0ee93e00`.

`popcorn.png` et `camera.png` sont les fichiers originaux, sans modification,
du dossier [public/lightbar-images](https://github.com/xp-technologies-dev/p-stream/tree/production/public/lightbar-images).
Ce sont les silhouettes blanches du preset cinéma du canvas amont, conservées
comme références. Le rendu actif utilise les quinze icônes Phosphor et MingCute
de [la sélection approuvée](../cinema/README.md), avec leurs licences propres.

Ces éléments tiers conservent la licence **GNU Affero General Public License v3.0**
du dépôt d'origine, reproduite dans [LICENSE.md](LICENSE.md). Ils ne sont pas
relicenciés sous la licence générale de Movix.

Adaptations Movix : preset cinéma fixé, chemins d'images importés par Vite,
champ de particules à 200 % de la largeur (géométrie mobile du Lightbar : 500 % × 40 %)
dont seule la moitié centrale, visible dans la popup, est allouée dans le canvas.
La densité reste de 265 particules : 34 images et 231 points.
Les directions, distributions de départ, durées de vie, orientation et fondu
parabolique proviennent du moteur amont.

La finition ajoute trois plans qui modulent la taille, la vitesse, l'opacité et
la netteté. Les sources SVG restent intactes ; les plans doux sont précalculés
dans des sprites en mémoire et le premier plan conserve les détails nets.
Ces sprites sont préparés pendant un temps mort, avant la première popup
(`src/utils/cinemaRainSprites.ts`) : le décor est complet dès l'ouverture. Si la
popup s'ouvre avant, le reste est préparé d'un bloc et les motifs entrent ensemble.
Le plan moyen gagne 20 % d'opacité et le premier plan 25 %, uniquement hors des
zones de lecture ; les points sont atténués de 20 % sans changer leur nombre.
Le placement initial et le renouvellement des icônes limitent leurs chevauchements
en anticipant quatre secondes de déplacement, sans correction de trajectoire en cours.
L'atténuation suit la surface visible des silhouettes tournées à proximité des
textes, mesurés dans le dialogue. Un éclairage bleu diffus adapte l'intention du
Lightbar à la popup ; une impulsion ponctuelle accompagne le déblocage. Les
projecteurs émettent un cône lumineux attaché à leur objectif, rogné par la popup
et atténué indépendamment au voisinage des textes.

Le rendu tient compte du temps écoulé, avec une référence de 60 images/seconde,
et d'un ratio de pixels plafonné à 2. Le canvas est redimensionné uniquement
lorsque nécessaire, sans intervalle ni filtre recalculé à chaque image. La boucle
s'arrête à la fermeture, lorsque l'onglet est masqué ou en mouvement réduit.
