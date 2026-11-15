package com.movix.tv.data.local

import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.MediaType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class LibraryTest {
    private fun p(pos: Int, dur: Int, ts: String) = """{"position":$pos,"duration":$dur,"timestamp":"$ts"}"""

    @Test
    fun encodeProgressIgnoresFirstAndLast30Seconds() {
        assertNull(Library.encodeProgress(10.0, 3600.0))
        assertNull(Library.encodeProgress(3590.0, 3600.0))
        assertTrue(Library.encodeProgress(600.0, 3600.0, Instant.parse("2026-10-15T10:00:00Z"))!!.contains("2026-10-15T10:00:00Z"))
    }

    @Test
    fun continueWatchingKeepsOneEpisodePerShowAndSortsByRecency() {
        val values = mapOf(
            "progress_tv_94997_s2_e2" to p(3000, 4000, "2026-10-10T10:00:00Z"),
            "progress_tv_94997_s2_e3" to p(1400, 3960, "2026-10-14T10:00:00Z"),
            "progress_27205" to p(600, 8880, "2026-10-12T10:00:00Z"),
            "progress_1" to p(10, 8000, "2026-10-15T10:00:00Z"),   // < 2 % : présent (pas de durée minimum)
            "progress_2" to p(7900, 8000, "2026-10-15T11:00:00Z"), // ≥ 95 % : film fini, absent
            "watchlist_movie" to "[]",
        )
        val list = Library.continueWatching(values)
        assertEquals(listOf("progress_1", "progress_tv_94997_s2_e3", "progress_27205"), list.map { it.key })
        assertEquals(2, list[1].season); assertEquals(3, list[1].episode)
    }

    @Test
    fun continueWatchingHasNoLimit() {
        val values = (1..20).associate { "progress_$it" to p(600, 6000, "2026-10-%02dT10:00:00Z".format(it)) }
        assertEquals(20, Library.continueWatching(values).size)
    }

    @Test
    fun finishedEpisodeMovesToNextEpisode() {
        val values = mapOf("progress_tv_5_s1_e4" to p(3900, 4000, "2026-10-15T10:00:00Z"))
        val e = Library.continueWatching(values).single()
        assertEquals("progress_tv_5_s1_e5", e.key)
        assertEquals(5, e.id); assertEquals(1, e.season); assertEquals(5, e.episode)
        assertEquals(0.0, e.progress.position, 0.0) // épisode suivant pas encore commencé
    }

    @Test
    fun overlayLocalUsesNewerLocalProgressAndDropsFinishedMovies() {
        fun entry(key: String, id: Int, type: MediaType, s: Int?, e: Int?, pos: Double, ts: String) =
            ContinueEntry(key, id, type, s, e, Progress(pos, 3000.0, ts), WatchMeta("T$id"))
        val server = listOf(
            entry("progress_tv_9_s1_e2", 9, MediaType.TV, 1, 2, 100.0, "2026-10-16T10:00:00.000Z"),
            entry("progress_550", 550, MediaType.MOVIE, null, null, 600.0, "2026-10-16T09:00:00.000Z"),
            entry("progress_13", 13, MediaType.MOVIE, null, null, 900.0, "2026-10-16T08:00:00.000Z"),
            entry("progress_77", 77, MediaType.MOVIE, null, null, 500.0, "2026-10-16T07:00:00.000Z"),
        )
        val values = mapOf(
            "progress_tv_9_s1_e2" to p(1500, 3000, "2026-10-16T10:00:05Z"), // plus récente : prise
            "progress_550" to p(7900, 8000, "2026-10-16T09:30:00Z"),        // film fini : retiré
            "progress_13" to p(100, 3000, "2026-10-16T07:00:00Z"),          // plus vieille : ignorée
            "progress_77" to "{pas du json",                                // illisible : ignorée
        )
        val out = Library.overlayLocal(server, values)
        assertEquals(listOf("progress_tv_9_s1_e2", "progress_13", "progress_77"), out.map { it.key })
        assertEquals(1500.0, out[0].progress.position, 0.0)
        assertEquals("T9", out[0].meta?.title)
        assertEquals(900.0, out[1].progress.position, 0.0)
        assertEquals(500.0, out[2].progress.position, 0.0)
    }

    @Test
    fun continueWatchingReadsTheSiteList() {
        val values = mapOf(
            // Format du site : anciens films en nombre, séries avec l'épisode en cours.
            Library.CONTINUE_KEY to """{"movies":[{"id":550,"lastAccessed":"2026-10-16T09:00:00.000Z"},27205],
                "tv":[{"id":125988,"currentEpisode":{"season":1,"episode":4},"lastAccessed":"2026-10-16T12:00:00.000Z"}]}""",
            "progress_tv_125988_s1_e4" to p(900, 3000, "2026-10-16T11:00:00Z"),
            "progress_tv_125988_s1_e2" to p(900, 3000, "2026-10-01T11:00:00Z"),
            "progress_550" to p(5900, 6000, "2026-10-16T09:30:00Z"), // fini : retiré
        )
        val list = Library.continueWatching(values)
        assertEquals(listOf("progress_tv_125988_s1_e4", "progress_27205"), list.map { it.key })
        assertEquals(900.0, list[0].progress.position, 0.0)
        assertEquals(0.0, list[1].progress.duration, 0.0) // sans position connue
    }

    @Test
    fun touchContinueMovesTheTitleFirstInTheSiteFormat() {
        val values = mapOf(Library.CONTINUE_KEY to """{"movies":[{"id":1}],"tv":[{"id":7,"currentEpisode":{"season":1,"episode":1}},{"id":9}],"extra":true}""")
        val out = Library.touchContinue(values, MediaType.TV, 9, 2, 5, Instant.parse("2026-10-16T12:00:00Z"))
        val list = Library.continueWatching(mapOf(Library.CONTINUE_KEY to out))
        assertEquals(9, list.first().id)
        assertEquals(2, list.first().season); assertEquals(5, list.first().episode)
        assertTrue(out.contains("\"extra\":true"))
        assertTrue(out.contains("\"movies\":[{\"id\":1}]"))
    }

    @Test
    fun corruptValuesAreIgnored() {
        assertTrue(Library.continueWatching(mapOf("progress_3" to "{pas du json")).isEmpty())
        assertTrue(Library.watchlist(mapOf("watchlist_movie" to "oups"), MediaType.MOVIE).isEmpty())
    }

    @Test
    fun watchlistToggleAddsThenRemoves() {
        val item = MediaItem(27205, MediaType.MOVIE, "Inception", "/p.jpg", null, "", 8.4, "2010")
        val added = Library.toggleWatchlist(emptyMap(), item)
        val v1 = mapOf("watchlist_movie" to added)
        assertTrue(Library.isInWatchlist(v1, item))
        val removed = Library.toggleWatchlist(v1, item)
        assertFalse(Library.isInWatchlist(mapOf("watchlist_movie" to removed), item))
    }

    @Test
    fun resumeEpisodeMovesToNextWhenFinished() {
        val finished = mapOf("progress_tv_5_s1_e4" to p(3900, 4000, "2026-10-15T10:00:00Z"))
        assertEquals(1 to 5, Library.resumeEpisode(finished, 5))
        val ongoing = mapOf("progress_tv_5_s1_e4" to p(900, 4000, "2026-10-15T10:00:00Z"))
        assertEquals(1 to 4, Library.resumeEpisode(ongoing, 5))
        assertNull(Library.resumeEpisode(emptyMap(), 5))
    }

    @Test
    fun progressOnStopMarksFinishedPast95Percent() {
        val now = Instant.parse("2026-10-15T10:00:00Z")
        val finished = Library.progressOnStop(3500.0, 3600.0, now)!!
        val values = mapOf("progress_tv_5_s1_e4" to finished)
        assertTrue(Library.isFinished(Library.progress(values, "progress_tv_5_s1_e4")!!))
        // Fini → la fiche propose l'épisode suivant.
        assertEquals(1 to 5, Library.resumeEpisode(values, 5))
        assertNull(Library.progressOnStop(12.0, 3600.0, now))
        assertTrue(Library.progressOnStop(600.0, 3600.0, now)!!.contains("600"))
    }

    @Test
    fun markWatchedKeepsExistingEpisodes() {
        val first = Library.markWatched(emptyMap(), 9, 1, 1)
        val second = Library.markWatched(mapOf("watched_episodes_tv_9" to first), 9, 1, 2)
        assertEquals(setOf("S1E1", "S1E2"), Library.watchedEpisodes(mapOf("watched_episodes_tv_9" to second), 9))
    }

    @Test
    fun watchMetaIsCappedAt400AndMostRecentLast() {
        assertEquals(400, Library.WATCH_META_MAX)
        var raw = ""
        for (i in 1..405) raw = Library.putWatchMeta(mapOf(TvKeys.WATCH_META to raw).filterValues { it.isNotEmpty() }, "progress_$i", WatchMeta("T$i"))
        val meta = Library.watchMeta(mapOf(TvKeys.WATCH_META to raw))
        assertEquals(Library.WATCH_META_MAX, meta.size)
        assertNull(meta["progress_1"])
        assertNull(meta["progress_5"])
        assertEquals("T6", meta["progress_6"]?.title)
        assertEquals("T405", meta["progress_405"]?.title)
    }

    @Test
    fun watchMetaEvictionSkipsKeptKeys() {
        var raw = ""
        // Les 3 plus vieilles fiches sont dans la rangée « Reprendre » actuelle : gardées.
        val keep = setOf("progress_1", "progress_2", "progress_3")
        for (i in 1..402) raw = Library.putWatchMeta(mapOf(TvKeys.WATCH_META to raw).filterValues { it.isNotEmpty() }, "progress_$i", WatchMeta("T$i"), keep)
        val meta = Library.watchMeta(mapOf(TvKeys.WATCH_META to raw))
        assertEquals(Library.WATCH_META_MAX, meta.size)
        assertEquals("T1", meta["progress_1"]?.title)
        assertEquals("T3", meta["progress_3"]?.title)
        assertNull(meta["progress_4"]) // plus vieilles hors de la rangée : évincées d'abord
        assertNull(meta["progress_5"])
        assertEquals("T6", meta["progress_6"]?.title)
    }

    @Test
    fun watchMetaEvictsOldestWhenEverythingIsKept() {
        var raw = ""
        val keep = (1..401).map { "progress_$it" }.toSet()
        for (i in 1..401) raw = Library.putWatchMeta(mapOf(TvKeys.WATCH_META to raw).filterValues { it.isNotEmpty() }, "progress_$i", WatchMeta("T$i"), keep)
        val meta = Library.watchMeta(mapOf(TvKeys.WATCH_META to raw))
        assertEquals(Library.WATCH_META_MAX, meta.size)
        assertNull(meta["progress_1"])
        assertEquals("T401", meta["progress_401"]?.title)
    }
}
