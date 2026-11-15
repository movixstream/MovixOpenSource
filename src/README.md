# Frontend Movix

Le frontend Movix porte l'expérience utilisateur complète : navigation dans le catalogue, pages détails, lecture vidéo, Live TV, WatchParty, profils, listes partagées, Wishboard, VIP et Wrapped.

Le point important pour contribuer ici : `src/App.tsx` ne fait pas que router. Il centralise aussi plusieurs comportements transverses, dont la persistance locale et la sync de certains morceaux de `localStorage` vers `POST /api/sync`.

## Démarrage

```bash
cp .env.example .env
npm install
npm run dev
```

Le serveur Vite écoute sur `http://localhost:3000`.

Commandes utiles :

```bash
npm run lint
npm run build
npm run preview
npm run wasm:watchparty-sync:setup
npm run wasm:watchparty-sync:build
```

## Ce que le frontend gère

- découverte de films, séries, anime, collections et fiches personnes
- pages de lecture pour films, séries et anime
- Live TV et providers annexes
- WatchParty, création de room, join, liste publique et Sync Pro
- comptes, auth, profils multiples et sessions
- listes partagées, suggestions, Wishboard et soumission de liens
- pages VIP, dons, cadeaux, invoices et Wrapped

## Variables d'environnement utiles

Les variables principales sont documentées dans `.env.example` :

- `VITE_MAIN_API`
- `VITE_TMDB_API_KEY`
- `VITE_SITE_URL`
- `VITE_WATCHPARTY_API`
- `VITE_PROXIES_EMBED_API`
- `VITE_SUPPORT_TELEGRAM_URL`
- `VITE_TURNSTILE_SITE_KEY`
- `VITE_TURNSTILE_INVISIBLE_SITEKEY`
- `VITE_TURNSTILE_DOMAINS_n`, `VITE_TURNSTILE_SITE_KEY_n` et `VITE_TURNSTILE_INVISIBLE_SITEKEY_n` (n de 2 à 10) : paires de widgets Turnstile supplémentaires au-delà de 10 domaines, choisies selon le domaine courant par `src/utils/turnstileKeys.ts`

La normalisation des URLs runtime est centralisée dans `src/config/runtime.ts`.

## Architecture

