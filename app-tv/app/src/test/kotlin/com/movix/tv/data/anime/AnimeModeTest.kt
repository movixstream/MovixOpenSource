package com.movix.tv.data.anime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Numérotation du mode anime : rang de la saison (saisons vides retirées), `index` de l'épisode. */
class AnimeModeTest {
    private fun season(path: String, name: String, from: Int, count: Int) = AnimeSeason(
        name = name,
        path = path,
        episodes = (1..count).map { AnimeEpisode(name = "Episode ${from + it - 1}", index = it, links = listOf(AnimeLinks("vostfr", listOf("https://x/$path/$it")))) },
    )

    // One Piece : sagas, une saison vide, puis les films.
    private val work = AnimeWork(
        name = "One Piece",
        slug = "one-piece",
        seasons = listOf(
            season("saison1", "Saga 1 East Blue", 1, 61),
            season("saison2", "Saga 2 Alabasta", 62, 82),
            AnimeSeason(name = "Vide", path = "saison3", episodes = emptyList()),
            season("film", "Films", 1, 3),
        ),
    )
    private val shown = work.copy(seasons = AnimeMode.seasons(work))

    @Test
    fun seasonsAreRankedWithoutEmptyOnes() {
        assertEquals(listOf("saison1", "saison2", "film"), shown.seasons.map { it.path })
        assertEquals("Films", AnimeMode.season(shown, 3)?.name)
    }

    @Test
    fun episodeByRankAndIndex() {
        val t = AnimeMode.episode(shown, 2, 1)!!
        assertEquals("saison2", t.season.path)
        assertEquals("Episode 62", t.episode.name)
        assertNull(AnimeMode.episode(shown, 2, 83))
        assertNull(AnimeMode.episode(shown, 4, 1))
    }

    @Test
    fun episodesKeepAnimeSamaNames() {
        val eps = AnimeMode.episodes(shown.seasons[1])
        assertEquals(82, eps.size)
        assertEquals(1, eps.first().number)
        assertEquals("Episode 62", eps.first().title)
        assertEquals("VOSTFR", eps.first().overview)
    }

    @Test
    fun resumeMovesToNextSeasonAfterTheLastEpisode() {
        assertEquals(1 to 30, AnimeMode.resume(shown, 1, 30))
        // Saga 1 finie (épisode 61 lu, la reprise propose le 62e rang).
        assertEquals(2 to 1, AnimeMode.resume(shown, 1, 62))
        // Reprise TMDB d'avant le mode anime, hors de l'œuvre : rien.
        assertNull(AnimeMode.resume(shown, 21, 4))
    }
}
