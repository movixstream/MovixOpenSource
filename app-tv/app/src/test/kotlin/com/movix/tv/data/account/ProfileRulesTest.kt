package com.movix.tv.data.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Profils créés, modifiés et supprimés depuis la télé (« Gérer les profils »).
 * Aucun test de bout en bout ne tourne sur une télé ; défaillances visées :
 * - un champ que l'on n'a pas changé renvoyé au serveur : la télé réécrirait
 *   le nom ou l'avatar changés entre-temps sur le site ;
 * - « Aucune » limite envoyée comme un champ absent : le profil enfant le resterait ;
 * - un avatar hors de `/avatars/` envoyé : le serveur refuse tout l'enregistrement ;
 * - un nom vide envoyé, ou un nom trop long (refus du serveur) ;
 * - suppression du profil en cours ou du dernier profil : le serveur en recrée
 *   un par défaut et l'historique est perdu ;
 * - modification d'un autre profil appliquée au compte de la télé (la limite
 *   d'un enfant posée sur le parent), ou celle du profil en cours oubliée (le
 *   catalogue ne suivrait pas la nouvelle limite).
 */
class ProfileRulesTest {
    private val pixar1 = "/avatars/pixar/pixar_avatar_1.png"
    private val mickey2 = "/avatars/mickey/mickey_avatar_2.png"
    private val lea = LinkedProfile("p1", "Léa", pixar1, 12)

    @Test
    fun rienDeChangeRienNePart() {
        assertTrue(ProfileRules.changes(lea, "Léa", pixar1, 12).isEmpty)
        // Espaces autour du nom : le serveur les retire aussi, ce n'est pas un changement.
        assertTrue(ProfileRules.changes(lea, "  Léa ", pixar1, 12).isEmpty)
    }

    @Test
    fun seulsLesChampsChangesPartent() {
        assertEquals(ProfileEdit(name = "Léo"), ProfileRules.changes(lea, " Léo ", pixar1, 12))
        assertEquals(ProfileEdit(avatar = mickey2), ProfileRules.changes(lea, "Léa", mickey2, 12))
        assertEquals(ProfileEdit(ageRestriction = 7), ProfileRules.changes(lea, "Léa", pixar1, 7))
        assertEquals(ProfileEdit(name = "Léo", avatar = mickey2, ageRestriction = 16), ProfileRules.changes(lea, "Léo", mickey2, 16))
    }

    @Test
    fun limiteLeveeEnvoieZero() {
        assertEquals(ProfileEdit(ageRestriction = 0), ProfileRules.changes(lea, "Léa", pixar1, 0))
        // Limite absente sur le serveur = aucune (le site lit `ageRestriction || 0`) : « Aucune » ne change rien.
        val parent = LinkedProfile("p0", "Parent", "/avatars/disney/disney_avatar_1.png", null)
        assertTrue(ProfileRules.changes(parent, "Parent", "/avatars/disney/disney_avatar_1.png", 0).isEmpty)
        assertEquals(ProfileEdit(ageRestriction = 12), ProfileRules.changes(parent, "Parent", "/avatars/disney/disney_avatar_1.png", 12))
    }

    @Test
    fun avatarHorsDuSiteJamaisEnvoye() {
        assertNull(ProfileRules.changes(lea, "Léa", "https://exemple.com/a.png", 12).avatar)
        assertNull(ProfileRules.changes(lea, "Léa", "", 12).avatar)
        // Avatar d'origine qui n'est pas du site (ancien compte) et non changé : rien ne part.
        val ancien = lea.copy(avatar = null)
        assertTrue(ProfileRules.changes(ancien, "Léa", "", 12).isEmpty)
    }

    @Test
    fun nomVideJamaisEnvoyeNomTropLongCoupe() {
        assertNull(ProfileRules.changes(lea, "   ", pixar1, 12).name)
        assertEquals(ProfileRules.PROFILE_NAME_MAX, ProfileRules.changes(lea, "b".repeat(40), pixar1, 12).name?.length)
    }

    @Test
    fun avatarDUnNouveauProfil() {
        // Le serveur refuse tout avatar hors de `/avatars/`.
        assertTrue(ProfileRules.NEW_PROFILE_AVATARS.all { it.startsWith("/avatars/") })
        val first = ProfileRules.NEW_PROFILE_AVATARS.first()
        assertEquals(first, ProfileRules.newProfileAvatar(emptyList()))
        // Déjà pris par un autre profil : le suivant, pour les distinguer dans « Qui regarde ? ».
        assertEquals(ProfileRules.NEW_PROFILE_AVATARS[1], ProfileRules.newProfileAvatar(listOf(first, null)))
        // Tous pris : on en donne un quand même.
        assertTrue(ProfileRules.newProfileAvatar(ProfileRules.NEW_PROFILE_AVATARS) in ProfileRules.NEW_PROFILE_AVATARS)
    }

    @Test
    fun nomDUnNouveauProfil() {
        // Mêmes bornes que le serveur (1 à 32 caractères) : un nom refusé là-bas ne part pas.
        assertNull(ProfileRules.profileName("   "))
        assertEquals("Léo", ProfileRules.profileName("  Léo "))
        assertEquals(32, ProfileRules.profileName("a".repeat(40))?.length)
    }

    @Test
    fun avatarAccepteParLeServeur() {
        assertTrue(ProfileRules.isSiteAvatar(pixar1))
        assertFalse(ProfileRules.isSiteAvatar(null))
        assertFalse(ProfileRules.isSiteAvatar(""))
        assertFalse(ProfileRules.isSiteAvatar("https://exemple.com/avatars/a.png"))
    }

    @Test
    fun suppressionNiDuProfilEnCoursNiDuDernier() {
        assertFalse(ProfileRules.canDelete("p1", currentId = "p1", count = 3))
        assertFalse(ProfileRules.canDelete("p2", currentId = "p1", count = 1))
        assertTrue(ProfileRules.canDelete("p2", currentId = "p1", count = 2))
    }

    private val account = Account("jwt", "oauth", "u1", "p1", "Léa", pixar1, sessionId = "s1", ageRestriction = 12)

    @Test
    fun profilEnCoursModifieMetAJourLeCompte() {
        val next = ProfileRules.accountAfterSave(account, LinkedProfile("p1", "Léo", mickey2, 7))
        assertEquals("Léo", next?.profileName)
        assertEquals(mickey2, next?.avatar)
        assertEquals(7, next?.ageRestriction)
        // Le reste du compte (session) ne bouge pas.
        assertEquals("jwt", next?.token)
        assertEquals("p1", next?.profileId)
        assertEquals("s1", next?.sessionId)
        // Limite levée : 0 (aucune), jamais `null` (« inconnue » ferait attendre le catalogue).
        assertEquals(0, ProfileRules.accountAfterSave(account, LinkedProfile("p1", "Léa", pixar1, null))?.ageRestriction)
    }

    @Test
    fun autreProfilModifieNeTouchePasAuCompte() {
        assertNull(ProfileRules.accountAfterSave(account, LinkedProfile("p2", "Enfant", mickey2, 7)))
    }
}
