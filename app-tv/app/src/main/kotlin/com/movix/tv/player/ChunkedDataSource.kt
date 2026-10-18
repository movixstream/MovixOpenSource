package com.movix.tv.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener

/**
 * Lit un fichier par morceaux de [chunk] octets (en-tête Range borné).
 *
 * Le CDN de YouTube refuse en 403 une requête ouverte (`Range: bytes=0-`),
 * celle que Media3 envoie pour un fichier progressif, mais accepte les plages
 * bornées : on enchaîne donc les plages de façon transparente pour le lecteur.
 * La taille totale vient du paramètre `clen` de l'URL, sinon de Content-Range.
 */
@UnstableApi
class ChunkedDataSource(private val upstream: DataSource, private val chunk: Long = 1L shl 20) : DataSource {
    private var spec: DataSpec? = null
    private var pos = 0L
    /** Fin (exclue) demandée par le lecteur, ou -1 jusqu'à la fin du fichier. */
    private var end = -1L
    private var total = -1L
    private var remaining = 0L
    private var opened = false

    override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

    override fun open(dataSpec: DataSpec): Long {
        spec = dataSpec
        pos = dataSpec.position
        end = if (dataSpec.length != C.LENGTH_UNSET.toLong()) pos + dataSpec.length else -1L
        total = dataSpec.uri.getQueryParameter("clen")?.toLongOrNull() ?: -1L
        openChunk()
        if (total < 0) {
            total = upstream.responseHeaders.entries.firstOrNull { it.key.equals("Content-Range", true) }
                ?.value?.firstOrNull()?.substringAfter('/')?.toLongOrNull() ?: -1L
        }
        return when {
            end >= 0 -> end - pos
            total >= 0 -> total - pos
            else -> C.LENGTH_UNSET.toLong()
        }
    }

    private fun limit(): Long = when {
        end >= 0 -> end
        total >= 0 -> total
        else -> Long.MAX_VALUE
    }

    private fun openChunk() {
        val s = spec ?: return
        if (opened) { upstream.close(); opened = false }
        val len = minOf(chunk, limit() - pos)
        if (len <= 0) { remaining = 0; return }
        remaining = try {
            upstream.open(s.subrange(pos - s.position, len)).let { if (it == C.LENGTH_UNSET.toLong()) len else it }
        } catch (e: java.io.IOException) {
            android.util.Log.w("MovixYouTube", "plage $pos+$len refusée (itag ${s.uri.getQueryParameter("itag")}, ${s.httpRequestHeaders})", e)
            throw e
        }
        opened = true
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (pos >= limit()) return C.RESULT_END_OF_INPUT
        if (remaining <= 0) {
            openChunk()
            if (remaining <= 0) return C.RESULT_END_OF_INPUT
        }
        val read = upstream.read(buffer, offset, minOf(length.toLong(), remaining).toInt())
        if (read == C.RESULT_END_OF_INPUT) {
            // Morceau plus court qu'annoncé (fin du fichier) : rien de plus à lire.
            return C.RESULT_END_OF_INPUT
        }
        pos += read
        remaining -= read
        return read
    }

    override fun getUri(): Uri? = spec?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() {
        if (opened) upstream.close()
        opened = false
        spec = null
    }

    class Factory(private val upstream: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = ChunkedDataSource(upstream.createDataSource())
    }
}
