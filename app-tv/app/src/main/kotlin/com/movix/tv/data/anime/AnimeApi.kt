package com.movix.tv.data.anime

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** Lecteurs d'un épisode dans une langue (`vostfr`, `vf`, `va`…). */
@Serializable
data class AnimeLinks(
    val language: String = "",
    val players: List<String> = emptyList(),
    /** Lecteurs dont l'adresse reste à demander au serveur (`/anime/episode`). */
    val pending: Int = 0,
)

@Serializable
data class AnimeEpisode(
    val name: String = "",
    /** Rang de l'épisode sur anime-sama (1, 2…), à renvoyer à `/anime/episode`. */
    val index: Int = 0,
    @kotlinx.serialization.SerialName("streaming_links") val links: List<AnimeLinks> = emptyList(),
)

@Serializable
data class AnimeSeason(
    val name: String = "",
    /** Chemin de la saison sur anime-sama (`saison1`, `saison2-2`, `film`, `oav`…). */
    val path: String = "",
    val episodes: List<AnimeEpisode> = emptyList(),
)

/** Une œuvre d'anime-sama, telle que la rend `/anime/tmdb/{type}/{id}`. */
@Serializable
data class AnimeWork(
    val name: String = "",
    val slug: String? = null,
    val seasons: List<AnimeSeason> = emptyList(),
)

/** Adresses des lecteurs d'un épisode (`/anime/episode/{slug}`), avec les flux du serveur pour un VIP. */
@Serializable
data class AnimeEpisodeLinks(
    @kotlinx.serialization.SerialName("streaming_links") val links: List<AnimeLinks> = emptyList(),
    /** Lecteur → m3u8 signé du relais Movix (`?resolve=1` avec une clé VIP). */
    val m3u8ByPlayer: Map<String, String> = emptyMap(),
)

@Serializable
data class AnimeTmdbRef(val type: String = "", val id: Int = 0)

/** Œuvre du catalogue d'anime-sama (`/anime/catalogue`). */
@Serializable
data class AnimeCatalogueItem(
    val slug: String = "",
    val name: String = "",
    val posterPath: String? = null,
    val tmdb: AnimeTmdbRef? = null,
    val year: Int? = null,
    val languages: List<String> = emptyList(),
)

@Serializable
data class AnimeCataloguePage(
    val page: Int = 1,
    val totalPages: Int = 0,
    val items: List<AnimeCatalogueItem> = emptyList(),
)

/**
 * Routes `/anime` de la Main API (`API/Mainapi/routes/animeSama.js`). Même
 * règle que [com.movix.tv.data.movix.MovixApi] : jamais d'`Origin` ni de `Referer`.
 */
class AnimeApi(
    private val client: OkHttpClient,
    private val json: Json,
    private val baseUrl: HttpUrl,
) {
    // Une œuvre jamais lue par le serveur : il attend jusqu'à 12 s sa première lecture.
    private val slowClient: OkHttpClient by lazy {
        client.newBuilder().readTimeout(30, TimeUnit.SECONDS).callTimeout(35, TimeUnit.SECONDS).build()
    }

    /** Œuvres d'anime-sama reliées à ce titre TMDB ; liste vide si aucune. */
    suspend fun byTmdb(type: String, id: Int): List<AnimeWork> =
        get(slowClient, url("anime/tmdb/$type/$id")) ?: emptyList()

    /**
     * Adresses des lecteurs d'un épisode ([seasonPath] = `path` de la saison,
     * [index] = `index` de l'épisode). [vipKey] demande en plus les flux
     * extraits par le serveur. `null` si l'épisode est inconnu ou l'appel échoue.
     */
    suspend fun episode(slug: String, seasonPath: String, index: Int, vipKey: String?): AnimeEpisodeLinks? {
        val u = url("anime/episode").newBuilder().addPathSegment(slug).apply {
            addQueryParameter("season", seasonPath)
            addQueryParameter("episode", index.toString())
            if (vipKey != null) addQueryParameter("resolve", "1")
        }.build()
        return get(slowClient, u, vipKey)
    }

    /** Page du catalogue (œuvres reliées à TMDB seulement). Lève une exception si l'appel échoue. */
    suspend fun catalogue(params: Map<String, String>, page: Int, limit: Int = 40): AnimeCataloguePage {
        val u = url("anime/catalogue").newBuilder().apply {
            params.forEach { (k, v) -> addQueryParameter(k, v) }
            addQueryParameter("linked", "1")
            addQueryParameter("page", page.toString())
            addQueryParameter("limit", limit.toString())
        }.build()
        return get(client, u) ?: throw java.io.IOException("catalogue anime illisible")
    }

    private suspend inline fun <reified T> get(http: OkHttpClient, u: HttpUrl, vipKey: String? = null): T? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(u).apply { if (vipKey != null) header("x-access-key", vipKey) }.build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return@withContext null
            runCatching { json.decodeFromString<T>(res.body.string()) }.getOrNull()
        }
    }

    private fun url(path: String): HttpUrl = baseUrl.newBuilder().addPathSegments(path).build()
}
