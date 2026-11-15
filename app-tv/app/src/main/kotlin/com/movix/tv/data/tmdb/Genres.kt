package com.movix.tv.data.tmdb

/** Pages qui ont une barre de genres. */
enum class GenrePage { MOVIES, SERIES, ANIME }

/**
 * Genres de la barre des pages Films, Séries et Animés, et la requête TMDB de
 * chacun. Les identifiants viennent de `/genre/movie/list` et `/genre/tv/list` :
 * les séries n'ont pas les genres des films (pas d'« Action » 28 mais « Action
 * et aventure » 10759, pas de « Science-fiction » 878 mais 10765).
 *
 * Ordre : les genres les plus regardés d'abord, pas l'ordre alphabétique. À la
 * télécommande, chaque puce coûte un appui, et l'alphabet change avec la langue.
 */
object Genres {

    private val movies = listOf(
        28, // Action
        12, // Aventure
        35, // Comédie
        18, // Drame
        27, // Horreur
        53, // Thriller
        878, // Science-fiction
        10749, // Romance
        16, // Animation
        80, // Policier
        14, // Fantastique
        10751, // Famille
        9648, // Mystère
        99, // Documentaire
        10752, // Guerre
        36, // Histoire
        10402, // Musique
        37, // Western
    )

    // Actualités (10763) et talk-shows (10767) écartés : rien à regarder à la demande.
    private val series = listOf(
        10759, // Action et aventure
        35, // Comédie
        18, // Drame
        80, // Policier
        10765, // Science-fiction et fantastique
        9648, // Mystère
        16, // Animation
        10751, // Famille
        10762, // Jeunesse
        99, // Documentaire
        10764, // Téléréalité
        10766, // Feuilleton
        10768, // Guerre et politique
        37, // Western
    )

    // Combinés à l'animation (16) : « Tout » la couvre déjà, d'où pas de puce 16.
    private val anime = listOf(10759, 10765, 35, 18, 9648, 80, 10751, 10762)

    fun of(page: GenrePage): List<Int> = when (page) {
        GenrePage.MOVIES -> movies
        GenrePage.SERIES -> series
        GenrePage.ANIME -> anime
    }

    /**
     * Requête de la grille d'un genre : tout le catalogue du genre, par popularité.
     * Un seuil de votes bas (10) garde un catalogue large tout en écartant les
     * fiches vides que `discover` remonte sinon. Animés : séries japonaises, le
     * genre combiné à l'animation par une virgule (« et » pour TMDB), comme les
     * rangées de la page.
     */
    fun spec(page: GenrePage, genreId: Int): RowSpec {
        val params: Map<String, String> = when (page) {
            GenrePage.ANIME -> linkedMapOf(
                "with_genres" to "16,$genreId",
                "with_original_language" to "ja",
                "sort_by" to "popularity.desc",
                "vote_count.gte" to "10",
            )
            else -> linkedMapOf(
                "with_genres" to genreId.toString(),
                "sort_by" to "popularity.desc",
                "vote_count.gte" to "10",
            )
        }
        val tv = page != GenrePage.MOVIES
        return RowSpec(
            id = "genre-${page.name.lowercase()}-$genreId",
            title = "",
            path = if (tv) "/discover/tv" else "/discover/movie",
            fallbackType = if (tv) MediaType.TV else MediaType.MOVIE,
            tier = 1,
            params = { params },
            collection = true,
        )
    }
}
