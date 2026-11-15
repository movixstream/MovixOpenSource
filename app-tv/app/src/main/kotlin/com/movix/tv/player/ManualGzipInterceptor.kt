package com.movix.tv.player

import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.ResponseBody.Companion.asResponseBody
import okio.GzipSource
import okio.buffer

/**
 * OkHttp ne décompresse que ce qu'il a demandé lui-même : dès que l'appelant
 * fixe Accept-Encoding (celui de Chrome pour Fsvid/Vidzy, voir
 * [MediaHeaders.CHROME_ACCEPT_ENCODING]), le corps gzip arrive tel quel et
 * le lecteur ne sait pas lire la playlist. On le décode ici.
 */
object ManualGzipInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)
        if (request.header("Accept-Encoding") == null) return response
        val encoding = response.header("Content-Encoding")?.trim()?.lowercase()
        if (encoding != "gzip" && encoding != "x-gzip") return response
        val body = response.body ?: return response
        if (request.method == "HEAD" || response.code == 204 || response.code == 304) return response
        return response.newBuilder()
            .removeHeader("Content-Encoding")
            .removeHeader("Content-Length")
            .body(GzipSource(body.source()).buffer().asResponseBody(body.contentType(), -1L))
            .build()
    }
}
