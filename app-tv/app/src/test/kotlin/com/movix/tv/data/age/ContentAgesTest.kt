package com.movix.tv.data.age

import com.movix.tv.data.tmdb.MediaType
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger

/**
 * Âges des titres (TMDB) gardés en cache et filtre des listes d'un profil
 * limité. Défaillances visées, qu'aucun test de bout en bout ne couvre (pas de
 * télé ni de TMDB dans les tests) :
 *
 * - un profil sans restriction paie des requêtes ou voit sa liste changer ;
 * - un titre non vérifié (sans classification, TMDB injoignable) montré à un mineur ;
 * - un titre `adult` montré à un mineur, ou demandé à TMDB pour rien ;
 * - le même âge demandé plusieurs fois (rangées qui partagent des titres) ;
 * - plus de 6 requêtes à la fois (boîtiers lents) ;
 * - un échec réseau gardé comme « inconnu » : le titre resterait caché ;
 * - « inconnu » gardé trop longtemps, ou un âge vérifié redemandé à chaque lancement ;
 * - le cache disque perdu d'un lancement à l'autre.
 */
class ContentAgesTest {
    @get:Rule
    val folder = TemporaryFolder()

    private var clock = 1_800_000_000_000L
    private val calls = mutableListOf<String>()
    private val known = mutableMapOf<String, Int?>()
    private val failing = mutableSetOf<String>()
    private var latency = 0L
    private val running = AtomicInteger()
    private var maxRunning = 0

    private fun TestScope.ages(file: File? = null) = ContentAges(
        fetch = { type, id ->
            val key = "${type.path}:$id"
            calls += key
            val now = running.incrementAndGet()
            maxRunning = maxOf(maxRunning, now)
            try {
                if (latency > 0) delay(latency)
                if (key in failing) throw IOException("réseau")
                known[key]
            } finally {
                running.decrementAndGet()
            }
        },
        file = file,
        scope = backgroundScope,
        now = { clock },
    )

    private fun movie(id: Int, adult: Boolean = false) = TitleRef(MediaType.MOVIE, id, adult)

    private suspend fun ContentAges.ids(items: List<TitleRef>, limit: Int) = keepAllowed(items, limit) { it }.map { it.id }

    @Test
    fun sansRestrictionAucuneRequeteEtListeIntacte() = runTest {
        val list = (1..5).map { movie(it) }
        assertEquals(list, ages().keepAllowed(list, 0) { it })
        assertTrue(calls.isEmpty())
    }

    @Test
    fun titreNonVerifieCachePourUnMineur() = runTest {
        known["movie:1"] = 0
        known["movie:2"] = 16
        known["movie:3"] = null
        failing += "movie:4"
        val a = ages()
        val list = (1..4).map { movie(it) }
        assertEquals(listOf(1), a.ids(list, 12))
        assertEquals(listOf(1, 2), a.ids(list, 16))
        // 18 ans : un titre sans classification (ou pas encore vérifiable) reste visible, comme sur le site.
        assertEquals(listOf(1, 2, 3, 4), a.ids(list, 18))
    }

    @Test
    fun titreAdulteVaut18SansRequete() = runTest {
        val a = ages()
        assertEquals(emptyList<Int>(), a.ids(listOf(movie(5, adult = true)), 16))
        assertEquals(listOf(5), a.ids(listOf(movie(5, adult = true)), 18))
        assertTrue(calls.isEmpty())
    }

    @Test
    fun chaqueAgeNestDemandeQuUneFois() = runTest {
        latency = 50
        (1..8).forEach { known["movie:$it"] = 0 }
        val a = ages()
        val first = (1..6).map { movie(it) }
        val second = (3..8).map { movie(it) }
        // Deux rangées chargées en même temps qui partagent des titres.
        listOf(async { a.ids(first, 12) }, async { a.ids(second, 12) }).awaitAll()
        assertEquals((1..8).map { "movie:$it" }, calls.sortedBy { it.removePrefix("movie:").toInt() })
        a.ids((1..8).map { movie(it) }, 7)
        assertEquals(8, calls.size)
    }

