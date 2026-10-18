package com.movix.tv.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SubtitlesTest {
    @Test
    fun parsesSrtWithTagsAndCrlf() {
        val cues = Subtitles.parse("﻿1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>Bonjour</i>\r\n\r\n2\r\n00:01:02,000 --> 00:01:04,250\r\nLigne 1\r\nLigne 2\r\n")
        assertEquals(2, cues.size)
        assertEquals(1500L, cues[0].startMs)
        assertEquals("Bonjour", cues[0].text)
        assertEquals(64_250L, cues[1].endMs)
        assertEquals("Ligne 1\nLigne 2", cues[1].text)
    }

    @Test
    fun parsesVttShortTimesAndSettings() {
        val cues = Subtitles.parse("WEBVTT\n\nNOTE rien\n\n00:05.000 --> 00:07.000 align:center\nSalut\n\n1:00:00.000 --> 1:00:01.000\nTard")
        assertEquals(listOf(5_000L, 3_600_000L), cues.map { it.startMs })
        assertEquals(7_000L, cues[0].endMs)
    }

    @Test
    fun textAtHandlesGapsAndOverlaps() {
        val cues = Subtitles.parse("1\n00:00:01,000 --> 00:00:05,000\nA\n\n2\n00:00:02,000 --> 00:00:03,000\nB\n\n3\n00:00:10,000 --> 00:00:11,000\nC")
        assertNull(Subtitles.textAt(cues, 500))
        assertEquals("A", Subtitles.textAt(cues, 1_500))
        assertEquals("A\nB", Subtitles.textAt(cues, 2_500))
        assertNull(Subtitles.textAt(cues, 7_000))
        assertEquals("C", Subtitles.textAt(cues, 10_000))
        assertNull(Subtitles.textAt(emptyList(), 0))
    }
}
