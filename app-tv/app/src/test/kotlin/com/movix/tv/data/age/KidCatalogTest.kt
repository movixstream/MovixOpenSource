package com.movix.tv.data.age

import com.movix.tv.data.tmdb.MediaType
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Où la télé cherche les titres d'un profil limité, et quand elle s'arrête.
 * Aucun test de bout en bout ne tourne sur une télé avec un profil enfant.
 *
 * Défaillances visées :
 * - rangée presque vide en 7+ : une seule page de la liste générale, dont le
 *   filtre d'âge ne garde que 2 à 5 titres sur 20 (mesuré sur TMDB) ;
 * - classification demandée à TMDB au-dessus de la limite du profil : des pages
 *   entières vérifiées pour rien ;
 * - titres « NR » (non classés) ramenés par un filtre sans plancher ;
 * - requêtes sans fin sur une rangée qui n'a rien pour le profil ;
 * - même titre vérifié ou affiché deux fois quand deux sources le donnent ;
 * - profil sans restriction ralenti ou changé par ce mécanisme.
 */
class KidCatalogTest {
    private val popular = mapOf("sort_by" to "popularity.desc", "with_genres" to "28")

    // ------------------------------------------------------------ requêtes

    @Test
    fun sansRestrictionLaRangeeEstDemandeeTelleQuelle() {
        val same = listOf(ListQuery("/discover/movie", popular))
        assertEquals(same, KidCatalog.queries("/discover/movie", popular, 0))
        // 18+ : la règle ne masque presque rien, la liste générale suffit.
        assertEquals(same, KidCatalog.queries("/discover/movie", popular, 18))
        assertEquals(listOf(ListQuery("/movie/popular", emptyMap())), KidCatalog.queries("/movie/popular", emptyMap(), 0))
    }

    @Test
    fun filmsDemandesParClassificationFrancaisePuisAmericaine() {
        val q = KidCatalog.queries("/discover/movie", popular, 7)
        assertEquals(listOf("FR", "US"), q.map { it.params["certification_country"] })
        assertTrue(q.all { it.path == "/discover/movie" })
        // Les paramètres de la rangée restent (genre, tri).
        assertTrue(q.all { it.params["with_genres"] == "28" && it.params["sort_by"] == "popularity.desc" })
        assertEquals(listOf("TP", "PG"), q.map { it.params["certification.lte"] })
        // Plancher : sans lui, TMDB ramène aussi les titres « NR », que la règle ne sait pas lire.
        assertEquals(listOf("TP", "G"), q.map { it.params["certification.gte"] })
        assertEquals(listOf("12", "PG"), KidCatalog.queries("/discover/movie", popular, 12).map { it.params["certification.lte"] })
        assertEquals(listOf("16", "PG-13"), KidCatalog.queries("/discover/movie", popular, 16).map { it.params["certification.lte"] })
    }

    @Test
    fun seriesDemandeesParClassification() {
        val q = KidCatalog.queries("/discover/tv", popular, 7)
        assertEquals(listOf("FR", "US"), q.map { it.params["certification_country"] })
        assertEquals(listOf("TP", "TV-PG"), q.map { it.params["certification.lte"] })
        assertEquals(listOf("TP", "TV-Y"), q.map { it.params["certification.gte"] })
        assertEquals(listOf("12", "TV-PG"), KidCatalog.queries("/discover/tv", popular, 12).map { it.params["certification.lte"] })
        assertEquals(listOf("16", "TV-14"), KidCatalog.queries("/discover/tv", popular, 16).map { it.params["certification.lte"] })
    }

    // La table des classifications doit suivre la règle d'âge : un plafond
    // au-dessus de la limite ferait vérifier des pages de titres interdits.
    @Test
    fun plafondDemandeJamaisAuDessusDeLaLimite() {
        for (limit in listOf(7, 12, 16)) {
            for (path in listOf("/discover/movie", "/discover/tv")) {
                for (q in KidCatalog.queries(path, popular, limit)) {
                    val age = AgeRules.certificationAge(q.params["certification.lte"])
                    assertTrue("$path $limit+ : ${q.params}", age != null && AgeRules.allows(limit, age))
                }
            }
        }
    }

    @Test
    fun limiteInhabituelleRameneeAuPalierPlusStrict() {
        // Une limite hors des paliers du site ne demande jamais plus large qu'elle.
        assertEquals(KidCatalog.queries("/discover/tv", popular, 12), KidCatalog.queries("/discover/tv", popular, 13))
        assertEquals(KidCatalog.queries("/discover/tv", popular, 7), KidCatalog.queries("/discover/tv", popular, 10))
        assertEquals(KidCatalog.queries("/discover/tv", popular, 7), KidCatalog.queries("/discover/tv", popular, 5))
    }

