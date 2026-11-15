package com.movix.tv.data.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Vignettes des avatars embarquées dans l'appli (`assets/avatar_thumbs/`),
 * fabriquées par `app-tv/scripts/build-avatar-thumbs.mjs` : le choix d'avatar
 * n'attend ni le réseau ni le décodage d'images de 800 px.
 *
 * Défaillances visées :
 * - nom de vignette calculé autrement par l'appli et par le script (les deux
 *   font le MD5 du chemin) : aucune vignette trouvée, tout retombe sur le réseau ;
 * - avatar ajouté au catalogue sans relancer le script : case lente parmi les autres ;
 * - vignette d'un avatar retiré du site, ou image pleine taille copiée par
 *   erreur : l'APK grossit pour rien.
 */
class AvatarThumbsTest {
    private val all = AvatarCatalog.groups.flatMap { g -> g.categories.flatMap { it.avatars } }

    private val dir: File? = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
        .flatMap { sequenceOf(File(it, "src/main/assets/${AvatarThumbs.DIR}"), File(it, "app/src/main/assets/${AvatarThumbs.DIR}")) }
        .firstOrNull { it.isDirectory }

    // Le script Node calcule le même nom : md5 du chemin du site, en UTF-8.
    @Test
    fun nomDeVignetteCommunAvecLeScript() {
        assertEquals("e9b6421bf42be0d1d6a6b12dec6d3a5b.webp", AvatarThumbs.fileName("/avatars/pixar/pixar_avatar_1.png"))
        // Accent et « + » : mêmes octets des deux côtés (forme composée).
        assertEquals("c67e4f636b8d905f1342ad3979f735d9.webp", AvatarThumbs.fileName("/avatars/disney+/à_contre-sens_2/1.png"))
        assertEquals(AvatarThumbs.fileName("/avatars/disney+/à_contre-sens_2/1.png"), AvatarThumbs.fileName("/avatars/disney+/a\u0300_contre-sens_2/1.png"))
    }

    // Le visage d'un profil reçoit une adresse complète : le chemin du site doit s'y retrouver,
    // sinon sa vignette n'est jamais trouvée et le visage attend le réseau.
    @Test
    fun cheminDuSiteRetrouveDansUneAdresse() {
        assertEquals("/avatars/pixar/pixar_avatar_1.png", AvatarThumbs.pathOf("https://movix.exemple/avatars/pixar/pixar_avatar_1.png"))
        assertEquals("/avatars/disney+/ice_age/3.png", AvatarThumbs.pathOf("/avatars/disney+/ice_age/3.png"))
        assertNull(AvatarThumbs.pathOf(null))
        assertNull(AvatarThumbs.pathOf(""))
        assertNull(AvatarThumbs.pathOf("https://exemple.com/photo.png"))
    }

    @Test
    fun chaqueAvatarDuCatalogueASaVignette() {
        assumeTrue("dossier des vignettes introuvable", dir != null)
        val missing = all.filterNot { File(dir, AvatarThumbs.fileName(it)).isFile }
        assertEquals("relancer : node app-tv/scripts/build-avatar-thumbs.mjs", emptyList<String>(), missing)
    }

    @Test
    fun aucuneVignetteEnTropNiTropLourde() {
        assumeTrue("dossier des vignettes introuvable", dir != null)
        val expected = all.mapTo(HashSet()) { AvatarThumbs.fileName(it) }
        val files = dir!!.listFiles().orEmpty().filter { it.isFile }
        assertEquals(emptyList<String>(), files.map { it.name }.filterNot { it in expected })
        // Une vignette pèse quelques Ko ; une image du site, jusqu'à 600 Ko.
        assertEquals(emptyList<String>(), files.filter { it.length() > 24 * 1024 }.map { it.name })
        assertTrue("vignettes : ${files.sumOf { it.length() } / 1024} Ko", files.sumOf { it.length() } < 9L * 1024 * 1024)
    }
}
