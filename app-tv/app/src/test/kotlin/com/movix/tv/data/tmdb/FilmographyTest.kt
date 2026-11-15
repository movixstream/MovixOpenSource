package com.movix.tv.data.tmdb

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Filmographie de l'écran « personne ». Modes de défaillance visés (aucun test
 * de bout en bout ne tourne sur la télé) :
 * - une série créditée plusieurs fois sort en double (et deux clés identiques
 *   font planter la rangée) ;
 * - talk-shows, journaux, télé-réalité, documentaires et cérémonies noient les
 *   vrais rôles ;
 * - « Self », « Lui-même », son propre nom, caméos non crédités, images
 *   d'archives comptés comme des rôles ;
 * - titres adultes, sans affiche ou seulement annoncés affichés ;
 * - tri inutile (l'inconnu avant le célèbre, le passage d'un épisode avant le
 *   rôle récurrent) ;
 * - biographie vide alors que TMDB l'a en anglais ;
 * - réponse TMDB avec des champs absents ou `null` qui fait échouer la lecture.
 */
class FilmographyTest {
    private fun credit(
        id: Int,
        type: String = "movie",
        votes: Int = 100,
        character: String? = "Rôle $id",
        genres: List<Int>? = listOf(18),
        episodes: Int? = if (type == "tv") 10 else null,
        poster: Boolean = true,
        adult: Boolean = false,
        date: String? = "2001-05-04",
        order: Int? = 0,
    ) = TmdbPersonCredit(
        id = id,
        mediaType = type,
        title = if (type == "movie") "Film $id" else null,
        name = if (type == "tv") "Série $id" else null,
        posterPath = if (poster) "/$id.jpg" else null,
        voteCount = votes,
        character = character,
        genreIds = genres,
        episodeCount = episodes,
        adult = adult,
        releaseDate = if (type == "movie") date else null,
        firstAirDate = if (type == "tv") date else null,
        order = order,
    )

    private fun page(vararg cast: TmdbPersonCredit) =
        TmdbPerson(id = 31, name = "Tom Hanks", combinedCredits = TmdbCombinedCredits(cast = cast.toList())).toPersonPage()

    private fun PersonPage.keys() = (movies + series).map { it.item.key }

    @Test
    fun seriesCreditedSeveralTimesShowsOnceWithItsRealRole() {
        val p = page(
            credit(1, "tv", character = "Himself"),
            credit(1, "tv", character = "Paul"),
            credit(1, "tv", character = "Paul (jeune)"),
            credit(1, "movie"),
        )
        assertEquals(listOf("tv:1"), p.series.map { it.item.key })
        assertEquals("Paul", p.series.single().character)
        // Même identifiant TMDB, mais un film : c'est un autre titre.
        assertEquals(listOf("movie:1"), p.movies.map { it.item.key })
    }

    @Test
    fun talkShowsNewsRealityAndDocumentariesAreLeftOut() {
        val p = page(
            credit(1, "tv", genres = listOf(10767)),
            credit(2, "tv", genres = listOf(10763)),
            credit(3, "tv", genres = listOf(10764, 18)),
            credit(4, "movie", genres = listOf(99)),
            credit(5, "tv", genres = listOf(18)),
        )
        assertEquals(listOf("tv:5"), p.keys())
    }

    @Test
    fun playingYourselfOrAnUncreditedCameoIsNotARole() {
        val p = page(
            credit(1, character = "Self"),
            credit(2, character = "Himself - Guest"),
            credit(3, character = "Lui-même"),
            credit(4, character = "Tom Hanks"),
            credit(5, character = "Himself (archive footage)"),
            credit(6, character = "Passer-by (uncredited)"),
            credit(7, character = "Narrator (voice)", order = 5),
            credit(8, character = "Forrest Gump"),
            // Le héros qui raconte en tête d'affiche (Fight Club) joue bien.
            credit(9, character = "Narrator", order = 0),
            // Personnage inconnu de TMDB : rien ne dit que ce n'est pas un rôle.
            credit(10, character = null),
        )
        assertEquals(setOf(8, 9, 10), p.movies.map { it.item.id }.toSet())
    }

    @Test
    fun adultPosterlessAnnouncedAndCeremonyTitlesAreLeftOut() {
        val p = page(
            credit(1, adult = true),
            credit(2, poster = false),
            // Projet annoncé : ni date ni vote.
            credit(3, votes = 0, date = null),
            // Série sans aucun genre : cérémonie ou émission spéciale (Oscars).
            credit(4, "tv", genres = emptyList()),
            // À venir mais daté : gardé.
            credit(5, votes = 0, date = "2027-03-01"),
            credit(6),
        )
        assertEquals(setOf("movie:5", "movie:6"), p.keys().toSet())
    }

