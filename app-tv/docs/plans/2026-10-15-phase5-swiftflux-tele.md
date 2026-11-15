# Phase 5 : SwiftFlux sur la télé, sans captcha (contrat)

> **Abandonné le 2026-10-15** (commit 34d76630) : à la demande de
> l'utilisateur, la route `POST /api/swiftflow/tv/mp4/resolve` est ouverte,
> sans compte ni signature, avec seulement une limite de 60 appels / 10 min
> par IP. La télé envoie `{kind, tmdbId, season?, episode?, index}` et lit la
> même réponse que le site. La suite du document décrit l'ancienne version
> signée, gardée pour mémoire.

Le site obtient l'URL d'un MP4 SwiftFlux contre un jeton Turnstile
(`POST /api/swiftflow/mp4/resolve`). La télé n'a pas de captcha : elle passe par
une route à part, ouverte **seulement** aux télés reliées par code (phase 4).

## Secret d'appareil

- `deviceSecret = base64url(HMAC-SHA256(K, "movix-tv-device-v1\n" + sessionId))`
- `K` = `TV_DEVICE_SECRET` (env), sinon `HMAC-SHA256(JWT_SECRET, "movix-tv-device-key-v1")`.
- Rien n'est stocké : le serveur le recalcule depuis le `sessionId` du JWT.
  Supprimer la session sur le site coupe le JWT, donc la route.
- Remis **une seule fois**, dans la réponse `approved` de `POST /api/tv/link/poll`
  (champ `deviceSecret`). L'entrée Redis approuvée garde le `sessionId`, pas le
  secret. Le secret ne voyage plus jamais ensuite.
- Côté télé : chiffré par une clé AES-GCM de l'Android Keystore.

## Route

`POST /api/swiftflow/tv/mp4/resolve`

En-têtes :
- `Authorization: Bearer <JWT de la télé>`
- `X-Movix-Ts` : secondes Unix, ±60 s de l'horloge serveur
- `X-Movix-Nonce` : 22 à 64 caractères `[A-Za-z0-9_-]`, unique (Redis
  `SET NX EX 120` sur `tvsig:nonce:<sessionId>:<nonce>`)
- `X-Movix-Sig` : `base64url(HMAC-SHA256(deviceSecret, canonique))`, sans `=`

Corps JSON : `{kind, tmdbId, season?, episode?, index?}` (comme le site, sans
`turnstileToken`).

Chaîne canonique (lignes séparées par `\n`, valeurs vides si absentes) :

```
POST
/api/swiftflow/tv/mp4/resolve
<kind>
<tmdbId>
<season>
<episode>
<index>
<ts>
<nonce>
```

`index` absent = chaîne vide (le serveur prend alors 0).

Contrôles, dans l'ordre :
1. JWT valide (`getAuthIfValid`) → sinon 401 `unauthorized`.
2. La ligne `user_sessions` a `device.deviceType === 'tv'` → sinon 403 `not_a_tv`.
3. En-têtes présents et bien formés, horloge ±60 s → sinon 401 `bad_signature`
   (horloge : 401 `clock_skew` avec `serverTime` pour que la télé se recale).
4. Signature `timingSafeEqual` → sinon 401 `bad_signature`.
5. Nonce neuf → sinon 401 `replay`.
6. Limites (Redis, fenêtre fixe) : 30 / 10 min par session, 300 / 24 h par
   compte, 8 IP distinctes / 24 h par session → 429 `rate_limited`
   (l'excès d'IP est journalisé : jeton partagé).
7. Redis injoignable → 503 (on refuse, on n'ouvre pas).

Réponse : identique à la route du site (`success, url, index, label, quality,
size, language, is_vip`). L'URL expire : la télé ne la met pas en cache et la
redemande à chaque lancement.

## Télé

- Catalogue : `GET /api/swiftflow/movie/:id` et
  `GET /api/swiftflow/tv/:id/season/:s?episode=:e` ; lire le bloc
  `mp4.entries` (`index`, `label`, `quality`, `language`). `pending: true` =
  réessayer une fois après 1,5 s.
- Une entrée par fichier dans le groupe « Serveur Movix », nommée SwiftFlux,
  visible seulement si la télé est reliée.
- Au lancement : `resolve` signé, puis lecture directe du MP4 avec
  `Referer: <site>/`. 401 `clock_skew` → recalage sur `serverTime` et un
  nouvel essai ; 401 (autre) ou 403 → source sautée.
