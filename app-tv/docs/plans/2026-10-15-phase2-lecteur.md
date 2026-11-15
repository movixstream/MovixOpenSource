# Phase 2 : lecteur et sources serveur (VIP) — plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:executing-plans
> (exécution native choisie). Étapes en cases à cocher.

**Goal :** un VIP lance un film ou un épisode depuis la fiche ; la vidéo
démarre dans un lecteur Media3 natif aux contrôles de la maquette, reprend là
où il s'était arrêté, enchaîne l'épisode suivant et peut passer le générique.

**Architecture :** la Main API (`https://api.movix.men`) passe par le même
`OkHttpClient` que TMDB, sans `Origin` ni `Referer`. Un `VipManager` garde
l'état de la clé (vérifiée au démarrage puis toutes les 10 min). Un
`SourceRepository` interroge en parallèle les routes catalogue, chacune
décodée par un parseur pur ; un `SourceSelector` pur range les sources et
choisit celle qu'on lance. Le lecteur est un `ExoPlayer` unique par écran,
dessiné dans une `SurfaceView` ; ses requêtes passent par Cronet (repli
OkHttp), puis un `ResolvingDataSource` qui pose les en-têtes par hôte, puis un
`DataSource` qui déballe les segments PNG+MPEG-TS. Les contrôles et le panneau
de réglages sont en Compose ; les sous-titres sont dessinés par Compose à
partir des `Cue` du lecteur (pas de `media3-ui`, trop lourd).

**Tech Stack :** Media3 1.11.1 (`exoplayer`, `exoplayer-hls`,
`datasource-okhttp`, `datasource-cronet`), `play-services-cronet` 18.1.1
(chargé depuis les services Google s'ils existent), le reste comme en phase 1.

**Spec :** [../spec.md](../spec.md), section Phase 2. Contrat des routes :
[../recherche.md](../recherche.md) et le code de
`MovixTv-main/src/pages/Watch/WatchMovie.tsx` / `WatchTv.tsx`.

## Global Constraints

- Jamais d'`Origin` ni de `Referer` vers `api.movix.men` (404 ou fausse réponse).
- Clé VIP : `GET /api/check-vip` + `x-access-key` → `{vip, expiresAt,
  duration, reason}`. `vip:false` efface la clé ; erreur réseau = état gardé.
- Sources : 404/502 = source absente, jamais une erreur affichée. SwiftFlux
  (Turnstile) exclu. Avec VIP : `?resolve=1` + `x-access-key`, garder
  `m3u8Url` et `subtitles`.
- Lecteur : `SurfaceView` uniquement, buffer plafonné en octets (16 Mo si peu
  de RAM, 48 Mo sinon), résolution plafonnée à celle de l'écran.
- En-têtes de lecture par hôte, segments et CDN compris (règles de
  `MovixTv-main/app/src/services/mediaProxyHeaders.ts`), en plus des en-têtes
  renvoyés par le serveur pour la source.
- Progression au format du site (`Library.encodeProgress`, clés
  `progress_*`), écrite toutes les 10 s, à la pause et à la sortie ; méta des
  cartes « Reprendre » dans `TvKeys.WATCH_META`.
- Jamais de son pendant les essais : émulateur lancé avec `-no-audio`.

## Review Focus

1. **Pas de VIP** : le bouton Lecture explique qu'il faut une clé VIP (la
   lecture sans VIP arrive en phase 3) et mène aux réglages ; pas d'écran noir.
2. **Aucune source résolue** : message clair et retour à la fiche, pas de
   lecteur bloqué sur un rond qui tourne.
3. **Source qui casse en cours de route** (403, 404, manifeste vide) : passage
   automatique à la source suivante, une seule fois par source.
4. **Retour** dans le lecteur : ferme d'abord le panneau, puis cache les
   contrôles, puis quitte en enregistrant la position.
5. **Clé VIP expirée** pendant l'utilisation : la vérification périodique
   l'efface, la lecture en cours continue.

---

### Task 1 : dépendances et réseau Main API

**Files :** `gradle/libs.versions.toml`, `app/build.gradle.kts`,
`app/proguard-rules.pro`, `data/movix/MovixApi.kt`, `AppContainer.kt`.

- [x] Media3 1.11.1 et Cronet dans le catalogue de versions.
- [x] `MovixApi(client, json, baseUrl)` : `checkVip(key)`, `sources(route…)`,
      `segments(type, id, duration, season, episode)` ; aucun `Origin` ni
      `Referer` (test MockWebServer).

### Task 2 : clé VIP

**Files :** `data/movix/VipManager.kt`, `data/local/LocalStore.kt`
(`TvKeys.VIP_KEY`), `ui/settings/SettingsScreen.kt`, chaînes FR/EN, test
`VipManagerTest`.

- [x] `VipManager.state: StateFlow<VipState>` ; `start()` vérifie au démarrage
      puis toutes les 10 min ; `submit(key)` vérifie avant d'enregistrer.
- [x] `vip:false` efface la clé ; exception réseau = état inchangé (tests).
- [x] Réglages : champ « Clé VIP », bouton Vérifier, état et date de fin.

