package com.movix.tv.data.tmdb

import androidx.compose.runtime.Immutable
import com.movix.tv.data.imdb.ImdbSuggestions
import java.text.Normalizer
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull

@Immutable
data class CatalogRow(val spec: RowSpec, val items: List<MediaItem>)

/** Une recherche : la grille, et les titres assez connus pour être proposés au-dessus. */
@Immutable
data class SearchResults(val items: List<MediaItem>, val known: List<MediaItem>)

class CatalogRepository(private val api: TmdbApi, private val imdb: ImdbSuggestions? = null) {

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

    // Acteurs récents en mémoire : revenir d'une fiche ouverte depuis la
    // filmographie ne recharge rien, et le focus retrouve aussitôt son titre.
    private val personCache = object : LinkedHashMap<Int, PersonPage>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, PersonPage>?) = size > 12
    }

    /** Écran « personne » : biographie et filmographie déjà triée (voir [toPersonPage]). */
    suspend fun person(id: Int): PersonPage {
        synchronized(personCache) { personCache[id] }?.let { return it }
        // Hors du fil principal : réponse lourde pour un acteur prolifique
        // (centaines de rôles et biographies traduites), lue puis triée ici.
        return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { api.person(id).toPersonPage() }
            .also { synchronized(personCache) { personCache[id] = it } }
    }

    /**
     * TMDB ne cherche que des mots entiers : « Inter » sort d'abord
     * « inter-medium » (0 vote) et laisse Interstellar en page 2. On y ajoute
     * les titres proposés par IMDb, qui complète le début des mots et range
     * par popularité, convertis en titres TMDB (titre français, affiche,
     * votes) ; les plus connus passent devant. IMDb lent ou en panne : TMDB seul.
     */
    suspend fun search(query: String): SearchResults = coroutineScope {
        val popular = async { popularOrEmpty(query) }
        val found = api.search(query)
        merge(query, popular.await(), found)
    }

    // IMDb en panne ou bloqué : après deux échecs de suite, la recherche s'en
    // passe 10 min au lieu d'attendre son délai à chaque fois.
    @Volatile private var imdbMisses = 0
    @Volatile private var imdbPausedUntil = 0L

    /** Titres d'IMDb ; rien s'il échoue ou dépasse [IMDB_TIMEOUT_MS] : la grille n'attend pas plus. */
    private suspend fun popularOrEmpty(query: String): List<TmdbItem> {
        if (imdb == null || System.currentTimeMillis() < imdbPausedUntil) return emptyList()
        val t0 = System.nanoTime()
        var error: Exception? = null
        val items = try {
            withTimeoutOrNull(IMDB_TIMEOUT_MS) { popular(query) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e
            null
        }
        val ms = (System.nanoTime() - t0) / 1_000_000
        if (items == null) {
            android.util.Log.w("MovixPerf", "recherche IMDb : $ms ms, ${error ?: "délai dépassé"}")
            if (++imdbMisses >= 2) {
                imdbMisses = 0
                imdbPausedUntil = System.currentTimeMillis() + IMDB_PAUSE_MS
            }
        } else {
            imdbMisses = 0
            if (ms > 2000) android.util.Log.w("MovixPerf", "recherche IMDb lente : $ms ms")
        }
        return items.orEmpty()
    }

    private suspend fun popular(query: String): List<TmdbItem> = coroutineScope {
        imdb?.titles(query).orEmpty()
            .map { id -> async { runCatching { fromImdb(id) }.getOrNull() } }
            .awaitAll().filterNotNull()
    }

    // IMDb → TMDB déjà convertis (un titre absent de TMDB vaut null) : la
    // saisie lettre par lettre redemande souvent les mêmes titres.
    private val imdbCache = object : LinkedHashMap<String, TmdbItem?>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, TmdbItem?>?) = size > 300
    }

    private suspend fun fromImdb(imdbId: String): TmdbItem? {
        synchronized(imdbCache) { if (imdbCache.containsKey(imdbId)) return imdbCache[imdbId] }
        val found = api.findImdb(imdbId)
        val item = (found.movies.map { it.copy(mediaType = "movie") } + found.tv.map { it.copy(mediaType = "tv") })
            .firstOrNull { !it.adult && it.posterPath != null }
        synchronized(imdbCache) { imdbCache[imdbId] = item }
        return item
    }

    companion object {
        const val MIN_ROW_ITEMS = 8
        const val HIDE_BELOW = 6
        // IMDb hors de son cache (≈ 0,6 s) puis /find : plus d'une seconde sur une télé lente.
        const val IMDB_TIMEOUT_MS = 3_000L
        const val IMDB_PAUSE_MS = 10 * 60_000L

        /**
         * Votes TMDB à partir desquels un titre est « connu » : rangé en tête et
         * proposé au-dessus de la grille. IMDb a déjà trié les siens : quelques
         * votes écartent ses inconnus (« kaam » → films indiens à 0 vote) sans
         * perdre les séries françaises, peu notées sur TMDB (Plus belle la vie :
         * 38). La recherche TMDB ramène tout titre qui contient le mot : il en
         * faut plus.
         */
        const val IMDB_KNOWN_VOTES = 10
        const val TMDB_KNOWN_VOTES = 50

        /**
         * Grille : le titre exact d'abord s'il est connu, puis les titres connus
         * (ceux d'IMDb dans son ordre, puis ceux de TMDB), puis le reste. Titres
         * proposés : les connus seulement, jamais un inconnu qui a juste le mot
         * tapé dans son titre.
         */
        fun merge(query: String, popular: List<TmdbItem>, found: List<TmdbItem>): SearchResults {
            fun List<TmdbItem>.rated(minVotes: Int) = mapNotNull { raw ->
                raw.toMediaItem(MediaType.MOVIE)?.takeIf { it.posterPath != null }?.let { it to (raw.voteCount >= minVotes) }
            }
            val all = (popular.rated(IMDB_KNOWN_VOTES) + found.rated(TMDB_KNOWN_VOTES)).distinctBy { it.first.key }
            val known = all.filter { it.second }.map { it.first }
            val exact = fold(query)
            val items = (known.filter { fold(it.title) == exact } + known + all.map { it.first }).distinctBy { it.key }
            return SearchResults(items, known)
        }

        /** « Spider-Man » et « spider man », « L'Été » et « l'ete » : même forme. */
        private fun fold(text: String): String =
            Normalizer.normalize(text.lowercase(Locale.ROOT), Normalizer.Form.NFD)
                .replace(MARKS, "").replace(NON_WORD, " ").trim()

        private val MARKS = Regex("\\p{Mn}+")
        private val NON_WORD = Regex("[^\\p{L}\\p{N}]+")

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
