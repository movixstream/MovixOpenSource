# Phase 3 : extraction sur la télé avec QuickJS natif — plan

> Exécution native (superpowers:executing-plans). Choix de l'utilisateur :
> **pas de WebView**, le plus optimisé possible.

**Goal :** sans VIP (ou quand le serveur n'a rien résolu), extraire sur la
télé le flux des lecteurs embed (Voe, Vidmoly, Uqload, Sibnet, Dood, Lulu,
Veev, Vidara, SeekStreaming, Fsvid, Vidzy) avec le userscript Movix
**inchangé**, et le lire dans le lecteur natif.

**Architecture :**
- Module Kotlin pur `extractor/` (JVM, testable sur PC contre les vrais
  hébergeurs) : un runtime QuickJS (`io.github.dokar3:quickjs-kt:1.0.15`,
  0,66 Mo en armeabi-v7a), des polyfills navigateur minimaux, et une boucle
  d'événements **pilotée par Kotlin** : minuteurs et requêtes réseau sont des
  fonctions natives synchrones qui rendent la main tout de suite ; Kotlin
  rappelle le JS quand c'est prêt. Aucune évaluation ne reste bloquée.
- Réseau : `GM_xmlhttpRequest` → interface `HttpBridge`. Dans l'appli :
  Cronet (empreinte TLS de Chrome) ou OkHttp, règles `MediaHeaders` par hôte.
- Fsvid / Vidzy : le userscript charge un QuickJS compilé en WebAssembly
  depuis jsDelivr ; on le remplace par une cale `__movixNativeQJS` qui
  exécute les scripts du lecteur dans un **second QuickJS natif** (bac à sable,
  limites mémoire et temps). Un seul remplacement de texte dans le userscript,
  journalisé s'il ne trouve plus sa cible.
- Le userscript (`MovixTv-main/userscript/movix.user.js`, v1.7.3) est copié
  dans `app/src/main/assets/extract/`. Il est compilé en bytecode une fois
  (cache sur disque, clé = SHA-256 du script) : démarrage en millisecondes.
- Le runtime se crée à la première extraction et se ferme après 2 min sans
  usage : zéro coût pendant la lecture.

## Global Constraints

- Aucune WebView. Aucun téléchargement de code à l'exécution.
- Le userscript reste le fichier amont tel quel (resynchronisation = copie).
- Extraction d'un lecteur : 25 s au plus ; trois lecteurs en parallèle.
- Lecture : URL **et** en-têtes rendus par `__MOVIX_PREPARE_CAST_SOURCE__`.

## Review Focus

1. Un lecteur qui ne répond jamais : délai de 25 s, puis le suivant.
2. Une promesse rejetée sans gestionnaire dans le userscript : ne doit pas
   tuer le runtime ni les autres extractions.
3. Un minuteur jamais annulé (cache, intervalle) : ne bloque rien.
4. Fsvid servant son leurre (`/troll/`) sans les bons en-têtes : en-têtes de
   `MediaHeaders` appliqués à l'extraction comme à la lecture.
5. VIP dont toutes les sources serveur échouent : bascule sur l'extraction.

## Tasks

1. Module `extractor` : Gradle, quickjs-kt, polyfills, pont réseau, cale
   QuickJS, runtime, tests unitaires des polyfills (faux réseau).
2. Tests réels (`MOVIX_LIVE=1`) : liens embed pris sur la Main API sans VIP,
   extraction par hébergeur, lecture de la playlist avec les en-têtes rendus.
3. Appli : `AndroidHttpBridge` (Cronet / OkHttp + `MediaHeaders`), cache du
   bytecode, fermeture après inactivité.
4. Lecteur : sources « Extraction sur la télé » lançables, extraction
   automatique quand aucune source serveur n'est jouable ou qu'elles ont
   toutes échoué ; en-têtes et sous-titres de l'extraction transmis au lecteur.
5. Vérification sur l'émulateur **sans VIP**, mesures, commit.
