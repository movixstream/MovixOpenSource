package com.movix.tv.data.anime

import com.movix.tv.data.movix.Lang
import com.movix.tv.data.movix.Provider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Découpages relevés le 2026-11-24 sur `/anime/tmdb` et TMDB. */
class AnimeMatchTest {
    private fun season(path: String, count: Int) =
        AnimeSeason(name = path, path = path, episodes = (1..count).map { AnimeEpisode("Episode $it", it) })

    private fun work(vararg seasons: AnimeSeason) = AnimeWork("Œuvre", "oeuvre", seasons.toList())

    private fun counts(vararg c: Int) = c.withIndex().associate { (i, n) -> i + 1 to n } + (0 to 10)

    private fun AnimeTarget?.at() = this?.let { "${it.season.path}:${it.episode.index}" }

    @Test
    fun sameShapeKeepsSeasonAndRank() {
        // L'Attaque des Titans : 4 saisons des deux côtés (28 contre 30 épisodes en saison 4).
        val aot = work(season("saison1", 25), season("saison2", 12), season("saison3", 22), season("saison4", 30), season("film", 1), season("oav", 8))
        val tmdb = counts(25, 12, 22, 28)
        assertEquals("saison4:28", AnimeMatch.episode(aot, tmdb, 4, 28).at())
        assertEquals("saison2:1", AnimeMatch.episode(aot, tmdb, 2, 1).at())
    }

    @Test
    fun oneTmdbSeasonCountsAbsolute() {
        // Jujutsu Kaisen : une saison de 59 épisodes sur TMDB, 24 + film + 23 + 12 sur anime-sama.
        val jjk = work(season("saison1", 24), season("film", 1), season("saison2", 23), season("saison3", 12))
        val tmdb = counts(59)
        assertEquals("saison1:24", AnimeMatch.episode(jjk, tmdb, 1, 24).at())
        assertEquals("saison2:1", AnimeMatch.episode(jjk, tmdb, 1, 25).at())
        assertEquals("saison3:12", AnimeMatch.episode(jjk, tmdb, 1, 59).at())
        assertNull(AnimeMatch.episode(jjk, tmdb, 1, 60))
    }

    @Test
    fun manyTmdbSeasonsCountAbsoluteToo() {
        // Naruto Shippuden : 20 saisons sur TMDB, une suite de 500 sur anime-sama (« Sans fillers » en hs).
        val shippuden = work(season("saison1", 500), season("saison1hs", 297), season("film", 7), season("kai", 36))
        val tmdb = counts(32, 21, 18)
        assertEquals("saison1:54", AnimeMatch.episode(shippuden, tmdb, 3, 1).at())
    }

    @Test
    fun splitSeasonsFollowSiteOrder() {
        // Bleach : 366 + 50 sur TMDB ; la guerre de mille ans en quatre parties sur anime-sama.
        val bleach = work(
            season("saison1", 366), season("saison1hs", 203), season("saison2", 13), season("saison2-2", 13),
            season("saison2-3", 14), season("saison2-4", 10), season("film", 4), season("kai", 28),
        )
        val tmdb = counts(366, 50)
        assertEquals("saison2-2:1", AnimeMatch.episode(bleach, tmdb, 2, 14).at())
        assertEquals("saison2-4:10", AnimeMatch.episode(bleach, tmdb, 2, 50).at())
    }

    @Test
    fun specialSeasonCountsWhenItCompletesTheShape() {
        // Demon Slayer : l'arc du train (saison 2 sur TMDB) est le hors-série `saison1hs`.
        val ds = work(
            season("saison1", 26), season("film1", 1), season("saison1hs", 7), season("saison2", 11),
            season("saison3", 11), season("saison4", 8), season("film2", 1),
        )
        val tmdb = counts(26, 7, 11, 11, 8)
        assertEquals("saison1hs:3", AnimeMatch.episode(ds, tmdb, 2, 3).at())
        assertEquals("saison2:1", AnimeMatch.episode(ds, tmdb, 3, 1).at())
        assertEquals("saison4:8", AnimeMatch.episode(ds, tmdb, 5, 8).at())
    }

    @Test
    fun unknownTmdbShapeFallsBackToSameSeason() {
        val w = work(season("saison1", 12), season("saison2", 13))
        assertEquals("saison2:3", AnimeMatch.episode(w, emptyMap(), 2, 3).at())
        assertNull(AnimeMatch.episode(w, emptyMap(), 3, 1))
    }

    @Test
    fun noSlugOrNoMainSeasonGivesNothing() {
        assertNull(AnimeMatch.episode(AnimeWork("x", null, listOf(season("saison1", 3))), counts(3), 1, 1))
        assertNull(AnimeMatch.episode(work(season("film", 2)), counts(2), 1, 1))
    }

    @Test
    fun movieNeedsASingleEpisode() {
        assertEquals("film:1", AnimeMatch.movie(work(season("film", 1))).at())
        assertNull(AnimeMatch.movie(work(season("film", 3))))
    }

    @Test
    fun sourcesKeepLanguageAndServerStream() {
        val links = listOf(
            AnimeLinks("vostfr", listOf("https://video.sibnet.ru/shell.php?videoid=1", "https://vidmoly.to/embed-x.html")),
            AnimeLinks("vf2", listOf("https://uqload.vc/embed-y.html", "")),
            AnimeLinks("va", listOf("https://ansembed.net/embed-z.html")),
        )
        val list = AnimeSources.sources(links, mapOf("https://vidmoly.to/embed-x.html" to "https://relay/x.m3u8"))
        assertEquals(4, list.size)
        assertTrue(list.all { it.provider == Provider.ANIME })
        assertEquals(listOf(Lang.VOSTFR, Lang.VOSTFR, Lang.VF, Lang.VO), list.map { it.language })
        assertEquals("Sibnet VOSTFR", list[0].label)
        assertEquals("https://relay/x.m3u8", list[1].streamUrl)
        assertNull(list[2].streamUrl)
        assertEquals("ansembed.net VO", list[3].label)
    }
}
