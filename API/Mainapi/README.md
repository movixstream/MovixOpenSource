# Main API Movix

C'est le cœur applicatif du projet. Si le frontend affiche un catalogue, authentifie un user, synchronise du `localStorage`, gère les commentaires, le Wishboard, le Top 10, le Live TV, le debrid ou les pages VIP, il finit très souvent ici.

Le service tourne en mode cluster via `server.js` : un master lance plusieurs workers, surveille les redémarrages et gère un graceful shutdown. `app.js` monte ensuite Express, Redis, le pool MySQL, les caches disque et les routes injectées par dépendances.

## Ce que le service gère

- auth, sessions et profils
- recherche, metadata TMDB et agrégation de sources
- sync frontend <-> backend pour une partie de l'état utilisateur
- commentaires, likes, listes partagées, Wishboard et soumission de liens
- Live TV, proxies, debrid et intégrations de scraping
- VIP, invoices, wrapped et features communautaires

## Démarrage

```bash
cd API/Mainapi
cp .env.example .env
npm install
npm run dev
```

Ne lance pas le service avec un `.env` vide : MySQL, Redis, JWT, TMDB et plusieurs routes métier en dépendent directement.

Notes utiles :

- le serveur HTTP écoute actuellement sur `http://localhost:25565`
- `server.js` bind aujourd'hui le port `25565` en dur
- `NUM_WORKERS` permet de régler le nombre de workers du cluster ; `WORKER_MAX_RSS_MB` remplace, un par un, les workers qui dépassent ce seuil de mémoire
- MySQL et Redis sont nécessaires pour une grosse partie des routes

## Architecture

```text
API/Mainapi/
|-- server.js                 # Master cluster + workers + graceful shutdown
|-- app.js                    # Bootstrap Express, middleware, deps partagées
|-- mysqlPool.js              # Pool MySQL unique
|-- config/redis.js           # Redis
|-- middleware/               # CORS, sécurité, auth
|-- routes/                   # Modules avec configure(deps)
|-- commentsRoutes.js         # Commentaires
|-- likesRoutes.js            # Likes / dislikes
|-- sharedListsRoutes.js      # Listes partagées
|-- liveTvRoutes.js           # Live TV
|-- wishboardRoutes.js        # Wishboard
|-- top10Routes.js            # Classements
|-- wrappedRoutes.js          # Wrapped
|-- linkSubmissionsRoutes.js  # Soumission de liens
|-- utils/                    # Cache, proxies, axios helpers, VIP, etc.
|-- cache/                    # Caches disque
`-- exportscripts/            # SQL et scripts de migration
```

Le pattern important dans `routes/` : beaucoup de modules exposent `configure(deps)`. C'est `app.js` qui injecte les clients HTTP, le cache, les helpers et les constantes partagées avant montage.

## Variables d'environnement à renseigner en premier

Le fichier `API/Mainapi/.env.example` est la référence complète. En pratique, les groupes de variables à traiter en premier sont :

- cœur applicatif : `JWT_SECRET`, `TMDB_API_KEY`, `FRONTEND_BASE_URL`
- données : `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- cache et coordination : `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `NUM_WORKERS`
- scraping / proxy : `PROXY_SERVER_URL`, `IPTV_STREAM_PROXY`, `SOCKS5_PROXIES`, `HTTP_PROXIES`
- anti-abuse / forms : `TURNSTILE_SECRET_KEY`, `TURNSTILE_INVISIBLE_SECRETKEY`, puis `TURNSTILE_DOMAINS_n`, `TURNSTILE_SECRET_KEY_n` et `TURNSTILE_INVISIBLE_SECRETKEY_n` (n de 2 à 10) au-delà de 10 domaines : la clé suit l'`Origin` de la requête (`utils/turnstile.js`)
- connexion Discord / Google : `DISCORD_CLIENT_ID`, `GOOGLE_CLIENT_ID` (les mêmes que `src/config/discord.ts` et `src/config/google.ts`)
- paiement / VIP : variables `VIP_*`, `BLOCKCYPHER_TOKEN`

Certaines intégrations sont très spécifiques à des sources données, par exemple les cookies `DARKIWORLD_*` ou `FSTREAM_LOGIN_*`.

`FSTREAM_BASE_URL` définit le domaine FrenchStream (`https://french-stream.net` par défaut).

