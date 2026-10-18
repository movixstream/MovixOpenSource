# Phase 1 : socle et catalogue — plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:executing-plans
> (exécution native choisie). Étapes en cases à cocher.

**Goal :** une appli Android TV native qui s'installe, affiche l'accueil, les
pages Films / Séries / Animés, la fiche avec épisodes, la recherche et les
réglages, exactement comme la maquette, sans lecture vidéo.

**Architecture :** une seule Activity Compose. Injection manuelle
(`AppContainer`), un `OkHttpClient` partagé par TMDB et Coil, données TMDB
décodées avec kotlinx.serialization, état local (Ma liste, progression,
réglages) dans DataStore au format du site. Navigation par une pile de routes
maison (pas de navigation-compose, pour la taille et le contrôle du focus).

**Tech Stack :** AGP 9.4.1 (Kotlin intégré), Kotlin 2.4.21, Compose BOM
2026.09.00, tv-material 1.1.0, Coil 3.6.3, OkHttp 5.5.0, kotlinx.serialization,
DataStore, JUnit 4 + MockWebServer.

**Spec :** [../spec.md](../spec.md)

## Global Constraints

- `minSdk 25`, `targetSdk 36`, `compileSdk 36`, ABI `armeabi-v7a` + `arm64-v8a`.
- Paquet `com.movix.tv`, français par défaut, anglais en option.
- Un seul `OkHttpClient`. Aucun `Origin`/`Referer` vers la Main API.
- Aucune clé dans le dépôt : la clé TMDB vient des réglages, ou de
  `local.properties` (`tmdb.key=`, fichier ignoré) en debug uniquement.
- Couleurs : fond `#0A0A0A`, texte `#F4F4F0`, atténué `#A1A1A1`, rouge `#DC2626`.
- Polices : Bricolage Grotesque (titres), Instrument Sans (texte), OFL.
- Images TMDB : affiche `w342`, paysage `w500`, bannière `w1280` ; taille de
  décodage imposée, RGB565.
- Rangées : `LazyRow` de foundation, `key` et `contentType` partout,
  `focusRestorer()` par rangée, zoom du focus lu dans `graphicsLayer`.

## Review Focus

1. **Pas de clé TMDB** (premier lancement) : l'accueil montre un écran clair
   « Ajoute ta clé TMDB » avec le bouton vers les réglages, pas un écran vide.
2. **Réseau coupé ou TMDB en erreur** : chaque rangée en échec disparaît, les
   autres restent ; si tout échoue, message et bouton « Réessayer ».
3. **Titres sans image ni résumé** : écartés des rangées (pas d'affiche) ; une
   fiche sans résumé affiche ses infos sans trou.
4. **Retour** : ferme la fiche ou la recherche et rend le focus à la carte
   d'origine ; sur l'accueil, Retour depuis une rangée remonte au rail, puis
   quitte l'appli.
5. **Série sans saison 1 / saison 0 seulement** : saison 0 masquée, première
   saison réelle sélectionnée.

---

### Task 1 : projet Gradle qui compile

**Files :** `app-tv/settings.gradle.kts`, `build.gradle.kts`,
`gradle.properties`, `gradle/libs.versions.toml`, `gradle/wrapper/*`,
`gradlew`, `gradlew.bat`, `.gitignore`, `app/build.gradle.kts`,
`app/proguard-rules.pro`, `app/src/main/AndroidManifest.xml`,
`app/src/main/kotlin/com/movix/tv/MainActivity.kt`, `MovixApp.kt`.

- [x] Wrapper Gradle 9.8.1, AGP 9.4.1, plugins compose et serialization.
- [x] Manifeste : `LEANBACK_LAUNCHER` + `LAUNCHER`, `android:banner`,
      `leanback` et `touchscreen` non requis, `INTERNET`.
- [x] Release : `isMinifyEnabled`, `isShrinkResources`, `localeFilters` fr/en,
      splits ABI v7a + arm64.
- [x] `gradlew assembleDebug` passe.

### Task 2 : thème, polices, logo

**Files :** `ui/theme/{Color,Type,Theme}.kt`, `res/font/*.ttf`,
`res/drawable/ic_movix_mark.xml` (vecteur tiré de `brand/movix.svg`),
`res/drawable/banner.xml`, `res/mipmap-*`.

- [x] `MovixTheme` (tv-material `MaterialTheme` sombre), `MovixColors`,
      `MovixType` (tailles de la maquette : héros 42, titre de rangée 15,
      texte 13.5, méta 12.5, en dp sur une base 960×540).
- [x] `FocusBrackets` : `Modifier.focusBrackets(focused)` qui dessine les deux
      crochets rouges à perforations dans `drawWithContent`.

### Task 3 : données TMDB

**Files :** `data/tmdb/{TmdbApi,TmdbModels,RowRegistry,CatalogRepository}.kt`,
tests `RowRegistryTest`, `CatalogRepositoryTest`, `TmdbApiTest`.

**Interfaces :**
- `class TmdbApi(client: OkHttpClient, keyProvider: () -> String?, language: String = "fr-FR")`
  - `suspend fun list(path: String, params: Map<String,String>, page: Int = 1): TmdbPage`
  - `suspend fun details(type: MediaType, id: Int): TmdbDetails`
  - `suspend fun season(tvId: Int, season: Int): TmdbSeason`
  - `suspend fun search(query: String): List<TmdbItem>`
- `data class RowSpec(id, titleRes, path, params, tier, limit)` ;
  `object RowRegistry { val home; val movies; val series; val anime }`
- `class CatalogRepository(api)` : `suspend fun loadRows(specs): List<CatalogRow>`
  (vagues par palier, doublons retirés dans l'ordre, minimum 8 par rangée,
  rangée < 6 masquée, sans affiche écartée, erreur = rangée absente).

- [x] Tests d'abord (déduplication, rangée masquée, erreur isolée, URL et
      paramètres construits, `language=fr-FR`, aucune `Origin`).

### Task 4 : stockage local

**Files :** `data/local/{LocalStore,ProgressStore,WatchlistStore,SettingsStore}.kt`,
tests `ProgressStoreTest`.

- [x] Clés et formats du site (`progress_*`, `watchlist_*`,
      `watched_episodes_tv_*`), seuils 30 s et 95 %, « Reprendre » = 2 à 95 %,
      12 entrées max, la plus récente d'abord.

### Task 5 : navigation, rail, accueil et pages

**Files :** `ui/nav/{Route,Navigator}.kt`, `ui/components/{Rail,Hero,MediaRow,PosterCard,LandscapeCard}.kt`,
`ui/home/{HomeScreen,HomeViewModel}.kt`.

- [x] Rail repliable, élément courant marqué d'un trait rouge.
- [x] Bannière qui suit la carte sélectionnée (fondu 200 ms, image `w1280`).
- [x] Films / Séries / Animés = même écran, autre registre.

### Task 6 : fiche, recherche, réglages

**Files :** `ui/details/*`, `ui/search/*`, `ui/settings/*`.

- [x] Fiche : boutons, saisons (0 masquée), épisodes, vu / progression.
- [x] Recherche : clavier à l'écran (grille de lettres), résultats en grille.
- [x] Réglages : saisie et test de la clé TMDB (`/configuration`).

### Task 7 : vérification

- [x] `gradlew testDebugUnitTest assembleRelease`.
- [x] Émulateur Android TV 9 (x86) : installer, capturer accueil, fiche,
      recherche ; vérifier le focus au D-pad avec `adb shell input keyevent`.
- [x] Commit.
