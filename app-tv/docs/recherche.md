# Movix TV native : notes de recherche (2026-10-15)

Base de la future spec. Trois enquêtes : contrat backend de MovixTv-main, pont
userscript, techniques optimisées (versions vérifiées le 2026-10-15).

## Choix de fond

- Appli **100 % native** : Kotlin, Jetpack Compose for TV, Media3 ExoPlayer.
  Aucun code React repris. Une WebView n'apparaît que pour deux usages :
  1. **moteur caché** qui exécute le userscript d'extraction tel quel ;
  2. **page embed plein écran** avec souris virtuelle et bloqueur de pubs,
     en dernier recours, quand aucun lien direct n'a pu être extrait.
- Cible : Android TV, Google TV, Fire OS (Fire TV Stick 3e gén., Lite, 4K,
  4K Max, Cube). Pas Tizen, webOS, Roku, Apple TV, Vega OS.
- `minSdk 25` (Fire OS 6). APK **armeabi-v7a obligatoire** : la plupart des
  Fire TV Sticks ont un système 32 bits.

## Backend (lu dans MovixTv-main et API/Mainapi)

- Main API `https://api.movix.men`. **Ne jamais envoyer `Origin` ni `Referer`**
  vers elle (sinon 404 ou fausse réponse, `middleware/security.js`).
- Pas de compte sur la TV actuelle : seulement la **clé VIP** (`VIP-…`).
  `GET /api/check-vip` avec `x-access-key` → `{vip, expiresAt, duration, reason}`.
  Vérifiée au démarrage puis toutes les 10 min. `vip:false` efface la clé ;
  erreur réseau = on garde l'état.
- La **connexion par code** de la maquette n'existe pas encore côté serveur :
  il faudra un flux « device code » dans la Main API (à concevoir).
- Catalogue : **TMDB en direct** (`api.themoviedb.org/3`, `language=fr-FR`),
  registre de rangées dans `MovixTv-main/src/tv/data/rowRegistry.ts`.
  Clé TMDB : saisie par l'utilisateur, jamais embarquée.
- Sources : routes catalogue de la Main API, lancées **en parallèle**
  (`/api/links`, `/api/tmdb`, `/api/imdb`, `/api/purstream`, `/api/fstream`,
  `/api/wiflix`, `/api/j1f`, `/api/swiftflow`, `/api/cpasmal`, `/api/kisskh`,
  `/api/drama`). Avec VIP : `?resolve=1` + `x-access-key` → le serveur ajoute
  `m3u8Url` (et `subtitles`) sur les lecteurs qu'il sait extraire.
  404/502 d'une source = source absente. SwiftFlux (Turnstile) exclu.
- Sans VIP, ou si le serveur n'a rien résolu pour un lien : extraction locale
  par le userscript.
- Progression, reprise, Ma liste : **locales** sur la TV actuelle
  (`progress_*`, seuils 30 s et 95 %). `/api/sync` exige un JWT de compte.
- Segments (générique) : `GET /api/segments/{movie|tv}/{tmdb}?duration=…`.
- Mise à jour : manifeste `version.json` (`buildNumber`, `apkUrl`,
  `apkSha256`…), comme l'app mobile.

## Userscript (extraction locale)

- Source à embarquer : `MovixTv-main/userscript/movix.user.js` (v1.7.3,
  ~232 Ko), en-tête retiré. Tout son réseau passe par `GM_xmlhttpRequest`.
- **Aucun hébergeur ne demande de vraie page, de cookie ni de captcha.**
  Fsvid/Vidzy exécutent un script dans QuickJS (WASM chargé depuis jsDelivr,
  SHA-256 épinglé) : le servir depuis `assets/` via `shouldInterceptRequest`.
- Exécution : une WebView cachée, une seule, page vide d'origine https
  (`WebViewAssetLoader`), polyfill GM_* branché sur `addJavascriptInterface`,
  requêtes faites en Kotlin (OkHttp/Cronet, redirections manuelles).
- Appel : `movixExtractM3u8(type, url)` puis
  `__MOVIX_PREPARE_CAST_SOURCE__({type:'CAST_PREPARE_SOURCE', url})` qui rend
  l'URL **et** les en-têtes de lecture.
- Lecture : en-têtes par hôte (segments et CDN compris). Fsvid/Vidzy veulent
  l'UA Chrome 140 + `Sec-Ch-Ua*` ; Lulu/Veev/Vidara rejouent l'identité de
  l'extraction (jeton lié à l'IP et au client). **Cronet** pour l'empreinte
  TLS (les CDN Fsvid/Vidzy bloquent OkHttp). Segments PNG+MPEG-TS à déballer
  dans un `DataSource` (reprendre `PngWrappedMpegTs.kt`). Pas de proxy local.

## Stack retenue

| Lib | Version |
|---|---|
| Compose BOM | `androidx.compose:compose-bom:2026.09.00` |
| tv-material | `androidx.tv:tv-material:1.1.0` (listes : `LazyRow` de foundation) |
| Media3 | `androidx.media3:*:1.11.1` (exoplayer, hls, datasource-okhttp/cronet, ui) |
| OkHttp | `com.squareup.okhttp3:okhttp:5.5.0` (un seul client) |
| Coil 3 | `io.coil-kt.coil3:coil-compose:3.6.3` |
| androidx.webkit | `androidx.webkit:webkit:1.17.1` |
| profileinstaller | `androidx.profileinstaller:profileinstaller:1.4.1` |
| adblock | crate Rust `adblock 0.13.3` + JNI maison (`cargo-ndk`) |

## Optimisation (règles)

- Baseline + Startup Profile intégrés (seule optimisation AOT en sideload).
  Mesurer en **release** seulement.
- Focus : `focusRestorer()` par rangée, zoom lu dans `graphicsLayer`, `key` et
  `contentType` partout, pas d'ombre ni de flou sur les petits appareils.
- Images : `w342`/`w500`, taille imposée, RGB565, cache mémoire 10-15 %.
- Lecteur : `SurfaceView` uniquement, buffer plafonné en octets
  (16 Mo si peu de RAM), résolution limitée à l'écran, tunneling en option.
- Souris virtuelle (modèle TV Bro `CursorDrawerDelegate.kt`) : View dédiée
  bougée par `translationX/Y` (aucun redessin), `Choreographer`, accélération,
  clic = `MotionEvent` tactile (marche dans les iframes cross-origin),
  défilement au bord par faux glissé.
- Bloqueur : moteur adblock-rust **sérialisé à la compilation**, filtrage dans
  `shouldInterceptRequest` (+ Service Workers), pop-up refusées
  (`onCreateWindow`), redirections du cadre principal bloquées, scriptlets et
  CSS cosmétique via `addDocumentStartJavaScript` sur toutes les frames.
  GeckoView + uBlock Origin écarté (≈ 50 Mo, trop de RAM pour 1 Go).
