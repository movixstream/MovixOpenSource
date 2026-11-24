package com.movix.tv.data.anime

import com.movix.tv.data.movix.PlayRequest
import com.movix.tv.data.tmdb.MediaType
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Essai réel, sur PC : œuvres et lecteurs demandés à la vraie Main API, sans
 * VIP. Découpages TMDB relevés le 2026-11-24.
 *
 * Lancer : `MOVIX_LIVE=1 ./gradlew :app:testDebugUnitTest --tests "*AnimeLiveTest*"`.
 */
class AnimeLiveTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }
    private val api = AnimeApi(OkHttpClient(), json, "https://api.movix.men/".toHttpUrl())

    private fun live() = assumeTrue("MOVIX_LIVE=1 pour l'essai réel", System.getenv("MOVIX_LIVE") == "1")

    private fun target(type: MediaType, id: Int, counts: Map<Int, Int>, s: Int?, e: Int?): AnimeTarget? = runBlocking {
        val works = api.byTmdb(type.path, id)
        works.firstNotNullOfOrNull { w -> if (type == MediaType.TV) AnimeMatch.episode(w, counts, s!!, e!!) else AnimeMatch.movie(w) }
    }

    @Test
    fun episodesLandWhereExpected() {
        live()
        // Jujutsu Kaisen S1E30 (TMDB, une saison) = saison 2 épisode 6 d'anime-sama.
        assertEquals("saison2:6", target(MediaType.TV, 95479, mapOf(1 to 59), 1, 30)?.let { "${it.season.path}:${it.episode.index}" })
        // One Piece S2E1 (après les 61 épisodes d'East Blue) = « Episode 62 ».
        val op = (1..23).zip(listOf(61, 16, 14, 39, 13, 52, 33, 35, 73, 45, 26, 14, 101, 58, 62, 50, 56, 55, 74, 14, 197, 67, 25)).toMap()
        assertEquals("Episode 62", target(MediaType.TV, 37854, op, 2, 1)?.episode?.name)
        // Demon Slayer S3E1 (TMDB compte l'arc du train en saison 2).
        assertEquals("saison2:1", target(MediaType.TV, 85937, mapOf(1 to 26, 2 to 7, 3 to 11, 4 to 11, 5 to 8), 3, 1)?.let { "${it.season.path}:${it.episode.index}" })
        // Suzume, film seul.
        assertEquals("film", target(MediaType.MOVIE, 916224, emptyMap(), null, null)?.season?.path)
    }

    @Test
    fun sourcesComeWithPlayers() = runBlocking {
        live()
        val sources = AnimeSources(api) { _, _ -> AnimeHint(true, mapOf(1 to 59)) }
            .load(PlayRequest(MediaType.TV, 95479, 1, 30), vipKey = null)
        println(sources.joinToString("\n") { "  ${it.label}  ${it.embedUrl}" })
        assertTrue(sources.isNotEmpty())
        assertTrue(sources.all { it.embedUrl?.startsWith("http") == true })
    }
}
