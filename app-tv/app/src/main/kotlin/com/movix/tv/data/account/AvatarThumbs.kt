package com.movix.tv.data.account

import java.security.MessageDigest
import java.text.Normalizer

/**
 * Vignettes des avatars embarquées dans l'appli (`assets/avatar_thumbs/`) :
 * 144 px, 4 Ko en moyenne, contre des images de 800 px et 600 Ko sur le site.
 * Le choix d'avatar s'en sert pour ne rien télécharger et ne presque rien
 * décoder. Fabriquées par `app-tv/scripts/build-avatar-thumbs.mjs`, à relancer
 * avec le catalogue ([AvatarCatalog]) quand le site change ses avatars.
 */
object AvatarThumbs {
    /** Dossier des vignettes dans les `assets` de l'appli. */
    const val DIR = "avatar_thumbs"

    /**
     * Fichier de la vignette de l'avatar [path] (chemin du site, `/avatars/…`) :
     * le MD5 du chemin, en UTF-8 et en forme composée, comme le script qui les
     * fabrique. Un nom en hexadécimal évite accents, apostrophes et « + » dans l'APK.
     */
    fun fileName(path: String): String {
        val bytes = Normalizer.normalize(path, Normalizer.Form.NFC).toByteArray(Charsets.UTF_8)
        val digest = MessageDigest.getInstance("MD5").digest(bytes)
        return buildString(digest.size * 2 + 5) {
            for (b in digest) {
                append(HEX[(b.toInt() shr 4) and 0xF])
                append(HEX[b.toInt() and 0xF])
            }
            append(".webp")
        }
    }

    /** Chemin du site (`/avatars/…`) de l'avatar à l'adresse [url] ; `null` si ce n'est pas un avatar du site. */
    fun pathOf(url: String?): String? {
        val start = url?.indexOf(SITE_FOLDER) ?: -1
        return if (start >= 0) url?.substring(start) else null
    }

    private const val SITE_FOLDER = "/avatars/"

    private const val HEX = "0123456789abcdef"
}
