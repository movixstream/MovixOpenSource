package com.movix.tv.data.tmdb

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

class TmdbApiTest {
    private val server = MockWebServer()
    private val json = Json { ignoreUnknownKeys = true }
    private var key: String? = "k123"
    private lateinit var api: TmdbApi

    @Before
    fun setUp() {
        server.start()
        api = TmdbApi(OkHttpClient(), json, { key }, server.url("/3/"))
    }

    @After
    fun tearDown() = server.close()

    @Test
    fun listSendsKeyLanguageAndParamsWithoutOrigin() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"page":1,"results":[{"id":1,"title":"A","poster_path":"/a.jpg"}]}""").build())
        val page = api.list("/discover/movie", mapOf("with_genres" to "28"))
        val req = server.takeRequest()
        val url = req.url
        assertEquals("/3/discover/movie", url.encodedPath)
        assertEquals("k123", url.queryParameter("api_key"))
        assertEquals("fr-FR", url.queryParameter("language"))
        assertEquals("28", url.queryParameter("with_genres"))
        assertEquals("false", url.queryParameter("include_adult"))
        assertNull(req.headers["Origin"]); assertNull(req.headers["Referer"])
        assertEquals("A", page.results.single().title)
    }

    @Test
    fun rowCanOverrideIncludeAdult() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"results":[]}""").build())
        api.list("/discover/tv", mapOf("include_adult" to "true"))
        assertEquals("true", server.takeRequest().url.queryParameter("include_adult"))
    }

    @Test(expected = MissingTmdbKeyException::class)
    fun missingKeyFailsBeforeAnyRequest() = runTest {
        key = null
        api.list("/trending/all/week", emptyMap())
    }

    @Test(expected = TmdbException::class)
    fun httpErrorBecomesTmdbException() = runTest {
        server.enqueue(MockResponse.Builder().code(401).body("{}").build())
        api.details(MediaType.MOVIE, 1)
    }

    @Test
    fun seasonZeroIsHiddenInDetails() = runTest {
        server.enqueue(
            MockResponse.Builder().body(
                """{"id":7,"name":"S","number_of_seasons":2,"seasons":[{"season_number":0},{"season_number":1},{"season_number":2}]}""",
            ).build(),
        )
        val d = api.details(MediaType.TV, 7).toDetails(MediaType.TV)
        assertEquals(listOf(1, 2), d.seasonNumbers)
    }
}
