package com.movix.app.proxy

import android.util.Log

/**
 * Reçoit, sur le thread du transfert, ce que libcurl lit. Les noms sont lus
 * par JNI (src/main/cpp/movix_curl.c) : ne pas les renommer sans le C.
 */
internal interface CurlTransferCallback {
    fun onHeaderLine(line: ByteArray)

    /** `false` interrompt le transfert (lecteur parti, redirection suivie). */
    fun onBody(chunk: ByteArray, length: Int): Boolean

    fun shouldAbort(): Boolean

    fun onError(message: String)
}

/**
 * Liaison JNI vers libcurl-impersonate (lexiforest/curl-impersonate), la même
 * pile que curl_cffi dans le relais Python. Voir [ImpersonateMediaProxyUpstream].
 */
internal object CurlImpersonate {
    private const val TAG = "CurlImpersonate"

    /** Faux si la bibliothèque manque (ABI non fournie, tests JVM) : repli OkHttp. */
    val available: Boolean by lazy {
        runCatching { System.loadLibrary("movixcurl") }
            .onFailure { Log.w(TAG, "libcurl-impersonate indisponible : ${it.message}") }
            .isSuccess
    }

    fun errorText(code: Int): String =
        runCatching { nativeErrorText(code) }.getOrDefault("curl error $code")

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
