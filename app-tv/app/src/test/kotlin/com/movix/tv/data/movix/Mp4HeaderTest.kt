package com.movix.tv.data.movix

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayOutputStream

class Mp4HeaderTest {
    private fun box(type: String, vararg content: ByteArray): ByteArray {
        val body = content.fold(ByteArray(0)) { a, b -> a + b }
        return u32(8 + body.size) + type.toByteArray(Charsets.ISO_8859_1) + body
    }

    private fun u32(v: Int) = byteArrayOf((v ushr 24).toByte(), (v ushr 16).toByte(), (v ushr 8).toByte(), v.toByte())

    /** `tkhd` version 0 : 84 octets de contenu, largeur et hauteur 16.16 à la fin. */
    private fun tkhd(w: Int, h: Int) = box("tkhd", ByteArray(76), u32(w shl 16), u32(h shl 16))

    /** `stsd` avec une entrée dont seul le code compte. */
    private fun stsd(fourcc: String) = box("stsd", ByteArray(4), u32(1), u32(16), fourcc.toByteArray(Charsets.ISO_8859_1), ByteArray(8))

    /** Tables d'index après `stsd` : jamais lues. */
    private val bigTable = box("stsz", ByteArray(200_000))

    private fun trak(w: Int, h: Int, fourcc: String) =
        box("trak", tkhd(w, h), box("mdia", box("mdhd", ByteArray(24)), box("minf", box("stbl", stsd(fourcc), bigTable))))

    private val ftyp = box("ftyp", "isom".toByteArray(), ByteArray(8))
    private val moov = box("moov", box("mvhd", ByteArray(100)), trak(1920, 800, "hvc1"), trak(0, 0, "ec-3"))
    private val mdat = box("mdat", ByteArray(300_000))

    /** Lecture d'un tableau comme le ferait un serveur HTTP qui gère `Range`. */
    private fun reader(file: ByteArray, reads: MutableList<Long> = ArrayList()): suspend (Long, Int) -> ByteArray? = { offset, length ->
        reads += offset
        if (offset >= file.size) null else file.copyOfRange(offset.toInt(), minOf(file.size, (offset + length).toInt()))
    }

    @Test
    fun faststartFile() = runBlocking {
        val reads = ArrayList<Long>()
        val v = Mp4Header.read(reader(ftyp + moov + mdat, reads))
        assertEquals(Variant(1080, listOf("hvc1", "ec-3")), v)
        // Les grandes tables et les données ne sont jamais lues en entier.
        assertEquals(true, reads.size <= 6)
    }

    @Test
    fun moovAfterMediaData() = runBlocking {
        val v = Mp4Header.read(reader(ftyp + mdat + moov))
        assertEquals(Variant(1080, listOf("hvc1", "ec-3")), v)
    }

    @Test
    fun notAnMp4() = runBlocking {
        assertNull(Mp4Header.read(reader("<html>404</html>".toByteArray())))
        assertNull(Mp4Header.read(reader(ftyp))) // pas de moov
        assertNull(Mp4Header.read { _, _ -> null })
    }

    @Test
    fun largeSizeBox() = runBlocking {
        // mdat en taille 64 bits (size = 1).
        val payload = ByteArray(1000)
        val out = ByteArrayOutputStream()
        out.write(u32(1)); out.write("mdat".toByteArray()); out.write(u32(0)); out.write(u32(16 + payload.size)); out.write(payload)
        val v = Mp4Header.read(reader(ftyp + out.toByteArray() + moov))
        assertEquals(1080, v?.height)
    }
}