    @Test
    fun sixRequetesALaFoisAuPlus() = runTest {
        latency = 100
        (1..30).forEach { known["movie:$it"] = 0 }
        ages().ids((1..30).map { movie(it) }, 12)
        assertEquals(30, calls.size)
        assertTrue("$maxRunning requêtes en même temps", maxRunning <= 6)
    }

    @Test
    fun echecReseauPasGardeLeTitreEstRedemande() = runTest {
        failing += "movie:4"
        val a = ages()
        assertEquals(emptyList<Int>(), a.ids(listOf(movie(4)), 12))
        failing.clear()
        known["movie:4"] = 0
        assertEquals(listOf(4), a.ids(listOf(movie(4)), 12))
        assertEquals(listOf("movie:4", "movie:4"), calls)
    }

    @Test
    fun inconnuRedemandeApresUnJourVerifieGardeUnMois() = runTest {
        known["movie:1"] = 12
        known["movie:2"] = null
        val a = ages()
        val list = listOf(movie(1), movie(2))
        a.ids(list, 18)
        assertEquals(2, calls.size)
        clock += 25 * HOUR
        a.ids(list, 18)
        assertEquals(listOf("movie:1", "movie:2", "movie:2"), calls)
        clock += 30 * DAY
        a.ids(list, 18)
        assertEquals(listOf("movie:1", "movie:2", "movie:2", "movie:1", "movie:2"), calls)
    }

    @Test
    fun ageApprisDUneFicheEviteLaRequete() = runTest {
        val a = ages()
        a.learn(MediaType.MOVIE, 7, 16)
        a.learn(MediaType.TV, 7, 0)
        assertEquals(emptyList<Int>(), a.ids(listOf(movie(7)), 12))
        assertEquals(listOf(7), a.keepAllowed(listOf(TitleRef(MediaType.TV, 7)), 12) { it }.map { it.id })
        assertTrue(calls.isEmpty())
    }

    @Test
    fun verificationPourUneFicheDistingueInconnuEtInjoignable() = runTest {
        known["tv:3"] = null
        known["movie:9"] = 12
        failing += "movie:4"
        val a = ages()
        assertEquals(AgeCheck.Known(12), a.age(MediaType.MOVIE, 9))
        assertEquals(AgeCheck.Known(null), a.age(MediaType.TV, 3))
        assertEquals(AgeCheck.Unreachable, a.age(MediaType.MOVIE, 4))
    }

    @Test
    fun agesGardesSurLeDisqueDUnLancementALAutre() = runTest {
        val file = File(folder.root, "ages.txt")
        known["movie:1"] = 12
        known["movie:2"] = null
        known["tv:3"] = 0
        val list = listOf(movie(1), movie(2), TitleRef(MediaType.TV, 3))
        val first = ages(file)
        first.keepAllowed(list, 18) { it }
        first.save()
        assertEquals(3, calls.size)

        // Nouveau lancement : rien n'est redemandé.
        ages(file).keepAllowed(list, 18) { it }
        assertEquals(3, calls.size)

        // Un jour plus tard : seul l'inconnu est redemandé.
        clock += 25 * HOUR
        ages(file).keepAllowed(list, 18) { it }
        assertEquals(listOf("movie:1", "movie:2", "tv:3", "movie:2"), calls)
    }

    @Test
    fun fichierAbimeIgnore() = runTest {
        val file = File(folder.root, "ages.txt")
        file.writeText("n'importe quoi\nmovie:x 12 1\nmovie:1 abc 1\n")
        known["movie:1"] = 0
        assertEquals(listOf(1), ages(file).ids(listOf(movie(1)), 12))
        assertEquals(listOf("movie:1"), calls)
    }

    private companion object {
        const val HOUR = 3_600_000L
        const val DAY = 24 * HOUR
    }
}
