package com.movix.tv.data.tmdb

import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RowRegistryTest {

    private val pages: Map<String, List<RowSpec>> = mapOf(
        "home" to RowRegistry.home,
        "movies" to RowRegistry.movies,
        "series" to RowRegistry.series,
        "anime" to RowRegistry.anime,
    )

    private val isoDate = Regex("""\d{4}-\d{2}-\d{2}""")

    @Test
    fun idsUniquesEtIndexes() {
        // 78 rangées dans le registre TS d'origine.
        assertEquals(78, RowRegistry.all.size)
        RowRegistry.all.forEach { (id, spec) -> assertEquals(id, spec.id) }
    }

    @Test
    fun pagesNonVidesEtSansDoublon() {
        pages.forEach { (page, rows) ->
            assertTrue("Page $page vide", rows.isNotEmpty())
            val ids = rows.map { it.id }
            assertEquals("Doublon dans la page $page : $ids", ids.size, ids.toSet().size)
            ids.forEach { assertNotNull("Rangée $it absente du registre", RowRegistry.find(it)) }
        }
        assertEquals(10, RowRegistry.home.size)
        assertEquals(20, RowRegistry.movies.size)
        assertEquals(20, RowRegistry.series.size)
        assertEquals(20, RowRegistry.anime.size)
    }

    @Test
    fun pagesCouvrentLesRangeesParDefaut() {
        assertEquals(6, RowRegistry.DEFAULT_VISIBLE_ROWS)
        pages.values.forEach { assertTrue(it.size >= RowRegistry.DEFAULT_VISIBLE_ROWS) }
    }

    @Test
    fun cheminsCommencentParUneBarre() {
        RowRegistry.all.values.forEach { spec ->
            assertTrue("Chemin invalide pour ${spec.id} : ${spec.path}", spec.path.startsWith("/"))
        }
    }

    @Test
    fun datesRecentesIsoEtRelativesAuJour() {
        // Identifiant -> clé de date minimale -> nombre de jours avant aujourd'hui.
        val recentes = mapOf(
            "films-recents" to ("primary_release_date.gte" to 120L),
            "series-recentes" to ("first_air_date.gte" to 180L),
            "animes-en-cours" to ("air_date.gte" to 30L),
            "animes-nouveaux" to ("first_air_date.gte" to 365L),
            "animes-films-recents" to ("primary_release_date.gte" to 730L),
        )
        recentes.forEach { (id, attendu) ->
            val spec = RowRegistry.find(id)
            assertNotNull(id, spec)
            val avant = LocalDate.now(ZoneOffset.UTC)
            val params = spec!!.params()
            val apres = LocalDate.now(ZoneOffset.UTC)

            val dates = params.filterKeys { it.endsWith("date.gte") || it.endsWith("date.lte") }
            assertFalse("Aucune date pour $id", dates.isEmpty())
            dates.forEach { (cle, valeur) ->
                assertTrue("$id.$cle : « $valeur » n'est pas au format yyyy-MM-dd", isoDate.matches(valeur))
            }

            // Tolère un passage de minuit entre les deux lectures de l'horloge.
            val (cle, jours) = attendu
            val possibles = setOf(avant.minusDays(jours).toString(), apres.minusDays(jours).toString())
            assertTrue("$id.$cle = ${params[cle]}, attendu $possibles", params[cle] in possibles)
            params.keys.filter { it.endsWith("date.lte") }.forEach { lte ->
                assertTrue(params[lte] in setOf(avant.toString(), apres.toString()))
            }
        }
    }

    @Test
    fun parametresRecalculesAChaqueAppel() {
        val spec = RowRegistry.find("films-recents")!!
        val premier = spec.params()
        val second = spec.params()
        // Deux maps distinctes : la fonction est rejouée, pas une valeur figée à l'init.
        assertFalse(premier === second)
        assertEquals(RowRegistry.daysAgo(120), second["primary_release_date.gte"])
        assertEquals(RowRegistry.today(), second["primary_release_date.lte"])
    }

    @Test
    fun premiereRangeeAlimenteLaBanniere() {
        assertEquals("tendances", RowRegistry.home.first().id)
        assertEquals("films-selection", RowRegistry.movies.first().id)
        assertEquals("series-selection", RowRegistry.series.first().id)
        assertEquals("animes-en-cours", RowRegistry.anime.first().id)
    }

    @Test
    fun classementsNonDedoublonnesEtTronquesADix() {
        listOf("films-top10", "series-top10", "animes-top10").forEach { id ->
            val spec = RowRegistry.find(id)!!
            assertEquals(RowLayout.RANK, spec.layout)
            assertEquals(10, spec.limit)
            assertFalse(spec.dedupe)
        }
    }

    @Test
    fun parametresNumeriquesConvertisEnChaines() {
        val nollywood = RowRegistry.find("nollywood")!!.params()
        assertEquals("3", nollywood["vote_count.gte"])
        assertEquals(RowRegistry.AFRICAN_COUNTRIES, RowRegistry.find("action-afrique")!!.params()["with_origin_country"])
        assertEquals("10342", RowRegistry.find("ghibli")!!.params()["with_companies"])
    }

    @Test
    fun rangeeInconnueRenvoieNull() {
        assertNull(RowRegistry.find("inconnu"))
    }
}
