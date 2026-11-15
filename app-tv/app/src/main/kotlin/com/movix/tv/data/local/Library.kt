package com.movix.tv.data.local

import androidx.compose.runtime.Immutable
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.MediaType
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant

// Formats du site, à l'identique (voir docs/backend-compte.md).

@Serializable
data class Progress(val position: Double, val duration: Double, val timestamp: String)

@Serializable
data class WatchlistEntry(
    val id: Int,
    val type: String,
    val title: String = "",
    val poster_path: String? = null,
    val addedAt: String = "",
)

@Serializable
data class WatchMeta(
    val title: String,
    val backdropPath: String? = null,
    val episodeName: String? = null,
    /** Résumé de l'épisode (série) ou du film, pour le bandeau de « Reprendre ». */
    val overview: String? = null,
    val rating: Double? = null,
    val year: String? = null,
)

@Immutable
data class ContinueEntry(
    val key: String,
    val id: Int,
    val type: MediaType,
    val season: Int?,
    val episode: Int?,
    val progress: Progress,
    val meta: WatchMeta?,
) {
    val ratio: Float get() = if (progress.duration > 0) (progress.position / progress.duration).toFloat() else 0f
    val remainingSeconds: Int get() = (progress.duration - progress.position).toInt().coerceAtLeast(0)
}

/**
 * Lecture et écriture de la bibliothèque locale. Fonctions pures sur la carte
 * de [LocalStore] : testables sans Android.
 */
object Library {
    const val MIN_SECONDS = 30.0
    const val FINISHED_RATIO = 0.95

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val tvKey = Regex("""^progress_tv_(\d+)_s(\d+)_e(\d+)$""")
    private val movieKey = Regex("""^progress_(\d+)$""")

    fun movieProgressKey(id: Int) = "progress_$id"
    fun episodeProgressKey(id: Int, season: Int, episode: Int) = "progress_tv_${id}_s${season}_e$episode"
    fun watchlistKey(type: MediaType) = "watchlist_${type.path}"
    fun watchedEpisodesKey(tvId: Int) = "watched_episodes_tv_$tvId"

    fun progress(values: Map<String, String>, key: String): Progress? =
        values[key]?.let { runCatching { json.decodeFromString<Progress>(it) }.getOrNull() }

    /**
     * Valeur à écrire pour une position donnée, ou `null` pour ne rien écrire :
     * rien avant 30 s de lecture ni dans les 30 dernières secondes (même règle que le site).
     */
    fun encodeProgress(position: Double, duration: Double, now: Instant = Instant.now()): String? {
        if (position < MIN_SECONDS || duration <= 0 || duration - position < MIN_SECONDS) return null
        return json.encodeToString(Progress.serializer(), Progress(position, duration, now.toString()))
    }

    fun isFinished(p: Progress) = p.duration > 0 && p.position / p.duration >= FINISHED_RATIO

    /**
     * Valeur à écrire quand la lecture s'arrête à [position] : la progression
     * normale, ou un titre « fini » (position = durée) passé 95 %, pour que la
     * fiche propose l'épisode suivant. `null` : rien à écrire (moins de 30 s vues).
     */
    fun progressOnStop(position: Double, duration: Double, now: Instant = Instant.now()): String? {
        if (duration > 0 && position / duration >= FINISHED_RATIO) {
            return json.encodeToString(Progress.serializer(), Progress(duration, duration, now.toString()))
        }
        return encodeProgress(position, duration, now)
    }

    /** Nouvelle valeur de `watched_episodes_tv_<id>` avec l'épisode marqué vu. */
    fun markWatched(values: Map<String, String>, tvId: Int, season: Int, episode: Int): String {
        val current = values[watchedEpisodesKey(tvId)]?.let {
            runCatching { json.decodeFromString<Map<String, Boolean>>(it) }.getOrNull()
        }.orEmpty()
        return json.encodeToString<Map<String, Boolean>>(current + ("S${season}E$episode" to true))
    }

