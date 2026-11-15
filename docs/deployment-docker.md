# Déploiement Docker du frontend

Le `Dockerfile` construit les bundles Vite moderne et legacy puis les sert avec le petit serveur
Hono de `server/`. L'image finale contient uniquement `dist/`, les dépendances
de production du workspace `server`, ses fichiers d'exécution et le helper
`functions/_lib/socialPreview.js`.

## Construire l'image

BuildKit est requis, car le Dockerfile utilise des caches, des copies avec
`--link` et `--exclude`, ainsi qu'un secret de build facultatif. La syntaxe
Dockerfile est fixée à `docker/dockerfile:1.19`. Docker Engine 25 ou plus est
requis pour la fréquence du healthcheck au démarrage. `VITE_SITE_URL` est
obligatoire. Les autres valeurs sont à adapter au déploiement :

```powershell
docker build --tag movix-frontend `
  --build-arg VITE_SITE_URL=https://example.com `
  --build-arg VITE_MAIN_API=https://api.example.com `
  --build-arg VITE_TMDB_API_KEY=public-tmdb-key `
  --build-arg VITE_WATCHPARTY_API=https://watchparty.example.com `
  --build-arg VITE_PROXIES_EMBED_API=https://proxy.example.com `
  .
```

Les paramètres `VITE_*` sont publics : Vite les inscrit dans les fichiers
JavaScript servis au navigateur. Ils ne doivent pas contenir de secret.

Le Dockerfile accepte aussi les paramètres publics documentés dans
`.env.example` pour Turnstile, les notifications, le support, l'analytique, les
publicités, les miroirs et le DSN GlitchTip. `VITE_APP_BUILD_ID` identifie le
build ; à défaut, Vite utilise `COMMIT_REF`, puis la date de construction.
Fournir le SHA du commit permet de retrouver la version déployée.

Les deux variantes et leurs polyfills restent dans `dist/assets/`. Le serveur
les sert avec un cache immutable, tandis que `index.html` doit être revalidé.
Les navigateurs choisissent leur variante à l'ouverture de la page. Aucun
paramètre Docker supplémentaire n'est nécessaire pour activer le legacy.

Le serveur applique aussi cette politique au runtime Docker : les réponses
d'erreur (statut HTTP 400 ou supérieur) et `/health` sont `no-store`. Les
fichiers sous `/wasm/watchparty-sync/` utilisent `no-cache, must-revalidate`
afin que le chargeur JavaScript et le binaire WASM soient chacun revalidés
avant réutilisation.
Les autres médias publics, dont le nom n'est pas hashé, restent cacheables
pendant 24 heures avec `stale-while-revalidate`.

## Conservation des fichiers entre déploiements

Dans **Configuration → Persistent Storage** de l'application frontend Coolify,
ajouter un **Directory Mount** :

- source sur le serveur : `/data/frontend-assets/movix` ;
- destination dans le conteneur : `/app/asset-history` ;
- propriétaire : UID/GID `1000:1000` (`node` dans l'image).

L'image définit déjà `ASSET_HISTORY_DIR=/app/asset-history`. Un seul montage
couvre tous les domaines servis par cette application. Une autre application
ou un autre serveur doit disposer de son propre montage et du même code ; les
domaines hébergés sur Pages, Vercel ou une autre image ne sont pas modifiés par
ce déploiement. Garder le suffixe des PR pour isoler leurs dossiers, et prévoir
les mêmes permissions sur ces dossiers. Ne pas monter le stockage sur
`/app/dist` : les nouveaux fichiers du build seraient masqués.

Avant le **premier** redéploiement, transférer
[`scripts/seed-frontend-assets.sh`](../scripts/seed-frontend-assets.sh) sur le
serveur et exécuter avec le nom du conteneur Movix encore actif :

```bash
sudo bash seed-frontend-assets.sh movix NOM_DU_CONTENEUR_MOVIX
```

Le script prépare les permissions et copie uniquement `index.html` et
`assets/`, sans redémarrer le conteneur. Le nouveau serveur importe cette
version au démarrage avant de publier la sienne. Un import déjà présent n'est
pas écrasé ; sans import initial, la conservation commence avec le nouveau
build et ne récupère pas les fichiers déjà supprimés.

L'archive conserve la version actuelle et au moins les trois précédentes,
ainsi que chaque version utilisée depuis moins de sept jours. Un marqueur
renouvelé chaque minute protège les versions encore actives, y compris pendant
les chevauchements et rollbacks. Le nettoyage s'exécute au démarrage puis chaque
heure et conserve les fichiers partagés par les versions retenues. La copie
et le nettoyage sont coordonnés entre conteneurs. Les fichiers courants restent
prioritaires ; les fichiers archivés répondent aux mêmes URL `/assets/...`.
Seuls les fichiers hashés sont archivés, sans HTML ni source maps. Le serveur
refuse de démarrer si le montage configuré n'est pas inscriptible.

## Cache HTML préparé pour Cloudflare

Le HTML reste `Cache-Control: no-cache` côté navigateur. Les pages publiques
`/`, `/index.html`, `/movies`, `/anime`, `/tv-shows`, `/collections`, `/search`,
`/about`, `/privacy`, `/terms-of-service`, `/extension`, `/app`, `/list-catalog`,
`/top10`, `/calendar`, `/live-tv`, `/cinegraph`, `/movie/:id` et `/tv/:id` émettent
`Cloudflare-CDN-Cache-Control: public, max-age=60` pour les réponses 200 aux
requêtes GET/HEAD sans `Authorization` ni réponse `Set-Cookie`. Les autres
pages et fichiers de pilotage restent `no-store` côté CDN. Les paramètres
d'URL, notamment la langue des aperçus, doivent rester dans la clé de cache.

Cette préparation s'applique à tous les hôtes servis par le conteneur. Le
28 septembre 2026, la règle `movix_public_html_origin` a été ajoutée après
les règles existantes sur les onze zones `movix.*` du compte, pour le domaine
racine et `www`. Elle rend ces pages éligibles en respectant les en-têtes de
l'origine. Le cache de 60 secondes ne devient effectif qu'après le déploiement
du nouveau serveur ; les réponses actuelles `no-cache` continuent à revalider.
Les hébergements distincts de `movix.help` et `movix.online` doivent fournir
leurs propres en-têtes. Voir le modèle `cloudflare-cache-rules.json` et le
[README principal](../README.md#cache-cloudflare-du-frontend) pour le périmètre.

## Cache des avatars

Dans Docker, `public/avatars/` est exclu de la copie vers le builder. Vite
compile le frontend et copie les autres fichiers publics comme auparavant.
Les avatars rejoignent directement `dist/avatars/` dans l'image finale via
une copie `--link`, séparée du reste de `dist/`. Les URL `/avatars/...` restent
inchangées et les images sont toujours embarquées dans l'image Docker.

La couche des avatars peut ainsi être réutilisée quand seul le JavaScript
change. Une modification limitée aux fichiers d'avatars ne relance pas Vite
si les autres entrées et paramètres du build restent identiques. Les avatars
restent dans le contexte Docker : cette séparation réduit les copies et les
exports de couches, pas la taille du contexte ni celle de l'image finale.
Les builds Vite hors Docker conservent leur comportement habituel et copient
toujours les avatars dans `dist/`.

## Source maps GlitchTip

`GLITCHTIP_AUTH_TOKEN` est un secret. Il ne doit pas être transmis avec
`--build-arg`. Quand la plateforme sait monter un secret BuildKit, le fichier
doit porter l'identifiant `glitchtip_auth_token` :

Une fois `GLITCHTIP_AUTH_TOKEN` défini dans l'environnement du processus
Docker :

```powershell
docker build --tag movix-frontend `
  --secret id=glitchtip_auth_token,env=GLITCHTIP_AUTH_TOKEN `
  --build-arg VITE_SITE_URL=https://example.com `
  --build-arg VITE_GLITCHTIP_DSN=https://public-dsn.example `
  --build-arg GLITCHTIP_URL=https://glitchtip.example.com `
  .
