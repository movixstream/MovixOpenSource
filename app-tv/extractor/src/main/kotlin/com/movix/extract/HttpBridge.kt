package com.movix.extract

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Requête émise par `GM_xmlhttpRequest`. */
class BridgeRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: ByteArray?,
    val timeoutMs: Long,
)

/** Réponse rendue au userscript. [headers] : en-têtes bruts, une ligne par en-tête. */
class BridgeResponse(
    val status: Int,
    val statusText: String,
    val headers: List<Pair<String, String>>,
    val finalUrl: String,
    val body: ByteArray,
) {
    val contentType: String? get() = headers.firstOrNull { it.first.equals("content-type", true) }?.second
}

/** Réseau de l'extraction. L'appli fournit Cronet ou OkHttp ; les tests, OkHttp. */
fun interface HttpBridge {
    suspend fun execute(request: BridgeRequest): BridgeResponse
}

/**
 * Pont OkHttp : suit les redirections (comme Tampermonkey), garde les
 * en-têtes de la requête d'un saut à l'autre et rend l'URL finale.
 */
class OkHttpBridge(
    private val client: OkHttpClient,
    private val defaultHeaders: (url: String, headers: Map<String, String>) -> Map<String, String> = { _, h -> h },
) : HttpBridge {
    override suspend fun execute(request: BridgeRequest): BridgeResponse {
        val headers = defaultHeaders(request.url, request.headers)
        val builder = Request.Builder().url(request.url)
        headers.forEach { (k, v) -> runCatching { builder.header(k, v) } }
        val method = request.method.uppercase()
        val needsBody = method in setOf("POST", "PUT", "PATCH", "DELETE")
        builder.method(method, if (needsBody || request.body != null) (request.body ?: ByteArray(0)).toRequestBody() else null)
        val call = client.newBuilder()
            .callTimeout(request.timeoutMs.coerceIn(1_000, 120_000), TimeUnit.MILLISECONDS)
            .build()
            .newCall(builder.build())
        val response = call.await()
        return response.use { r ->
            BridgeResponse(
                status = r.code,
                statusText = r.message,
                headers = r.headers.toPairs(),
                finalUrl = r.request.url.toString(),
                body = r.body.bytes(),
            )
        }
    }

    private fun Headers.toPairs(): List<Pair<String, String>> = (0 until size).map { name(it) to value(it) }
}

suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) { cont.resume(response) { _, _, _ -> response.close() } }
    })
    cont.invokeOnCancellation { runCatching { cancel() } }
}
