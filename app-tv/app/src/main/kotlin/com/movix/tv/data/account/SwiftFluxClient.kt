package com.movix.tv.data.account

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Fichier MP4 SwiftFlux rendu par le serveur. L'URL expire : jamais mise en cache. */
data class SwiftFluxFile(val url: String, val quality: String?, val label: String?, val language: String?)

/**
 * URL des fichiers SwiftFlux pour l'appli télé : route ouverte de la Main API,
 * sans captcha, sans compte (seule une limite par IP côté serveur).
 */
class SwiftFluxClient(
    private val client: OkHttpClient,
    private val json: Json,
    private val baseUrl: HttpUrl,
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    /**
     * URL du fichier [index] d'un film ([season] null) ou d'un épisode, ou
     * `null` si le serveur refuse ou ne répond pas.
     */
    suspend fun resolve(tmdbId: Int, season: Int?, episode: Int?, index: Int): SwiftFluxFile? = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("kind", if (season == null) "movie" else "tv")
            put("tmdbId", tmdbId)
            if (season != null) put("season", season)
            if (episode != null) put("episode", episode)
            put("index", index)
        }
        val req = Request.Builder()
            .url(baseUrl.newBuilder().addPathSegments(PATH).build())
            .post(body.toString().toRequestBody(jsonType))
            .build()
        runCatching {
            client.newCall(req).execute().use { res ->
                val root = runCatching { json.parseToJsonElement(res.body.string()) as? JsonObject }.getOrNull()
                fun str(k: String) = (root?.get(k) as? JsonPrimitive)?.contentOrNull
                if (!res.isSuccessful) {
                    Log.w("MovixSwiftFlux", "refus ${res.code} ${str("error")}")
                    return@use null
                }
                str("url")?.takeIf { it.startsWith("http") }?.let { SwiftFluxFile(it, str("quality"), str("label"), str("language")) }
            }
        }.onFailure { Log.w("MovixSwiftFlux", "resolve : ${it.javaClass.simpleName}") }.getOrNull()
    }

    companion object {
        const val PATH = "api/swiftflow/tv/mp4/resolve"
    }
}
