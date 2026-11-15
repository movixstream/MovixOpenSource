package com.movix.tv.data.tmdb

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Barre de genres. Défaillances visées : un genre de film demandé aux séries
 * (TMDB n'a pas d'« Action » 28 côté télé, mais 10759) donne une grille vide ou
 * fausse ; un genre animé filtré en « ou » (barre verticale) sort de
 * l'animation ; une grille de genre qui partage l'identifiant d'une rangée
 * reprendrait l'état de cette rangée.
 */
class GenresTest {
    // Listes officielles de TMDB (/genre/movie/list et /genre/tv/list).
    private val tmdbMovieGenres = setOf(28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770, 53, 10752, 37)
    private val tmdbTvGenres = setOf(10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765, 10766, 10767, 10768, 37)

    @Test
    fun chaquePageNeProposeQueSesGenresTmdb() {
        val movies = Genres.of(GenrePage.MOVIES)
        val series = Genres.of(GenrePage.SERIES)
        val anime = Genres.of(GenrePage.ANIME)
        assertTrue(movies.isNotEmpty() && series.isNotEmpty() && anime.isNotEmpty())
        assertTrue("Films : ${movies - tmdbMovieGenres}", tmdbMovieGenres.containsAll(movies))
        assertTrue("Séries : ${series - tmdbTvGenres}", tmdbTvGenres.containsAll(series))
        assertTrue("Animés : ${anime - tmdbTvGenres}", tmdbTvGenres.containsAll(anime))
        // « Tout » est déjà toute l'animation : pas de puce « Animation » sur la page Animés.
        assertFalse(16 in anime)
        GenrePage.entries.forEach { page ->
            val ids = Genres.of(page)
            assertEquals("Doublon sur $page", ids.size, ids.toSet().size)
        }
    }

    @Test
    fun seriesEtAnimesInterrogentLaTele() {
        val serie = Genres.spec(GenrePage.SERIES, 10759)
        assertEquals("/discover/tv", serie.path)
        assertEquals(MediaType.TV, serie.fallbackType)
        assertEquals("10759", serie.params()["with_genres"])

        val film = Genres.spec(GenrePage.MOVIES, 28)
        assertEquals("/discover/movie", film.path)
        assertEquals(MediaType.MOVIE, film.fallbackType)
        assertEquals("28", film.params()["with_genres"])
    }

    @Test
    fun genreAnimeResteDansLAnimationJaponaise() {
        val spec = Genres.spec(GenrePage.ANIME, 18)
        assertEquals("/discover/tv", spec.path)
        // Virgule : « et » pour TMDB (la barre verticale voudrait dire « ou »).
        assertEquals("16,18", spec.params()["with_genres"])
        assertEquals("ja", spec.params()["with_original_language"])
    }

    @Test
    fun grillesTrieesParPopularite() {
        GenrePage.entries.forEach { page ->
            Genres.of(page).forEach { id ->
                assertEquals("popularity.desc", Genres.spec(page, id).params()["sort_by"])
            }
        }
    }

    @Test
    fun identifiantsDistinctsDesRangees() {
        val ids = GenrePage.entries.flatMap { page -> Genres.of(page).map { Genres.spec(page, it).id } }
        assertEquals(ids.size, ids.toSet().size)
        ids.forEach { assertFalse("$it est aussi une rangée", it in RowRegistry.all) }
    }
}
