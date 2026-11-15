package com.movix.tv.data.movix

import android.util.Log
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Interroge en parallèle toutes les routes de sources de la Main API et rend
 * la liste brute des sources. Une route absente, en erreur ou trop lente
 * donne simplement zéro source. Les fichiers SwiftFlux ne s'obtiennent que
 * par la route signée des télés reliées.
 */
class SourceRepository(private val api: MovixApi, private val json: Json) {

    /** Une route : chemin, paramètres, `resolve` demandé, parseur. */
    internal class Route(
        val provider: Provider,
        val path: String,
        val query: Map<String, String> = emptyMap(),
        val resolve: Boolean = true,
        val parse: (JsonElement?) -> List<PlaybackSource>,
    )

    /** Les routes à appeler pour [req], d'après le contrat relevé dans le code du site TV. */
    internal fun routes(req: PlayRequest): List<Route> {
        val id = req.tmdbId
        if (!req.isTv) {
            return listOfNotNull(
                Route(Provider.LINKS, "api/links/movie/$id", parse = SourceParsers::links),
                Route(Provider.COFLIX, "api/tmdb/movie/$id", parse = SourceParsers::coflix),
                req.imdbId?.let { Route(Provider.OMEGA, "api/imdb/movie/$it", parse = SourceParsers::omega) },
                Route(Provider.PURSTREAM, "api/purstream/movie/$id/stream", resolve = false, parse = SourceParsers::purstream),
                Route(Provider.FSTREAM, "api/fstream/movie/$id") { SourceParsers.fstream(it, null) },
                Route(Provider.WIFLIX, "api/wiflix/movie/$id") { SourceParsers.vfVostfr(Provider.WIFLIX, it, null) },
                Route(Provider.J1F, "api/j1f/movie/$id") { SourceParsers.vfVostfr(Provider.J1F, it, null) },
                Route(Provider.SWIFTFLOW, "api/swiftflow/movie/$id") { SourceParsers.vfVostfr(Provider.SWIFTFLOW, it, null) + SourceParsers.swiftfluxEntries(it) },
                Route(Provider.VIPER, "api/cpasmal/movie/$id") { SourceParsers.viper(it) },
                Route(Provider.KISSKH, "api/kisskh/movie/$id", resolve = false, parse = SourceParsers::kisskh),
            )
        }
        val s = req.season ?: 1
        val e = req.episode ?: 1
        val se = mapOf("season" to "$s", "episode" to "$e")
        val ep = mapOf("episode" to "$e")
        return listOf(
            Route(Provider.LINKS, "api/links/tv/$id", se, parse = SourceParsers::links),
            Route(Provider.COFLIX, "api/tmdb/tv/$id", se, parse = SourceParsers::coflix),
            Route(Provider.PURSTREAM, "api/purstream/tv/$id/stream", se, resolve = false, parse = SourceParsers::purstream),
            Route(Provider.FSTREAM, "api/fstream/tv/$id/season/$s", ep) { SourceParsers.fstream(it, e) },
            Route(Provider.WIFLIX, "api/wiflix/tv/$id/$s", ep) { SourceParsers.vfVostfr(Provider.WIFLIX, it, e) },
            Route(Provider.J1F, "api/j1f/tv/$id/season/$s", ep) { SourceParsers.vfVostfr(Provider.J1F, it, e) },
            Route(Provider.SWIFTFLOW, "api/swiftflow/tv/$id/season/$s", ep) { SourceParsers.vfVostfr(Provider.SWIFTFLOW, it, e) + SourceParsers.swiftfluxEntries(it) },
            // L'appli React n'envoie pas `?episode` ici, mais le serveur n'enrichit
            // une série que s'il le reçoit (embedExtraction.js) : on l'ajoute.
            Route(Provider.VIPER, "api/cpasmal/tv/$id/$s/$e", ep) { SourceParsers.viper(it, isTv = true) },
            Route(Provider.KISSKH, "api/kisskh/tv/$id", se, resolve = false, parse = SourceParsers::kisskh),
            Route(Provider.VOX, "api/drama/tv/$id", se, parse = SourceParsers::vox),
        )
    }

    /**
     * Toutes les sources de [req]. [vipKey] (clé VIP vérifiée) active
     * `?resolve=1`. Chaque route a [perRouteMs] pour répondre ; une réponse
     * « en préparation » (202 ou `pending:true`) est redemandée deux fois.
     */
    suspend fun load(
        req: PlayRequest,
        vipKey: String?,
        perRouteMs: Long = 35_000,
        swiftflux: (suspend (index: Int) -> Pair<String, String?>?)? = null,
    ): List<PlaybackSource> = coroutineScope {
        routes(req).map { route ->
            async {
                val started = System.currentTimeMillis()
                val fetched = withTimeoutOrNull(perRouteMs) { fetch(route, vipKey) } ?: emptyList()
                val result = resolveMp4(fetched, swiftflux)
                runCatching {
                    Log.i("MovixSources", "${route.provider} : ${result.size} source(s), ${result.count { it.playable }} jouable(s), ${System.currentTimeMillis() - started} ms")
                }
                result
            }
        }.awaitAll().flatten().filter { s ->
            // Sans VIP, PurStream rend l'URL brute de l'amont, qui exige des
            // en-têtes qu'on ne connaît pas : rien à lancer. KissKH, lui, se lit
            // sans en-tête (vérifié le 2026-10-16 : playlist et segments PNG en 200).
            vipKey != null || s.provider != Provider.PURSTREAM
        }
    }

    /**
     * Fichiers SwiftFlux annoncés : URL demandée tout de suite (au plus 3, en
     * parallèle) quand la télé est reliée, sinon retirés. [swiftflux] rend
     * l'URL et la qualité annoncée, ou `null` si le serveur refuse.
     */
    private suspend fun resolveMp4(
        list: List<PlaybackSource>,
        swiftflux: (suspend (Int) -> Pair<String, String?>?)?,
    ): List<PlaybackSource> = coroutineScope {
        val (mp4, rest) = list.partition { it.mp4Index != null }
        if (mp4.isEmpty() || swiftflux == null) return@coroutineScope rest
        rest + mp4.take(3).map { s ->
            async {
                withTimeoutOrNull(10_000) { runCatching { swiftflux(s.mp4Index!!) }.getOrNull() }?.let { (url, quality) ->
                    s.copy(streamUrl = url, quality = quality ?: s.quality, headers = mapOf("Referer" to SITE_REFERER))
                }
            }
        }.awaitAll().filterNotNull()
    }

    private suspend fun fetch(route: Route, vipKey: String?): List<PlaybackSource> {
        repeat(3) { attempt ->
            val body = runCatching { api.getSource(route.path, route.query, vipKey, route.resolve) }.getOrNull() ?: return emptyList()
            val root = if (body.pending) null else runCatching { json.parseToJsonElement(body.body) }.getOrNull()
            if (!body.pending && !SourceParsers.isPending(root)) return runCatching { route.parse(root) }.getOrDefault(emptyList())
            if (attempt < 2) delay(2_500)
        }
        return emptyList()
    }

    companion object {
        /** Le CDN de SwiftFlux est censé n'accepter que les domaines Movix. */
        const val SITE_REFERER = "https://movix.luxe/"
    }
}