    @Test
    fun listesFixesRemplaceesParLeurEquivalentFiltrable() {
        // `/movie/popular` et les autres n'acceptent aucun filtre : TMDB documente leur équivalent « discover ».
        val pop = KidCatalog.queries("/movie/popular", emptyMap(), 7)
        assertTrue(pop.all { it.path == "/discover/movie" && it.params["sort_by"] == "popularity.desc" })
        assertEquals(listOf("FR", "US"), pop.map { it.params["certification_country"] })
        val top = KidCatalog.queries("/tv/top_rated", emptyMap(), 12)
        assertTrue(top.all { it.path == "/discover/tv" && it.params["sort_by"] == "vote_average.desc" && it.params["vote_count.gte"] == "200" })
        assertTrue(KidCatalog.queries("/movie/top_rated", emptyMap(), 12).all { it.path == "/discover/movie" && it.params["sort_by"] == "vote_average.desc" })
        assertTrue(KidCatalog.queries("/tv/popular", emptyMap(), 16).all { it.path == "/discover/tv" })
    }

    // Les tendances n'acceptent aucun filtre et ne laissent que 2 titres sur 20 en
    // 7+ : elles passent d'abord, puis les titres populaires classés complètent.
    @Test
    fun tendancesCompleteesParLesTitresPopulairesClasses() {
        val movies = KidCatalog.queries("/trending/movie/week", emptyMap(), 7)
        assertEquals(ListQuery("/trending/movie/week", emptyMap()), movies.first())
        assertEquals(listOf("/discover/movie", "/discover/movie"), movies.drop(1).map { it.path })
        assertEquals(listOf("FR", "US"), movies.drop(1).map { it.params["certification_country"] })
        assertTrue(movies.drop(1).all { it.params["sort_by"] == "popularity.desc" && it.params["certification.lte"] != null })

        val series = KidCatalog.queries("/trending/tv/day", emptyMap(), 12)
        assertEquals(listOf("/trending/tv/day", "/discover/tv", "/discover/tv"), series.map { it.path })

        // Films et séries mêlés : une liste classée de chaque.
        val all = KidCatalog.queries("/trending/all/day", emptyMap(), 16)
        assertEquals(listOf("/trending/all/day", "/discover/movie", "/discover/tv"), all.map { it.path })
        assertEquals(listOf("FR", "FR"), all.drop(1).map { it.params["certification_country"] })

        // Sans restriction : les tendances seules, comme avant.
        assertEquals(listOf(ListQuery("/trending/all/day", emptyMap())), KidCatalog.queries("/trending/all/day", emptyMap(), 0))
    }

    @Test
    fun listeSansEquivalentGardeeTelleQuelle() {
        // « En cours de diffusion » : la compléter par des séries populaires la rendrait fausse.
        assertEquals(listOf(ListQuery("/tv/on_the_air", emptyMap())), KidCatalog.queries("/tv/on_the_air", emptyMap(), 7))
    }

    // Les listes « discover » ne disent pas si leurs titres sont des films ou des
    // séries. Ajoutées à une rangée de films (ou mêlée), elles doivent le dire
    // elles-mêmes : sinon une série s'ouvrirait comme le film de même numéro.
    @Test
    fun typeDesTitresDUneListeAjoutee() {
        assertEquals(MediaType.MOVIE, KidCatalog.typeOf("/discover/movie"))
        assertEquals(MediaType.TV, KidCatalog.typeOf("/discover/tv"))
        assertEquals(null, KidCatalog.typeOf("/trending/all/day"))
        for (limit in listOf(7, 12, 16)) {
            val added = KidCatalog.queries("/trending/all/day", emptyMap(), limit).drop(1)
            assertEquals(listOf(MediaType.MOVIE, MediaType.TV), added.map { KidCatalog.typeOf(it.path) })
        }
    }

    @Test
    fun rangeeQuiFiltreDejaParClassificationLaisseeIntacte() {
        val own = popular + mapOf("certification_country" to "US", "certification" to "R")
        assertEquals(listOf(ListQuery("/discover/movie", own)), KidCatalog.queries("/discover/movie", own, 7))
    }

    // --------------------------------------------------------- remplissage

    private val a = ListQuery("/a", emptyMap())
    private val b = ListQuery("/b", emptyMap())

