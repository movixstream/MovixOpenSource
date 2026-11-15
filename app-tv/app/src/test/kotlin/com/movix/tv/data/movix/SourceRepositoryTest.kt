package com.movix.tv.data.movix

import com.movix.tv.data.tmdb.MediaType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList

class SourceRepositoryTest {
    private val server = MockWebServer()
    private val json = Json { ignoreUnknownKeys = true }
    private val requests = CopyOnWriteArrayList<RecordedRequest>()
    private lateinit var repo: SourceRepository

    @Before
    fun setUp() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val path = request.url.encodedPath
                return when {
                    path.startsWith("/api/fstream/movie/") -> MockResponse.Builder().body(
                        """{"success":true,"players":{"VFF":[{"url":"https://voe.sx/e/1","player":"Voe","m3u8Url":"https://relay/voe-proxy?url=a.m3u8"}]}}""",
                    ).build()
                    path.startsWith("/api/purstream/") -> MockResponse.Builder().code(502).body("""{"error":"Erreur temporaire PurStream"}""").build()
                    path.startsWith("/api/wiflix/") -> MockResponse.Builder().code(500).body("{}").build()
                    path.startsWith("/api/j1f/") -> MockResponse.Builder().body("pas du json").build()
                    else -> MockResponse.Builder().code(404).body("""{"error":"Not found"}""").build()
                }
            }
        }
        server.start()
        repo = SourceRepository(MovixApi(OkHttpClient(), json, server.url("/")), json)
    }

    @After
    fun tearDown() = server.close()

    @Test
    fun movieCallsEveryRouteWithResolveAndKeyButNoOrigin() = runTest {
        // Vrai temps : sous runTest, le délai par route expirerait aussitôt (temps virtuel).
        val sources = withContext(Dispatchers.Default) { repo.load(PlayRequest(MediaType.MOVIE, 42, imdbId = "tt0000042"), vipKey = "VIP-x") }
        assertEquals(1, sources.size)
        assertTrue(sources.single().playable)
        val paths = requests.map { it.url.encodedPath }.toSet()
        assertTrue("/api/imdb/movie/tt0000042" in paths)
        assertTrue("/api/purstream/movie/42/stream" in paths)
        assertTrue(paths.none { it.contains("swiftflux") })
        for (r in requests) {
            assertEquals("VIP-x", r.headers["x-access-key"])
            assertNull(r.headers["Origin"]); assertNull(r.headers["Referer"])
            val resolve = r.url.queryParameter("resolve")
            if (r.url.encodedPath.startsWith("/api/purstream") || r.url.encodedPath.startsWith("/api/kisskh")) assertNull(resolve)
            else assertEquals("1", resolve)
        }
    }

    @Test
    fun episodeRoutesCarrySeasonAndEpisode() = runTest {
        withContext(Dispatchers.Default) { repo.load(PlayRequest(MediaType.TV, 7, season = 2, episode = 5), vipKey = null) }
        val byPath = requests.associateBy { it.url.encodedPath }
        assertEquals("5", byPath["/api/fstream/tv/7/season/2"]?.url?.queryParameter("episode"))
        assertEquals("5", byPath["/api/cpasmal/tv/7/2/5"]?.url?.queryParameter("episode"))
        assertEquals("2", byPath["/api/drama/tv/7"]?.url?.queryParameter("season"))
        // Sans clé : ni resolve ni en-tête.
        assertTrue(requests.all { it.url.queryParameter("resolve") == null && it.headers["x-access-key"] == null })
        // Pas d'Omega pour une série (le serveur ne la résout pas).
        assertTrue(byPath.keys.none { it.startsWith("/api/imdb") })
    }
}
