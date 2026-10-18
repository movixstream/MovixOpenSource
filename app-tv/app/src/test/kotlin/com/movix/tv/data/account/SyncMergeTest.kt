package com.movix.tv.data.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncMergeTest {
    private fun p(pos: Int, ts: String) = """{"position":$pos,"duration":3600,"timestamp":"$ts"}"""

    @Test
    fun onlySiteKeysAreSynced() {
        assertTrue(SyncMerge.isSynced("progress_550"))
        assertTrue(SyncMerge.isSynced("progress_tv_1396_s1_e2"))
        assertTrue(SyncMerge.isSynced("watchlist_tv"))
        assertTrue(SyncMerge.isSynced("watched_episodes_tv_1396"))
        assertFalse(SyncMerge.isSynced("movix_tv_vip_key"))
        assertFalse(SyncMerge.isSynced("access_code"))
        assertFalse(SyncMerge.isSynced("progress_abc"))
    }

    @Test
    fun newestProgressWinsBothWays() {
        val local = mapOf("progress_1" to p(100, "2026-10-15T10:00:00Z"), "progress_2" to p(900, "2026-10-15T12:00:00Z"))
        val remote = mapOf("progress_1" to p(500, "2026-10-15T11:00:00Z"), "progress_2" to p(300, "2026-10-15T09:00:00Z"))
        val r = SyncMerge.merge(local, remote, emptySet())
        assertEquals(remote["progress_1"], r.applyLocal["progress_1"])
        assertEquals(setOf("progress_2"), r.push)
    }

    @Test
    fun progressMissingOnOneSideIsCopied() {
        val r = SyncMerge.merge(mapOf("progress_1" to p(1, "a")), mapOf("progress_2" to p(2, "b")), emptySet())
        assertEquals(setOf("progress_1"), r.push)
        assertEquals(p(2, "b"), r.applyLocal["progress_2"])
    }

    @Test
    fun serverWinsWhenNothingPending() {
        val r = SyncMerge.merge(
            mapOf("watchlist_movie" to """[{"id":1,"type":"movie"}]""", "watched_tv" to "[]"),
            mapOf("watchlist_movie" to """[{"id":2,"type":"movie"}]"""),
            emptySet(),
        )
        assertEquals("""[{"id":2,"type":"movie"}]""", r.applyLocal["watchlist_movie"])
        assertTrue(r.applyLocal.containsKey("watched_tv") && r.applyLocal["watched_tv"] == null)
        assertTrue(r.push.isEmpty())
    }

    @Test
    fun pendingListIsUnitedThenPushed() {
        val r = SyncMerge.merge(
            mapOf("watchlist_movie" to """[{"id":1,"type":"movie","title":"local"}]"""),
            mapOf("watchlist_movie" to """[{"id":2,"type":"movie"},{"id":1,"type":"movie","title":"serveur"}]"""),
            setOf("watchlist_movie"),
        )
        val merged = r.applyLocal["watchlist_movie"]!!
        assertTrue(merged.contains("\"id\":2") && merged.contains("local") && !merged.contains("serveur"))
        assertEquals(setOf("watchlist_movie"), r.push)
    }

    @Test
    fun pendingObjectsAreUnited() {
        assertEquals(
            """{"S1E1":true,"S1E2":true}""",
            SyncMerge.union("""{"S1E2":true}""", """{"S1E1":true}"""),
        )
    }

    @Test
    fun nonSyncedKeysAreIgnored() {
        val r = SyncMerge.merge(mapOf("movix_tv_tmdb_key" to "x"), mapOf("access_code" to "VIP"), emptySet())
        assertTrue(r.applyLocal.isEmpty() && r.push.isEmpty())
    }
}
