package com.movix.tv.data.tmdb

import androidx.compose.runtime.Immutable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

@Immutable
data class CatalogRow(val spec: RowSpec, val items: List<MediaItem>)

class CatalogRepository(private val api: TmdbApi) {

    /** Charge les rangées données en parallèle. Une rangée en erreur vaut `failure`, les autres continuent. */
    suspend fun fetch(specs: List<RowSpec>): Map<String, Result<List<MediaItem>>> = coroutineScope {
        specs.map { spec ->
            async {
                val t0 = System.nanoTime()
                val result = runCatching {
                    api.list(spec.path, spec.params()).results.mapNotNull { it.toMediaItem(spec.fallbackType) }
                }
                val ms = (System.nanoTime() - t0) / 1_000_000
                if (ms > 3000 || result.isFailure) {
                    android.util.Log.w("MovixPerf", "rangée ${spec.id} : $ms ms, ${result.exceptionOrNull()?.toString() ?: "ok"}")
                }
                spec.id to result
            }
        }.awaitAll().toMap()
    }

    suspend fun page(spec: RowSpec, page: Int): List<MediaItem> =
        api.list(spec.path, spec.params(), page).results
            .mapNotNull { it.toMediaItem(spec.fallbackType) }
            .filter { it.posterPath != null }

    // Fiches récentes en mémoire : la bannière précharge la fiche du titre
    // sélectionné, qui s'ouvre alors sans attente.
    private val detailsCache = object : LinkedHashMap<String, Details>(32, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Details>?) = size > 40
    }

    suspend fun details(type: MediaType, id: Int): Details {
        val key = "${type.path}:$id"
        synchronized(detailsCache) { detailsCache[key] }?.let { return it }
        return api.details(type, id).toDetails(type).also { synchronized(detailsCache) { detailsCache[key] = it } }
    }

    suspend fun prefetchDetails(type: MediaType, id: Int) {
        runCatching { details(type, id) }
    }

    suspend fun episodes(tvId: Int, season: Int): List<Episode> =
        api.season(tvId, season).episodes.map { it.toEpisode() }

    suspend fun search(query: String): List<MediaItem> =
        api.search(query).mapNotNull { it.toMediaItem(MediaType.MOVIE) }.filter { it.posterPath != null }

    companion object {
        const val MIN_ROW_ITEMS = 8
        const val HIDE_BELOW = 6

        /**
         * Assemble les rangées dans l'ordre d'affichage, à partir de ce qui est déjà chargé.
         *
         * - les titres sans affiche sont écartés ;
         * - un titre déjà montré plus haut est retiré, mais une rangée garde au
         *   moins [MIN_ROW_ITEMS] titres (on réintègre les doublons) ;
         * - une rangée exemptée (`dedupe = false`, un classement) garde ses rangs,
         *   et ses titres comptent quand même comme vus ;
         * - une rangée de moins de [HIDE_BELOW] titres, ou en erreur, disparaît.
         */
        fun assemble(specs: List<RowSpec>, fetched: Map<String, Result<List<MediaItem>>>): List<CatalogRow> {
            val seen = HashSet<String>()
            val rows = ArrayList<CatalogRow>(specs.size)
            for (spec in specs) {
                val all = fetched[spec.id]?.getOrNull() ?: continue
                val withPoster = all.filter { it.posterPath != null }.distinctBy { it.key }
                val items = if (!spec.dedupe) {
                    withPoster
                } else {
                    val fresh = withPoster.filter { it.key !in seen }
                    if (fresh.size >= MIN_ROW_ITEMS) fresh
                    else {
                        val missing = MIN_ROW_ITEMS - fresh.size
                        val refill = withPoster.filter { it.key in seen }.take(missing).toSet()
                        withPoster.filter { it.key !in seen || it in refill }
                    }
                }.let { list -> spec.limit?.let { list.take(it) } ?: list }
                items.forEach { seen += it.key }
                if (items.size >= HIDE_BELOW) rows += CatalogRow(spec, items)
            }
            return rows
        }
    }
}