```

Sans prise en charge des secrets de build, omettre ce montage. Le build reste
fonctionnel, mais il ne produit ni n'envoie les source maps GlitchTip.

## Variables d'exécution

Le serveur écoute sur `PORT`, avec `3001` par défaut. Les aperçus sociaux sont
calculés côté serveur et lisent leurs propres variables au démarrage :

- `TMDB_API_KEY` ou `VITE_TMDB_API_KEY` pour les métadonnées TMDB ;
- `WATCHPARTY_API` ou `VITE_WATCHPARTY_API` pour les liens WatchParty.

Ces valeurs doivent être configurées comme variables d'exécution du conteneur,
même si leurs variantes `VITE_*` ont aussi été fournies au build.

```powershell
docker run --rm --publish 3001:3001 `
  --env PORT=3001 `
  --env TMDB_API_KEY=runtime-tmdb-key `
  --env WATCHPARTY_API=https://watchparty.example.com `
  movix-frontend
```

La route `/health` sert de sonde HTTP. Les fichiers WASM de WatchParty sont
copiés dans `dist/` par Vite depuis `public/wasm/`; `robots.txt`, `llms.txt` et
`sitemap.xml` suivent le même chemin.

## Contrôle de santé dans Coolify

Le Dockerfile configure une période initiale de 5 secondes, avec une sonde
toutes les secondes pendant le démarrage. Après un succès, le contrôle
reprend son intervalle de 30 secondes ; le timeout reste à 5 secondes et le
seuil à 3 échecs consécutifs.

Pour une application Coolify existante, aligner aussi **Health Checks → Start
Period** sur **5 secondes**. Coolify peut conserver en base une ancienne valeur
extraite du Dockerfile et l'utiliser pour son attente de déploiement. Garder
**Interval = 30 secondes**, **Timeout = 5 secondes** et **Retries = 3** ;
`start-interval=1s` est géré par Docker. Cette synchronisation évite que le
premier contrôle Coolify arrive trop tôt puis attende un intervalle complet.
Le temps effectivement gagné doit être confirmé lors du prochain déploiement.
