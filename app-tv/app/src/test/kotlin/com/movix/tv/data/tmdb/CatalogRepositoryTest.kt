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
}
