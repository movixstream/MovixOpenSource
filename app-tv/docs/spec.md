# Movix TV native : spécification

Date : 2026-10-15. Statut : validée par l'utilisateur (maquette approuvée).
Notes techniques détaillées : [recherche.md](recherche.md). Maquette :
[../maquette/](../maquette/).

## 1. But

Une appli Android TV **nouvelle, 100 % native**, la plus fluide et la plus
légère possible, qui remplace à terme MovixTv-main. Elle se pilote à la
télécommande, lit les vidéos dans un lecteur natif et marche sur les petits
appareils (Fire TV Stick Lite, 1 Go de RAM).

Hors périmètre : Tizen, webOS, Roku, Apple TV, consoles, Fire TV sous Vega OS.

## 2. Contraintes globales

- Kotlin, Jetpack Compose for TV, Media3 ExoPlayer. Aucune reprise du code
  React. Pas de React Native, pas de Capacitor.
- `minSdk 25`, `targetSdk 36`, `compileSdk 36`. APK `armeabi-v7a` + `arm64-v8a`
  (le v7a est obligatoire : système 32 bits sur la plupart des Fire TV Sticks).
- Paquet `com.movix.tv`. Langues : français (par défaut) et anglais.
- Un seul `OkHttpClient` pour toute l'appli. Aucun `Origin` ni `Referer` vers
  la Main API.
- Aucun secret dans l'APK (ni clé TMDB, ni clé serveur). La clé TMDB vient du
  compte, de la saisie utilisateur, ou de `local.properties` en développement.
- Perf mesurée en **release** avec Baseline Profile. Objectif : démarrage à
  froid < 1,5 s et défilement des rangées sans saccade sur Fire TV Stick Lite.
- Identité visuelle : la maquette. Fond `#0A0A0A`, texte `#F4F4F0`, rouge
  `#DC2626` (barres de progression, crochets du focus), polices Bricolage
  Grotesque (titres) et Instrument Sans (texte), logo [M] de `brand/`.
  Le focus d'une carte = les crochets rouges du logo + léger zoom ; le focus
  d'un bouton = pastille blanche, texte noir.
- Textes en français avec accents, tutoiement, phrases courtes.

## 3. Écrans (maquette)

1. **Accueil** : rail d'icônes à gauche (Recherche, Accueil, Films, Séries,
   Animés, Ma liste, Réglages), bannière qui suit la carte sélectionnée,
   rangées « Reprendre » (cartes paysage avec barre rouge) puis rangées TMDB.
2. **Films, Séries, Animés** : mêmes rangées, registres différents
   (repris de `MovixTv-main/src/tv/data/rowRegistry.ts`).
3. **Fiche** : titre, infos, résumé, boutons Reprendre / Ma liste /
   Bande-annonce, saisons, épisodes avec vignette, vu et progression.
4. **Recherche** : clavier à l'écran, résultats films et séries.
5. **Lecteur** : titre en haut, sous-titres, barre de progression, boutons
   −10 s / pause / +10 s, Épisode suivant, sous-titres, audio, réglages.
   Contrôles cachés : gauche/droite = ±10 s, OK = pause.
6. **Réglages du lecteur** : panneau à droite (Source, Qualité, Audio,
   Sous-titres, Décalage, Vitesse, Format) et sous-panneau Source groupé en
   « Serveur Movix » (VIP) et « Extraction sur la télé ».
7. **Embed avec souris** : page web plein écran, curseur, compteur de pubs
   bloquées, aide des touches.
8. **Connexion** : code à 5 caractères + QR, bouton « Utiliser une clé VIP ».
9. **Réglages de l'appli** : compte, clé VIP, clé TMDB, langue, version
   préférée (VF / VOSTFR), qualité, mode léger, à propos, mise à jour.
10. **Premier lancement** (onboarding, phase 4) : langue, version préférée,
    connexion (voir phase 4).
11. **Mise à jour** (phase 3 bis) : fenêtre « Nouvelle version », notes de
    version FR/EN, barre de téléchargement, bouton Installer.

## 4. Phases

Chaque phase donne une appli qui s'installe et marche. Un plan par phase dans
`plans/`.

