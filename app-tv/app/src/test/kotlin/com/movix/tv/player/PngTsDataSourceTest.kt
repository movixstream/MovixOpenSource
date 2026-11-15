package com.movix.tv.player

import androidx.media3.common.C
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayOutputStream

class PngTsDataSourceTest {
    /** Flux en mémoire qui rend au plus [chunk] octets par lecture, comme un réseau. */
    private class Bytes(private val data: ByteArray, private val chunk: Int = 100) : (ByteArray, Int, Int) -> Int {
        private var pos = 0
        override fun invoke(buffer: ByteArray, offset: Int, length: Int): Int {
            if (pos >= data.size) return C.RESULT_END_OF_INPUT
            val n = minOf(length, chunk, data.size - pos)
            System.arraycopy(data, pos, buffer, offset, n)
            pos += n
            return n
        }
    }

    private fun chunk(type: String, data: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        val len = data.size
        out.write(byteArrayOf((len ushr 24).toByte(), (len ushr 16).toByte(), (len ushr 8).toByte(), len.toByte()))
        out.write(type.toByteArray(Charsets.US_ASCII))
        out.write(data)
        out.write(ByteArray(4)) // CRC : non vérifié
        return out.toByteArray()
    }

    private val png: ByteArray = ByteArrayOutputStream().apply {
        write(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
        write(chunk("IHDR", ByteArray(13)))
        write(chunk("IDAT", ByteArray(40) { 7 }))
        write(chunk("IEND", ByteArray(0)))
    }.toByteArray()

    private val ts: ByteArray = ByteArray(188 * 5) { i -> if (i % 188 == 0) 0x47 else (i % 251).toByte() }

    /** Sonde puis lit tout : rend (octets sautés, contenu). */
    private fun readAll(data: ByteArray, chunk: Int = 100): Pair<Int, ByteArray> {
        val reader = PngTsReader(Bytes(data, chunk))
        val skipped = reader.probe()
        val out = ByteArrayOutputStream()
        val buf = ByteArray(333)
        while (true) {
            val n = reader.read(buf, 0, buf.size)
            if (n == C.RESULT_END_OF_INPUT) break
            out.write(buf, 0, n)
        }
        return skipped to out.toByteArray()
    }

    @Test
    fun offsetPointsAfterIend() {
        assertEquals(png.size, PngWrappedMpegTs.payloadOffset(png + ts))
    }

    @Test
    fun wrappedSegmentIsUnwrapped() {
        val (skipped, bytes) = readAll(png + ts, chunk = 7)
        assertEquals(png.size, skipped)
        assertArrayEquals(ts, bytes)
    }

    @Test
    fun pngNotFollowedByTsIsLeftAlone() {
        assertNull(PngWrappedMpegTs.payloadOffset(png + ByteArray(600)))
        val (skipped, bytes) = readAll(png + ByteArray(600))
        assertEquals(0, skipped)
        assertArrayEquals(png + ByteArray(600), bytes)
    }

    @Test
    fun plainTsAndManifestsPassThrough() {
        assertArrayEquals(ts, readAll(ts).second)
        val m3u8 = "#EXTM3U\n#EXT-X-VERSION:3\nseg0.ts\n".toByteArray()
        assertArrayEquals(m3u8, readAll(m3u8).second)
        val tiny = byteArrayOf(1, 2, 3)
        assertArrayEquals(tiny, readAll(tiny).second)
        assertArrayEquals(ByteArray(0), readAll(ByteArray(0)).second)
    }

    @Test
    fun corruptIhdrIsRejected() {
        val bad = png.copyOf().also { it[12] = 'X'.code.toByte() }
        assertNull(PngWrappedMpegTs.payloadOffset(bad + ts))
        assertArrayEquals(bad + ts, readAll(bad + ts).second)
    }
}
