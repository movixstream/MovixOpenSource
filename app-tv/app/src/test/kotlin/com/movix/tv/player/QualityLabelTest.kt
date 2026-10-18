package com.movix.tv.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QualityLabelTest {
    @Test
    fun cinemaScopeIsLabelledByWidth() {
        assertEquals("1080p", qualityLabel(1920, 872))
        assertEquals("1080p", qualityLabel(1920, 800))
        assertEquals("720p", qualityLabel(1280, 536))
        assertEquals("2160p", qualityLabel(3840, 1600))
    }

    @Test
    fun standardSizesStayTheSame() {
        assertEquals("1080p", qualityLabel(1920, 1080))
        assertEquals("720p", qualityLabel(1280, 720))
        assertEquals("480p", qualityLabel(854, 480))
        assertEquals("576p", qualityLabel(720, 576))
    }

    @Test
    fun unknownSizeGivesNoLabel() {
        assertNull(qualityLabel(0, 0))
    }
}
