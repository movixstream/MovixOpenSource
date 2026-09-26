# Déploiement Docker du frontend

Le `Dockerfile` construit les bundles Vite moderne et legacy puis les sert avec
le petit serveur Hono de `server/`. L'image finale contient uniquement `dist/`,
les dépendances de production du workspace `server`, ses fichiers d'exécution
et le helper `functions/_lib/socialPreview.js`.

## Construire l'image

BuildKit est requis, car le Dockerfile utilise des caches et un secret de
build facultatif. `VITE_SITE_URL` est obligatoire. Les autres valeurs sont à
adapter au déploiement :

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

## Source maps GlitchTip

`GLITCHTIP_AUTH_TOKEN` est un secret. Il ne doit pas être transmis avec
`--build-arg`. Quand la plateforme sait monter un secret BuildKit, le fichier
doit porter l'identifiant `glitchtip_auth_token`.

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
