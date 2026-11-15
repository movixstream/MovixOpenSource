package com.movix.tv.player

import android.content.Context
import android.util.Base64
import android.util.Log
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.Inet6Address
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.Locale
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Reçoit, sur le thread du transfert, ce que libcurl lit. Les noms sont lus
 * par JNI (src/main/cpp/movix_curl.c) : ne pas les renommer sans le C.
 */
interface CurlTransferCallback {
    fun onHeaderLine(line: ByteArray)

    /** `false` interrompt le transfert (lecteur fermé, redirection suivie). */
    fun onBody(chunk: ByteArray, length: Int): Boolean

    fun shouldAbort(): Boolean

    fun onError(message: String)
}

/**
 * libcurl-impersonate (lexiforest/curl-impersonate), la pile de curl_cffi :
 * ClientHello TLS, HTTP/2 et en-têtes d'un vrai Chrome. Même pont que l'app
 * mobile (app/android/.../ImpersonateMediaProxyUpstream.kt), voir
 * [BrowserImpersonation] pour la raison.
 */
object CurlImpersonate {
    private const val TAG = "CurlImpersonate"
    private const val MAX_IDLE_HANDLES = 6
    private const val CONNECT_TIMEOUT_SEC = 8
    // Comme le readTimeout de CronetDataSource : abandon après 20 s sans octet.
    private const val STALL_TIMEOUT_SEC = 20
    private const val CURLE_FAILED_INIT = 2

    /** Faux si la bibliothèque manque (ABI non fournie, tests JVM) : repli OkHttp. */
    val available: Boolean by lazy {
        runCatching { System.loadLibrary("movixcurl") }
            .onFailure { Log.w(TAG, "libcurl-impersonate indisponible : ${it.message}") }
            .isSuccess
    }

    // Un handle garde ses connexions et ses sessions TLS d'une requête à
    // l'autre : les segments suivants n'ont plus de poignée de main à faire.
    private val idleHandles = ArrayBlockingQueue<Long>(MAX_IDLE_HANDLES)
    private val transfers = Executors.newCachedThreadPool { task ->
        Thread(task, "MovixCurl").apply { isDaemon = true }
    }

    fun errorText(code: Int): String =
        runCatching { nativeErrorText(code) }.getOrDefault("curl error $code")

    /**
     * Lance une requête GET (ou HEAD) ; rend quand les en-têtes de la réponse
     * finale sont là. Les redirections ne sont pas suivies : à l'appelant.
     */
    fun start(context: Context, url: String, head: Boolean, headerLines: List<String>): CurlTransfer {
        val caFile = CurlCaBundle.path(context) ?: throw IOException("No CA bundle for curl")
        val host = requireNotNull(java.net.URI(url).host) { "Missing host" }
        val resolveEntry = resolveEntry(host)
        val transfer = CurlTransfer()
        transfers.execute {
            val handle = idleHandles.poll() ?: nativeCreate()
            try {
                transfer.run { callback ->
                    if (handle == 0L) {
                        CURLE_FAILED_INIT
                    } else {
                        nativePerform(
                            handle = handle,
                            target = BrowserImpersonation.TARGET,
                            url = url,
                            head = head,
                            headers = headerLines.toTypedArray(),
                            resolve = arrayOf(resolveEntry),
                            acceptEncoding = BrowserImpersonation.ACCEPT_ENCODING,
                            caFile = caFile,
                            network = 0L,
                            connectTimeoutSec = CONNECT_TIMEOUT_SEC,
                            stallTimeoutSec = STALL_TIMEOUT_SEC,
                            callback = callback,
                        )
                    }
                }
            } finally {
                if (handle != 0L && !idleHandles.offer(handle)) nativeDestroy(handle)
            }
        }
        return transfer
    }

    // Résolu ici puis imposé à curl : sur Android, son résolveur (c-ares) ne
    // trouve pas les serveurs DNS du système.
    private fun resolveEntry(host: String): String {
        val name = host.lowercase(Locale.US).trimEnd('.')
        val addresses = try {
            InetAddress.getAllByName(name).toList()
        } catch (error: Exception) {
            throw UnknownHostException("Media DNS failed").apply { initCause(error) }
        }
        if (addresses.isEmpty()) throw UnknownHostException("Unresolved media host")
        val literals = addresses.distinct().joinToString(",") { address ->
            val literal = requireNotNull(address.hostAddress).substringBefore('%')
            if (address is Inet6Address) "[$literal]" else literal
        }
        return "$name:443:$literals"
    }

    @JvmStatic
    external fun nativeCreate(): Long