    /** Assez pour une rangée « Reprendre » locale sans limite. */
    const val WATCH_META_MAX = 400

    /**
     * Nouvelle valeur de `TvKeys.WATCH_META` avec [meta] pour [key]. Au-delà de
     * 400 fiches, la plus ancienne qui n'est pas dans [keep] (clés de la rangée
     * « Reprendre » affichée) saute d'abord ; si toutes y sont, la plus ancienne.
     * [key] elle-même n'est jamais évincée.
     */
    fun putWatchMeta(values: Map<String, String>, key: String, meta: WatchMeta, keep: Set<String> = emptySet()): String {
        val current = LinkedHashMap(watchMeta(values))
        current.remove(key)
        current[key] = meta
        while (current.size > WATCH_META_MAX) {
            val victim = current.keys.firstOrNull { it != key && it !in keep }
                ?: current.keys.first { it != key }
            current.remove(victim)
        }
        return json.encodeToString<Map<String, WatchMeta>>(current)
    }

    /** Clé de la liste « Reprendre » du site, synchronisée : `{movies:[{id,lastAccessed}], tv:[{id,currentEpisode:{season,episode},lastAccessed}]}`. */
    const val CONTINUE_KEY = "continueWatching"

    /** Une entrée de la liste du site (les plus anciens films n'y sont qu'un nombre). */
    private data class SiteEntry(val type: MediaType, val id: Int, val season: Int?, val episode: Int?, val lastAccessed: String)

