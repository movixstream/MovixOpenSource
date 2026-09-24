# AGENTS.md — Movix

## Documentation

Les préférences générales viennent du `AGENTS.md` global Codex. Les fichiers `CLAUDE.md` restent propres à Claude ; ne pas en importer les outils, modèles ou hooks.

Consulter l’index du [README principal](README.md), puis seulement les sections utiles au travail. Rechercher avant de lire un fichier volumineux. Vérifier les versions et commandes dans les manifestes actuels.

| Zone | Documentation |
| --- | --- |
| Frontend, routage et état | [src/README.md](src/README.md) |
| Auth, profils, sync, sources et Live TV | [Main API](API/Mainapi/README.md) |
| Services backend et WatchParty | [Services](API/README.md), [WatchParty](API/watchpartyAPI/README.md) |
| Extraction, proxy et DRM | [Proxies Embed](API/proxiesembed/README.md) |
| Chrome, Firefox et Tampermonkey | [Extension](extension/README.md), [Userscript](userscript/README.md) |
| React Native, WebView et plateformes mobiles | [App](app/README.md) |
| Rust et WebAssembly | [WatchParty Sync](wasm/watchparty-sync/README.md) |

## Périmètre de travail

- Travailler sur `main`, sans nouvelle branche ni worktree sauf demande explicite contraire.
- Ne pas ouvrir de panneau navigateur ni lancer de serveur de développement sans demande explicite. Une validation statique ne prouve pas le rendu visuel.
- Raisonner à partir de ce checkout : les autres copies de Movix évoluent séparément.
- Conserver les crédits et respecter [LICENSE](LICENSE). Une connexion MCP ou un déploiement nécessite une demande correspondante ; les exemples de client ne constituent pas une autorisation.

## Conventions à préserver

- Le frontend est une SPA React/TypeScript avec Vite. `next.config.js` est historique. Les versions exactes viennent des manifestes et lockfiles.
- Respecter le système de modules du package : ESM à la racine, **CommonJS dans `API/Mainapi/`** (`require`, `module.exports`). Ne pas convertir le backend implicitement.
- Frontend : composants fonctionnels en PascalCase, hooks préfixés `use`, alias `@/`, Tailwind, primitives Radix/shadcn et Context pour l’état global. Respecter les patterns du module plutôt qu’ajouter une nouvelle bibliothèque d’état.
- Passer les appels API par `src/services/` et les textes d’interface par `t()` ; garder les traductions FR/EN synchronisées. Les URLs runtime viennent de `src/config/runtime.ts`.
- Main API : requêtes MySQL paramétrées, authentification sur les routes protégées, protections et limitations existantes conservées. Respecter l’injection de dépendances et le cycle de vie du cluster avant de toucher pools, caches ou ressources partagées.
- Proxy Python : conserver l’asynchronisme aiohttp et les conventions des extracteurs du module. Ne pas y transposer les middlewares Node.
- Ne jamais committer de `.env` ni de secrets. Chaque service a sa propre configuration ; `API/watchpartyAPI/` utilise les dépendances Node de la racine.

## Changements qui traversent plusieurs modules

- Auth et profils : frontend, `localStorage` et `/api/sync` ; préserver l’isolation des profils et les restrictions d’âge.
- Lecture : vérifier les pages `src/pages/Watch/`, les players et, selon le problème, Main API, le proxy Python ou l’extension.
- Extensions : comparer Chrome MV3 et Firefox MV2 et reporter les changements de logique partagée dans les deux variantes. Vérifier également le userscript.
- Le userscript est embarqué dans l’app mobile : vérifier le bridge et régénérer avec `node app/scripts/build-userscript.js` si nécessaire. Ne pas modifier directement une source générée.
- Sync Pro : vérifier serveur WatchParty, hook, worker et Rust ensemble. La sortie générée est `public/wasm/watchparty-sync/` ; conserver le repli JavaScript.
- Service worker personnalisé : `public/sw.js`, enregistré dans `src/main.tsx`. Le repli de domaine concerne aussi `src/services/blockDetection.ts` ; vérifier la configuration actuelle, sans reprendre d’anciens domaines ou TTL.
- Hébergement : `build:cf`, `build:coolify` et `server/index.js` couvrent plusieurs cibles. Vérifier celle du déploiement demandé.

## Tests et vérification

- Ne jamais écrire de tests unitaires après avoir écrit le code qu’ils vérifient.
- Privilégier fortement les tests de bout en bout (E2E) comme seul mécanisme de test. Les utiliser pour vérifier le fonctionnement des fonctionnalités complexes.
- Terminer chaque exécution E2E par un artefact vérifiable et reproductible : rapport accompagné des traces, captures ou sorties pertinentes, avec la commande de relance, les prérequis, les données utilisées et les résultats attendus et observés. Ne pas y inclure de secrets.
- Si un système doit être testé en isolation, commencer par consigner tous ses modes de défaillance identifiés et expliquer lesquels échappent aux E2E existants. Écrire ensuite les tests nécessaires à partir de cette analyse, avant le code testé, avec des assertions indépendantes de l’implémentation.
- Supprimer les tests unitaires sans protection supplémentaire contre un bug réel : doublons des E2E, assertions sur le texte ou la structure du code, constantes triviales, snapshots de détails internes, mocks qui ne vérifient qu’eux-mêmes ou logique de production recopiée dans le test.

Il n’y a pas de script `npm test` à la racine. Les scénarios navigateur sont dans `tests/*.browser.*` ; des tests isolés et d’intégration subsistent dans les modules pour leurs défaillances spécifiques. Les README des modules indiquent les commandes utiles.

Les contrôles ci-dessous sont des repères à utiliser lorsqu’une vérification est explicitement demandée. Sinon, se limiter à la lecture ciblée du code et du diff.

| Modification | Contrôle adapté |
| --- | --- |
| Documentation | Diff, liens et cohérence avec les scripts/code cités |
| Frontend | Scénario E2E ciblé avec artefact ; lint ou build selon la demande |
| Types frontend | TypeScript local avec la configuration du package ; le build Vite seul ne contrôle pas les types |
| Main API | Scénario E2E ciblé ; `node --check <fichier>` pour une vérification de syntaxe |
| Rust/WASM | `npm run wasm:watchparty-sync:build` pour vérifier la compilation du moteur |

Ne pas lancer de suite générale sans rapport. Distinguer les problèmes préexistants des régressions et indiquer uniquement les contrôles réellement exécutés.
