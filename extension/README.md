# Extension navigateur Movix

L'extension Movix sert quand le site a besoin d'un coup de main côté navigateur : réécriture de headers, interception de requêtes, extraction locale de certaines sources et pont entre la page Movix et une logique qui ne peut pas vivre uniquement dans le frontend web.

Le repo garde deux variantes en parallèle :

- `extension/Chrome/`
- `extension/Firefox/`

## Quand choisir l'extension

| Cas | Recommandation |
| --- | --- |
| Firefox | Extension native recommandée |
| Chrome / Edge / Brave | L'extension fonctionne, mais le userscript peut être plus simple à installer |
| Dev local | Charge directement les dossiers `Chrome/` ou `Firefox/` |

Si tu préfères Tampermonkey sur Chromium, regarde aussi [userscript/README.md](../userscript/README.md).

## Installation locale

### Chrome / Edge / Brave

1. Ouvre `chrome://extensions`.
2. Active le mode développeur.
3. Clique sur `Charger l'extension non empaquetée`.
4. Sélectionne `extension/Chrome/`.

### Firefox

1. Ouvre `about:debugging#/runtime/this-firefox`.
2. Clique sur `Charger un module complémentaire temporaire`.
3. Sélectionne `extension/Firefox/manifest.json`.

## Structure

Chaque variante contient les mêmes briques principales :

- `manifest.json`
- `background.js`
- `content.js`
- `injected.js`
- `extractors.js`
- `popup.html`
- `popup.js`

## Permissions et comportement

Les manifests déclarent notamment :

- `declarativeNetRequest`
- `declarativeNetRequestWithHostAccess`
- `storage`
- des `host_permissions` larges

Ces permissions servent à :

- injecter ou normaliser les bons headers
- faire passer certaines requêtes vidéo ou Live TV
- exécuter des extractions dans le contexte adapté
- permettre la communication avec Movix sur ses domaines autorisés

L'extension n'écoute que les pages de ces domaines. Pour en ajouter un, complète `content_scripts.matches` dans le manifest et `MOVIX_SITE_DOMAINS` dans `background.js`, pour Chrome et Firefox.

## Notes de contribution

- Si tu modifies la logique partagée, compare toujours `Chrome/` et `Firefox/`.
- Les deux variantes n'ont pas exactement le même manifest ; ne pars pas du principe qu'un copier-coller suffit.
- Si la feature doit aussi exister en mode Tampermonkey, vérifie `userscript/movix.user.js`.
