package com.movix.tv.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CodecsTest {
    @Test
    fun mimeFromHlsAndMp4Codes() {
        assertEquals("video/hevc", Codecs.mimeOf("hvc1.1.6.L120.90"))
        assertEquals("video/hevc", Codecs.mimeOf("hev1"))
        assertEquals("video/avc", Codecs.mimeOf("avc1.64001f"))
        assertEquals("video/dolby-vision", Codecs.mimeOf("dvh1.08.06"))
        assertEquals("audio/mp4a-latm", Codecs.mimeOf("mp4a.40.2"))
        assertEquals("audio/eac3", Codecs.mimeOf("ec-3"))
        assertEquals("audio/ac3", Codecs.mimeOf("ac-3"))
        assertEquals("audio/opus", Codecs.mimeOf("Opus"))
        assertEquals("audio/vnd.dts.hd", Codecs.mimeOf("dtsh"))
        assertNull(Codecs.mimeOf("xyz1"))
    }

    @Test
    fun readableNames() {
        assertEquals("H.265 (HEVC)", Codecs.displayName("video/hevc"))
        assertEquals("Dolby Digital Plus (E-AC-3)", Codecs.displayName("audio/eac3"))
        assertEquals("DTS", Codecs.displayName("audio/vnd.dts"))
        assertEquals("foo.1", Codecs.displayName("video/x-foo", "foo.1"))
        assertEquals("X-FOO", Codecs.displayName("video/x-foo"))
        assertEquals("?", Codecs.displayName(null))
    }
}
