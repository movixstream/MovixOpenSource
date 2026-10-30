package com.movix.app.proxy

import android.content.Context
import android.net.Network
import android.util.Base64
import android.util.Log
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.Inet6Address
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URI
import java.net.UnknownHostException
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.Locale
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Upstream du proxy média qui imite un vrai Chrome de bout en bout, via
 * libcurl-impersonate : ClientHello TLS (dont X25519MLKEM768 et GREASE),
 * réglages HTTP/2, en-têtes et leur ordre. C'est ce que fait déjà le relais
 * Python avec curl_cffi, et ce qu'exigent Fsvid/Vidzy depuis le 2026-10-30
 * (voir [BrowserImpersonation]).
 *
 * Même contrat que [OkHttpMediaProxyUpstream] : redirections suivies à la
 * main et revalidées, leurres refusés, cookies partagés via
 * [MediaProxyCookieJar], corps rendu en flux. La résolution DNS se fait ici
 * puis est imposée à curl (CURLOPT_RESOLVE) : une adresse privée est refusée
 * avant toute connexion, et curl ne résout jamais lui-même.
 *
 * Repli sur [fallback] si la bibliothèque manque ou si le transfert échoue
 * avant les en-têtes : jamais pire que le chemin OkHttp d'avant.
 */
internal class ImpersonateMediaProxyUpstream(
    context: Context,
    private val fallback: MediaProxyUpstream,
    private val validateUrl: (String) -> URI = {
        MediaProxyPolicy.validatePublicHttpsUrl(it)
    },
    // Relais Cast : sockets et DNS liés au réseau qui joint le Chromecast.
    private val boundNetwork: Network? = null,
) : MediaProxyUpstream, Closeable {
    private val appContext = context.applicationContext

    // Un handle garde ses connexions et ses sessions TLS d'une requête à
    // l'autre : les segments suivants n'ont plus de poignée de main à faire.
    private val idleHandles = ArrayBlockingQueue<Long>(MAX_IDLE_HANDLES)
    private val transfers = Executors.newCachedThreadPool { task ->
        Thread(task, "MovixCurlProxy").apply { isDaemon = true }
    }

    @Volatile
    private var closed = false

    override fun execute(
        target: MediaProxyTarget,
        localRequestHeaders: Map<String, String>,
    ): MediaProxyUpstreamResponse {
        if (MediaProxyPolicy.isProviderDecoyUrl(target.upstreamUrl)) {
            throw IllegalStateException("Upstream returned a decoy stream")
        }
        val caFile = if (CurlImpersonate.available) CurlCaBundle.path(appContext) else null
        if (caFile == null || closed) return fallback.execute(target, localRequestHeaders)

        var currentUrl = target.upstreamUrl
        repeat(MAX_REDIRECTS + 1) { redirectCount ->
            val uri = validateUrl(currentUrl)
            val httpUrl = currentUrl.toHttpUrlOrNull()
                ?: throw IllegalArgumentException("Invalid media URL")
            val resolveEntry = resolveEntry(requireNotNull(uri.host))
            val cookie = MediaProxyCookieJar.loadForRequest(httpUrl)
                .joinToString("; ") { "${it.name}=${it.value}" }
            val headerLines = BrowserImpersonation.xhrHeaders(
                uri,
                target.headers,
                localRequestHeaders,
                cookie,
            )
            val journalHeaders = headerLines.associate {
                it.substringBefore(':') to it.substringAfter(':').trim()
            }

            val transfer = start(currentUrl, target.method == "HEAD", headerLines, resolveEntry, caFile)
            val head = try {
                transfer.awaitHead(HEADER_TIMEOUT_SEC)
            } catch (error: IOException) {
                transfer.cancel()
                MediaProxyJournal.record(
                    phase = "media/curl",
                    method = target.method,
                    url = currentUrl,
                    requestHeaders = journalHeaders,
                    error = error.message,
                    localRequestHeaders = localRequestHeaders,
                )
                Log.w(TAG, "curl-impersonate échoue avant les en-têtes, repli : ${error.message}")
                return fallback.execute(target, localRequestHeaders)
            }

            head.fields
                .filter { it.first.equals("Set-Cookie", ignoreCase = true) }
                .mapNotNull { Cookie.parse(httpUrl, it.second) }
                .takeIf { it.isNotEmpty() }
                ?.let { MediaProxyCookieJar.saveFromResponse(httpUrl, it) }

            val responseHeaders = head.mergedHeaders()
            MediaProxyJournal.record(
                phase = "media/curl",
                method = target.method,
                url = currentUrl,
                requestHeaders = journalHeaders,
                statusCode = head.statusCode,
                responseHeaders = responseHeaders,
                localRequestHeaders = localRequestHeaders,
            )

            val location = head.header("Location")
            if (head.statusCode in 300..399 && location != null) {
                transfer.cancel()
                if (redirectCount >= MAX_REDIRECTS) {
                    throw IllegalStateException("Too many media redirects")
                }
                currentUrl = httpUrl.resolve(location)?.toString()
                    ?: throw IllegalArgumentException("Invalid media redirect")
                if (MediaProxyPolicy.isProviderDecoyUrl(currentUrl)) {
                    throw IllegalStateException("Upstream returned a decoy stream")
                }
                return@repeat
            }

            return MediaProxyUpstreamResponse(
                statusCode = head.statusCode,
                statusMessage = head.statusMessage,
                headers = if (target.method == "HEAD") {
                    responseHeaders
                } else {
                    decodedCurlResponseHeaders(responseHeaders)
                },
                body = transfer.body,
                finalUrl = currentUrl,
                onClose = transfer::cancel,
            )
        }
        throw IllegalStateException("Media redirect resolution failed")
    }

    override fun close() {
        closed = true
        transfers.shutdown()
        while (true) {
            val handle = idleHandles.poll() ?: break
            CurlImpersonate.nativeDestroy(handle)
        }
    }

    private fun start(
        url: String,
        head: Boolean,
        headerLines: List<String>,
        resolveEntry: String,
        caFile: String,
    ): CurlTransfer {
        val transfer = CurlTransfer()
        val network = boundNetwork?.networkHandle ?: 0L
        transfers.execute {
            val handle = idleHandles.poll() ?: CurlImpersonate.nativeCreate()
            try {
                transfer.run { callback ->
                    if (handle == 0L) {
                        CURLE_FAILED_INIT
                    } else {
                        CurlImpersonate.nativePerform(
                            handle = handle,
                            target = BrowserImpersonation.TARGET,
                            url = url,
                            head = head,
                            headers = headerLines.toTypedArray(),
                            resolve = arrayOf(resolveEntry),
                            acceptEncoding = BrowserImpersonation.ACCEPT_ENCODING,
                            caFile = caFile,
                            network = network,
                            connectTimeoutSec = CONNECT_TIMEOUT_SEC,
                            stallTimeoutSec = STALL_TIMEOUT_SEC,
                            callback = callback,
                        )
                    }
                }
            } finally {
                if (handle != 0L && (closed || !idleHandles.offer(handle))) {
                    CurlImpersonate.nativeDestroy(handle)
                }
            }
        }
        return transfer
    }

    private fun resolveEntry(host: String): String {
        val name = host.lowercase(Locale.US).trimEnd('.')
        val addresses = try {
            boundNetwork?.getAllByName(name)?.toList()
                ?: InetAddress.getAllByName(name).toList()
        } catch (error: Exception) {
            throw UnknownHostException("Media DNS failed").apply { initCause(error) }
        }
        if (addresses.isEmpty() || addresses.any(MediaProxyPolicy::isForbiddenAddress)) {
            throw UnknownHostException("Private or unresolved media host")
        }
        val literals = addresses.distinct().joinToString(",") { address ->
            val literal = requireNotNull(address.hostAddress).substringBefore('%')
            if (address is Inet6Address) "[$literal]" else literal
        }
        return "$name:443:$literals"
    }

    companion object {
        private const val TAG = "CurlMediaProxy"
        private const val MAX_REDIRECTS = 5
        private const val MAX_IDLE_HANDLES = 6
        private const val HEADER_TIMEOUT_SEC = 20L
        private const val CONNECT_TIMEOUT_SEC = 15
        // Équivalent du readTimeout d'OkHttp : abandon après 45 s sans un octet.
        private const val STALL_TIMEOUT_SEC = 45
        private const val CURLE_FAILED_INIT = 2
    }
}