    private fun siteList(values: Map<String, String>): List<SiteEntry> {
        val root = values[CONTINUE_KEY]?.let { runCatching { json.parseToJsonElement(it) }.getOrNull() } as? kotlinx.serialization.json.JsonObject
            ?: return emptyList()
        fun str(o: kotlinx.serialization.json.JsonObject, k: String) = (o[k] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNullSafe()
        fun int(o: kotlinx.serialization.json.JsonObject?, k: String) = o?.let { str(it, k)?.toIntOrNull() }
        val movies = (root["movies"] as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull { e ->
            when (e) {
                is kotlinx.serialization.json.JsonPrimitive -> e.contentOrNullSafe()?.toIntOrNull()?.let { SiteEntry(MediaType.MOVIE, it, null, null, "") }
                is kotlinx.serialization.json.JsonObject -> int(e, "id")?.let { SiteEntry(MediaType.MOVIE, it, null, null, str(e, "lastAccessed").orEmpty()) }
                else -> null
            }
        }
        val shows = (root["tv"] as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull { e ->
            val o = e as? kotlinx.serialization.json.JsonObject ?: return@mapNotNull null
            val ep = o["currentEpisode"] as? kotlinx.serialization.json.JsonObject
            int(o, "id")?.let { SiteEntry(MediaType.TV, it, int(ep, "season"), int(ep, "episode"), str(o, "lastAccessed").orEmpty()) }
        }
        return movies + shows
    }

    private fun kotlinx.serialization.json.JsonPrimitive.contentOrNullSafe(): String? = if (this is kotlinx.serialization.json.JsonNull) null else content

    /**
     * Rangée « Reprendre » locale (repli quand le serveur ne répond pas ou
     * sans compte), avec les règles du serveur : la liste `continueWatching`
     * (titres ouverts, épisode en cours de chaque série) et toutes les
     * progressions, sans durée minimum ni limite. Un seul épisode par série,
     * la plus récente d'abord (dernier accès ou dernière position). Film fini
     * (≥ 95 %) : absent. Épisode fini : l'entrée passe à l'épisode suivant de
     * la même saison (le serveur gère le changement de saison).
     */
    fun continueWatching(values: Map<String, String>): List<ContinueEntry> {
        val meta = watchMeta(values)
        val best = LinkedHashMap<String, Pair<ContinueEntry, String>>()
        fun offer(e: ContinueEntry, recency: String) {
            val k = "${e.type.path}:${e.id}"
            val cur = best[k]
            if (cur == null || recency > cur.second) best[k] = e to recency
        }
        // Épisode [s]/[e] de [id], ou le suivant s'il est fini ; [recency] reste
        // celle de l'épisode regardé.
        fun offerEpisode(id: Int, s: Int, e: Int, p: Progress?, recency: String) {
            if (p != null && isFinished(p)) {
                val next = episodeProgressKey(id, s, e + 1)
                offer(ContinueEntry(next, id, MediaType.TV, s, e + 1, progress(values, next) ?: Progress(0.0, 0.0, recency), meta[next]), recency)
            } else {
                val key = episodeProgressKey(id, s, e)
                // Sans progression connue : barre vide, l'entrée reste (le site l'affiche aussi).
                offer(ContinueEntry(key, id, MediaType.TV, s, e, p ?: Progress(0.0, 0.0, recency), meta[key]), recency)
            }
        }
        values.forEach { (key, raw) ->
            if (!key.startsWith("progress_")) return@forEach
            val p = runCatching { json.decodeFromString<Progress>(raw) }.getOrNull() ?: return@forEach
            tvKey.matchEntire(key)?.let { m ->
                val (id, s, e) = m.destructured
                offerEpisode(id.toInt(), s.toInt(), e.toInt(), p, p.timestamp)
                return@forEach
            }
            movieKey.matchEntire(key)?.let { m ->
                if (!isFinished(p)) offer(ContinueEntry(key, m.groupValues[1].toInt(), MediaType.MOVIE, null, null, p, meta[key]), p.timestamp)
            }
        }
        for (s in siteList(values)) {
            if (s.type == MediaType.TV) {
                val season = s.season ?: 1
                val episode = s.episode ?: 1
                val p = progress(values, episodeProgressKey(s.id, season, episode))
                offerEpisode(s.id, season, episode, p, maxOf(s.lastAccessed, p?.timestamp.orEmpty()))
                continue
            }
            val key = movieProgressKey(s.id)
            val p = progress(values, key)
            if (p != null && isFinished(p)) continue
            val recency = maxOf(s.lastAccessed, p?.timestamp.orEmpty())
            offer(ContinueEntry(key, s.id, s.type, null, null, p ?: Progress(0.0, 0.0, recency), meta[key]), recency)
        }
        return best.values.sortedByDescending { it.second }.map { it.first }
    }

    /**
     * Rangée du serveur corrigée par les positions locales : juste après une
     * lecture, la télé connaît la position avant que la synchro ne l'ait
     * envoyée et que la rangée ne soit relue (jusqu'à 30 s). Une progression
     * locale plus récente que celle du serveur remplace la sienne ; un film que
     * la télé sait fini (≥ 95 %) est retiré. Ordre et fiches du serveur gardés.
     */
    fun overlayLocal(server: List<ContinueEntry>, values: Map<String, String>): List<ContinueEntry> =
        server.mapNotNull { e ->
            val local = progress(values, e.key) ?: return@mapNotNull e
            val localAt = instantOrNull(local.timestamp) ?: return@mapNotNull e
            val serverAt = instantOrNull(e.progress.timestamp)
            if (serverAt != null && !localAt.isAfter(serverAt)) return@mapNotNull e
            if (e.type == MediaType.MOVIE && isFinished(local)) null else e.copy(progress = local)
        }

    // Le serveur écrit des millisecondes (`.000Z`), la télé non : comparer des instants, pas des chaînes.
    private fun instantOrNull(s: String): Instant? = runCatching { Instant.parse(s) }.getOrNull()

    /**
     * Nouvelle valeur de `continueWatching` après l'ouverture de [type]/[id]
     * (et de l'épisode [season]/[episode]) sur la télé : même format que le
     * site, entrée remontée en tête avec `lastAccessed` à [now]. Les champs
     * inconnus des autres entrées sont gardés.
     */
    fun touchContinue(values: Map<String, String>, type: MediaType, id: Int, season: Int?, episode: Int?, now: Instant = Instant.now()): String {
        val root = (values[CONTINUE_KEY]?.let { runCatching { json.parseToJsonElement(it) }.getOrNull() } as? kotlinx.serialization.json.JsonObject)
            ?: kotlinx.serialization.json.JsonObject(emptyMap())
        fun idOf(e: kotlinx.serialization.json.JsonElement): Int? = when (e) {
            is kotlinx.serialization.json.JsonObject -> (e["id"] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNullSafe()?.toIntOrNull()
            is kotlinx.serialization.json.JsonPrimitive -> e.contentOrNullSafe()?.toIntOrNull()
            else -> null
        }
        val field = if (type == MediaType.TV) "tv" else "movies"
        val rest = (root[field] as? kotlinx.serialization.json.JsonArray).orEmpty().filter { idOf(it) != id }
        val entry = kotlinx.serialization.json.buildJsonObject {
            put("id", kotlinx.serialization.json.JsonPrimitive(id))
            if (type == MediaType.TV) put("currentEpisode", kotlinx.serialization.json.buildJsonObject {
                put("season", kotlinx.serialization.json.JsonPrimitive(season ?: 1))
                put("episode", kotlinx.serialization.json.JsonPrimitive(episode ?: 1))
            })
            put("lastAccessed", kotlinx.serialization.json.JsonPrimitive(now.toString()))
        }
        val other = if (type == MediaType.TV) "movies" else "tv"
        return kotlinx.serialization.json.JsonObject(
            root + mapOf(
                field to kotlinx.serialization.json.JsonArray(listOf(entry) + rest),
                other to (root[other] ?: kotlinx.serialization.json.JsonArray(emptyList())),
            ),
        ).toString()
    }

    fun watchMeta(values: Map<String, String>): Map<String, WatchMeta> =
        values[TvKeys.WATCH_META]?.let {
            runCatching { json.decodeFromString<Map<String, WatchMeta>>(it) }.getOrNull()
        } ?: emptyMap()

    fun watchlist(values: Map<String, String>, type: MediaType): List<WatchlistEntry> =
        values[watchlistKey(type)]?.let {
            runCatching { json.decodeFromString<List<WatchlistEntry>>(it) }.getOrNull()
        } ?: emptyList()

    fun isInWatchlist(values: Map<String, String>, item: MediaItem) =
        watchlist(values, item.type).any { it.id == item.id }

    /** Nouvelle valeur de `watchlist_<type>` après ajout ou retrait de [item]. */
    fun toggleWatchlist(values: Map<String, String>, item: MediaItem, now: Instant = Instant.now()): String {
        val current = watchlist(values, item.type)
        val next = if (current.any { it.id == item.id }) current.filterNot { it.id == item.id }
        else listOf(WatchlistEntry(item.id, item.type.path, item.title, item.posterPath, now.toString())) + current
        return json.encodeToString(kotlinx.serialization.builtins.ListSerializer(WatchlistEntry.serializer()), next)
    }

    fun watchedEpisodes(values: Map<String, String>, tvId: Int): Set<String> =
        values[watchedEpisodesKey(tvId)]?.let {
            runCatching { json.decodeFromString<Map<String, Boolean>>(it) }.getOrNull()
        }?.filterValues { it }?.keys ?: emptySet()

    /**
     * Épisode à proposer sur la fiche d'une série : le plus récent commencé s'il
     * n'est pas fini, le suivant s'il l'est, sinon `null` (on propose le début).
     */
    fun resumeEpisode(values: Map<String, String>, tvId: Int): Pair<Int, Int>? {
        val prefix = "progress_tv_${tvId}_"
        val last = values.keys.filter { it.startsWith(prefix) }
            .mapNotNull { key -> tvKey.matchEntire(key)?.let { m -> m to progress(values, key) } }
            .filter { it.second != null }
            .maxByOrNull { it.second!!.timestamp } ?: return null
        val (_, s, e) = last.first.destructured
        val p = last.second!!
        return if (isFinished(p)) s.toInt() to e.toInt() + 1 else s.toInt() to e.toInt()
    }
}
