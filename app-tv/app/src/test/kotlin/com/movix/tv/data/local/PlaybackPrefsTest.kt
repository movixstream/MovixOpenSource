package com.movix.tv.data.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Préférences de lecture : valeurs par défaut, une préférence par profil, sous-titres par version. */
class PlaybackPrefsTest {
    @Test
    fun defaultsKeepTodaysBehaviour() {
        val p = UiPrefs.playback(emptyMap(), null)
        assertEquals("fr", p.audio)
        assertEquals("VF", p.version)
        assertNull(p.subtitlesFor("VF"))
        assertNull(p.subtitlesFor("VOSTFR"))
        assertNull(p.subtitlesFor("VO"))
        assertTrue(p.remember)
        assertEquals(p, UiPrefs.playback(emptyMap(), "u1_p1"))
    }

    @Test
    fun eachProfileHasItsOwnAndFallsBackToTheTv() {
        val tv = PlaybackPrefs(version = "VOSTFR")
        val kid = PlaybackPrefs(audio = "en")
        val values = mapOf(
            UiPrefs.playbackKey(null) to UiPrefs.encode(tv),
            UiPrefs.playbackKey("u1_p1") to UiPrefs.encode(kid),
        )
        assertEquals(kid, UiPrefs.playback(values, "u1_p1"))
        // Profil qui n'a encore rien choisi : les choix faits sur la télé avant la liaison.
        assertEquals(tv, UiPrefs.playback(values, "u1_p2"))
        assertEquals(tv, UiPrefs.playback(values, null))
        assertTrue(UiPrefs.playbackKey("u1_p1") != UiPrefs.playbackKey("u1_p2"))
        assertTrue(UiPrefs.playbackKey("u1_p1") != UiPrefs.playbackKey(null))
    }

    @Test
    fun unreadableValueFallsBackToDefaults() {
        assertEquals(PlaybackPrefs(), UiPrefs.playback(mapOf(UiPrefs.playbackKey(null) to "{pas du json"), null))
    }

    @Test
    fun subtitlesAreKeptPerVersion() {
        val p = PlaybackPrefs().withSubtitles("VOSTFR", "fr").withSubtitles("VF", "off")
        assertEquals("fr", p.subtitlesFor("VOSTFR"))
        assertEquals("off", p.subtitlesFor("VF"))
        assertNull(p.subtitlesFor("VO"))
        // `null` : retour à la règle automatique pour cette version.
        assertNull(p.withSubtitles("VOSTFR", null).subtitlesFor("VOSTFR"))
        // Relu tel quel après un passage par le stockage.
        assertEquals(p, UiPrefs.playback(mapOf(UiPrefs.playbackKey(null) to UiPrefs.encode(p)), null))
    }

    @Test
    fun frenchAudioKeepsTheThreeCodesOfBefore() {
        assertEquals(listOf("fr", "fre", "fra"), PlaybackPrefs.audioLanguages("fr"))
        assertEquals(listOf("en"), PlaybackPrefs.audioLanguages("en"))
    }
}
