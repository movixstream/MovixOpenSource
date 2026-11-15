# Comptes, VIP, synchronisation et SwiftFlux : l'existant (2026-10-15)

Base des phases 4 et 5. Chemins relatifs à la racine du dépôt movix.

## Comptes et sessions

- Connexion du site : phrase BIP39 (`userType 'bip39'`) ou Discord / Google
  (`'oauth'`), `API/Mainapi/routes/authRoutes.js`. Comptes liés par
  `account_links`.
- JWT HS256 `{sub, userType, sessionId, authMethod}`, **sans expiration**,
  secret `JWT_SECRET` (`middleware/auth.js:33-40`). Chaque route appelle
  `getAuthIfValid(req)` ; la session doit exister dans `user_sessions`
  (révocable par `POST /api/sessions/delete`). `sessionDeviceInfo.js` sait
  déjà marquer `deviceType: 'tv'`.
- Pas de table users/profiles : fichiers JSON `data/users/…` et un fichier par
  profil. 5 profils max.
- **Aucun appairage par code n'existe.** Modèle le plus proche : le serveur
  OAuth2 interne (`routes/oauth.js`, `utils/oauthStorage.js`) — jetons opaques
  hachés en base, codes de 10 min, révocation `revoked_at`.

## Conception retenue pour le code à 5 caractères (phase 4)

Créer à la validation une vraie ligne `user_sessions` (`device.deviceType='tv'`)
et émettre un JWT par `issueJwt` : la télé réutilise alors toutes les routes
`/api/*` (profils, sync, OAuth REST) et apparaît dans la liste des sessions du
site, où on peut la déconnecter.
- `POST /api/tv/link/start` : `deviceCode` (32 octets aléatoires, renvoyé à la
  télé seulement), `userCode` 5 caractères (alphabet sans 0/O/1/I/L),
  `expiresIn 600`, `interval 5`. Stockés dans **Redis** (12 workers recyclés
  toutes les 12 h : rien en mémoire).
- Page site `/tv?code=XXXXX` (cible du QR) : utilisateur connecté, choix du
  profil, `POST /api/tv/link/confirm {userCode, profileId}` avec son JWT.
- `POST /api/tv/link/poll {deviceCode}` toutes les 5 s → `pending` /
  `expired` / `{token, profileId, profile, vip}`. Usage unique.
- Limites Redis (`createRedisRateLimitStore`) sur start, poll et confirm ;
  cinq essais faux par code puis code détruit.

## VIP

- La clé n'est pas liée au compte en MySQL, mais `access_code` est une clé
  synchronisée : elle vit dans le fichier **du profil**.
- `buildVipIdentity` (`oauth.js:326-373`) relit `access_code` et le revérifie
  par `verifyAccessKey` (ignore `is_vip`, falsifiable). À réutiliser : au
  `poll` réussi, renvoyer `{active, expiresAt}` et la clé du profil appairé
  (la télé en a besoin pour `x-access-key`).

## Synchronisation

- `POST /api/sync {userType, profileId, ops[]}` (set, remove, arrayAdd,
  arrayRemove, objPatch), verrou par profil, 180 req/min, 200 ops/requête.
- **Aucun horodatage côté serveur** ; le site recharge le profil en
  remplaçant tout son localStorage (le serveur gagne).
- Clés : `progress_<id>`, `progress_tv_<id>_s<S>_e<E>`
  (`{position, duration, timestamp}`), `continueWatching`, `watchlist_movie`,
  `watchlist_tv`, `watched_movie`, `watched_tv`, `watched_episodes_tv_<id>`.
- API REST déjà prête dans `oauth.js` (watchlist, history,
  continue-watching…). Rien de dédié aux `progress_*` : passer par `/api/sync`.
- Côté télé : fusion par `timestamp` (le plus récent gagne) avant d'envoyer,
  file d'envoi persistante, envoi par lots, pull au démarrage et au retour
  sur l'accueil.

## SwiftFlux (phase 5)

- `POST /api/swiftflow/mp4/resolve` exige Turnstile si `TURNSTILE_SECRET_KEY`
  est défini ; aucune limite de débit propre ; renvoie l'URL brute amont.
- Le CDN est censé n'accepter qu'un `Referer` Movix (commentaire de
  `swiftfluxService.ts`). Essai du 2026-10-15 sur un épisode
  (`cdn79.mongo-loko.store`) : `206` aussi **sans** `Referer`, `moov` au début
  du fichier, H.264 1080p + AAC. Envoyer quand même
  `Referer: https://<domaine movix>/` depuis le lecteur natif, au cas où le
  CDN se durcit (pas de relais).
- Ce qui protège vraiment : l'URL rendue par `resolve` donne le fichier entier
  à qui la possède (paramètre `ff=` à durée limitée). Le contrôle se fait donc
  **avant** de la rendre : qui demande, combien de fois.
- Route télé proposée : `POST /api/swiftflow/tv/mp4/resolve`, sans Turnstile,
  mais :
  1. JWT de session télé valide (`deviceType 'tv'`) ;
  2. requête signée HMAC-SHA256 avec un secret d'appareil remis une seule fois
     à l'appairage : `METHOD\npath\nsha256(body)\nts\nnonce`, en-têtes
     `X-Movix-Device`, `X-Movix-Ts`, `X-Movix-Nonce`, `X-Movix-Sig`,
     horloge ±60 s, nonce unique (`SET NX EX 120`), comparaison
     `timingSafeEqual` (modèle `utils/mediaSigning.js`) ;
  3. limites par appareil et par compte (Redis), alerte si un même jeton sort
     de nombreuses IP ;
  4. une seule URL par requête, comme le site.
- Le secret d'appareil est rangé dans l'Android Keystore côté télé.
- Code ouvert : rien de ce qui précède ne dépend d'un secret dans l'APK. Un
  attaquant qui lit le code sait **comment** signer, pas **avec quoi** : il lui
  faut un compte, appairer une télé (visible et révocable depuis le site), et
  il reste bridé par les limites de ce compte. Le pire cas est un compte qui
  partage son jeton : les limites par compte et l'alerte multi-IP le coupent.
- Repli refusé : « les télés reçoivent l'URL sans captcha » sans appairage.
  Un en-tête ou un User-Agent « télé » se copie en une ligne ; la route
  deviendrait un robinet à liens directs, ce que Turnstile empêche sur le
  site. Si l'appairage tarde, mieux vaut ne pas offrir SwiftFlux sur la télé.
- Ordre de travail : phase 4 (appairage, `deviceToken`, clé d'appareil) puis
  cette route ; côté télé, appel `resolve` au lancement d'une source
  SwiftFlux (l'URL expire : ne pas la mettre en cache), qualité lue dans le
  bloc `mp4` (`quality`, sinon la sonde de l'en-tête MP4).