Les sources de streaming gardent leurs résultats en cache (Redis si disponible, sinon mémoire du worker) et passent par les proxys de `SOCKS5_PROXIES` / `HTTP_PROXIES`. Cpasmal est coupé par défaut (`CPASMAL_ENABLED=true` pour le réactiver) ; activée, une route Cpasmal sans cache répond `202` avec `Retry-After` : rappeler la même URL.

## Fichiers SQLite pour Darkino / DarkiWorld

La source téléchargements (`routes/darkiworld.js` et `utils/darkiworldSqlite.js`) lit des snapshots SQLite locaux : `mirror.sqlite`, `darkino.sqlite` et `links_small.sqlite`. Ces fichiers ne sont pas versionnés dans le dépôt public.

1. Télécharger [l’archive des fichiers SQLite sur Pixeldrain](https://pixeldrain.com/u/n2M1s1MA).
2. Extraire les fichiers `.sqlite` dans `API/Mainapi/darkino-backups/`.
3. Pour utiliser un autre dossier, définir `DARKIWORLD_SQLITE_DIR` avec son chemin absolu, par exemple `/home/container/darkino-backups`.

Démarrer ou redémarrer Main API après l’installation des fichiers. Sans ces snapshots, les liens absents du cache local peuvent renvoyer `sqlite_miss`. Avec `HYDRACKER_BLACKOUT=true` (valeur par défaut), aucune résolution en direct auprès d’Hydracker ou de DarkiWorld ne prend le relais.

## Points d'entrée utiles

- auth et profils : `routes/authRoutes.js`, `routes/sessions.js`, `routes/profiles.js`
- persistance frontend : `routes/sync.js`, historique et progression : `routes/history.js`
- recherche et catalogues : `routes/search.js`, `routes/tmdb.js`
- scraping / lecture : `routes/cpasmal.js`, `routes/fstream.js`, `routes/wiflix.js`, `liveTvRoutes.js`
- communautaire : `commentsRoutes.js`, `likesRoutes.js`, `sharedListsRoutes.js`, `wishboardRoutes.js`, `linkSubmissionsRoutes.js`
- VIP / paiements : `utils/vipDonations.js`, `routes/vipDonations.js` ; réglages des dons gérés depuis l'admin (montant libre, moyens actifs, cartes cadeaux, contacts) : `utils/vipDonationSettings.js`
- publicités réglées depuis l'admin (emplacements, rotation, ciblage, statistiques) : `routes/monetization.js`, `utils/monetizationSettings.js`, `utils/monetizationPicker.js`, `utils/monetizationStats.js`
- parrainage (code par compte, jours VIP pour le parrain et le filleul, activé depuis l'admin ; temps de visionnage pris au Wrapped) : `routes/referral.js`, `utils/referralProgress.js`, `utils/referralSettings.js`, `utils/referralRules.js`
- promos du grand carrousel (slides ajoutées en haut des pages Accueil, Films, Séries, Plateformes et Animés, réglées depuis l'admin carrousel par carrousel ; images et clics par jour gardés en base) : `routes/heroPromos.js`, `utils/heroPromoSettings.js`, tables du groupe `heroPromo` (`db/schema/heroPromo.js`). Un lien vers un autre site passe par `GET /api/hero-promos/<id>/go`, qui compte le clic puis redirige, comme `/api/go` pour les pubs

## Historique et progression

L'historique, la progression et les marques « Déjà vu » sont stockés en MySQL (`db/schema/history.js`) : `watch_progress`, `watch_history`, `watch_marks`, plus un cache TMDB permanent (`tmdb_media`, `tmdb_episodes`). Les clients continuent d'écrire via `/api/sync` ; le serveur recopie ces clés dans les tables et importe une fois les anciennes données de chaque profil.

Code : `routes/history.js`, `utils/historyStore.js` (rangée « Reprendre »), `utils/historyOverview.js` (onglet Historique du profil), `utils/historyImport.js`, `utils/mediaStore.js` (cache TMDB).

Routes sous `/api/history`, pour les comptes connectés (OAuth ou BIP39) :

| Route | Rôle |
| --- | --- |
| `GET /continue` | rangée « Reprendre » |
| `GET /list` | onglet Historique (filtre `status`, pagination) |
| `GET /title` | avancement d'un film ou d'une série |
| `GET /titles` | avancement de plusieurs films en un appel (`type=movie`, `ids=1,2,3`) |
| `GET` / `POST /progress` | position de lecture |
| `DELETE /continue/:type/:id`, `DELETE /continue` | retirer une carte, ou toutes |
| `DELETE /title/:type/:id` | supprimer un titre de l'historique |

## Liaison d'une télé

`routes/tvLink.js` relie l'appli TV à un compte avec un code à 5 caractères affiché sur la télé : `POST /api/tv/link/start` et `/poll` côté télé, `GET /info` et `POST /confirm` côté site. Nécessite Redis.

## Source anime (anime-sama)

Code : `routes/animeSama.js` (routes sous `/anime`), `utils/animeSamaPages.js` (lecture des pages du site), `utils/animeSamaLinks.js` (adresses des lecteurs), `utils/animeSamaIndex.js` (index du catalogue), `utils/animeSamaTmdbResolver.js` (ID TMDB des fiches qui n'en publient pas), tables du groupe `animeSama` (`db/schema/animeSama.js`).

Depuis le 12/11/2026, le site ne publie plus `episodes.js` : la page de saison liste des repères `lien:<n°>`, et l'adresse d'un lecteur se demande à `/api/lien.php` avec le jeton de la page. Ce point d'entrée refuse tout au-delà d'environ 300 demandes par IP et par tranche de 10 minutes. Les adresses ne sont donc demandées que pour l'épisode qu'un visiteur ouvre, puis gardées dans un carnet par œuvre (`cache/anime-sama/liens/<slug>.json`).

Une tâche de fond, sur un seul worker, lit le sitemap du site, chaque fiche une fois par jour et le planning de la semaine. Chaque fiche porte l'ID TMDB que le site publie : une œuvre se retrouve par cet ID, sans comparer de noms.

Une cinquantaine de fiches ne publient pas d'ID TMDB, mais donnent leur ID AniList et MyAnimeList. `utils/animeSamaTmdbResolver.js` demande alors la correspondance au service ARM (`arm.haglund.dev`) et en déduit le type, série ou film ; un cas douteux reste sans lien. Ce lien ne remplace jamais l'ID que le site publie, et n'est pas posé quand une autre œuvre porte déjà cet ID TMDB. Si ARM ne répond pas, le lien déjà rangé reste.

| Route | Rôle |
| --- | --- |
| `GET /anime/search/:query` | œuvres trouvées par nom, avec saisons et épisodes |
| `GET /anime/tmdb/:type/:id` | œuvre dont la fiche porte cet ID TMDB (`tv` ou `movie`), même forme |
| `GET /anime/episode/:slug?season=<chemin>&episode=<rang>` | adresses des lecteurs d'un épisode |
| `GET /anime/catalogue`, `/anime/catalogue/genres` | catalogue indexé, paginé et filtrable |
| `GET /anime/planning?from=&to=` | sorties annoncées entre deux jours, plus celles prévues la semaine suivante (`estimated: true`) |
| `GET /anime/home?language=fr-FR` | page Animes du site (œuvres TMDB, affiches des genres, rangées du catalogue), calculée une fois par langue ; `202` tant qu'elle n'est pas prête |

Dans la liste d'une œuvre, chaque langue d'un épisode donne `players` (adresses connues) et `pending` (lecteurs dont l'adresse reste à demander par `/anime/episode`).

Le planning du site ne couvre que la semaine en cours, du lundi au dimanche. `/anime/planning` y ajoute la semaine suivante : les sorties de la semaine connue, sept jours plus tard, avec le numéro d'épisode suivant et `estimated: true` (les films et OAV ne sont pas recopiés). Ces sorties prévues ne sont pas rangées en base : elles disparaissent dès que le site publie la semaine, et aucune n'est rendue pour un jour passé. Le statut « Terminé » des fiches ne sert pas de filtre : près de la moitié des séries en cours de diffusion le portent (il décrit souvent la première saison).

Scénario de bout en bout contre le vrai site et une base MySQL de test (nom fini par `_test`), avec rapport (`report.md`, réponses, requêtes, logs) :

```bash
ANIME_SAMA_E2E_MYSQL=mysql://user:motdepasse@127.0.0.1:3306/movix_test node API/Mainapi/scripts/e2e/animeSamaLive.js <dossier du rapport>
```

Il lit une trentaine de fiches et fait une douzaine de demandes à `/api/lien.php` : sans effet sur le quota.

## À garder en tête

- Le backend actif est ici, pas dans l'ancien contenu direct de `API/`.
- Plusieurs tables MySQL sont initialisées automatiquement au démarrage.
- Une partie du comportement applicatif dépend de caches disque et de proxys externes ; un bug peut venir d'ailleurs que du code route lui-même.
- Si une feature touche la lecture vidéo, regarde aussi `API/proxiesembed/` et parfois l'extension navigateur.
