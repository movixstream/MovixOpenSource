package com.movix.tv.adblock

/**
 * Pont JNI vers `libmovix_adblock.so` (crate `app-tv/adblock/`, adblock-rust).
 *
 * Ne pas appeler directement : passer par [AdblockEngine], qui charge le
 * moteur une seule fois et gère le handle. Les noms et signatures sont liés
 * aux fonctions `Java_com_movix_tv_adblock_AdblockNative_*` du crate (règle
 * R8 dans `proguard-rules.pro`).
 */
object AdblockNative {
    init {
        System.loadLibrary("movix_adblock")
    }

    /** Charge le moteur sérialisé + ressources (JSON). 0 si échec. */
    external fun create(engine: ByteArray, resourcesJson: String): Long

    /**
     * null = laisser passer ; "" = bloquer ; sinon URL `data:` de la ressource
     * de redirection (uBO `$redirect`).
     */
    external fun check(handle: Long, url: String, sourceUrl: String, requestType: String): String?

    /**
     * JSON pour la page/frame [url] :
     * `{"css": "...", "script": "...", "generichide": bool, "exceptions": [...], "procedural": [...]}`.
     * `exceptions` est à repasser tel quel à [hiddenSelectors] ; `procedural`
     * liste les filtres procéduraux uBO (JSON adblock-rust) que le CSS ne sait
     * pas exprimer.
     */
    external fun cosmetic(handle: Long, url: String): String

    /** Sélecteurs génériques à cacher pour ces classes/ids (MutationObserver). */
    external fun hiddenSelectors(
        handle: Long,
        classes: Array<String>,
        ids: Array<String>,
        exceptions: Array<String>,
    ): Array<String>

    external fun destroy(handle: Long)
}
