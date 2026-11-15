package com.movix.tv.data.tmdb

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRepositoryTest {
    private fun item(id: Int, poster: Boolean = true) =
        MediaItem(id, MediaType.MOVIE, "T$id", if (poster) "/$id.jpg" else null, null, "", null, null)

    private fun spec(id: String, dedupe: Boolean = true, limit: Int? = null) =
        RowSpec(id = id, title = id, path = "/x", fallbackType = MediaType.MOVIE, tier = 1, dedupe = dedupe, limit = limit)

    @Test
    fun duplicatesAreRemovedInDisplayOrder() {
        val a = (1..20).map { item(it) }
        val b = (11..40).map { item(it) }
        val rows = CatalogRepository.assemble(
            listOf(spec("a"), spec("b")),
            mapOf("a" to Result.success(a), "b" to Result.success(b)),
        )
        assertEquals((21..40).toList(), rows[1].items.map { it.id })
    }

    @Test
    fun rowKeepsAtLeastEightTitles() {
        val a = (1..20).map { item(it) }
        val b = (1..10).map { item(it) } + listOf(item(99))
        val rows = CatalogRepository.assemble(
            listOf(spec("a"), spec("b")),
            mapOf("a" to Result.success(a), "b" to Result.success(b)),
        )
        assertEquals(8, rows[1].items.size)
        assertTrue(rows[1].items.any { it.id == 99 })
    }

    @Test
    fun failedOrTinyRowsDisappearButOthersStay() {
        val rows = CatalogRepository.assemble(
            listOf(spec("ok"), spec("ko"), spec("tiny")),
            mapOf(
                "ok" to Result.success((1..10).map { item(it) }),
                "ko" to Result.failure(RuntimeException("réseau")),
                "tiny" to Result.success((100..104).map { item(it) }),
            ),
        )
        assertEquals(listOf("ok"), rows.map { it.spec.id })
    }

    @Test
    fun itemsWithoutPosterAreDropped() {
        val rows = CatalogRepository.assemble(
            listOf(spec("a")),
            mapOf("a" to Result.success((1..10).map { item(it, poster = it % 2 == 0) } + (11..20).map { item(it) })),
        )
        assertTrue(rows[0].items.all { it.posterPath != null })
    }

    @Test
    fun rankedRowKeepsRanksAndLimit() {
        val a = (1..20).map { item(it) }
        val rows = CatalogRepository.assemble(
            listOf(spec("a"), spec("top", dedupe = false, limit = 10)),
            mapOf("a" to Result.success(a), "top" to Result.success(a)),
        )
        assertEquals((1..10).toList(), rows[1].items.map { it.id })
    }

    private fun found(id: Int, title: String, votes: Int, type: String = "movie", poster: Boolean = true) =
        TmdbItem(id = id, title = title, mediaType = type, posterPath = if (poster) "/$id.jpg" else null, voteCount = votes)

    @Test
    fun searchPutsPopularTitlesBeforeTmdbWordMatches() {
        // « Inter » : TMDB sort d'abord des inconnus qui contiennent le mot exact.
        val r = CatalogRepository.merge(
            "Inter",
            popular = listOf(found(157336, "Interstellar", 41581), found(1411, "Person of Interest", 2199, "tv"), found(9, "National Theatre Live: Inter Alia", 7)),
            found = listOf(found(1, "inter-medium", 0), found(2, "Inter", 0), found(157336, "Interstellar", 41581), found(3, "Sans affiche", 900, poster = false)),
        )
        assertEquals(listOf("movie:157336", "tv:1411", "movie:9", "movie:1", "movie:2"), r.items.map { it.key })
        // Proposés : seulement les titres connus ; « Inter » a beau être exact, il a 0 vote.
        assertEquals(listOf("Interstellar", "Person of Interest"), r.known.map { it.title })
    }

    @Test
    fun imdbTitlesNeedAFewVotesTmdbOnlyTitlesMore() {
        // « kaam » : IMDb ne propose que des inconnus ; un titre TMDB bien voté passe devant.
        val kaam = CatalogRepository.merge("kaam", listOf(found(1, "Kaam Chalu Hai", 3), found(2, "Kaam Jwala", 0)), listOf(found(3, "Kaam 25", 60)))
        assertEquals(listOf(3, 1, 2), kaam.items.map { it.id })
        assertEquals(listOf(3), kaam.known.map { it.id })
        // Une série française proposée par IMDb reste connue malgré ses 38 votes TMDB.
        val pblv = CatalogRepository.merge("plus belle", listOf(found(10, "Plus belle la vie", 38, "tv")), listOf(found(11, "Plus belle", 40)))
        assertEquals(listOf("tv:10"), pblv.known.map { it.key })
        assertEquals(listOf("tv:10", "movie:11"), pblv.items.map { it.key })
    }

    @Test
    fun knownExactTitleComesFirstAndWellVotedTmdbTitlesAreKnown() {
        val r = CatalogRepository.merge(
            "spider man",
            popular = listOf(found(10, "Spider-Man : No Way Home", 19000), found(11, "Spider-Man : Across the Spider-Verse", 7000)),
            found = listOf(found(557, "Spider-Man", 20000), found(12, "Spider Man Fan Film", 3)),
        )
        assertEquals(listOf(557, 10, 11, 12), r.items.map { it.id })
        assertEquals(listOf(10, 11, 557), r.known.map { it.id })
    }

    @Test
    fun withoutImdbKnownExactTitlesLeadThenTmdbOrder() {
        val r = CatalogRepository.merge("dune", emptyList(), listOf(found(1, "Dune", 9000), found(2, "Dune Drifter", 10), found(3, "Dune", 120, type = "tv")))
        assertEquals(listOf("movie:1", "tv:3", "movie:2"), r.items.map { it.key })
        assertEquals(listOf("movie:1", "tv:3"), r.known.map { it.key })
    }
}