    @Test
    fun bestKnownTitlesComeFirst() {
        val p = page(credit(1, votes = 50), credit(2, votes = 30000), credit(3, votes = 900))
        assertEquals(listOf(2, 3, 1), p.movies.map { it.item.id })
    }

    @Test
    fun recurringSeriesRolesComeBeforeOneEpisodeAppearances() {
        val p = page(
            // Un épisode d'une série célèbre : un passage, pas son rôle.
            credit(1, "tv", votes = 9000, episodes = 1),
            credit(2, "tv", votes = 300, episodes = 24),
            credit(3, "tv", votes = 5000, episodes = 3),
            // Crédité deux fois, dont une fois sur 20 épisodes : rôle récurrent.
            credit(4, "tv", votes = 100, episodes = 1),
            credit(4, "tv", votes = 100, episodes = 20),
        )
        assertEquals(listOf(3, 2, 4, 1), p.series.map { it.item.id })
    }

    @Test
    fun characterIsShownWithoutVoiceMention() {
        assertEquals("Woody", page(credit(1, character = "Woody (voice)")).movies.single().character)
    }

    @Test
    fun englishBiographyStandsInWhenFrenchIsMissing() {
        val translations = TmdbPersonTranslations(
            listOf(
                TmdbPersonTranslation("de", TmdbPersonTranslationData("Deutsch")),
                TmdbPersonTranslation("en", TmdbPersonTranslationData("English bio")),
            ),
        )
        assertEquals("English bio", TmdbPerson(id = 1, name = "A", biography = " ", translations = translations).toPersonPage().biography)
        assertEquals("Bio FR", TmdbPerson(id = 1, name = "A", biography = "Bio FR", translations = translations).toPersonPage().biography)
    }
}

class PersonApiTest {
    private val server = MockWebServer()
    private lateinit var api: TmdbApi

    @Before
    fun setUp() {
        server.start()
        // Plus strict que l'appli (ni `explicitNulls = false` ni `coerceInputValues`).
        api = TmdbApi(OkHttpClient(), Json { ignoreUnknownKeys = true }, { "k123" }, server.url("/3/"))
    }

    @After
    fun tearDown() = server.close()

    @Test
    fun personAndCreditsComeInOneRequestDespiteMissingFields() = runTest {
        server.enqueue(
            MockResponse.Builder().body(
                """
                {"id":31,"name":"Tom Hanks","biography":"","profile_path":"/t.jpg","birthday":"1956-07-09","deathday":null,
                 "place_of_birth":"Concord, California, USA","gender":2,"known_for_department":"Acting",
                 "combined_credits":{"cast":[
                   {"id":13,"media_type":"movie","title":"Forrest Gump","poster_path":"/f.jpg","vote_count":28000,"popularity":40.5,
                    "genre_ids":[35,18],"character":"Forrest Gump","order":0,"release_date":"1994-06-23","adult":false,"credit_id":"a"},
                   {"id":1668,"media_type":"tv","name":"Friends","poster_path":"/fr.jpg","vote_count":9000,"genre_ids":[35],
                    "character":null,"episode_count":1,"first_air_date":"1994-09-22","credit_id":"b"}
                 ],"crew":[{"id":5,"media_type":"movie","title":"Réalisé","job":"Director","poster_path":"/x.jpg"}]},
                 "translations":{"translations":[{"iso_639_1":"en","iso_3166_1":"US","data":{"biography":"Thomas Jeffrey Hanks is an actor."}}]}}
                """.trimIndent(),
            ).build(),
        )
        val p = api.person(31).toPersonPage()
        val url = server.takeRequest().url
        assertEquals("/3/person/31", url.encodedPath)
        assertEquals("fr-FR", url.queryParameter("language"))
        assertTrue(url.queryParameter("append_to_response").orEmpty().split(',').contains("combined_credits"))
        assertEquals(listOf("movie:13"), p.movies.map { it.item.key })
        assertEquals(listOf("tv:1668"), p.series.map { it.item.key })
        assertEquals("1994", p.movies.single().item.year)
        assertEquals("1956", p.birthYear)
        assertEquals("Thomas Jeffrey Hanks is an actor.", p.biography)
    }
}
