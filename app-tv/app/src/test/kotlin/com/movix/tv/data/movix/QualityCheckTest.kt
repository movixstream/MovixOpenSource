package com.movix.tv.data.movix

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** « Vérifier la qualité » : quelles sources portent le badge « Meilleure qualité ». */
class QualityCheckTest {
    private fun measured(height: Int?, vararg unsupported: String) =
        QualityResult.Measured(SourceSelector.Rating(height, unsupported.toList()))

    @Test
    fun bestIsTheHighestReadableClassWithTies() {
        // 1776×1000 s'affiche « 1080p » comme un vrai 1080p : même classe, même badge.
        val results = mapOf(
            "a" to measured(1080),
            "b" to measured(1000),
            "c" to measured(720),
            "d" to QualityResult.Unavailable,
        )
        assertEquals(setOf("a", "b"), QualityCheck.best(results))
        assertEquals(1080, QualityCheck.bestHeight(results))
    }

    @Test
    fun sourcesThisTvCannotDecodeAreNeverBest() {
        // Un 4K en H.265 sans décodeur ne vaut rien ici : le 1080p lisible gagne.
        val results = mapOf("uhd" to measured(2160, "video/hevc"), "hd" to measured(1080))
        assertEquals(setOf("hd"), QualityCheck.best(results))
        assertEquals(1080, QualityCheck.bestHeight(results))
    }

    @Test
    fun nothingMeasuredMeansNoBest() {
        val results = mapOf(
            "a" to QualityResult.Checking,
            "b" to QualityResult.Unknown,
            "c" to QualityResult.Unavailable,
            "d" to measured(null), // codecs lus, résolution non annoncée
        )
        assertEquals(emptySet<String>(), QualityCheck.best(results))
        assertNull(QualityCheck.bestHeight(results))
        assertEquals(emptySet<String>(), QualityCheck.best(emptyMap()))
    }
}