### Task 3 : sources

**Files :** `data/movix/SourceModels.kt`, `SourceParsers.kt`,
`SourceRepository.kt`, `SourceSelector.kt`, tests `SourceParsersTest`,
`SourceSelectorTest`.

- [x] Une fonction de parsage pure par route, sur des réponses réelles
      enregistrées en fixtures.
- [x] Appels en parallèle (`async` par route, délai par route), 404/502 et
      erreurs = liste vide pour cette route.
- [x] Sélection : sources avec flux direct (`m3u8Url`) d'abord, VF avant
      VOSTFR avant VO, qualité décroissante, doublons d'URL retirés ; groupes
      « Serveur Movix » (résolues) et « Extraction sur la télé » (phase 3,
      listées mais grisées).

### Task 4 : moteur de lecture

**Files :** `player/MediaHeaders.kt`, `player/PngTsDataSource.kt`,
`player/PlayerEngine.kt`, tests `MediaHeadersTest`, `PngTsDataSourceTest`.

- [x] `MediaHeaders.forUrl(url, base)` : port fidèle de
      `applyMediaProxyHeaderRules` (Fsvid, Vidzy, Lulu/Veev/Vidara, suffixes
      à point = sous-domaines seulement).
- [x] `PngTsDataSource` : sonde les 4 Ko + 3 paquets TS du début, saute
      l'enveloppe PNG si elle est là, sinon rend les octets tels quels.
- [x] `PlayerEngine` : Cronet (`CronetUtil.buildCronetEngine`) sinon OkHttp ;
      `ResolvingDataSource` qui fusionne en-têtes de la source + règles par
      hôte ; `DefaultLoadControl` plafonné en octets ; `TrackSelector` limité
      à la taille de l'écran ; sous-titres externes en `SubtitleConfiguration`.

### Task 5 : écran lecteur

**Files :** `ui/player/{PlayerScreen,PlayerViewModel,PlayerControls,PlayerSettingsPanel}.kt`,
`ui/nav/Navigator.kt` (`Route.Player`), `ui/MovixRoot.kt`,
`ui/details/DetailsScreen.kt`, `ui/components/Icons.kt`, chaînes FR/EN.

- [x] Titre en haut, barre rouge (lecture), tampon gris clair, temps écoulé
      et restant, −10 s / pause / +10 s, Épisode suivant, sous-titres, audio,
      réglages ; pastilles langue et qualité.
- [x] Contrôles cachés : gauche/droite = ±10 s, OK = pause, toute touche les
      montre ; disparition après 4 s sans touche (pas pendant la pause).
- [x] Panneau à droite : Source (groupée), Qualité, Audio, Sous-titres,
      Décalage (±0,5 s), Vitesse, Format (ajusté, rempli, étiré).
- [x] Fiche : Lecture / Reprendre et les épisodes ouvrent le lecteur ; cartes
      « Reprendre » de l'accueil aussi.

### Task 6 : reprise, épisode suivant, générique

**Files :** `ui/player/PlayerViewModel.kt`, `data/local/Library.kt`,
`data/movix/MovixApi.kt`, test `LibraryTest`.

- [x] Reprise à la position enregistrée (sauf si finie), écriture toutes les
      10 s, à la pause et à la sortie ; `WATCH_META` (titre, image, épisode).
- [x] Épisode suivant : même saison, sinon premier de la saison suivante ;
      bouton masqué pour un film ou le dernier épisode.
- [x] `GET /api/segments/...?duration=` une fois la durée connue : bouton
      « Passer l'intro » pendant l'intro, « Épisode suivant » au générique de fin.

### Task 7 : vérification

- [x] `./gradlew.bat :app:testDebugUnitTest :app:assembleRelease`.
- [x] Émulateur `movix_tv` (port 5560, `-no-window -no-audio`, build
      `benchmark`) : film lancé depuis la fiche (fichier direct, sans VIP),
      la vidéo avance (captures `adb exec-out screencap`), ±10 s, pause,
      panneau, Retour, reprise depuis la carte « Reprendre ».
- [ ] Même essai avec une clé VIP (flux `m3u8Url` signé du relais).

Écarts au plan, décidés en cours de route :
- Avec VIP, `m3u8Url` est une URL signée du relais `proxiesembed` : aucun
  en-tête de lecture n'est renvoyé. Les règles par hôte restent posées sur
  chaque requête (sans effet sur le relais), prêtes pour la phase 3.
- Les sous-titres externes (SRT, VTT) sont lus par l'appli et non par
  Media3 : le décalage est un simple calcul, sans recharger le flux.
- Sans VIP, les fichiers MP4 directs de `/api/links` se lancent quand même.
- Omega (`/api/imdb`) n'est appelé que pour un film : le serveur ne résout
  pas les séries de cette route.
- Retour est traité dans le gestionnaire de touches du lecteur : Compose s'en
  sert sinon pour faire sortir le focus du panneau (un appui perdu par niveau).
- [x] README (état, mesures), commit.
