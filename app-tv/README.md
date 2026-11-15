# Movix TV

Appli Android TV native de Movix (Fire TV, Google TV, Android TV) : Kotlin,
Jetpack Compose for TV et Media3.

- Catalogue par genre, fiches, filmographie des acteurs, épisodes, recherche,
  Ma liste et réglages.
- Lecteur natif avec les sources du serveur Movix, reprise et épisode suivant.
- Qualité réelle de chaque source mesurée à la demande ; langue audio,
  sous-titres et version retenus d'un épisode à l'autre.
- Son Dolby et DTS décodé par l'appli quand la télé ne le gère pas
  ([`ffmpeg/`](ffmpeg/README.md)).
- Extraction des lecteurs embed directement sur la télé, sans WebView : le
  userscript Movix tourne dans QuickJS (module `extractor/`).
- Lecteur web avec bloqueur de pubs ([`adblock/`](adblock/README.md)).
- Liaison au compte Movix par un code affiché sur la télé ; profils du compte,
  avec la restriction d'âge des profils enfant.
- Mode enfant réglable sur la télé (Réglages › Mode enfant), avec ou sans
  compte ; le catalogue d'un profil 7+, 12+ ou 16+ est rempli à partir des
  classifications d'âge de TMDB.
- Profils du compte gérés depuis « Qui regarde ? » : création, avatar, nom,
  limite d'âge, suppression. Le choix d'avatar affiche des vignettes
  embarquées (`app/src/main/assets/avatar_thumbs/`), sans réseau ; quand le
  site change ses avatars, reprendre `AvatarCatalog.kt` puis lancer
  `node app-tv/scripts/build-avatar-thumbs.mjs`.

Installation pour les utilisateurs : page `/app-tv` du site.

## Construire

Il faut le JDK 17 et le SDK Android (plateforme et build-tools 37).

1. Crée `local.properties` (jamais commité) :

   ```properties
   sdk.dir=/chemin/vers/android/sdk
   tmdb.key=ta_clé_tmdb
   ```

   La clé TMDB peut aussi venir de `VITE_TMDB_API_KEY` dans le `.env` à la
   racine du dépôt, ou de la variable `MOVIX_TMDB_KEY`.

2. Compile et lance les tests :

   ```bash
   ./gradlew :app:testDebugUnitTest :app:assembleRelease
   ```

Les APK sortent dans `app/build/outputs/apk/<type>/`, une par ABI
(`armeabi-v7a`, `arm64-v8a`, `x86` pour l'émulateur). Le type `benchmark`
se comporte comme la release mais est signé avec la clé de debug.

## Mises à jour

L'appli lit [`version.json`](version.json) dans ce dépôt et télécharge
[`movix-tv.apk`](movix-tv.apk) quand le `versionCode` est plus grand que le
sien. Elle vérifie taille et SHA-256 avant de lancer l'installeur Android.

Pour publier : augmenter `versionCode` / `versionName` dans
`app/build.gradle.kts`, puis lancer
`scripts/release.sh "Notes en français" "Notes in English"`, qui construit
l'APK signée et réécrit ces deux fichiers.

## Polices

Bricolage Grotesque et Instrument Sans, sous licence SIL Open Font License 1.1,
réduites aux caractères latins (`app/src/main/res/font/`).

## Réseau du lecteur

Certains hébergeurs n'acceptent qu'un vrai navigateur : le lecteur passe alors
par [libcurl-impersonate](https://github.com/lexiforest/curl-impersonate)
(licence MIT), téléchargée et vérifiée au build (NDK 26.1 et CMake 3.22
requis).