    @JvmStatic
    external fun nativeDestroy(handle: Long)

    @JvmStatic
    external fun nativeErrorText(code: Int): String

    @JvmStatic
    external fun nativePerform(
        handle: Long,
        target: String,
        url: String,
        head: Boolean,
        headers: Array<String>,
        resolve: Array<String>,
        acceptEncoding: String?,
        caFile: String,
        network: Long,
        connectTimeoutSec: Int,
        stallTimeoutSec: Int,
        callback: CurlTransferCallback,
    ): Int
}

/** libcurl décode lui-même les encodages annoncés dans ACCEPT_ENCODING. */
fun decodedCurlResponseHeaders(headers: Map<String, List<String>>): Map<String, List<String>> {
    val encodings = headers.entries
        .filter { it.key.equals("Content-Encoding", ignoreCase = true) }
        .flatMap { it.value }
        .flatMap { it.split(',') }
        .map { it.trim().lowercase(Locale.US) }
    val decoded = setOf("gzip", "x-gzip", "deflate", "br", "zstd", "identity")
    if (encodings.isEmpty() || encodings.any { it !in decoded }) return headers
    // La longueur annoncée est celle du corps compressé.
    return headers.filterKeys {
        !it.equals("Content-Encoding", ignoreCase = true) &&
            !it.equals("Content-Length", ignoreCase = true)
    }
}

class CurlResponseHead(
    val statusCode: Int,
    val statusMessage: String,
    headerLines: List<String>,
) {
    val fields: List<Pair<String, String>> = headerLines.mapNotNull { line ->
        val colon = line.indexOf(':')
        if (colon <= 0) null else line.substring(0, colon).trim() to line.substring(colon + 1).trim()
    }

    fun header(name: String): String? =
        fields.lastOrNull { it.first.equals(name, ignoreCase = true) }?.second

    fun headerMap(): Map<String, List<String>> {
        val map = LinkedHashMap<String, MutableList<String>>()
        for ((name, value) in fields) map.getOrPut(name) { ArrayList() } += value
        return map
    }
}

/**
 * Assemble les lignes d'en-tête que libcurl remonte une à une. Les réponses
 * intermédiaires (100, 103) sont ignorées : seule la réponse finale compte.
 */
class CurlResponseHeadParser {
    private var statusLine: String? = null
    private val lines = ArrayList<String>()

    fun accept(rawLine: String): CurlResponseHead? {
        val line = rawLine.trimEnd('\r', '\n')
        if (line.startsWith("HTTP/", ignoreCase = true)) {
            statusLine = line
            lines.clear()
            return null
        }
        if (line.isEmpty()) {
            val parts = statusLine?.split(' ', limit = 3) ?: return null
            val status = parts.getOrNull(1)?.toIntOrNull() ?: return null
            statusLine = null
            if (status < 200) {
                lines.clear()
                return null
            }
            return CurlResponseHead(status, parts.getOrNull(2).orEmpty(), lines.toList())
        }
        if ((line[0] == ' ' || line[0] == '\t') && lines.isNotEmpty()) {
            lines[lines.lastIndex] = lines.last() + " " + line.trim()
        } else {
            lines += line
        }
        return null
    }
}

/**
 * Un transfert libcurl, lancé sur son propre thread : les en-têtes réveillent
 * l'appelant, le corps passe par une file bornée vers [body]. Quand la file
 * est pleine, le thread curl attend, ce qui freine la lecture réseau.
 */
class CurlTransfer internal constructor() : CurlTransferCallback {
    private val parser = CurlResponseHeadParser()
    private val headLatch = CountDownLatch(1)
    private val chunks = ArrayBlockingQueue<Any>(QUEUE_CAPACITY)

    @Volatile
    private var cancelled = false

    @Volatile
    private var head: CurlResponseHead? = null

    @Volatile
    private var failure: IOException? = null

    @Volatile
    private var errorText: String? = null

    val body: InputStream = Body()

    internal fun run(perform: (CurlTransferCallback) -> Int) {
        val code = try {
            perform(this)
        } catch (error: Throwable) {
            failure = IOException("curl transfer failed", error)
            -1
        }
        if (code != 0 && failure == null && !cancelled) {
            failure = IOException("curl $code: ${errorText ?: CurlImpersonate.errorText(code)}")
        }
        if (head == null) {
            if (failure == null) failure = IOException("curl ended without a response")
            headLatch.countDown()
        } else {
            offerUntilCancelled(failure ?: EndOfStream)
        }
    }

