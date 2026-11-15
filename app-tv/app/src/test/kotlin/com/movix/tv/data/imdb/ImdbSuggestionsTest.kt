package com.movix.tv.data.imdb

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

class ImdbSuggestionsTest {
    private val server = MockWebServer()
    private lateinit var imdb: ImdbSuggestions

    @Before
    fun setUp() {
        server.start()
        imdb = ImdbSuggestions(OkHttpClient(), Json { ignoreUnknownKeys = true }, server.url("/suggestion/x/"))
    }

    @After
    fun tearDown() = server.close()

    // Extrait d'une vraie réponse pour « inter », raccourci.
    private val inter = """
        {"d":[
          {"i":{"imageUrl":"https://m.media-amazon.com/a.jpg"},"id":"tt0816692","l":"Interstellar","q":"feature","qid":"movie","rank":212,"y":2014},
          {"id":"nm0492639","l":"Bill Lawrence","rank":3878,"s":"Actor"},
          {"id":"tt1839578","l":"Person of Interest","q":"TV series","qid":"tvSeries","rank":182,"y":2011},
          {"id":"tt9999999","l":"Interlude","q":"TV episode","qid":"tvEpisode","rank":99999},
          {"id":"tt0816692","l":"Interstellar","qid":"movie"},
          {"id":"tt0478934","l":"The Last Bey of the Balkans","q":"TV mini-series","qid":"tvMiniSeries"}
        ],"q":"inter","v":1}
    """.trimIndent()

    @Test
    fun `seuls les films et séries restent, dans l'ordre d'IMDb et sans doublon`() = runTest {
        server.enqueue(MockResponse.Builder().body(inter).build())
        assertEquals(listOf("tt0816692", "tt1839578", "tt0478934"), imdb.titles("Inter"))
    }

    @Test
    fun `la saisie part en minuscules dans le chemin, sans les vidéos`() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"d":[]}""").build())
        imdb.titles("  Le   Seigneur ")
        val url = server.takeRequest().url
        assertEquals("/suggestion/x/le%20seigneur.json", url.encodedPath)
        assertEquals("0", url.queryParameter("includeVideos"))
    }

    @Test
    fun `une saisie déjà vue ne relance pas IMDb`() = runTest {
        server.enqueue(MockResponse.Builder().body(inter).build())
        val first = imdb.titles("inter")
        assertEquals(first, imdb.titles("INTER "))
        assertEquals(1, server.requestCount)
    }

    @Test(expected = java.io.IOException::class)
    fun `une erreur HTTP remonte pour laisser TMDB seul`() = runTest {
        server.enqueue(MockResponse.Builder().code(503).body("").build())
        imdb.titles("inter")
    }

    @Test
    fun `moins de deux caractères ne part pas`() = runTest {
        assertNull(ImdbSuggestions.slug(" a "))
        assertEquals(emptyList<String>(), imdb.titles("a"))
        assertEquals(0, server.requestCount)
    }
}
