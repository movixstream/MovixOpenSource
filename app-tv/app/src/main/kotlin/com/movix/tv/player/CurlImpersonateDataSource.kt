package com.movix.tv.player

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.Util
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource.HttpDataSourceException
import androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException
import androidx.media3.datasource.HttpUtil
import java.io.ByteArrayOutputStream
import java.io.IOException
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Source Media3 qui imite un vrai Chrome de bout en bout (libcurl-impersonate,
 * voir [BrowserImpersonation]) : pour Fsvid/Vidzy, que ni Cronet ni OkHttp ne
 * passent plus. Redirections suivies ici, cookies partagés avec OkHttp via
 * [PlaybackCookieJar], plage d'octets comme [androidx.media3.datasource.okhttp.OkHttpDataSource].
 */
class CurlImpersonateDataSource(private val context: Context) : BaseDataSource(/* isNetwork= */ true) {
    private var dataSpec: DataSpec? = null
    private var transfer: CurlTransfer? = null
    private var uri: Uri? = null
    private var responseHeaders: Map<String, List<String>> = emptyMap()
    private var bytesToRead = C.LENGTH_UNSET.toLong()
    private var bytesRead = 0L
    private var opened = false

    override fun open(dataSpec: DataSpec): Long {
        this.dataSpec = dataSpec
        bytesRead = 0
        bytesToRead = C.LENGTH_UNSET.toLong()
        transferInitializing(dataSpec)

        val (url, head, current) = openFollowingRedirects(dataSpec)
        transfer = current
        uri = Uri.parse(url)
        responseHeaders = if (dataSpec.httpMethod == DataSpec.HTTP_METHOD_HEAD) {
            head.headerMap()
        } else {
            decodedCurlResponseHeaders(head.headerMap())
        }

        if (head.statusCode !in 200..299) {
            current.cancel()
            // Plage qui commence pile à la fin du fichier : rien à lire, pas une erreur.
            if (head.statusCode == 416 &&
                dataSpec.position == HttpUtil.getDocumentSize(head.header("Content-Range"))
            ) {
                opened = true
                transferStarted(dataSpec)
                return if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else 0
            }
            throw InvalidResponseCodeException(
                head.statusCode,
                head.statusMessage,
                null,
                responseHeaders,
                dataSpec,
                Util.EMPTY_BYTE_ARRAY,
            )
        }

        // Serveur qui ignore la plage : sauter les octets avant la position.
        val bytesToSkip = if (head.statusCode == 200 && dataSpec.position != 0L) dataSpec.position else 0L
        val contentLength = responseHeaders.entries
            .firstOrNull { it.key.equals("Content-Length", ignoreCase = true) }
            ?.value?.firstOrNull()?.trim()?.toLongOrNull()
        bytesToRead = when {
            dataSpec.length != C.LENGTH_UNSET.toLong() -> dataSpec.length
            contentLength != null -> contentLength - bytesToSkip
            else -> C.LENGTH_UNSET.toLong()
        }
        opened = true
        transferStarted(dataSpec)
        skipFully(bytesToSkip, dataSpec)
        return bytesToRead
    }