### Phase 1 : socle et catalogue
Projet Gradle, thème, polices, logo, navigation au D-pad, rail, accueil,
Films / Séries / Animés, fiche avec épisodes, recherche, Ma liste et
progression locales, réglages (clé TMDB). Données TMDB en direct. Images Coil
dimensionnées. Pas encore de lecture.

### Phase 2 : lecteur et sources serveur (VIP)
Lecteur Media3 aux contrôles de la maquette, sources Main API lancées en
parallèle, `?resolve=1` + `x-access-key` pour les VIP, en-têtes par hôte,
Cronet, déballage PNG+TS, sous-titres externes, reprise, épisode suivant,
segments (passer le générique), saisie de la clé VIP (`/api/check-vip`).

### Phase 3 : extraction sur la télé (userscript)
WebView cachée unique qui exécute `MovixTv-main/userscript/movix.user.js`,
polyfill GM_* sur `addJavascriptInterface`, requêtes en Kotlin, QuickJS
servi depuis les assets, `movixExtractM3u8` + `__MOVIX_PREPARE_CAST_SOURCE__`.
Utilisée sans VIP, ou quand le serveur n'a rien résolu pour un lien.

### Phase 3 bis : adresse Movix et mises à jour automatiques
À faire avant de donner l'APK à qui que ce soit : sans elles, un domaine
bloqué ou un correctif oblige à réinstaller à la main. Même fonctionnement que
l'appli Android (`app/src/services/addressResolver.ts`,
`app/src/services/versionCheck.ts`, `app/src/hooks/useAppUpdate.ts`).

**Adresse du site** (QR de connexion, `Referer` SwiftFlux, liens « à propos ») :
1. `https://rentry.co/movix` (anti-cache `?_=<ms>`, 5 s) : JSON
   `{"mirrors": [...]}` ou page HTML dont on prend le premier lien du premier
   `<article>` ; on refuse `rentry.co` lui-même et tout ce qui n'est pas un nom
   d'hôte valide. Aujourd'hui il pointe vers `movix.online`.
2. `https://<hôte>/address.json` : `primary.url`, `active[].url` (miroirs),
   `github`, `telegram` ; on ignore `blocked[]`. Si rentry échoue (défi
   Cloudflare derrière un VPN), on essaie les résolveurs connus
   (`movix.online`).
3. Sinon la dernière config valide (DataStore), sinon la liste codée en dur,
   complétée des miroirs connus absents de la config en cache.
Résolution en tâche de fond au démarrage, jamais bloquante ; le domaine retenu
est celui qui répond, en essayant les miroirs dans l'ordre.

**Adresse de l'API** : toujours le sous-domaine `api.` du domaine retenu
(`movix.luxe` → `https://api.movix.luxe` ; vérifié le 2026-10-15 :
`/api/check-vip` répond 200 sur `api.movix.luxe`, `api.movix.men`,
`api.movix.cash`). Rien à changer côté serveur. La télé remplace son
`https://api.movix.men` codé en dur par `api.<domaine>`, et si l'API ne
répond plus, passe au miroir suivant (site et API changent ensemble).

**Mises à jour** :
- Manifeste propre à la télé, `app-tv/version.json` du dépôt movix
  (`raw.githubusercontent.com`, lien GitHub lu dans `address.json`), même
  forme que celui de l'appli Android : `version`, `buildNumber`, `apkUrl`,
  `apkSizeBytes`, `apkSha256`, `mandatory`, `releasedAt`,
  `releaseNotes {fr, en}`. Vérifié au démarrage puis toutes les 12 h.
- `buildNumber` plus grand que `versionCode` → fenêtre « Nouvelle version »
  (Plus tard / Installer ; `mandatory` = pas de « Plus tard »).
- Téléchargement en tâche de fond dans le cache de l'appli, reprise si coupé,
  SHA-256 et taille vérifiés avant d'installer, APK refusé sinon.
- Installation par `PackageInstaller` (permission
  `REQUEST_INSTALL_PACKAGES`). Sur Fire TV, première fois : écran qui explique
  comment autoriser « Applications inconnues » pour Movix.
- Une APK par architecture (`armeabi-v7a`, `arm64-v8a`) : le manifeste donne
  une URL par ABI, la télé prend la sienne.
- Même clé de signature pour toutes les versions (sinon Android refuse la
  mise à jour) : la clé reste hors du dépôt.