/** libcurl décode lui-même les encodages annoncés dans ACCEPT_ENCODING. */
internal fun decodedCurlResponseHeaders(headers: Map<String, String>): Map<String, String> {
    val encodings = headers.entries
        .filter { it.key.equals("Content-Encoding", ignoreCase = true) }
        .flatMap { it.value.split(',') }
        .map { it.trim().lowercase(Locale.US) }
    val decoded = setOf("gzip", "x-gzip", "deflate", "br", "zstd", "identity")
    if (encodings.isEmpty() || encodings.any { it !in decoded }) return headers
    // Comme pour Cronet : la longueur annoncée est celle du corps compressé.
    return headers.filterKeys {
        !it.equals("Content-Encoding", ignoreCase = true) &&
            !it.equals("Content-Length", ignoreCase = true)
    }
}

internal class CurlResponseHead(
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

    fun mergedHeaders(): Map<String, String> {
        val merged = linkedMapOf<String, String>()
        for ((name, value) in fields) {
            merged.merge(name, value) { previous, next -> "$previous, $next" }
        }
        return merged
    }
}

/**
 * Assemble les lignes d'en-tête que libcurl remonte une à une. Les réponses
 * intermédiaires (100, 103) sont ignorées : seule la réponse finale compte.
 */
internal class CurlResponseHeadParser {
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
 * l'appelant, le corps passe par une file bornée vers un InputStream. Quand
 * la file est pleine, le thread curl attend, ce qui freine la lecture réseau.
 */
private class CurlTransfer : CurlTransferCallback {
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

    fun run(perform: (CurlTransferCallback) -> Int) {
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
        if (!headLatch.await(timeoutSec, TimeUnit.SECONDS)) {
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
                    throw IOException("Interrupted while reading media body")
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

    companion object {
        private const val QUEUE_CAPACITY = 32
        private const val OFFER_WAIT_MS = 250L
        private const val READ_WAIT_SEC = 1L
    }
}

/**
 * Ancres de confiance pour libcurl : BoringSSL ne lit pas le magasin Android.
 * On exporte les certificats système (ceux de network_security_config.xml)
 * en PEM, une fois par processus.
 */
internal object CurlCaBundle {
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
