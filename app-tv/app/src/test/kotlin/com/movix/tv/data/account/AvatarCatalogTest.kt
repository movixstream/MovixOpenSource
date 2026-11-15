package com.movix.tv.data.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Catalogue des avatars embarqué dans l'appli (la télé n'a aucune route qui le
 * liste). Défaillances visées :
 * - un chemin faux (faute de frappe, fichier renommé sur le site) : avatar
 *   cassé dans « Qui regarde ? », sur la télé comme sur le site ;
 * - un chemin hors de `/avatars/` : le serveur refuse le profil entier ;
 * - l'avatar d'un profil introuvable dans le catalogue : le choix d'avatar
 *   s'ouvrirait ailleurs que sur l'avatar choisi ;
 * - l'avatar proposé à un nouveau profil absent du catalogue : il ne serait
 *   montré comme choisi nulle part.
 */
class AvatarCatalogTest {
    private val all = AvatarCatalog.groups.flatMap { g -> g.categories.flatMap { it.avatars } }

    @Test
    fun cheminsAcceptesParLeServeur() {
        assertTrue(all.isNotEmpty())
        assertEquals(emptyList<String>(), all.filterNot { it.startsWith("/avatars/") && it.endsWith(".png") })
        AvatarCatalog.groups.forEach { g ->
            assertTrue(g.name.isNotBlank() && g.categories.isNotEmpty())
            g.categories.forEach { c -> assertTrue("${g.name} › ${c.name}", c.name.isNotBlank() && c.avatars.isNotEmpty()) }
        }
    }

    /** Chaque avatar existe sous `public/avatars/` du dépôt (servi tel quel par le site). */
    @Test
    fun chaqueAvatarExisteSurLeSite() {
        val root = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
            .firstOrNull { File(it, "public/avatars").isDirectory }
        // Module copié hors du dépôt (vérification de l'index) : rien à comparer.
        assumeTrue("public/avatars introuvable", root != null)
        val missing = all.filterNot { File(root, "public$it").isFile }
        assertEquals(emptyList<String>(), missing)
    }

    @Test
    fun avatarRetrouveDansLeCatalogue() {
        for (path in listOf("/avatars/pixar/pixar_avatar_3.png", "/avatars/disney/disney_avatar_1.png", all.last())) {
            val spot = AvatarCatalog.locate(path)
            assertNotNull(path, spot)
            assertEquals(path, AvatarCatalog.groups[spot!!.group].categories[spot.category].avatars[spot.index])
        }
        assertNull(AvatarCatalog.locate(null))
        assertNull(AvatarCatalog.locate(""))
        assertNull(AvatarCatalog.locate("/avatars/inconnu/rien.png"))
        assertNull(AvatarCatalog.locate("https://exemple.com/avatars/pixar/pixar_avatar_3.png"))
    }

    @Test
    fun avatarsProposesAUnNouveauProfilSontDansLeCatalogue() {
        assertEquals(emptyList<String>(), ProfileRules.NEW_PROFILE_AVATARS.filter { AvatarCatalog.locate(it) == null })
    }
}