```text
src/
|-- main.tsx                 # Point d'entrée
|-- App.tsx                  # Routing principal + comportements transverses
|-- pages/                   # Une page = une route
|-- components/              # UI et composants métier
|-- context/                 # État global via React Context
|-- services/                # Appels HTTP
|-- hooks/                   # Hooks custom
|-- utils/                   # Helpers
|-- config/                  # Runtime, Firebase, proxies
|-- workers/                 # Web workers, dont WatchParty Sync
|-- i18n/                    # Traductions
`-- components/ui/           # Primitives UI réutilisables
```

## Routes à connaître

Le routeur principal est dans `src/App.tsx`. Les grandes familles de routes sont :

- navigation catalogue : `/`, `/movies`, `/tv-shows`, `/collections`, `/movie/:id`, `/tv/:id`
- lecture : `/watch/movie/:tmdbid`, `/watch/tv/:tmdbid/s/:season/e/:episode`, `/watch/anime/...`
- social / communautaire : `/wishboard`, `/list/:shareCode`, `/top10`, `/wrapped`
- compte / profils / VIP : `/profile`, `/profile-selection`, `/settings`, `/vip`, `/vip/don`
- temps réel : `/watchparty/create`, `/watchparty/join`, `/watchparty/room/:roomId`
- services annexes : `/live-tv`, `/debrid`, `/extension`, `/ftv`

## État global

Movix n'utilise ni Redux ni Zustand. L'état global passe surtout par React Context, le stockage local et quelques synchronisations backend.

Les contexts à connaître en premier :

- `AuthContext.tsx`
- `ProfileContext.tsx`
- `SearchContext.tsx`
- `VipModalContext.tsx`
- `AdFreePopupContext.tsx`
- `AdWarningContext.tsx`
- `IntroContext.tsx`

## Où intervenir selon le sujet

- Auth et persistance : `src/App.tsx`, `src/context/AuthContext.tsx`, `src/context/ProfileContext.tsx`
- Calls backend : `src/services/` puis les pages/composants consommateurs
- WatchParty : `src/pages/WatchParty*.tsx`, `src/hooks/useWatchParty.ts`, `src/utils/watchparty.ts`, `src/workers/watchpartySync.worker.ts`
- Lecture vidéo : `src/pages/Watch/` et les composants `*Player*`
- Traductions : `src/i18n/`

## Notes de contribution

### Bundles moderne et legacy

Les builds de production (`build`, `build:cf`, `build:coolify`) produisent deux variantes du JavaScript à partir du même code. `@vitejs/plugin-legacy` choisit les modules natifs sur les moteurs modernes et charge SystemJS avec les chunks legacy sur les moteurs plus anciens. La cible legacy comprend Chrome 53, Edge 79, Firefox 67 et Safari/iOS 15. Le serveur doit publier tout `dist/`, y compris les fichiers `*-legacy-*.js` et les polyfills ; voir le [déploiement Docker](../docs/deployment-docker.md).

Les polyfills JavaScript legacy sont calculés par le plugin. La liste `modernPolyfills` dans `vite.config.ts` est explicite : elle reprend les polyfills détectés sur le bundle moderne et évite de relancer une analyse Babel sur chaque chunk moderne à chaque build. Les deux variantes et leur sélection automatique restent actives.

Après une évolution des API JavaScript utilisées, des dépendances ou des cibles navigateur, réévaluer cette liste : remplacer temporairement `modernPolyfills` par `true`, lancer un build avec `DEBUG=vite:legacy`, puis reprendre le Set `modern polyfills` affiché. Convertir par exemple `core-js/modules/es.promise.with-resolvers.js` en `es.promise.with-resolvers` et rétablir la liste explicite. Un import extérieur à `core-js` doit aller dans `additionalModernPolyfills`. La détection doit couvrir tous les chunks, y compris ceux chargés à la demande.

`compat/legacy-dom-polyfills.js` complète les API DOM nécessaires avec AbortController/fetch, IntersectionObserver et ResizeObserver, uniquement dans la variante legacy. L'annulation de fetch émulée rejette la promesse mais ne peut pas interrompre physiquement la connexion réseau. Les scripts classiques intégrés à `index.html` restent écrits en ES5, car Vite ne les transpile pas.

Les workers sont compilés séparément avec une cible de syntaxe Chrome 68 et ne reçoivent pas les polyfills de la page. Si le worker de Sync Pro échoue ou ne confirme pas son démarrage sous cinq secondes, WatchParty utilise localement la synchronisation classique. Les hauteurs de WatchParty ont un repli `vh`, et les cartes de personnages et Live TV réservent leur ratio sans dépendre de `aspect-ratio`.

Ces cibles de compilation ne garantissent pas à elles seules le fonctionnement complet sur une TV. La lecture dépend aussi des codecs, des API multimédias et des lecteurs tiers. La validation d'une ancienne version doit utiliser les fichiers du build de production sur le moteur concerné ; le serveur de développement Vite ne sert pas de bundle legacy.

### Espacements sur les anciennes WebView Android

`main.tsx` initialise `utils/flexGapSupport.ts`. Une mesure réelle détecte l'absence de `gap` en Flexbox ; l'User-Agent Android ne permet pas de la déduire. Sur ces seuls moteurs, le repli suit les éléments rendus, les états et les changements de largeur, puis ajoute les marges nécessaires. Les composants conservent leurs classes `gap-*` habituelles, et les grilles ne sont pas modifiées. Les carrousels utilisent `hooks/useFlexGapEmblaCarousel.ts` pour recalculer leurs positions lorsque ces marges changent.

Ce repli privilégie un espacement utilisable sans réorganiser le DOM React. Les groupes avec retour à la ligne peuvent conserver une petite gouttière extérieure. Les groupes ayant des pseudo-éléments dans le flux ou des enfants `display: contents`, ainsi que les paires encadrées de deux marges automatiques, ne sont pas émulés intégralement.

Les scénarios `node tests/flexGapLayout.browser.mjs`, `node tests/flexGap.browser.mjs` et `node tests/flexGapCarousel.browser.mjs` vérifient les dispositions, les vrais contrôles HLS/votes et le défilement du carrousel, sans serveur ni compte. Ils nécessitent les dépendances npm et Playwright/Chromium. `FLEX_GAP_LEGACY_CHROMIUM` permet de fournir un Chromium antérieur à 84 ; `FLEX_GAP_REPORT_DIR` conserve les mesures, captures et traces. Sans cet exécutable, consulter le rapport pour distinguer les contrôles modernes d'une éventuelle simulation.

### Conventions

- Les imports inutilisés cassent le lint.
- Certaines features de lecture combinent plusieurs players et plusieurs proxies ; évite les simplifications rapides.
- Si tu touches une feature transversale, regarde aussi le backend correspondant dans `API/Mainapi/` ou `API/watchpartyAPI/`.