    /** Suit les redirections ; rend l'URL finale, sa réponse et le transfert ouvert. */
    private fun openFollowingRedirects(dataSpec: DataSpec): Triple<String, CurlResponseHead, CurlTransfer> {
        var url = dataSpec.uri.toString()
        var redirects = 0
        while (true) {
            val httpUrl = url.toHttpUrlOrNull() ?: throw HttpDataSourceException(
                "Invalid media URL",
                dataSpec,
                PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
                HttpDataSourceException.TYPE_OPEN,
            )
            val cookie = PlaybackCookieJar.loadForRequest(httpUrl).joinToString("; ") { "${it.name}=${it.value}" }
            val lines = BrowserImpersonation.xhrHeaders(url, dataSpec.httpRequestHeaders, cookie, rangeHeader(dataSpec))
            val attempt = try {
                CurlImpersonate.start(context, url, dataSpec.httpMethod == DataSpec.HTTP_METHOD_HEAD, lines)
            } catch (error: IOException) {
                throw HttpDataSourceException.createForIOException(error, dataSpec, HttpDataSourceException.TYPE_OPEN)
            }
            val attemptHead = try {
                attempt.awaitHead(HEADER_TIMEOUT_SEC)
            } catch (error: IOException) {
                attempt.cancel()
                throw HttpDataSourceException.createForIOException(error, dataSpec, HttpDataSourceException.TYPE_OPEN)
            }
            attemptHead.fields
                .filter { it.first.equals("Set-Cookie", ignoreCase = true) }
                .mapNotNull { Cookie.parse(httpUrl, it.second) }
                .takeIf { it.isNotEmpty() }
                ?.let { PlaybackCookieJar.saveFromResponse(httpUrl, it) }

            val location = attemptHead.header("Location")
            if (attemptHead.statusCode in 300..399 && location != null) {
                attempt.cancel()
                val next = httpUrl.resolve(location)?.toString()
                if (next == null || ++redirects > MAX_REDIRECTS) {
                    throw HttpDataSourceException(
                        "Invalid or too many media redirects",
                        dataSpec,
                        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
                        HttpDataSourceException.TYPE_OPEN,
                    )
                }
                url = next
                continue
            }
            return Triple(url, attemptHead, attempt)
        }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        var toRead = length
        if (bytesToRead != C.LENGTH_UNSET.toLong()) {
            val remaining = bytesToRead - bytesRead
            if (remaining == 0L) return C.RESULT_END_OF_INPUT
            toRead = minOf(toRead.toLong(), remaining).toInt()
        }
        val body = transfer?.body ?: return C.RESULT_END_OF_INPUT
        val count = try {
            body.read(buffer, offset, toRead)
        } catch (error: IOException) {
            throw HttpDataSourceException.createForIOException(
                error,
                checkNotNull(dataSpec),
                HttpDataSourceException.TYPE_READ,
            )
        }
        if (count == -1) return C.RESULT_END_OF_INPUT
        bytesRead += count
        bytesTransferred(count)
        return count
    }

    override fun getUri(): Uri? = uri

    override fun getResponseHeaders(): Map<String, List<String>> = responseHeaders

    override fun close() {
        transfer?.cancel()
        transfer = null
        if (opened) {
            opened = false
            transferEnded()
        }
        uri = null
        responseHeaders = emptyMap()
    }

    private fun skipFully(bytes: Long, dataSpec: DataSpec) {
        if (bytes == 0L) return
        val skipBuffer = ByteArray(16 * 1024)
        var left = bytes
        val body = checkNotNull(transfer).body
        while (left > 0) {
            val count = try {
                body.read(skipBuffer, 0, minOf(left, skipBuffer.size.toLong()).toInt())
            } catch (error: IOException) {
                throw HttpDataSourceException.createForIOException(error, dataSpec, HttpDataSourceException.TYPE_OPEN)
            }
            if (count == -1) {
                throw HttpDataSourceException(
                    dataSpec,
                    PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE,
                    HttpDataSourceException.TYPE_OPEN,
                )
            }
            left -= count
            bytesTransferred(count)
        }
    }

    class Factory(private val context: Context) : DataSource.Factory {
        override fun createDataSource(): DataSource = CurlImpersonateDataSource(context.applicationContext)
    }

    companion object {
        private const val MAX_REDIRECTS = 5
        private const val HEADER_TIMEOUT_SEC = 20L

        private fun rangeHeader(dataSpec: DataSpec): String? {
            if (dataSpec.position == 0L && dataSpec.length == C.LENGTH_UNSET.toLong()) return null
            val end = if (dataSpec.length == C.LENGTH_UNSET.toLong()) "" else (dataSpec.position + dataSpec.length - 1).toString()
            return "bytes=${dataSpec.position}-$end"
        }

        /**
         * Jusqu'à [length] octets de [url] (à partir de [offset] si [ranged]),
         * pour [com.movix.tv.data.movix.StreamProbe] ; `null` si erreur.
         */
        fun readPrefix(
            context: Context,
            url: String,
            headers: Map<String, String>,
            offset: Long,
            length: Int,
            ranged: Boolean,
        ): ByteArray? {
            val source = CurlImpersonateDataSource(context.applicationContext)
            val spec = DataSpec.Builder()
                .setUri(url)
                .setHttpRequestHeaders(MediaHeaders.apply(url, headers))
                .apply { if (ranged) setPosition(offset).setLength(length.toLong()) }
                .build()
            return try {
                source.open(spec)
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                while (out.size() < length) {
                    val count = source.read(buffer, 0, minOf(buffer.size, length - out.size()))
                    if (count == C.RESULT_END_OF_INPUT) break
                    out.write(buffer, 0, count)
                }
                out.toByteArray()
            } catch (_: IOException) {
                null
            } finally {
                source.close()
            }
        }
    }
}
