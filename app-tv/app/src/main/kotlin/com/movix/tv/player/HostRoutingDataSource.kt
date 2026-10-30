package com.movix.tv.player

import android.net.Uri
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener

/**
 * Envoie chaque requête vers [alternate] ou [primary] selon son hôte.
 *
 * Fsvid/Vidzy exigent un vrai profil de navigateur : TLS qui propose
 * X25519MLKEM768 (OkHttp ne le fait pas) et Accept-Encoding exact de Chrome
 * (Cronet le réécrit). Leurs requêtes passent donc par libcurl-impersonate
 * ([CurlImpersonateDataSource]), le reste garde Cronet.
 */
class HostRoutingDataSource(
    private val primary: DataSource,
    private val alternate: DataSource,
    private val useAlternate: (Uri) -> Boolean,
) : DataSource {
    private var current: DataSource? = null

    override fun addTransferListener(transferListener: TransferListener) {
        primary.addTransferListener(transferListener)
        alternate.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        val source = if (useAlternate(dataSpec.uri)) alternate else primary
        current = source
        return source.open(dataSpec)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        checkNotNull(current) { "read() avant open()" }.read(buffer, offset, length)

    override fun getUri(): Uri? = current?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = current?.responseHeaders ?: emptyMap()

    override fun close() {
        try {
            current?.close()
        } finally {
            current = null
        }
    }

    class Factory(
        private val primary: DataSource.Factory,
        private val alternate: DataSource.Factory,
        private val useAlternate: (Uri) -> Boolean,
    ) : DataSource.Factory {
        override fun createDataSource(): DataSource =
            HostRoutingDataSource(primary.createDataSource(), alternate.createDataSource(), useAlternate)
    }

    companion object {
        /** Hôtes dont le CDN exige un vrai profil de navigateur. */
        fun needsBrowserImpersonation(uri: Uri): Boolean =
            BrowserImpersonation.requiresImpersonation(uri.toString())
    }
}
