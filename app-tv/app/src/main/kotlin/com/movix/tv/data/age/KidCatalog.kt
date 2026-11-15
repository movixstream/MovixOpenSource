package com.movix.tv.data.age

import com.movix.tv.data.tmdb.MediaType
import kotlinx.coroutines.CancellationException

/** Une liste TMDB à demander : chemin et paramètres. */
data class ListQuery(val path: String, val params: Map<String, String>)

/** Une page d'une liste : ses titres, et s'il en reste après elle. */
data class ListPage<T>(val items: List<T>, val hasMore: Boolean)

/**
 * Où chercher les titres d'un profil limité (7+, 12+, 16+), pour que ses
 * rangées et ses grilles soient pleines.
 *
 * Le filtre d'âge ([AgeRules], [ContentAges]) reste le seul juge de ce qui est
 * montré. Mais appliqué à la liste générale d'une rangée, il n'en garde que
 * 2 à 5 titres sur 20 en 7+ (mesuré sur TMDB) : la rangée disparaît. Ici on
 * demande donc à TMDB des listes déjà triées par classification, où presque
 * tout passe, sans rien changer à la règle.
 *
 * - `/discover/movie` et `/discover/tv` acceptent `certification_country`,
 *   `certification.gte` et `certification.lte` (pour les séries, TMDB ne le
 *   documente pas, mais le filtre répond : si un jour il était ignoré, la liste
 *   redeviendrait la liste générale, filtrée comme avant).
 * - France d'abord, comme la règle : un titre classé en France à la limite ou
 *   en dessous passe à coup sûr. États-Unis ensuite, pour les titres que la
 *   France n'a pas classés.
 * - Un plancher (`certification.gte`) écarte les titres « NR » (non classés),
 *   que TMDB range avant tous les autres.
 */
object KidCatalog {
    /**
     * Titres permis à partir desquels une rangée est pleine : on ne demande
     * plus rien. Presque une page entière, parce que les rangées d'un profil
     * limité puisent dans les mêmes titres et que les doublons d'une rangée à
     * l'autre sont retirés ensuite.
     */
    const val ROW_ENOUGH = 18

    /** Listes demandées à TMDB pour une rangée, au plus (chacune coûte jusqu'à 20 âges à vérifier). */
    const val MAX_LISTS = 4

    /** Listes sans aucun titre permis après lesquelles la rangée est abandonnée. */
    const val GIVE_UP_AFTER = 2

    private const val MOVIES = "/discover/movie"
    private const val SERIES = "/discover/tv"

    /** Plafond de classification demandé par pays, selon le palier du profil. */
    private class Ceilings(val country: String, val floor: String, val at7: String, val at12: String, val at16: String) {
        fun at(step: Int) = when (step) {
            16 -> at16
            12 -> at12
            else -> at7
        }
    }

    // PG-13 vaut 13 ans et TV-14 vaut 14 ans pour la règle : hors d'un profil 12+.
    private val MOVIE_CEILINGS = listOf(
        Ceilings("FR", floor = "TP", at7 = "TP", at12 = "12", at16 = "16"),
        Ceilings("US", floor = "G", at7 = "PG", at12 = "PG", at16 = "PG-13"),
    )
    private val SERIES_CEILINGS = listOf(
        Ceilings("FR", floor = "TP", at7 = "TP", at12 = "12", at16 = "16"),
        Ceilings("US", floor = "TV-Y", at7 = "TV-PG", at12 = "TV-PG", at16 = "TV-14"),
    )

    /**
     * Listes fixes de TMDB, qui n'acceptent aucun filtre, et leur équivalent
     * « discover » donné par la documentation de TMDB.
     */
    private val EQUIVALENTS: Map<String, ListQuery> = mapOf(
        "/movie/popular" to ListQuery(MOVIES, mapOf("sort_by" to "popularity.desc")),
        "/movie/top_rated" to ListQuery(MOVIES, mapOf("sort_by" to "vote_average.desc", "vote_count.gte" to "200", "without_genres" to "99,10755")),
        "/tv/popular" to ListQuery(SERIES, mapOf("sort_by" to "popularity.desc")),
        "/tv/top_rated" to ListQuery(SERIES, mapOf("sort_by" to "vote_average.desc", "vote_count.gte" to "200")),
    )

