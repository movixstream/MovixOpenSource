# Bloqueur du lecteur web (adblock-rust en JNI)

Bloqueur de pubs du lecteur web (embed) de l'appli télé : le moteur
[adblock-rust](https://github.com/brave/adblock-rust) de Brave (crate `adblock`
0.13.3), appelé depuis Kotlin par JNI (`com.movix.tv.adblock.AdblockNative`,
utilisé à travers `AdblockEngine`).

Tout est préparé sur la machine de build et **commité** :

| Fichier | Rôle | Taille |
|---|---|---|
| `app/src/main/jniLibs/armeabi-v7a/libmovix_adblock.so` | bibliothèque native | 1,9 Mo |
| `app/src/main/jniLibs/arm64-v8a/libmovix_adblock.so` | bibliothèque native (pages de 16 Ko) | 2,8 Mo |
| `app/src/main/jniLibs/x86/libmovix_adblock.so` | bibliothèque native (émulateur) | 3,0 Mo |
| `app/src/main/assets/adblock/engine.dat` | moteur sérialisé (toutes les listes) | 6,8 Mo (2,9 Mo compressé dans l'APK) |
| `app/src/main/assets/adblock/resources.json` | redirections et scriptlets uBO | 0,47 Mo (0,1 Mo compressé) |

Le build Gradle n'a donc pas besoin de Rust, et la télé ne télécharge ni
n'analyse aucune liste : elle désérialise `engine.dat` une fois, à la
première ouverture du lecteur web.

## Contenu du crate

- `src/lib.rs` : `MovixEngine` (chargement, `check`, `cosmetic`,
  `hidden_selectors`) et les fonctions JNI. Aucune panique ne traverse JNI
  (`catch_unwind`, d'où `panic = "unwind"` en release) ; un handle à 0 vaut
  « moteur absent ».
- `src/bin/gen.rs` (feature `gen`) : lit les listes téléchargées, applique
  les directives uBO `!#include` et `!#if` (environnement : uBO sur Chromium
  mobile, sans filtrage HTML), construit et sérialise le moteur, valide les
  ressources et vérifie qu'une pub est bloquée et un lecteur non.
- `gen/ubo-resources.mjs` : assemble les ressources uBO au format
  adblock-rust (le format module ES des scriptlets récents n'est pas lisible
  par l'assembleur d'adblock-rust).
- `lists/movix.txt` : règles propres aux lecteurs (régies popunder connues,
  `nowoif` sur les hébergeurs). Rester prudent : rien qui touche aux lecteurs
  ni à leurs CDN.
- `src/tests.rs` : tests sur le vrai `engine.dat` (régies bloquées, lecteurs
  non bloqués, redirection `data:`, cosmétique, scriptlets, entrées invalides).

## Contrat JNI

- `check(handle, url, sourceUrl, requestType)` : `null` = laisser passer,
  `""` = bloquer, sinon URL `data:` de la ressource de redirection.
- `cosmetic(handle, url)` : JSON
  `{"css", "script", "generichide", "exceptions", "procedural"}`. `css` =
  sélecteurs cachés (`display:none!important`, une règle par sélecteur) et
  filtres `:style()` ; `script` = scriptlets uBO dans une fonction qui définit
  `scriptletGlobals` ; `exceptions` = à repasser à `hiddenSelectors` ;
  `procedural` = filtres procéduraux uBO (JSON adblock-rust) inexprimables en CSS.
- `hiddenSelectors(handle, classes, ids, exceptions)` : sélecteurs génériques
  à cacher pour les classes et ids apparus dans la page.

## Régénérer

Prérequis : Rust avec les cibles `armv7-linux-androideabi`,
`aarch64-linux-android` et `i686-linux-android`, `cargo-ndk` 3.5.4, Node.js,
curl, tar et le NDK Android (`ANDROID_NDK_HOME`).

```bash
cd app-tv/adblock
./build.sh            # listes, assets, tests, bibliothèques des 3 ABI
./build.sh --no-ndk   # listes, assets et tests seulement
```

Le format de `engine.dat` dépend de la version d'adblock-rust : après une
mise à jour du crate `adblock`, toujours tout régénérer (assets **et** `.so`).
Les listes sont prises telles qu'elles sont le jour de la génération ; la
version de uBlock Origin des ressources est épinglée dans `build.sh`
(`UBO_TAG`, actuellement 1.75.0).

## Crédits et licences

Les listes et ressources sont incluses dans `engine.dat` et `resources.json`
sous leurs propres licences :

| Source | Auteurs | Licence |
|---|---|---|
| [EasyList](https://easylist.to/) | équipe EasyList | GPLv3 ou CC BY-SA 3.0 ([licence](https://easylist.to/pages/licence.html)) |
| [Liste FR](https://forums.lanik.us/viewforum.php?f=91) | équipe Liste FR (EasyList) | CC BY-SA 3.0 (en-tête de la liste) |
| [uBlock filters](https://github.com/uBlockOrigin/uAssets) (filters, badware, privacy, unbreak, quick-fixes) | Raymond Hill et contributeurs uAssets | GPLv3 |
| Redirections et scriptlets de [uBlock Origin](https://github.com/gorhill/uBlock) 1.75.0 | Raymond Hill et contributeurs | GPLv3 |
| [Peter Lowe's Ad and tracking server list](https://pgl.yoyo.org/adservers/) | Peter Lowe | conditions de l'auteur ([policy](https://pgl.yoyo.org/adservers/policy.php)) |
| `lists/movix.txt` | Movix | MPL-2.0 |
| [adblock-rust](https://github.com/brave/adblock-rust) | Brave Software | MPL-2.0 |
| [jni-rs](https://github.com/jni-rs/jni-rs) | contributeurs jni-rs | MIT ou Apache-2.0 |
