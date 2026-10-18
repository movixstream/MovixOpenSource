package com.movix.tv.data.subs

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

class ExternalSubtitlesTest {
    private val srt = "1\n00:00:01,000 --> 00:00:02,000\nÇa marche, déjà vu\n"

    @Test
    fun gzipUtf8IsDecompressed() {
        val out = ByteArrayOutputStream()
        GZIPOutputStream(out).use { it.write(srt.toByteArray(Charsets.UTF_8)) }
        assertEquals(srt, ExternalSubtitles.decode(out.toByteArray()))
    }

    @Test
    fun oldFrenchSrtFallsBackToWindows1252() {
        assertEquals(srt, ExternalSubtitles.decode(srt.toByteArray(charset("windows-1252"))))
    }

    @Test
    fun utf16WithBom() {
        assertEquals(srt, ExternalSubtitles.decode(byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + srt.toByteArray(Charsets.UTF_16LE)))
    }
}
