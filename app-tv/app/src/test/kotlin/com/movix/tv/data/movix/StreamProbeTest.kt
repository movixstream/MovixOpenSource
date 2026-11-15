package com.movix.tv.data.movix

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class StreamProbeTest {
    private val server = MockWebServer()

    /** MP4 « faststart » minimal : ftyp puis moov (une piste H.264 1280×720, une AAC). */
    private val mp4: ByteArray = run {
        fun u32(v: Int) = byteArrayOf((v ushr 24).toByte(), (v ushr 16).toByte(), (v ushr 8).toByte(), v.toByte())
        fun box(type: String, vararg c: ByteArray): ByteArray { val b = c.fold(ByteArray(0)) { a, x -> a + x }; return u32(8 + b.size) + type.toByteArray() + b }
        fun trak(w: Int, h: Int, cc: String) = box("trak", box("tkhd", ByteArray(76), u32(w shl 16), u32(h shl 16)),
            box("mdia", box("minf", box("stbl", box("stsd", ByteArray(4), u32(1), u32(16), cc.toByteArray(), ByteArray(8))))))
        box("ftyp", "isom".toByteArray()) + box("moov", trak(1280, 720, "avc1"), trak(0, 0, "mp4a")) + box("mdat", ByteArray(4096))
    }

    @Before
    fun setUp() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                "/low" -> MockResponse.Builder().body("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=864x360\n/v.m3u8\n").build()
                "/hd" -> MockResponse.Builder().body("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x800,CODECS=\"hvc1.1.6.L120.90,ec-3\"\n/v.m3u8\n").build()
                "/media" -> MockResponse.Builder().body("#EXTM3U\n#EXTINF:6.0,\nseg.ts\n").build()
                "/film.mp4" -> {
                    // Serveur qui gère Range, comme un CDN.
                    val (from, to) = request.headers["Range"]!!.removePrefix("bytes=").split('-').map { it.toLong() }
                    val end = minOf(to, mp4.size - 1L)
                    MockResponse.Builder().code(206).body(Buffer().write(mp4.copyOfRange(from.toInt(), end.toInt() + 1))).build()
                }
                "/slow" -> MockResponse.Builder().body("#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\n/v.m3u8\n")
                    .headersDelay(3, java.util.concurrent.TimeUnit.SECONDS).build()
                // Lien du relais sans extension : un MP4 servi à qui le prend pour du HLS (Range ou pas).
                "/relay" -> {
                    val range = request.headers["Range"]
                    if (range == null) MockResponse.Builder().body(Buffer().write(mp4)).build()
                    else {
                        val (from, to) = range.removePrefix("bytes=").split('-').map { it.toLong() }
                        val end = minOf(to, mp4.size - 1L)
                        MockResponse.Builder().code(206).body(Buffer().write(mp4.copyOfRange(from.toInt(), end.toInt() + 1))).build()
                    }
                }
                "/page" -> MockResponse.Builder().body("<html>lien expiré</html>").build()
                else -> MockResponse.Builder().code(403).build()
            }
        }
        server.start()
    }

    @After
    fun tearDown() = server.close()

    private fun source(path: String, kind: StreamKind = StreamKind.HLS) =
        PlaybackSource(Provider.FSTREAM, path, Lang.VF, streamUrl = server.url(path).toString(), kind = kind)

    @Test
    fun readsPlaylistsAndMp4Headers() = runBlocking {
        val low = source("/low"); val hd = source("/hd"); val media = source("/media"); val denied = source("/denied")
        val file = source("/film.mp4", StreamKind.FILE)
        val found = withContext(Dispatchers.Default) { StreamProbe(OkHttpClient()).variants(listOf(low, hd, media, denied, file)) }
        assertEquals(
            mapOf(
                low.id to listOf(Variant(486)),
                hd.id to listOf(Variant(1080, listOf("hvc1.1.6.L120.90", "ec-3"))),
                file.id to listOf(Variant(720, listOf("avc1", "mp4a"))),
            ),
            found,
        )
    }

    @Test
    fun givesUpOnSlowStreamsWithinTheBudget() = runBlocking {
        val slow = source("/slow"); val hd = source("/hd")
        val started = System.nanoTime()
        val found = withContext(Dispatchers.Default) { StreamProbe(OkHttpClient()).variants(listOf(slow, hd), totalMs = 1_000) }
        val tookMs = (System.nanoTime() - started) / 1_000_000
        assertEquals(setOf(hd.id), found.keys)
        assertTrue("attente trop longue : $tookMs ms", tookMs < 3_000)
    }

    // ---------- sonde d'une source seule (« Vérifier la qualité ») ----------

    @Test
    fun probeTellsDeadLinksFromUnannouncedQuality() = runBlocking {
        val probe = StreamProbe(OkHttpClient())
        withContext(Dispatchers.Default) {
            assertEquals(ProbeOutcome.Found(listOf(Variant(486))), probe.probe(source("/low"), 5_000))
            assertEquals(ProbeOutcome.Found(listOf(Variant(720, listOf("avc1", "mp4a")))), probe.probe(source("/film.mp4", StreamKind.FILE), 5_000))
            // Playlist de segments : le flux répond, mais sans résolution annoncée.
            assertEquals(ProbeOutcome.Unknown, probe.probe(source("/media"), 5_000))
            // Refus du serveur, ou page web à la place d'une playlist : lien mort.
            assertEquals(ProbeOutcome.Unreachable, probe.probe(source("/denied"), 5_000))
            assertEquals(ProbeOutcome.Unreachable, probe.probe(source("/page"), 5_000))
        }
    }

    @Test
    fun probeReadsStreamsWhoseKindWasGuessedWrong() = runBlocking {
        val probe = StreamProbe(OkHttpClient())
        withContext(Dispatchers.Default) {
            // MP4 pris pour du HLS, et playlist maîtresse prise pour un fichier.
            assertEquals(ProbeOutcome.Found(listOf(Variant(720, listOf("avc1", "mp4a")))), probe.probe(source("/relay"), 5_000))
            assertEquals(ProbeOutcome.Found(listOf(Variant(486))), probe.probe(source("/low", StreamKind.FILE), 5_000))
        }
    }

    @Test
    fun probeGivesUpAtItsOwnDelay() = runBlocking {
        val started = System.nanoTime()
        val outcome = withContext(Dispatchers.Default) { StreamProbe(OkHttpClient()).probe(source("/slow"), 1_000) }
        val tookMs = (System.nanoTime() - started) / 1_000_000
        assertEquals(ProbeOutcome.Unreachable, outcome)
        assertTrue("attente trop longue : $tookMs ms", tookMs < 3_000)
    }
}