    /**
     * Listes à interroger, dans l'ordre, pour la rangée ([path], [params]) et
     * la restriction [limit]. Sans restriction, ou en 18+ (la règle n'y masque
     * presque rien) : la rangée telle quelle.
     *
     * Les tendances n'acceptent aucun filtre : elles passent d'abord, telles
     * quelles, puis les titres populaires classés complètent la rangée (en 7+,
     * il n'en reste que 2 sur 20).
     */
    fun queries(path: String, params: Map<String, String>, limit: Int): List<ListQuery> {
        val same = listOf(ListQuery(path, params))
        if (limit <= 0 || limit >= 18) return same
        // La rangée choisit déjà ses classifications : on n'y touche pas.
        if (params.keys.any { it.startsWith("certification") }) return same
        // Une limite hors des paliers du site est ramenée au palier plus strict.
        val step = when {
            limit >= 16 -> 16
            limit >= 12 -> 12
            else -> 7
        }
        val popular = mapOf("sort_by" to "popularity.desc")
        return when {
            path.startsWith("/trending/movie/") -> same + classified(ListQuery(MOVIES, popular), step)
            path.startsWith("/trending/tv/") -> same + classified(ListQuery(SERIES, popular), step)
            // Films et séries mêlés : la liste française de chacun (une de plus coûterait une page d'âges).
            path.startsWith("/trending/all/") ->
                same + classified(ListQuery(MOVIES, popular), step).take(1) + classified(ListQuery(SERIES, popular), step).take(1)
            else -> {
                val base = EQUIVALENTS[path]?.let { ListQuery(it.path, it.params + params) } ?: ListQuery(path, params)
                classified(base, step).ifEmpty { same }
            }
        }
    }

    /**
     * Type des titres d'une liste « discover », que TMDB ne donne pas dans la
     * réponse ; `null` pour les autres listes (le type vient alors de chaque
     * titre, ou de la rangée). Une liste de séries ajoutée à une rangée de
     * films doit porter son type : sinon une série s'ouvrirait comme le film
     * de même numéro.
     */
    fun typeOf(path: String): MediaType? = when (path) {
        MOVIES -> MediaType.MOVIE
        SERIES -> MediaType.TV
        else -> null
    }

    /** [base] demandée par classification, France puis États-Unis ; vide si la liste n'accepte pas ce filtre. */
    private fun classified(base: ListQuery, step: Int): List<ListQuery> {
        val ceilings = when (base.path) {
            MOVIES -> MOVIE_CEILINGS
            SERIES -> SERIES_CEILINGS
            else -> return emptyList()
        }
        return ceilings.map { c ->
            ListQuery(
                base.path,
                base.params + mapOf(
                    "certification_country" to c.country,
                    "certification.gte" to c.floor,
                    "certification.lte" to c.at(step),
                ),
            )
        }
    }

    /**
     * Remplit une rangée : une liste à la fois ([queries] dans l'ordre, page 1
     * de chacune, puis page 2…), jusqu'à [enough] titres gardés par [keep] (le
     * filtre d'âge) ou [maxLists] listes. Une liste à la fois, parce que
     * chaque titre nouveau coûte une vérification d'âge : on ne demande que ce
     * qui manque.
     *
     * - un titre déjà vu (gardé ou refusé) n'est pas revérifié ;
     * - une source épuisée n'est plus demandée ;
     * - rien de gardé après [GIVE_UP_AFTER] listes : la rangée n'a rien pour ce profil ;
     * - une panne remonte si rien n'est encore trouvé ; sinon la rangée
     *   s'affiche avec ce qu'elle a.
     */
    suspend fun <T> fill(
        queries: List<ListQuery>,
        enough: Int,
        load: suspend (ListQuery, Int) -> ListPage<T>,
        keep: suspend (List<T>) -> List<T>,
        key: (T) -> String,
        maxLists: Int = MAX_LISTS,
    ): List<T> {
        val kept = ArrayList<T>()
        val seen = HashSet<String>()
        val open = queries.toMutableList()
        var lists = 0
        var page = 1
        try {
            while (open.isNotEmpty()) {
                for (query in open.toList()) {
                    if (kept.size >= enough || lists >= maxLists) return kept
                    val found = load(query, page)
                    lists++
                    if (!found.hasMore) open.remove(query)
                    val fresh = found.items.filter { seen.add(key(it)) }
                    if (fresh.isNotEmpty()) kept += keep(fresh)
                    if (kept.isEmpty() && lists >= GIVE_UP_AFTER) return kept
                }
                page++
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (kept.isEmpty()) throw e
        }
        return kept
    }

    /**
     * Une page de grille faite de la même page de plusieurs sources : un titre
     * de chacune à tour de rôle (elles sont triées de la même façon), sans doublon.
     */
    fun <T> interleave(lists: List<List<T>>, key: (T) -> String): List<T> {
        if (lists.size == 1) return lists[0]
        val seen = HashSet<String>()
        val out = ArrayList<T>(lists.sumOf { it.size })
        for (i in 0 until (lists.maxOfOrNull { it.size } ?: 0)) {
            for (list in lists) {
                val item = list.getOrNull(i) ?: continue
                if (seen.add(key(item))) out += item
            }
        }
        return out
    }
}
