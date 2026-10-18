package com.movix.tv.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener

/**
 * Lecteur qui retire l'enveloppe PNG d'un segment PNG+MPEG-TS (voir
 * [PngWrappedMpegTs]). Logique pure, sans Android : testable sur la JVM.
 * Les 8 premiers octets suffisent à écarter un fichier qui n'est pas un PNG,
 * sans rien retenir de plus.
 */
class PngTsReader(private val upstream: (ByteArray, Int, Int) -> Int) {
    private var prefix = ByteArray(0)
    private var prefixPos = 0
    private var prefixEnd = 0

    /** Sonde le début du flux ; rend le nombre d'octets d'enveloppe sautés (0 sinon). */
    fun probe(): Int {
        val buf = ByteArray(PngWrappedMpegTs.MAX_PROBE_BYTES)
        var count = fill(buf, 0, SIGNATURE_BYTES)
        var offset = 0
        if (PngWrappedMpegTs.startsLikePng(buf, count)) {
            count = fill(buf, count, buf.size)
            offset = PngWrappedMpegTs.payloadOffset(buf, count) ?: 0
        }
        prefix = buf
        prefixPos = offset
        prefixEnd = count
        return offset
    }

    private fun fill(buf: ByteArray, from: Int, until: Int): Int {
        var count = from
        while (count < until) {
            val n = upstream(buf, count, until - count)
            if (n == C.RESULT_END_OF_INPUT) break
            count += n
        }
        return count
    }

    fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (prefixPos < prefixEnd) {
            val n = minOf(length, prefixEnd - prefixPos)
            System.arraycopy(prefix, prefixPos, buffer, offset, n)
            prefixPos += n
            return n
        }
        return upstream(buffer, offset, length)
    }

    private companion object {
        const val SIGNATURE_BYTES = 8
    }
}

/**
 * Enveloppe un `DataSource` avec [PngTsReader]. Seule une lecture depuis le
 * début de la ressource est sondée (les segments HLS se lisent en entier).
 */
class PngTsDataSource(private val upstream: DataSource) : DataSource {
    private var reader: PngTsReader? = null

    override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

    override fun open(dataSpec: DataSpec): Long {
        val length = upstream.open(dataSpec)
        if (dataSpec.position != 0L) {
            reader = null
            return length
        }
        val r = PngTsReader(upstream::read)
        val skipped = r.probe()
        reader = r
        return if (length == C.LENGTH_UNSET.toLong() || skipped == 0) length else length - skipped
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        reader?.read(buffer, offset, length) ?: upstream.read(buffer, offset, length)

    override fun getUri(): Uri? = upstream.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() {
        reader = null
        upstream.close()
    }

    class Factory(private val upstream: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = PngTsDataSource(upstream.createDataSource())
    }
}
