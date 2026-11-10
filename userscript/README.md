# Userscript Movix

Le userscript Movix est la variante Tampermonkey de l'outillage navigateur. Il reprend la logique utile pour les navigateurs Chromium quand l'installation d'une extension locale n'est pas l'option la plus pratique.

Le fichier installé est `userscript/movix.user.js`.

## Quand choisir le userscript

- si tu es sur Chrome, Edge ou Brave et que tu veux une installation rapide
- si tu préfères Tampermonkey à une extension non empaquetée
- si tu veux retrouver une partie du comportement de l'extension sans passer par un store

Sur Firefox, l'extension native reste généralement le choix le plus propre.

## Installation

1. Installe [Tampermonkey](https://www.tampermonkey.net/).
2. Ouvre [`movix.user.js`](./movix.user.js).
3. Utilise le bouton `Raw` ou l'équivalent de ta forge pour lancer l'installation.
4. Recharge Movix.

## Ce que le script fait

- expose une couche de compatibilité navigateur proche de l'extension
- s'appuie sur `GM_xmlhttpRequest` et le stockage Tampermonkey
- reproduit une partie des mécanismes de réécriture de requêtes et d'extraction locale
- se charge très tôt dans la page (`document-start`)
- ne s'active que sur les domaines du site, lus sur `https://movix.online/address.json` (champ `active`)

## Fichiers à connaître

| Fichier | Rôle |
| --- | --- |
| `movix.user.js` | Script installable dans Tampermonkey |
| `../public/userscript/movix.user.js` | Variante servie par le frontend quand nécessaire |

## Notes de contribution

- Le fichier versionné ici est le livrable installé.
- Si tu touches une feature partagée avec l'extension, vérifie aussi `extension/Chrome/` et `extension/Firefox/`.
- Les métadonnées `@match`, `@grant` et `@connect` sont aussi importantes que la logique JS elle-même.
- L'[app mobile](../app/README.md) embarque ce même userscript dans un WebView via un bridge React Native ; si tu modifies la logique, pense à régénérer la source côté app avec `node app/scripts/build-userscript.js`.
