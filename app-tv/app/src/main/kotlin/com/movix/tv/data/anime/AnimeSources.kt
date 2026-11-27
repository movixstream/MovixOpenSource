package com.movix.tv.data.anime

import android.util.Log
import com.movix.tv.data.movix.Lang
import com.movix.tv.data.movix.PlayRequest
import com.movix.tv.data.movix.PlaybackSource
import com.movix.tv.data.movix.Provider
import com.movix.tv.data.movix.SourceParsers
import com.movix.tv.data.tmdb.MediaType
import com.movix.tv.player.MediaHeaders

/** Ce que la télé sait du titre TMDB : un anime possible, et la taille de ses saisons. */
data class AnimeHint(val animation: Boolean, val episodeCounts: Map<Int, Int>)

/**
 * Sources anime-sama d'un film ou d'un épisode TMDB, comme la page de lecture
 * anime du site (`WatchAnime.tsx`) : l'œuvre reliée à l'ID TMDB par l'index
 * du serveur, l'épisode retrouvé par [AnimeMatch], puis ses lecteurs demandés
 * à `/anime/episode` (adresses à jour, flux extraits pour un VIP).
 *
 * Seuls les titres d'animation sont demandés ([hint]) : inutile d'interroger
 * le serveur pour un film en prises de vue réelles.
 */
class AnimeSources(
    private val works: AnimeWorks,
    private val api: AnimeApi,
    private val hint: suspend (MediaType, Int) -> AnimeHint?,
) {
    suspend fun load(req: PlayRequest, vipKey: String?): List<PlaybackSource> {
        val target = target(req) ?: return emptyList()
        runCatching { Log.i("MovixSources", "anime-sama : ${target.slug} ${target.season.path} n°${target.episode.index} (${target.episode.name})") }
        val fresh = runCatching { api.episode(target.slug, target.season.path, target.episode.index, vipKey) }.getOrNull()
        return sources(fresh?.links?.takeIf { l -> l.any { it.players.isNotEmpty() } } ?: target.episode.links, fresh?.m3u8ByPlayer.orEmpty())
    }

    /**
     * Épisode d'anime-sama demandé : en mode anime, la saison de ce rang et
     * l'épisode de cet index ; sinon l'épisode TMDB retrouvé par [AnimeMatch].
     */
    private suspend fun target(req: PlayRequest): AnimeTarget? {
        if (req.isAnimeMode) {
            val work = works.series(req.tmdbId) ?: return null
            return AnimeMode.episode(work, req.season ?: 1, req.episode ?: 1)
        }
        val h = runCatching { hint(req.type, req.tmdbId) }.getOrNull() ?: return null
        if (!h.animation) return null
        return works.byTmdb(req.type, req.tmdbId).firstNotNullOfOrNull { work ->
            if (req.isTv) AnimeMatch.episode(work, h.episodeCounts, req.season ?: 1, req.episode ?: 1) else AnimeMatch.movie(work)
        }
    }

    companion object {
        /** Site d'où viennent les lecteurs (`ANIME_SAMA_URL` de la Main API). */
        const val SITE_REFERER = "https://anime-sama.to/"

        /** `vostfr` → VOSTFR ; `vf`, `vf1`, `vf2`, `vqc` → VF ; les autres doublages (`va`, `vkr`…) → VO. */
        fun language(raw: String): Lang {
            val s = raw.trim().lowercase()
            return when {
                s.startsWith("vostfr") -> Lang.VOSTFR
                s.startsWith("vf") || s == "vqc" -> Lang.VF
                else -> Lang.VO
            }
        }

        /** Lecteurs d'un épisode, avec le flux du serveur quand il l'a extrait (VIP). */
        fun sources(links: List<AnimeLinks>, m3u8ByPlayer: Map<String, String>): List<PlaybackSource> =
            links.flatMap { l ->
                val lang = language(l.language)
                // « VF2 », « VA »… gardés tels quels, comme sur le site ; « VF » et « VOSTFR » restent ceux de [lang].
                val tag = l.language.trim().uppercase().takeIf { it.isNotEmpty() && it != lang.label }
                l.players.filter { it.startsWith("http") }.map { url ->
                    val host = SourceParsers.hoster(url)
                    val name = host?.let(SourceParsers::hosterLabel)
                        ?: MediaHeaders.hostnameOf(url)?.removePrefix("www.") ?: "Lecteur"
                    val m3u8 = m3u8ByPlayer[url]?.takeIf { it.startsWith("http") }
                    PlaybackSource(
                        provider = Provider.ANIME,
                        label = listOfNotNull(name, tag ?: lang.label).joinToString(" "),
                        language = lang,
                        langTag = tag,
                        pageReferer = SITE_REFERER,
                        host = host,
                        embedUrl = url,
                        streamUrl = m3u8,
                        kind = m3u8?.let { SourceParsers.kindFor(it, host) } ?: com.movix.tv.data.movix.StreamKind.HLS,
                    )
                }
            }.distinctBy { it.embedUrl }
    }
}