    fun awaitHead(timeoutSec: Long): CurlResponseHead {
        val ready = try {
            headLatch.await(timeoutSec, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            cancel()
            throw java.io.InterruptedIOException("Interrupted while waiting for media headers")
        }
        if (!ready) {
            cancel()
            throw SocketTimeoutException("No media response headers after ${timeoutSec}s")
        }
        return head ?: throw (failure ?: IOException("curl ended without a response"))
    }

    fun cancel() {
        cancelled = true
        chunks.clear()
    }

    override fun onHeaderLine(line: ByteArray) {
        if (head != null) return // trailers HTTP/2 : rien à en faire
        parser.accept(String(line, Charsets.ISO_8859_1))?.let {
            head = it
            headLatch.countDown()
        }
    }

    override fun onBody(chunk: ByteArray, length: Int): Boolean {
        if (cancelled) return false
        return offerUntilCancelled(chunk.copyOf(length))
    }

    override fun shouldAbort(): Boolean = cancelled

    override fun onError(message: String) {
        errorText = message
    }

    private fun offerUntilCancelled(item: Any): Boolean {
        while (!cancelled) {
            try {
                if (chunks.offer(item, OFFER_WAIT_MS, TimeUnit.MILLISECONDS)) return true
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return false
            }
        }
        return false
    }

    private inner class Body : InputStream() {
        private var current: ByteArray? = null
        private var offset = 0
        private var finished = false

        override fun read(): Int {
            val one = ByteArray(1)
            val count = read(one, 0, 1)
            return if (count <= 0) -1 else one[0].toInt() and 0xff
        }

        override fun read(buffer: ByteArray, off: Int, len: Int): Int {
            if (len == 0) return 0
            if (!ensureChunk()) return -1
            val chunk = current!!
            val count = minOf(chunk.size - offset, len)
            System.arraycopy(chunk, offset, buffer, off, count)
            offset += count
            if (offset >= chunk.size) {
                current = null
                offset = 0
            }
            return count
        }

        private fun ensureChunk(): Boolean {
            if (current != null) return true
            if (finished) return false
            while (true) {
                val item = try {
                    chunks.poll(READ_WAIT_SEC, TimeUnit.SECONDS)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    finished = true
                    throw java.io.InterruptedIOException("Interrupted while reading media body")
                } ?: if (cancelled) {
                    finished = true
                    return false
                } else {
                    continue
                }
                when (item) {
                    is EndOfStream -> {
                        finished = true
                        return false
                    }
                    is IOException -> {
                        finished = true
                        throw item
                    }
                    is ByteArray -> {
                        if (item.isEmpty()) continue
                        current = item
                        offset = 0
                        return true
                    }
                }
            }
        }

        override fun close() {
            finished = true
            current = null
            cancel()
        }
    }

    private object EndOfStream

    private companion object {
        const val QUEUE_CAPACITY = 32
        const val OFFER_WAIT_MS = 250L
        const val READ_WAIT_SEC = 1L
    }
}

/**
 * Ancres de confiance pour libcurl : BoringSSL ne lit pas le magasin Android.
 * On exporte les certificats système en PEM, une fois par processus.
 */
object CurlCaBundle {
    private const val TAG = "CurlCaBundle"

    @Volatile
    private var cached: String? = null

    fun path(context: Context): String? {
        cached?.let { return it }
        synchronized(this) {
            cached?.let { return it }
            cached = runCatching { write(context) }
                .onFailure { Log.w(TAG, "Magasin de certificats illisible : ${it.message}") }
                .getOrNull()
            return cached
        }
    }

    private fun write(context: Context): String {
        val store = KeyStore.getInstance("AndroidCAStore").apply { load(null) }
        val pem = StringBuilder()
        for (alias in store.aliases()) {
            if (!alias.startsWith("system:")) continue
            val certificate = store.getCertificate(alias) as? X509Certificate ?: continue
            pem.append("-----BEGIN CERTIFICATE-----\n")
            pem.append(Base64.encodeToString(certificate.encoded, Base64.DEFAULT))
            pem.append("-----END CERTIFICATE-----\n")
        }
        check(pem.isNotEmpty()) { "No system CA certificate" }
        val file = File(context.noBackupFilesDir, "curl-ca-bundle.pem")
        val partial = File(file.parentFile, "${file.name}.partial")
        partial.writeText(pem.toString(), Charsets.US_ASCII)
        if (!partial.renameTo(file)) {
            file.delete()
            check(partial.renameTo(file)) { "Cannot store the CA bundle" }
        }
        return file.absolutePath
    }
}
