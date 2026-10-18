# Phase 4 : relier la télé au compte (code à 5 caractères), VIP et synchro

> Trois chantiers en parallèle, chacun sur ses fichiers. Ce document est le
> **contrat** commun : les trois s'y tiennent à la lettre.

## Parcours

1. La télé (pas connectée) affiche un code `K7P2Q` + un QR vers
   `https://<site>/tv?code=K7P2Q`, et interroge le serveur toutes les 5 s.
2. Sur son téléphone, l'utilisateur connecté au site ouvre `/tv` (ou scanne le
   QR), voit le code et le nom de la télé, choisit son profil, confirme.
3. La télé reçoit un jeton de session (JWT Movix normal, session `tv`), son
   profil, et la clé VIP du profil si elle est valide. Elle importe le VIP et
   synchronise reprise, historique, Ma liste et épisodes vus avec le site.
4. La télé apparaît dans les sessions du compte sur le site ; la supprimer la
   déconnecte. « Se déconnecter » sur la télé supprime sa propre session.

## API (Main API, `https://api.movix.men`)

Aucun en-tête `Origin`/`Referer` côté télé (déjà la règle). Tout l'état de
liaison vit dans **Redis** (12 workers recyclés : rien en mémoire de worker).

### `POST /api/tv/link/start` — télé, sans compte
Corps : `{ "deviceName": "Android TV salon" (≤ 40 car., optionnel), "clientId": "<uuid v4>" }`
Réponse 200 :
```json
{ "deviceCode": "<43 car. base64url, secret>", "userCode": "K7P2Q",
  "verificationUrl": "https://movix.luxe/tv?code=K7P2Q", "expiresIn": 600, "interval": 5 }
```
- `userCode` : 5 caractères dans `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (pas de
  0/O, 1/I/L). Unique parmi les codes vivants.
- Redis : `tvlink:dev:<sha256(deviceCode)>` → JSON
  `{userCode, deviceName, clientId, status:"pending", createdAt, lastPollAt}`
  et `tvlink:code:<userCode>` → `<sha256(deviceCode)>`, TTL 600 s.
- Site public : variable `PUBLIC_SITE_URL`, sinon `https://movix.luxe`.
- Limite : 10 / 10 min par IP.

### `GET /api/tv/link/info?code=K7P2Q` — site, connecté (Bearer)
200 `{ "deviceName": "Android TV salon", "expiresIn": 431 }` ; 404
`{ "error": "code_invalid" }` si inconnu, expiré ou déjà confirmé. Sert à
afficher « Connecter Android TV salon ? » avant de confirmer.

### `POST /api/tv/link/confirm` — site, connecté (Bearer)
Corps : `{ "userCode": "K7P2Q", "profileId": "<uuid>" }`
- 401 sans session valide ; 404 `code_invalid` ; 403 `profile_not_owned` ;
  429 trop d'essais. Cinq codes faux par utilisateur en 10 min → 429.
- Effet : crée une ligne `user_sessions` (`device` JSON avec
  `deviceType:"tv"`, `name: deviceName`, `clientId`), émet le JWT par
  `issueJwt(userType, userId, sessionId, "tv")`, lit le profil et la clé VIP
  du **profil choisi** (même logique que `buildVipIdentity` : `access_code`
  revérifiée par `verifyAccessKey`, jamais `is_vip`). Passe l'entrée Redis à
  `status:"approved"` avec `{token, userType, userId, profileId, profile, vip}`
  (TTL 120 s) et supprime `tvlink:code:<userCode>`.
- 200 `{ "ok": true, "deviceName": "Android TV salon" }`.

### `POST /api/tv/link/poll` — télé
Corps : `{ "deviceCode": "..." }`. Réponses 200 :
- `{ "status": "pending" }`
- `{ "status": "slow_down" }` si deux appels à moins de 4 s
- `{ "status": "expired" }` si inconnu ou expiré
- `{ "status": "approved", "token": "<JWT>", "userType": "oauth"|"bip39", "userId": "...",
    "profileId": "...", "profile": { "id", "name", "avatar", "ageRestriction" },
    "vip": { "active": true, "expiresAt": null, "accessKey": "VIP-…" | null } }`
  — **une seule fois** : l'entrée Redis est supprimée à la remise.
- Limite : 40 / min par IP.

### Existant réutilisé (télé connectée, `Authorization: Bearer <JWT>`)
- `GET /api/profiles/:profileId/data` → données du profil (clés du site).
- `POST /api/sync` `{ userType, userId, profileId, ops: [{op:"set", key, value}] }`
  (valeur = chaîne JSON, comme le site ; 200 ops max, 180 req/min).
- `GET /api/sessions` / `POST /api/sessions/delete { sessionId }` : la télé
  connaît son `sessionId` en décodant la charge utile du JWT.
- Un 401 sur ces routes = session supprimée : la télé se déconnecte.

## Synchronisation (télé)

Clés synchronisées : `progress_<id>`, `progress_tv_<id>_s<S>_e<E>`,
`continueWatching`, `watchlist_movie`, `watchlist_tv`, `watched_movie`,
`watched_tv`, `watched_episodes_tv_<id>`. Jamais les clés `movix_tv_*`.
- **Tirage** au démarrage, au retour au premier plan et toutes les 5 min :
  `GET /api/profiles/:id/data`. Fusion : `progress_*` → le `timestamp` le plus
  récent gagne ; autres clés → valeur du serveur, sauf si la clé locale a une
  écriture en attente d'envoi.
- **Envoi** : chaque écriture locale d'une clé synchronisée part dans une file
  persistante (DataStore), envoyée par lots (≤ 100 ops) 5 s après la dernière
  écriture, à la mise en pause du lecteur et en quittant l'appli ; nouvel essai
  plus tard en cas d'échec réseau.
- Clé VIP : `vip.accessKey` remis à la liaison → `VipManager.submit` (revérifiée).

## Écrans

- Télé : écran « Connexion » de la maquette (`app-tv/maquette/6-login.png`) :
  code en 5 cases, QR, compte à rebours, nouveau code à l'expiration, bouton
  « Utiliser une clé VIP » (réglages). Accessible depuis Réglages > Compte et
  proposé au premier lancement (« Plus tard » possible). Réglages > Compte :
  profil connecté (nom, avatar), « Se déconnecter ».
- Site : page `/tv` (`?code=` prérempli) : non connecté → invite à se
  connecter ; connecté → saisie du code (5 cases), nom de la télé, choix du
  profil, « Connecter la télé », état de réussite. FR + EN, style du site.
