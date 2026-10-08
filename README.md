<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./brand/movix-inverse.svg" />
    <img src="./brand/movix-horizontal.svg" alt="Movix" width="320" />
  </picture>
</p>

<h1 align="center">Movix</h1>

<p align="center">
  <strong>Le 1er site de streaming open source made in France et 100% vibecodé.</strong>
</p>

<p align="center">
  <a href="https://react.dev">React</a> |
  <a href="https://vite.dev">Vite</a> |
  <a href="https://www.typescriptlang.org">TypeScript</a> |
  <a href="https://nodejs.org">Node.js</a> |
  <a href="https://www.mysql.com">MySQL</a> |
  <a href="https://redis.io">Redis</a> |
  <a href="https://socket.io">Socket.IO</a> |
  <a href="https://www.python.org">Python</a> |
  <a href="https://www.rust-lang.org">Rust</a>
</p>

<p align="center">
  <a href="https://react.dev">
    <img alt="React" src="https://img.shields.io/badge/React-149ECA?style=flat-square&logo=react&logoColor=white" />
  </a>
  <a href="https://vite.dev">
    <img alt="Vite" src="https://img.shields.io/badge/Vite-7C3AED?style=flat-square&logo=vite&logoColor=white" />
  </a>
  <a href="https://www.typescriptlang.org">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  </a>
  <a href="https://nodejs.org">
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-3C873A?style=flat-square&logo=nodedotjs&logoColor=white" />
  </a>
  <a href="https://www.mysql.com">
    <img alt="MySQL" src="https://img.shields.io/badge/MySQL-005C84?style=flat-square&logo=mysql&logoColor=white" />
  </a>
  <a href="https://redis.io">
    <img alt="Redis" src="https://img.shields.io/badge/Redis-D82C20?style=flat-square&logo=redis&logoColor=white" />
  </a>
  <a href="https://socket.io">
    <img alt="Socket.IO" src="https://img.shields.io/badge/Socket.IO-010101?style=flat-square&logo=socketdotio&logoColor=white" />
  </a>
  <a href="https://www.python.org">
    <img alt="Python" src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" />
  </a>
  <a href="https://www.rust-lang.org">
    <img alt="Rust" src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" />
  </a>
</p>

<p align="center">
  <strong>Licence :</strong> Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0) · <a href="./LICENSE">LICENSE</a>
</p>

Movix est un monorepo produit pour une plateforme de streaming communautaire. Le frontend, l'API principale, la WatchParty, les proxies, les outils navigateur et plusieurs briques d'infra vivent dans le même dépôt parce qu'ils évoluent ensemble.

Ce n'est pas un simple duo "frontend + backend". Une feature peut très vite traverser plusieurs couches à la fois : interface React, persistance locale, sync backend, extraction vidéo, proxy Python et parfois extension navigateur.

## Le groupe ix

Movix fait partie d'**ix**, une petite famille de projets dont les noms finissent en « ix ». Ils partagent la même identité : une lettre entre deux crochets, et une couleur par projet.

<p align="center">
  <img src="./brand/groupe-ix.svg" alt="ix" width="72" />
  <img src="./brand/movix.svg" alt="Movix" width="72" />
  <img src="./brand/loadix.svg" alt="Loadix" width="72" />
</p>