### Phase 4 : compte, code de liaison, VIP et synchronisation
Premier lancement (onboarding), trois écrans à la télécommande, chacun
modifiable ensuite dans les réglages :
1. Langue de l'appli : français ou anglais (celle de la télé par défaut).
2. Version préférée : VF ou VOSTFR. Elle remplace l'ordre fixe « VF avant
   VOSTFR » du choix de la source (`SourceSelector`).
3. Connexion : code à 5 caractères + QR, clé VIP, ou « Plus tard ».

Côté Main API :
- `POST /api/tv/link/start` → `{deviceCode (secret, 32 octets), userCode
  (5 caractères sans ambiguïté, ex. K7P2Q), qrUrl, expiresIn: 600, interval: 5}`.
- Le site : page `/tv` (et lien direct du QR `/tv?code=K7P2Q`) où
  l'utilisateur connecté confirme le code et choisit le profil.
- `POST /api/tv/link/poll {deviceCode}` → en attente, refusé, expiré, ou
  `{deviceToken, profileId, vip}`.
- `deviceToken` : jeton long (opaque, stocké haché en base), révocable depuis
  le site (liste des télés connectées), renouvelé à l'usage.
- Le VIP du compte est importé à la connexion (si le compte en a un).
- Limites de débit sur `start`, `poll` et la confirmation ; codes à usage
  unique ; 10 minutes de validité.
Synchronisation à double sens de la reprise, de l'historique, de Ma liste et
des épisodes vus, avec les mêmes clés que le site (`progress_*`,
`continueWatching`, `watchlist_*`, `watched_episodes_tv_*`) via `/api/sync` ;
fusion par horodatage, le plus récent gagne.

### Phase 5 : SwiftFlux sur la télé, sans captcha
Route dédiée aux télés liées : authentifiée par `deviceToken`, requête signée
(HMAC avec une clé propre à l'appareil, horodatage, nonce), limite de débit
par appareil et par compte, URL de lecture signée à durée courte. Le jeton
Turnstile reste exigé pour le site. Conception détaillée dans
[backend-compte.md](backend-compte.md#swiftflux-phase-5).

Sécurité malgré le code ouvert : la protection ne repose sur aucun secret
caché dans l'appli, mais sur ce que le serveur seul détient — le jeton et la
clé de **chaque** télé, remis à l'appairage par un compte connecté, révocables
un par un. Lire le code ne donne ni l'un ni l'autre. Une route « télé sans
captcha » sans appairage serait en revanche un robinet ouvert : n'importe quel
script peut se faire passer pour une télé.

Déjà prêt côté télé (2026-10-15) : le lecteur lit les MP4 en direct, la sonde
lit leur en-tête (taille d'image, codecs) avant de lancer, et une fenêtre
prévient si le son ou l'image ne sont pas pris en charge. Reste : la route
serveur, l'appel depuis la télé, et lire le bloc `mp4` des réponses SwiftFlow
(qualité annoncée).

### Phase 6 : embed, souris virtuelle et bloqueur de pubs
WebView plein écran ; curseur dans une View dédiée bougée par
`translationX/Y`, accélération, clic tactile, défilement au bord ; moteur
adblock-rust sérialisé (JNI maison, `cargo-ndk`), filtrage réseau + Service
Workers, pop-up et redirections refusées, scriptlets et CSS cosmétique au
chargement de chaque frame.

### Phase 7 : finition et diffusion
Baseline et Startup Profiles, mode léger automatique, bannière Android TV,
publication des mises à jour (phase 3 bis) dans le circuit de release,
puis intégration sur le site Movix (page de téléchargement, tutoriels Fire TV
et Android TV).

## 5. Données locales (phase 1)

Format compatible avec le site pour que la synchronisation de la phase 4 soit
une simple copie :
- `progress_{movieId}` et `progress_tv_{tvId}_s{S}_e{E}` →
  `{position, duration, timestamp}` (secondes, ISO 8601).
- `watchlist_movie`, `watchlist_tv` → `[{id, type, title, poster_path, addedAt}]`.
- `watched_episodes_tv_{id}` → `{"S1E1": true}`.
Stockage : DataStore (fichier JSON), lu une fois au démarrage.
