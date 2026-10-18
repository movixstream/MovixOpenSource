package com.movix.tv.data.account

import com.movix.tv.data.tmdb.MediaType
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.io.IOException

class HistoryApiTest {
    private val server = MockWebServer()
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }
    private lateinit var api: HistoryApi

    // Réponse d'exemple de `GET /api/history/continue`, au format exact de
    // `historyStore.listContinue` (année et note en nombres, saison et épisode
    // `null` pour un film) : une série avec son épisode, et un film sans infos
    // TMDB (`title: null`) que la télé cache.
    private val sample = """{"items":[
        {"mediaType":"tv","tmdbId":1399,"season":2,"episode":1,"position":120.5,"duration":3000,
         "lastWatchedAt":"2026-10-16T10:00:00.000Z","title":"GoT","overview":"Hiver.","posterPath":"/got.jpg",
         "backdropPath":null,"year":2011,"rating":8.4,"episodeName":"Nord","episodeOverview":"Le mur.","stillPath":"/s.jpg"},
        {"mediaType":"movie","tmdbId":550,"season":null,"episode":null,"position":600,"duration":8000,
         "lastWatchedAt":"2026-10-15T10:00:00.000Z","title":null,"overview":null,"posterPath":null,
         "backdropPath":null,"year":null,"rating":null,"episodeName":null,"episodeOverview":null,"stillPath":null}
    ],"complete":true}"""

    @Before
    fun setUp() {
        server.start()
        api = HistoryApi(OkHttpClient(), json, server.url("/"))
    }

    @After
    fun tearDown() = server.close()

    @Test
    fun `réponse d'exemple lue, titre sans infos retiré`() = runTest {
        server.enqueue(MockResponse.Builder().body(sample).build())
        val items = api.continueWatching("tok", "p1", "fr-FR")
        val req = server.takeRequest()
        assertEquals("/api/history/continue", req.url.encodedPath)
        assertEquals("p1", req.url.queryParameter("profileId"))
        assertEquals("fr-FR", req.url.queryParameter("language"))
        assertEquals("Bearer tok", req.headers["Authorization"])
        assertNull(req.headers["Origin"]); assertNull(req.headers["Referer"])
        assertEquals(1, items.size)
        assertEquals("Nord", items.single().episodeName)
        assertEquals(2011, items.single().year)
        assertEquals(8.4, items.single().rating!!, 0.0)
    }

    @Test
    fun `année en nombre lue et rendue en texte dans la fiche`() {
        val item = json.decodeFromString(ContinueResponse.serializer(), sample).items.first()
        assertEquals(2011, item.year)
        assertEquals("2011", item.toContinueEntry()!!.meta?.year)
    }

    @Test(expected = SessionRevokedException::class)
    fun `401 donne SessionRevokedException`() = runTest {
        server.enqueue(MockResponse.Builder().code(401).body("""{"error":"Unauthorized"}""").build())
        api.continueWatching("tok", "p1", "fr-FR")
    }

    @Test(expected = IOException::class)
    fun `liste incomplète ou route absente, la télé garde sa rangée`() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"items":[],"complete":false}""").build())
        api.continueWatching("tok", "p1", "fr-FR")
    }

    @Test(expected = IOException::class)
    fun `404 (routes pas encore déployées) donne une erreur réseau`() = runTest {
        server.enqueue(MockResponse.Builder().code(404).body("{}").build())
        api.continueWatching("tok", "p1", "en-US")
    }

    @Test
    fun `élément converti en entrée de « Reprendre » avec la clé de Library`() {
        val item = json.decodeFromString(ContinueResponse.serializer(), sample).items.first()
        val e = item.toContinueEntry()!!
        assertEquals("progress_tv_1399_s2_e1", e.key)
        assertEquals(MediaType.TV, e.type)
        assertEquals(2, e.season); assertEquals(1, e.episode)
        assertEquals(120.5, e.progress.position, 0.0)
        assertEquals("2026-10-16T10:00:00.000Z", e.progress.timestamp)
        assertEquals("GoT", e.meta?.title)
        assertEquals("/got.jpg", e.meta?.backdropPath) // pas d'image de fond : l'affiche
        assertEquals("Le mur.", e.meta?.overview)
        assertEquals("Nord", e.meta?.episodeName)
        val movie = ServerContinueItem(mediaType = "movie", tmdbId = 27205, position = 1.0, duration = 2.0, lastWatchedAt = "x", title = "Inception")
        assertEquals("progress_27205", movie.toContinueEntry()!!.key)
        assertNull(movie.toContinueEntry()!!.season)
    }

    @Test
    fun `langue de l'appli vers TMDB`() {
        assertEquals("en-US", HistoryApi.tmdbLanguage("en"))
        assertEquals("fr-FR", HistoryApi.tmdbLanguage("fr"))
        assertEquals("fr-FR", HistoryApi.tmdbLanguage("de"))
    }
}