| Projet | Logo | Rôle |
| --- | --- | --- |
| ix | `[ix]` en noir | le groupe ; il reste neutre pour laisser sa couleur à chaque projet |
| Movix | `[M]` en rouge, crochets perforés comme une pellicule | streaming de films, séries et anime |
| [Loadix](https://loadix.fun) | `[L]` en bleu | index communautaire francophone de releases DDL et NZB |

Les annonces des projets passent par le canal Telegram [t.me/ix_annonces](https://t.me/ix_annonces). Les logos, leurs versions rondes pour les avatars et le script qui les génère sont dans [`brand/`](brand/).

## Ce que contient le repo

| Zone | Rôle | Documentation |
| --- | --- | --- |
| `src/` | Frontend Vite + React + TypeScript | [Frontend](src/README.md) |
| `Dockerfile` + `server/` | Build et hébergement du frontend avec Hono | [Déploiement Docker](docs/deployment-docker.md) |
| `cloudflare-cache-rules.json` | Cache Cloudflare des miroirs frontend | [Règles de cache](#cache-cloudflare-du-frontend) |
| `API/Mainapi/` | Backend principal clusterisé | [Main API](API/Mainapi/README.md) |
| `API/watchpartyAPI/` | Service temps réel WatchParty | [WatchParty API](API/watchpartyAPI/README.md) |
| `API/proxiesembed/` | Proxy aiohttp pour embeds, flux et DRM | [Proxies Embed](API/proxiesembed/README.md) |
| `extension/` + `userscript/` | Outils navigateur Movix | [Movix OS](README_MOVIX_OS.md) |
| `app/` | App mobile React Native (Android OK, iOS non testé) | [App mobile](app/README.md) |
| `wasm/watchparty-sync/` | Moteur Rust/WASM de la Sync Pro | [WatchParty Sync WASM](wasm/watchparty-sync/README.md) |
| `cloudflareproxy/` | Worker Cloudflare CORS/proxy | [Cloudflare Proxy](cloudflareproxy/README.md) |

## Architecture du monorepo

```text
movix-main/
|-- src/                        # Frontend principal
|-- public/                     # Assets statiques et artefacts WASM publiés
|-- API/
|   |-- Mainapi/                # Backend actif
|   |-- watchpartyAPI/          # Temps réel WatchParty
|   `-- proxiesembed/           # Proxy Python haute charge
|-- extension/                  # Extension Chrome / Firefox
|-- userscript/                 # Variante Tampermonkey
|-- app/                        # App mobile React Native (Android/iOS)
|-- wasm/watchparty-sync/       # Sync Pro en Rust/WASM
|-- cloudflareproxy/            # Worker Cloudflare
|-- functions/                  # Handlers serverless annexes
`-- PreMid/                     # Présence PreMiD
```

## Démarrage rapide

<p align="center">
  <strong>⚠️ L'utilisation de ce code implique le maintien des crédits et l'interdiction stricte de le monétiser (Zéro pub et abonnements). Voir la License complète </strong>
</p>

### Prérequis

- Node.js 18+ et npm
- Python 3.10+ pour les services Python
- MySQL et Redis pour `API/Mainapi`
- Rust + `wasm-bindgen` seulement si tu touches la Sync Pro WASM
- React Native CLI + Android Studio (et Xcode + CocoaPods sur Mac) seulement si tu touches l'app mobile `app/` — iOS n'a pas été testé, voir [`app/README.md`](app/README.md)

### Installer les dépendances utiles

```bash
npm install
cd API/Mainapi
npm install
```

`API/watchpartyAPI/` n'a pas son propre `package.json` : il consomme les dépendances du `node_modules` racine.

### Configurer les `.env` avant de lancer quoi que ce soit

Ne saute pas cette étape. Une bonne partie du monorepo dépend des variables d'environnement pour les URLs, la base de données, Redis, les proxys, TMDB, Turnstile et plusieurs intégrations de lecture.

```bash
# Frontend
cp .env.example .env

# API principale
cp API/Mainapi/.env.example API/Mainapi/.env

# WatchParty
cp API/watchpartyAPI/.env.example API/watchpartyAPI/.env

# Proxy embed
cp API/proxiesembed/.env.example API/proxiesembed/.env
```

### Lancer le minimum utile en local

```bash
# Frontend - http://localhost:3000
npm run dev
```

```bash
# Backend principal - http://localhost:25565
cd API/Mainapi
npm run dev
```

```bash
# WatchParty - http://localhost:25566
node API/watchpartyAPI/watchparty.js
```

Services optionnels selon la zone que tu touches :

```bash
# Proxy embed
cd API/proxiesembed
pip install -r requirements.txt
python server.py
```

## Configuration

Les fichiers d'exemple ou de config existants sont déjà dans le repo :

- Frontend : `.env.example`
- API principale : `API/Mainapi/.env.example`
- WatchParty : `API/watchpartyAPI/.env.example`
- Proxy embed : `API/proxiesembed/.env.example`

Les variables frontend les plus importantes sont `VITE_MAIN_API`, `VITE_WATCHPARTY_API`, `VITE_PROXIES_EMBED_API` et `VITE_SITE_URL`.

Pour un premier lancement local, configure au minimum :

- `/.env`
- `API/Mainapi/.env`
- `API/watchpartyAPI/.env`

### Cache Cloudflare du frontend

Le fichier [`cloudflare-cache-rules.json`](cloudflare-cache-rules.json) contient
le modèle commun des quatre Cache Rules des neuf miroirs listés dans `domains`.
La règle HTML a été ajoutée le 28 septembre 2026, après les trois règles
initiales du 26 septembre. Les domaines de `html_only_domains` (`movix.help`
et `movix.online`) ont uniquement reçu cette nouvelle règle HTML, leur
hébergement étant distinct. Chaque règle vise uniquement le domaine
racine et son hôte `www`, sans cibler les API ni les autres sous-domaines.

Conserver cet ordre :

| Ordre | Règle | Politique |
| --- | --- | --- |
| 1 | Frontend par défaut | Hors cache Cloudflare ; le navigateur respecte les en-têtes de l'origine |
| 2 | Médias publics identifiés | Cache selon l'origine : actuellement 24 heures, avec `stale-while-revalidate` |
| 3 | Bundles Vite sous `/assets/` | Cache selon l'origine : actuellement un an, avec `immutable` |
| 4 | HTML public identifié | Éligible selon l'origine ; 60 secondes lorsque le nouveau frontend fournit son en-tête CDN |

Les trois règles positives excluent les requêtes contenant `Authorization`,
quelle que soit la casse du nom de l'en-tête. Elles ne stockent pas les
réponses HTTP 400 à 599 dans le cache Cloudflare (`status_code_ttl: -1`).
Sans en-tête de cache à l'origine, elles ne mettent pas la réponse en cache
(`bypass_by_default`). Les paramètres d'URL restent dans la clé de cache.

La règle HTML ne force aucun TTL : le frontend en production au moment de
l'ajout émettait encore `no-cache, must-revalidate`. Le cache de 60 secondes
dépend du déploiement du serveur qui émet `Cloudflare-CDN-Cache-Control`.
Les pages privées, l'API et les autres sous-domaines ne sont pas visés par
cette règle. `movix.online` utilise un autre projet Pages et `movix.help` un
autre serveur : leurs en-têtes doivent être adaptés dans leur hébergement.

Pour appliquer le modèle à une zone, remplacer `{{DOMAIN}}` dans les
expressions par son domaine, puis envoyer uniquement l'objet `ruleset` à
`PUT /zones/{zone_id}/rulesets/phases/http_request_cache_settings/entrypoint`.
`domains`, `html_only_domains` et `phase` sont des métadonnées du fichier, pas des champs de ce
corps de requête. Cet appel remplace toutes les Cache Rules de la zone :
sauvegarder et comparer les règles existantes avant de l'utiliser.

Pour ajouter seulement le HTML, envoyer la règle `movix_public_html_origin`
à `POST /zones/{zone_id}/rulesets/{ruleset_id}/rules` après substitution du
domaine. Vérifier d'abord l'absence de ce `ref` pour éviter les doublons ;
utiliser PATCH sur son identifiant si elle existe déjà. Cette opération
préserve les autres règles. Pour les domaines de `html_only_domains`, ne pas
appliquer automatiquement le modèle complet des neuf miroirs.

Ce fichier ne contient aucun token et n'est pas appliqué automatiquement par
le build ou le déploiement Docker. Les en-têtes du serveur sont décrits dans
le [guide de déploiement Docker](docs/deployment-docker.md).

## Comment s'orienter vite

- Feature frontend : commence par `src/App.tsx`, puis la page cible dans `src/pages/`.
- Auth, profils, persistance : regarde `src/context/`, `src/App.tsx`, `API/Mainapi/routes/authRoutes.js` et `API/Mainapi/routes/sync.js`.
- Lecture vidéo et proxies : recoupe `src/pages/Watch/`, les composants player, `API/Mainapi/liveTvRoutes.js`, `API/proxiesembed/` et parfois `extension/`.
- WatchParty : vérifie à la fois `API/watchpartyAPI/watchparty.js`, `src/pages/WatchParty*.tsx`, `src/hooks/useWatchParty.ts`, `src/utils/watchparty*.ts` et `src/workers/watchpartySync.worker.ts`.
- Browser tooling : si tu modifies l'extension, compare toujours `extension/Chrome/` et `extension/Firefox/`, puis vérifie si le userscript doit suivre.
- Sync Rust/WASM : modifie `wasm/watchparty-sync/`, puis rebuild `public/wasm/watchparty-sync/`.

## Points importants avant de contribuer

- Le backend actif est `API/Mainapi/`. Le vieux contenu directement sous `API/` n'est plus la référence.
- Ce monorepo n'utilise pas de workspace tooling : chaque sous-projet garde ses scripts.
- Une partie importante de l'état produit vit dans `localStorage` et dans la sync backend. Ne raisonne pas "base de données only".
- Le lint frontend se lance à la racine avec `npm run lint`.
- Il n'y a pas de suite de tests globale fiable pour tout le repo. Vérifie au minimum les scripts touchés et le comportement manuel.

## Documentation par module

- [Frontend](src/README.md)
- [Services backend](API/README.md)
- [Main API](API/Mainapi/README.md)
- [WatchParty API](API/watchpartyAPI/README.md)
- [Proxies Embed](API/proxiesembed/README.md)
- [Movix OS](README_MOVIX_OS.md)
- [Extension navigateur](extension/README.md)
- [Userscript Tampermonkey](userscript/README.md)
- [App mobile React Native](app/README.md) — Android fonctionnel, iOS non testé (aide recherchée)
- [WatchParty Sync WASM](wasm/watchparty-sync/README.md)
- [Cloudflare Proxy](cloudflareproxy/README.md)

## Licence

Ce projet est distribué sous licence Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0). Le texte complet est disponible dans [LICENSE](LICENSE).

## Avertissement

Ce projet est fourni uniquement à des fins éducatives, de recherche et de démonstration.
Il n'encourage ni ne cautionne une utilisation illégale, le contournement de droits, ou toute violation des lois applicables.
Chaque utilisateur est seul responsable de l'usage qu'il en fait.
