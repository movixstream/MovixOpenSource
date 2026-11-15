package com.movix.tv.data.imdb

import java.io.IOException
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Suggestions de la barre de recherche d'imdb.com (`v3.sg.media-imdb.com`),
 * sans clé : elles complètent le début d'un mot (« inter » → Interstellar) et
 * rangent par popularité, ce que la recherche TMDB ne fait pas. API non
 * officielle : en cas d'échec, la recherche se contente de TMDB.
 */
class ImdbSuggestions(
    private val http: OkHttpClient,
    private val json: Json,
    private val baseUrl: HttpUrl = "https://v3.sg.media-imdb.com/suggestion/x/".toHttpUrl(),
) {
    // Réponses récentes : effacer une lettre puis la retaper ne relance rien.
    private val cache = object : LinkedHashMap<String, List<String>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<String>>?) = size > 40
    }

    /** Identifiants IMDb (`tt…`) des films et séries proposés, les plus connus d'abord. */
    suspend fun titles(query: String): List<String> {
        val q = slug(query) ?: return emptyList()
        synchronized(cache) { cache[q] }?.let { return it }
        val url = baseUrl.newBuilder().addPathSegment("$q.json").addQueryParameter("includeVideos", "0").build()
        val body = withContext(Dispatchers.IO) {
            http.newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) throw IOException("IMDb ${res.code}")
                res.body.string()
            }
        }
        val ids = json.decodeFromString<Page>(body).d
            .filter { it.id.startsWith("tt") && it.qid in TITLE_KINDS }
            .map { it.id }
            .distinct()
        synchronized(cache) { cache[q] = ids }
        return ids
    }

    @Serializable
    private data class Page(val d: List<Entry> = emptyList())

    /** `qid` : sorte de titre ; absent pour une personne (`nm…`). */
    @Serializable
    private data class Entry(val id: String = "", val qid: String? = null)

    companion object {
        /** Films et séries ; pas les personnes, épisodes, courts métrages, jeux vidéo… */
        private val TITLE_KINDS = setOf("movie", "tvMovie", "tvSeries", "tvMiniSeries", "tvSpecial")

        /** Forme attendue par IMDb : minuscules, espaces simples. Moins de 2 caractères : rien. */
        fun slug(query: String): String? =
            query.trim().replace(SPACES, " ").lowercase(Locale.ROOT).take(60).takeIf { it.length >= 2 }

        private val SPACES = Regex("\\s+")
    }
}
