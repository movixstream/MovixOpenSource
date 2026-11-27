package com.movix.tv.data.anime

import com.movix.tv.data.tmdb.Episode
import com.movix.tv.data.tmdb.MediaType

/**
 * Œuvres d'anime-sama reliées aux titres TMDB, gardées quelques minutes :
 * la fiche, le lecteur et l'épisode suivant n'en redemandent pas la liste
 * (600 Ko pour One Piece).
 */
class AnimeWorks(private val api: AnimeApi) {
    private val cache = object : LinkedHashMap<String, Pair<Long, List<AnimeWork>>>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Long, List<AnimeWork>>>?) = size > 6
    }

    /** Œuvres reliées à ce titre ; liste vide si aucune ou si l'appel échoue (échec non gardé). */
    suspend fun byTmdb(type: MediaType, id: Int): List<AnimeWork> {
        val key = "${type.path}:$id"
        val now = System.currentTimeMillis()
        synchronized(cache) { cache[key] }?.takeIf { now - it.first < CACHE_MS }?.let { return it.second }
        val found = runCatching { api.byTmdb(type.path, id) }.getOrNull() ?: return emptyList()
        synchronized(cache) { cache[key] = now to found }
        return found
    }

    /**
     * Œuvre du mode anime d'une série, sans ses saisons vides, comme
     * `useTvAnime.ts` : la première œuvre reliée à l'ID TMDB. `null` si aucune.
     */
    suspend fun series(tvId: Int): AnimeWork? =
        byTmdb(MediaType.TV, tvId).firstNotNullOfOrNull { w ->
            w.copy(seasons = AnimeMode.seasons(w)).takeIf { it.seasons.isNotEmpty() && !it.slug.isNullOrBlank() }
        }

    private companion object {
        const val CACHE_MS = 20 * 60_000L
    }
}

/**
 * Mode anime des fiches série, comme sur le site (`TVDetails.tsx`,
 * `WatchAnime.tsx`) : les saisons et épisodes d'anime-sama remplacent ceux de
 * TMDB. Une saison porte son rang dans la liste de l'œuvre (1, 2…, saisons
 * vides retirées), un épisode son `index` d'anime-sama. La reprise
 * (`progress_tv_{id}_s{rang}_e{index}`) est donc la même que sur le site.
 */
object AnimeMode {
    /** Séries où le site ne propose jamais le mode anime (`ANIME_MODE_HIDDEN_IDS`). */
    private val HIDDEN = setOf(132123, 94954, 114478, 456, 2190, 45950, 45854, 79141, 2085, 78173, 110316, 105248)

    /** Séries ouvertes en mode standard, le mode anime restant au choix (`ANIME_MODE_DEFAULT_OFF_IDS`). */
    private val DEFAULT_OFF = setOf(94605, 92885, 291904, 271607, 132005)

    fun allowed(tvId: Int): Boolean = tvId !in HIDDEN
    fun onByDefault(tvId: Int): Boolean = tvId !in HIDDEN && tvId !in DEFAULT_OFF

    /** Saisons affichées, dans l'ordre du site : sans les saisons vides. */
    fun seasons(work: AnimeWork): List<AnimeSeason> = work.seasons.filter { it.episodes.isNotEmpty() }

    /** Saison de rang [rank] (1 = la première), ou `null`. */
    fun season(work: AnimeWork, rank: Int): AnimeSeason? = work.seasons.getOrNull(rank - 1)

    /** Épisode [index] de la saison de rang [rank] : par rang dans la liste, sinon par `index`, comme le lecteur du site. */
    fun episode(work: AnimeWork, rank: Int, index: Int): AnimeTarget? {
        val slug = work.slug?.takeIf { it.isNotBlank() } ?: return null
        val s = season(work, rank) ?: return null
        val e = s.episodes.firstOrNull { it.index == index } ?: s.episodes.getOrNull(index - 1) ?: return null
        return AnimeTarget(slug, s, e)
    }

    /**
     * Épisode à reprendre ([season]/[episode] lus dans la reprise, l'épisode
     * suivant quand le dernier est fini) : tel quel s'il existe ; après la fin
     * d'une saison, le premier épisode de la suivante ; sinon `null`.
     */
    fun resume(work: AnimeWork, season: Int, episode: Int): Pair<Int, Int>? {
        if (episode(work, season, episode) != null) return season to episode
        val current = season(work, season) ?: return null
        val last = current.episodes.maxOfOrNull { it.index } ?: return null
        if (episode <= last) return null
        val next = season(work, season + 1)?.episodes?.firstOrNull() ?: return null
        return season + 1 to next.index
    }

    /**
     * Épisodes d'une saison au format de la fiche : numéro = `index`, titre =
     * nom d'anime-sama (« Episode 62 »), résumé = versions proposées.
     */
    fun episodes(season: AnimeSeason): List<Episode> =
        season.episodes.mapIndexed { i, e ->
            Episode(
                number = e.index.takeIf { it > 0 } ?: (i + 1),
                title = e.name.ifBlank { "${e.index}" },
                overview = versions(e),
                stillPath = null,
                runtime = null,
            )
        }.distinctBy { it.number }

    /** « VOSTFR · VF » : versions de l'épisode, dans l'ordre du site. */
    fun versions(e: AnimeEpisode): String =
        e.links.map { l ->
            val raw = l.language.trim()
            val lang = AnimeSources.language(raw)
            raw.uppercase().takeIf { it.isNotEmpty() && it != lang.label } ?: lang.label ?: raw.uppercase()
        }.filter { it.isNotBlank() }.distinct().joinToString(" · ")
}
