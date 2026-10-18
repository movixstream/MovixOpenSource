package com.movix.tv.data.account

import com.movix.tv.data.local.ContinueEntry
import com.movix.tv.data.local.Library
import com.movix.tv.data.local.Progress
import com.movix.tv.data.local.WatchMeta
import com.movix.tv.data.tmdb.MediaType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/** Un élément de la rangée « Reprendre » du serveur (`GET /api/history/continue`). */
@Serializable
data class ServerContinueItem(
    val mediaType: String,
    val tmdbId: Int,
    val season: Int? = null,
    val episode: Int? = null,
    val position: Double = 0.0,
    val duration: Double = 0.0,
    val lastWatchedAt: String = "",
    val title: String? = null,
    val overview: String? = null,
    val posterPath: String? = null,
    val backdropPath: String? = null,
    /** Année en nombre (`Number(release_year)` côté serveur). */
    val year: Int? = null,
    val rating: Double? = null,
    val episodeName: String? = null,
    val episodeOverview: String? = null,
    val stillPath: String? = null,
)

@Serializable
internal data class ContinueResponse(val items: List<ServerContinueItem> = emptyList(), val complete: Boolean = false)

/**
 * Entrée de « Reprendre » avec la clé de [Library] (`progress_<id>`,
 * `progress_tv_<id>_s<s>_e<e>`) : reprise et bandeau marchent comme avec la
 * rangée locale. Fiche remplie depuis la réponse, sans appel TMDB.
 * `null` : type inconnu.
 */
fun ServerContinueItem.toContinueEntry(): ContinueEntry? {
    val type = when (mediaType) {
        "movie" -> MediaType.MOVIE
        "tv" -> MediaType.TV
        else -> return null
    }
    val season = if (type == MediaType.TV) season ?: 1 else null
    val episode = if (type == MediaType.TV) episode ?: 1 else null
    val key = if (type == MediaType.TV) Library.episodeProgressKey(tmdbId, season!!, episode!!) else Library.movieProgressKey(tmdbId)
    val meta = title?.let {
        WatchMeta(
            title = it,
            backdropPath = backdropPath ?: posterPath,
            episodeName = episodeName,
            // Résumé de l'épisode s'il existe, sinon celui de la série ou du film.
            overview = episodeOverview?.takeIf { o -> o.isNotBlank() } ?: overview,
            rating = rating,
            year = year?.toString(),
        )
    }
    return ContinueEntry(key, tmdbId, type, season, episode, Progress(position, duration, lastWatchedAt), meta)
}

/**
 * Rangée « Reprendre » lue sur la Main API (historique en base). Même style
 * que [AccountApi] : jeton de la télé, jamais d'`Origin` ni de `Referer`.
 */
class HistoryApi(private val client: OkHttpClient, private val json: Json, private val baseUrl: HttpUrl) {

    /**
     * Rangée du profil, la plus récente d'abord, sans limite. Les titres sans
     * infos TMDB (`title: null`) sont retirés.
     *
     * @throws SessionRevokedException session supprimée depuis le site (401).
     * @throws IOException serveur injoignable, route absente (pas encore
     *   déployée) ou liste incomplète (`complete: false`) : la télé garde sa
     *   rangée locale.
     */
    suspend fun continueWatching(token: String, profileId: String, language: String): List<ServerContinueItem> = withContext(Dispatchers.IO) {
        val url = baseUrl.newBuilder().addPathSegments("api/history/continue")
            .addQueryParameter("profileId", profileId)
            .addQueryParameter("language", language)
            .build()
        val req = Request.Builder().url(url).header("Authorization", "Bearer $token").build()
        client.newCall(req).execute().use { res ->
            if (res.code == 401) throw SessionRevokedException()
            if (!res.isSuccessful) throw IOException("history continue ${res.code}")
            val body = json.decodeFromString(ContinueResponse.serializer(), res.body.string())
            if (!body.complete) throw IOException("history continue incomplète")
            body.items.filter { !it.title.isNullOrBlank() }
        }
    }

    companion object {
        /** Langue de l'appli (« fr », « en ») vers celle de TMDB acceptée par le serveur. */
        fun tmdbLanguage(uiLanguage: String): String = if (uiLanguage == "en") "en-US" else "fr-FR"
    }
}
