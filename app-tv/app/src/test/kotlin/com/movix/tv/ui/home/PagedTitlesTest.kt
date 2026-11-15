package com.movix.tv.ui.home

import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.MediaType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Grille paginée de « Voir tout » et des genres. Aucun test de bout en bout ne
 * tourne sur une télé : ces défaillances ne seraient vues par personne avant un membre.
 *
 * - TMDB trie par popularité à chaque appel : une page peut répéter des titres de
 *   la précédente → doublons dans la grille (deux cartes de même clé font planter
 *   la liste paresseuse) ;
 * - page vide (fin du catalogue) → la grille doit s'arrêter, pas redemander sans fin ;
 * - TMDB refuse toute page après la 500e → ne jamais la demander ;
 * - échec réseau → les titres déjà affichés restent, la même page est redemandée
 *   au « Réessayer », et le focus seul ne relance pas la requête en boucle ;
 * - réponse en double ou d'une autre page → ignorée ;
 * - une seule requête à la fois (boîtiers lents) ;
 * - la page suivante n'est demandée que quand le focus approche de la fin.
 */
class PagedTitlesTest {
    private fun item(id: Int) = MediaItem(id, MediaType.MOVIE, "T$id", "/$id.jpg", null, "", null, null)
    private fun items(range: IntRange) = range.map { item(it) }

    private fun PagedTitles.load(page: Int, found: List<MediaItem>) = loadingPage().received(page, found)

    @Test
    fun pagesSAjoutentSansDoublonDansLOrdre() {
        val s = PagedTitles().load(1, items(1..20)).load(2, items(15..34))
        assertEquals((1..34).toList(), s.items.map { it.id })
        assertEquals(3, s.nextPage)
        assertFalse(s.ended)
    }

    @Test
    fun pageVideTermineLaListe() {
        val s = PagedTitles().load(1, items(1..20)).load(2, emptyList())
        assertTrue(s.ended)
        assertFalse(s.canLoad)
        assertFalse(s.wantsMore(19))
        assertEquals((1..20).toList(), s.items.map { it.id })
    }

    @Test
    fun premierePageVideDonneUneListeVideTerminee() {
        val s = PagedTitles().load(1, emptyList())
        assertTrue(s.ended)
        assertTrue(s.items.isEmpty())
        assertFalse(s.failed)
    }

    @Test
    fun jamaisAuDelaDeLaPage500() {
        var s = PagedTitles()
        for (page in 1..PagedTitles.MAX_PAGE) {
            assertTrue("page $page refusée", s.canLoad)
            s = s.load(page, listOf(item(page)))
        }
        assertTrue(s.ended)
        assertFalse(s.canLoad)
        assertEquals(PagedTitles.MAX_PAGE, s.items.size)
    }

    @Test
    fun echecGardeLesTitresEtRedemandeLaMemePage() {
        val ok = PagedTitles().load(1, items(1..20))
        val ko = ok.loadingPage().failed(2)
        assertEquals((1..20).toList(), ko.items.map { it.id })
        assertTrue(ko.failed)
        assertFalse(ko.loading)
        assertEquals(2, ko.nextPage)
        // Le focus ne relance pas la page en échec : seul « Réessayer » le fait.
        assertFalse(ko.wantsMore(19))
        assertTrue(ko.canLoad)
        val retried = ko.loadingPage()
        assertFalse(retried.failed)
        val s = retried.received(2, items(21..40))
        assertEquals((1..40).toList(), s.items.map { it.id })
        assertEquals(3, s.nextPage)
    }

    @Test
    fun echecDeLaPremierePageSeRetente() {
        val ko = PagedTitles().loadingPage().failed(1)
        assertTrue(ko.failed)
        assertTrue(ko.items.isEmpty())
        assertEquals(1, ko.nextPage)
        assertTrue(ko.canLoad)
    }

    @Test
    fun reponseEnDoubleOuDUneAutrePageIgnoree() {
        val s = PagedTitles().load(1, items(1..20))
        // Même page reçue une seconde fois, ou page qui n'est pas celle attendue.
        assertEquals(s, s.received(1, items(100..120)))
        val waiting = s.loadingPage()
        assertEquals(waiting, waiting.received(3, items(200..220)))
        assertEquals(waiting, waiting.failed(3))
    }

    @Test
    fun uneSeuleRequeteALaFois() {
        val s = PagedTitles().load(1, items(1..20)).loadingPage()
        assertTrue(s.loading)
        assertFalse(s.canLoad)
        assertFalse(s.wantsMore(19))
    }

    @Test
    fun pageSuivanteSeulementPresDeLaFin() {
        val s = PagedTitles().load(1, items(1..20)).load(2, items(21..40)).load(3, items(41..60))
        assertFalse(s.wantsMore(0, ahead = 21))
        assertFalse(s.wantsMore(38, ahead = 21))
        assertTrue(s.wantsMore(39, ahead = 21))
        assertTrue(s.wantsMore(59, ahead = 21))
    }

    // Profil limité (restriction d'âge) : une page de TMDB peut être entièrement
    // masquée (genre Horreur pour un profil 7+) sans que le catalogue soit au bout.
    // - la liste ne doit pas s'arrêter sur cette page vide ;
    // - elle ne doit pas non plus demander des pages masquées sans fin ;
    // - grille vide au bout : l'écran doit savoir que c'est le profil qui masque tout.

    private fun PagedTitles.hiddenPage(page: Int, hidden: Int = 20) = loadingPage().received(page, emptyList(), hidden = hidden)

    @Test
    fun pageEntierementMasqueeNeTerminePasLaListe() {
        val s = PagedTitles().load(1, items(1..5)).hiddenPage(2)
        assertFalse(s.ended)
        assertTrue(s.canLoad)
        assertEquals(3, s.nextPage)
        assertEquals((1..5).toList(), s.items.map { it.id })
        // Grille courte : la page suivante reste à demander.
        assertTrue(s.wantsMore(4))
    }

    @Test
    fun pagesMasqueesDeSuiteBornees() {
        var s = PagedTitles()
        for (page in 1 until PagedTitles.MAX_HIDDEN_PAGES) {
            s = s.hiddenPage(page)
            assertFalse("page $page", s.ended)
        }
        s = s.hiddenPage(PagedTitles.MAX_HIDDEN_PAGES)
        assertTrue(s.ended)
        assertFalse(s.canLoad)
        assertTrue(s.items.isEmpty())
        assertTrue(s.onlyHidden)
    }

    @Test
    fun pageAvecTitresRemetLeCompteAZero() {
        var s = PagedTitles()
        for (page in 1 until PagedTitles.MAX_HIDDEN_PAGES) s = s.hiddenPage(page)
        s = s.loadingPage().received(PagedTitles.MAX_HIDDEN_PAGES, items(1..2), hidden = 18)
        for (page in 1 until PagedTitles.MAX_HIDDEN_PAGES) {
            s = s.hiddenPage(PagedTitles.MAX_HIDDEN_PAGES + page)
            assertFalse(s.ended)
        }
        assertEquals(listOf(1, 2), s.items.map { it.id })
        assertFalse(s.onlyHidden)
    }

    @Test
    fun vraiePageVideTermineMemeApresDesPagesMasquees() {
        val s = PagedTitles().load(1, items(1..3)).hiddenPage(2).loadingPage().received(3, emptyList())
        assertTrue(s.ended)
        assertFalse(s.onlyHidden)
    }

    @Test
    fun listeVideSansRienDeMasqueNestPasDuFaitDuProfil() {
        val s = PagedTitles().load(1, emptyList())
        assertTrue(s.ended)
        assertFalse(s.onlyHidden)
    }
}
