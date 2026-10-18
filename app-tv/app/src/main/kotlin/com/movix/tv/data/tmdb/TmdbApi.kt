package com.movix.tv.data.tmdb

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

class TmdbException(val code: Int, message: String) : Exception(message)

/** Clé absente : l'écran propose d'ouvrir les réglages au lieu d'afficher une erreur. */
class MissingTmdbKeyException : Exception("Clé TMDB absente")

/**
 * Client TMDB v3, en direct (sans proxy Movix), comme l'ancienne appli TV.
 * `keyProvider` est relu à chaque appel : une clé saisie dans les réglages
 * sert tout de suite, sans redémarrer.
 */
class TmdbApi(
    private val client: OkHttpClient,
    private val json: Json,
    private val keyProvider: () -> String?,
    private val baseUrl: HttpUrl = "https://api.themoviedb.org/3/".toHttpUrl(),
    private val language: String = "fr-FR",
) {
    suspend fun list(path: String, params: Map<String, String>, page: Int = 1): TmdbPage =
        get(path, params + mapOf("page" to page.toString(), "include_adult" to (params["include_adult"] ?: "false")))

    suspend fun details(type: MediaType, id: Int): TmdbDetails {
        val extra = if (type == MediaType.TV) "content_ratings" else "release_dates"
        return get(
            "/${type.path}/$id",
            mapOf("append_to_response" to "videos,external_ids,credits,recommendations,similar,$extra", "include_video_language" to "fr,en,null"),
        )
    }

    suspend fun season(tvId: Int, season: Int): TmdbSeason = get("/tv/$tvId/season/$season", emptyMap())

    suspend fun search(query: String): List<TmdbItem> =
        get<TmdbPage>("/search/multi", mapOf("query" to query, "include_adult" to "false"))
            .results.filter { it.mediaType == "movie" || it.mediaType == "tv" }

    /** `true` si TMDB accepte la clé (HTTP 200 sur /configuration). */
    suspend fun validateKey(key: String): Boolean = withContext(Dispatchers.IO) {
        val url = baseUrl.newBuilder().addPathSegments("configuration").addQueryParameter("api_key", key).build()
        client.newCall(Request.Builder().url(url).build()).execute().use { it.code == 200 }
    }

    private suspend inline fun <reified T> get(path: String, params: Map<String, String>): T {
        val key = keyProvider()?.takeIf { it.isNotBlank() } ?: throw MissingTmdbKeyException()
        val url = baseUrl.newBuilder().apply {
            addPathSegments(path.trimStart('/'))
            addQueryParameter("api_key", key)
            addQueryParameter("language", language)
            params.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()
        val body = withContext(Dispatchers.IO) {
            client.newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) throw TmdbException(res.code, "TMDB ${res.code} sur $path")
                res.body.string()
            }
        }
        return json.decodeFromString(body)
    }
}