    /** Sources factices : `pages[requête][n° de page - 1]`, et le journal des pages demandées. */
    private class Fake(val pages: Map<ListQuery, List<List<String>>>, val allowed: (String) -> Boolean = { true }) {
        val asked = ArrayList<Pair<String, Int>>()
        val checked = ArrayList<String>()
        fun load(q: ListQuery, page: Int): ListPage<String> {
            asked += q.path to page
            val all = pages[q].orEmpty()
            return ListPage(all.getOrElse(page - 1) { emptyList() }, hasMore = page < all.size)
        }
        fun keep(items: List<String>): List<String> {
            checked += items
            return items.filter(allowed)
        }
    }

    private suspend fun fill(fake: Fake, queries: List<ListQuery>, enough: Int = 4, maxLists: Int = 4) =
        KidCatalog.fill(queries, enough, fake::load, fake::keep, { it }, maxLists)

    @Test
    fun unePageSuffitQuandElleRemplitLaRangee() = runTest {
        val fake = Fake(mapOf(a to listOf(listOf("1", "2", "3", "4", "5"), listOf("6")), b to listOf(listOf("9"))))
        assertEquals(listOf("1", "2", "3", "4", "5"), fill(fake, listOf(a, b)))
        assertEquals(listOf("/a" to 1), fake.asked)
    }

    @Test
    fun sourceSuivantePuisPageSuivanteTantQuIlManqueDesTitres() = runTest {
        val fake = Fake(
            mapOf(a to listOf(listOf("a1"), listOf("a2"), listOf("a3")), b to listOf(listOf("b1"), listOf("b2"), listOf("b3"))),
        )
        assertEquals(listOf("a1", "b1", "a2", "b2"), fill(fake, listOf(a, b)))
        assertEquals(listOf("/a" to 1, "/b" to 1, "/a" to 2, "/b" to 2), fake.asked)
    }

    @Test
    fun jamaisPlusDeListesQueLePlafond() = runTest {
        val many = List(10) { p -> listOf("x$p") }
        val fake = Fake(mapOf(a to many))
        assertEquals(3, fill(fake, listOf(a), enough = 50, maxLists = 3).size)
        assertEquals(3, fake.asked.size)
    }

    @Test
    fun sourceEpuiseeNEstPasRedemandee() = runTest {
        val fake = Fake(mapOf(a to listOf(listOf("a1")), b to listOf(listOf("b1"), listOf("b2"), listOf("b3"))))
        assertEquals(listOf("a1", "b1", "b2", "b3"), fill(fake, listOf(a, b)))
        assertEquals(listOf("/a" to 1, "/b" to 1, "/b" to 2, "/b" to 3), fake.asked)
    }

    @Test
    fun titreDonneParDeuxSourcesVerifieEtGardeUneSeuleFois() = runTest {
        val fake = Fake(mapOf(a to listOf(listOf("x", "refusé")), b to listOf(listOf("x", "refusé", "y")))) { it != "refusé" }
        assertEquals(listOf("x", "y"), fill(fake, listOf(a, b)))
        // Ni le titre gardé ni le titre refusé ne sont revérifiés.
        assertEquals(listOf("x", "refusé", "y"), fake.checked)
    }

    @Test
    fun abandonQuandRienNEstPermisApresDeuxListes() = runTest {
        val many = List(10) { p -> listOf("x$p") }
        val fake = Fake(mapOf(a to many)) { false }
        assertEquals(emptyList<String>(), fill(fake, listOf(a)))
        assertEquals(KidCatalog.GIVE_UP_AFTER, fake.asked.size)
    }

    @Test
    fun panneALaPremiereListeRemonteMaisPasApresDesTitresTrouves() = runTest {
        val broken = runCatching {
            KidCatalog.fill(listOf(a), 4, { _, _ -> throw IOException("réseau") }, { it: List<String> -> it }, { it })
        }.exceptionOrNull()
        assertTrue(broken is IOException)

        // Des titres déjà trouvés : la rangée s'affiche avec eux plutôt que de disparaître.
        val partial = KidCatalog.fill(
            listOf(a), 4,
            { _, page -> if (page == 1) ListPage(listOf("a1"), hasMore = true) else throw IOException("réseau") },
            { it: List<String> -> it },
            { it },
        )
        assertEquals(listOf("a1"), partial)
    }

    // ------------------------------------------------------- grilles

    @Test
    fun pageDeGrilleEntrelaceLesSourcesSansDoublon() {
        val merged = KidCatalog.interleave(listOf(listOf("a1", "x", "a3"), listOf("x", "b2"))) { it }
        assertEquals(listOf("a1", "x", "b2", "a3"), merged)
        assertEquals(listOf("seul"), KidCatalog.interleave(listOf(listOf("seul"))) { it })
        assertEquals(emptyList<String>(), KidCatalog.interleave(emptyList<List<String>>()) { it })
    }
}
