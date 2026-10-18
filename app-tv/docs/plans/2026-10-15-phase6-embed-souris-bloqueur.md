# Phase 6 : lecteur web (embed), souris virtuelle et bloqueur de pubs

Dernier recours quand ni le serveur ni l'extraction sur la télé n'ont donné de
flux : la page du lecteur (embed) s'ouvre en plein écran dans une WebView,
pilotée au D-pad par une souris virtuelle, derrière le bloqueur le plus fort
qu'on puisse tenir sur 1 Go de RAM.

## Bloqueur : adblock-rust en JNI

- Crate `app-tv/adblock/` (`cdylib`, crate `adblock` 0.13.x, `jni`).
  Bibliothèques construites par `cargo ndk` pour `armeabi-v7a`, `arm64-v8a`,
  `x86`, **commitées** dans `app/src/main/jniLibs/<abi>/libmovix_adblock.so`
  (comme `public/wasm/watchparty-sync/`) : le build Gradle n'a pas besoin de
  Rust. Script de régénération dans `app-tv/adblock/` (README).
- Listes : EasyList, EasyList FR (Liste FR), uBlock filters (+ badware,
  privacy, unbreak, annoyances-others si raisonnable), Peter Lowe, plus
  `adblock/lists/movix.txt` (règles propres aux lecteurs). Téléchargées par
  le script de génération (pas au build Gradle), moteur **sérialisé** dans
  `app/src/main/assets/adblock/engine.dat` ; ressources uBO (redirections et
  scriptlets) dans `assets/adblock/resources.json`. Crédits et licences des
  listes dans le README du crate.
- Chargement : une fois, en arrière-plan, à la première ouverture d'un embed,
  gardé tant que l'appli vit (pas au démarrage de l'appli).

API Kotlin (fichier `app/src/main/kotlin/com/movix/tv/adblock/AdblockNative.kt`,
possédé par le crate) :

```kotlin
object AdblockNative {
    /** Charge le moteur sérialisé + ressources (JSON). 0 si échec. */
    external fun create(engine: ByteArray, resourcesJson: String): Long
    /**
     * null = laisser passer ; "" = bloquer ; sinon URL `data:` de la ressource
     * de redirection (uBO `$redirect`).
     */
    external fun check(handle: Long, url: String, sourceUrl: String, requestType: String): String?
    /** JSON {"css": "...", "script": "...", "generichide": bool} pour la page/frame [url]. */
    external fun cosmetic(handle: Long, url: String): String
    /** Sélecteurs génériques à cacher pour ces classes/ids (MutationObserver). */
    external fun hiddenSelectors(handle: Long, classes: Array<String>, ids: Array<String>, exceptions: Array<String>): Array<String>
    external fun destroy(handle: Long)
}
```

`requestType` : `document`, `subdocument`, `script`, `stylesheet`, `image`,
`media`, `font`, `xmlhttprequest`, `websocket`, `other` (types adblock-rust).

Classe d'usage `AdblockEngine` (côté appli) : chargement paresseux depuis les
assets, appels thread-safe (le moteur est en lecture seule), mesure du temps
de `check` (cible < 0,2 ms sur Fire TV Stick Lite).

## Page embed

- `ui/embed/EmbedScreen.kt` : WebView plein écran + `CursorView` par-dessus.
- WebView : JS, DOM storage, `mediaPlaybackRequiresUserGesture=false`,
  `setSupportMultipleWindows(true)` pour que `window.open` passe par
  `onCreateWindow` (refusé), UA Chrome sans `; wv`, pas d'accès fichiers,
  pas de cookies tiers sauf nécessité. Détruite en quittant l'écran.
- `shouldInterceptRequest` + `ServiceWorkerClient` : `AdblockEngine.check`,
  bloqué → réponse vide 403 ; redirection → ressource `data:`.
- Navigation du cadre principal : seules l'URL de départ et son domaine sont
  permises ; autres domaines, `intent:`, `market:` refusés (redirections pub).
- Cosmétique et scriptlets : `WebViewCompat.addDocumentStartJavaScript` sur
  toutes les origines ; le script demande au pont Java (`MovixAdblock`) le CSS
  et les scriptlets de sa frame, les applique, puis observe le DOM pour les
  sélecteurs génériques (par lots, au plus toutes les 300 ms).
- Le même script écoute `postMessage({movix:'toggle'})` (lecture/pause sur
  les `<video>` de sa frame, relayé aux iframes) pour la touche Lecture.

## Souris virtuelle

- `CursorView` : petite View dessinée une fois, bougée par
  `translationX/Y` (aucun redessin de la WebView), boucle `Choreographer`
  tant qu'une flèche est tenue, accélération (vitesse ×1 → ×4 en 0,6 s).
- OK = `MotionEvent` tactile (DOWN puis UP, source `TOUCHSCREEN`) envoyé à la
  WebView au point du curseur : marche dans les iframes cross-origin.
- Bord de l'écran : défilement par faux glissé tactile.
- Retour = quitter l'embed (vers le lecteur) ; Lecture/Pause = `toggle`.
- Curseur caché après 3 s sans mouvement, réapparaît à la première touche.

## Dans le lecteur

- Panneau Source : groupe « Lecteur web » avec les lecteurs embed (ceux qui
  ne s'extraient pas, et les autres en dernier).
- Écran « aucune source » : bouton « Ouvrir le lecteur web » sur le premier
  embed.
- Pas de reprise ni de synchro pendant l'embed (la position n'est pas lisible).
