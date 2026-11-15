package com.movix.app.proxy

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.net.InetAddress
import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE)
class CastMediaPreparerTest {
    private val access = MediaProxySessionAccess.castLan(
        InetAddress.getByName("192.168.90.2"),
        InetAddress.getByName("192.168.90.8"),
    )

    @Test
    fun servesInlineWebVttFromTheLanRelayWithoutAnUpstreamSubtitleRequest() {
        val requests = mutableListOf<MediaProxyTarget>()
        val upstream = object : MediaProxyUpstream {
            override fun execute(
                target: MediaProxyTarget,
                localRequestHeaders: Map<String, String>,
            ): MediaProxyUpstreamResponse {
                requests += target
                return MediaProxyUpstreamResponse(
                    200,
                    "OK",
                    mapOf("Content-Type" to "video/mp4"),
                    ByteArrayInputStream(byteArrayOf(0, 0, 0, 24, 102, 116, 121, 112)),
                    target.upstreamUrl,
                )
            }
        }
        val store = MediaProxySessionStore()
        val preparer = CastMediaPreparer(
            upstream,
            store,
            access,
            port = 28127,
            validateUrl = { URI(it) },
        )
        val vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBonjour\n"

        val prepared = preparer.prepare(
            CastPreparedSource(
                url = "https://cdn.example/movie.mp4",
                headers = emptyMap(),
                tracks = listOf(
                    CastPreparedTextTrack(
                        inlineVtt = vtt,
                        language = "fr",
                        active = true,
                    ),
                ),
            ),
        )

        assertEquals(1, requests.size)
        val trackParts = URI(prepared.textTracks.single().lanUrl).path
            .split('/')
            .filter(String::isNotEmpty)
        val first = requireNotNull(
            store.consumePreparedResponse(trackParts[1], trackParts[2]),
        )
        val second = requireNotNull(
            store.consumePreparedResponse(trackParts[1], trackParts[2]),
        )
        assertEquals("text/vtt; charset=utf-8", first.headers["Content-Type"])
        assertEquals(vtt, first.body.toString(Charsets.UTF_8))
        assertEquals(vtt, second.body.toString(Charsets.UTF_8))
    }

    @Test
    fun preparesMasterAndRepresentativeHlsWithOpaqueSubtitle() {
        val requests = mutableListOf<MediaProxyTarget>()
        val upstream = object : MediaProxyUpstream {
            override fun execute(
                target: MediaProxyTarget,
                localRequestHeaders: Map<String, String>,
            ): MediaProxyUpstreamResponse {
                requests += target
                val (contentType, body) = when {
                    target.upstreamUrl.endsWith("master.m3u8") ->
                        "application/octet-stream" to
                            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmedia.m3u8\n"
                    target.upstreamUrl.endsWith("media.m3u8") ->
                        "application/vnd.apple.mpegurl" to
                            "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6,\nchunk.m4s\n"
                    else -> "text/vtt" to "WEBVTT\n\n00:00.000 --> 00:01.000\nBonjour\n"
                }
                return MediaProxyUpstreamResponse(
                    200,
                    "OK",
                    mapOf("Content-Type" to contentType),
                    ByteArrayInputStream(body.toByteArray()),
                    target.upstreamUrl,
                )
            }
        }
        val store = MediaProxySessionStore()
        val preparer = CastMediaPreparer(
            upstream,
            store,
            access,
            port = 28127,
            validateUrl = { URI(it) },
        )

        val prepared = preparer.prepare(
            CastPreparedSource(
                url = "https://cdn.example/master.m3u8",
                headers = mapOf("Referer" to "https://player.example/"),
                tracks = listOf(
                    CastPreparedTextTrack(
                        url = "https://cdn.example/subtitles/fr.vtt?token=secret",
                        language = "fr",
                        name = "Français",
                        headers = mapOf(
                            "Referer" to "https://subtitles.example/",
                            "Authorization" to "must-not-pass",
                        ),
                        active = true,
                    ),
                ),
            ),
        )

        assertEquals(CastMediaProfile.hlsFmp4(), prepared.profile)
        assertEquals("application/x-mpegurl", prepared.profile.contentType)
        assertTrue(prepared.lanContentUrl.contains("/cast/"))
        assertFalse(prepared.lanContentUrl.contains("cdn.example"))
        assertEquals(1, prepared.textTracks.size)
        assertTrue(prepared.textTracks.single().lanUrl.contains("/cast/"))
        assertFalse(prepared.textTracks.single().lanUrl.contains("token=secret"))
        assertEquals("fr", prepared.textTracks.single().language)
        assertTrue(prepared.textTracks.single().active)
        assertEquals(3, requests.size)
        assertTrue(requests.take(2).all {
            it.headers["Referer"] == "https://player.example/"
        })
        assertEquals(
            "https://subtitles.example/",
            requests.last().headers["Referer"],
        )
        assertFalse(requests.last().headers.containsKey("Authorization"))

        val rootResource = URI(prepared.lanContentUrl).path
            .split('/')
            .filter(String::isNotEmpty)[2]
        assertNotNull(
            store.consumePreparedResponse(prepared.sessionId, rootResource),
        )
    }

    @Test
    fun detectsTransportStreamAndAcceptsPublicSourcesWithEmptyHeaders() {
        val upstream = fixedResponse(
            200,
            "application/x-mpegurl",
            "#EXTM3U\n#EXTINF:6,\nsegment.ts\n",
        )
        val preparer = CastMediaPreparer(
            upstream,
            MediaProxySessionStore(),
            access,
            28127,
            validateUrl = { URI(it) },
        )

        val prepared = preparer.prepare(
            CastPreparedSource("https://cdn.example/live", emptyMap()),
        )

        assertEquals(CastMediaProfile.hlsTs(), prepared.profile)
    }

    @Test
    fun wrapsDirectFmp4MediaPlaylistInPersistentLocalMaster() {
        val mediaPlaylist =
            "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MAP:URI=\"init.mp4\"\n" +
                "#EXTINF:4,\nsegment-0001.m4s\n#EXT-X-ENDLIST\n"
        val store = MediaProxySessionStore()
        val preparer = CastMediaPreparer(
            fixedResponse(200, "application/vnd.apple.mpegurl", mediaPlaylist),
            store,
            access,
            28127,
            validateUrl = { URI(it) },
        )

        val prepared = preparer.prepare(
            CastPreparedSource("https://cdn.example/video.m3u8", emptyMap()),
        )

        assertEquals(CastMediaProfile.hlsFmp4(), prepared.profile)
        val rootParts = URI(prepared.lanContentUrl).path
            .split('/')
            .filter(String::isNotEmpty)
        val sessionId = rootParts[1]
        val rootResourceId = rootParts[2]
        val firstMaster = requireNotNull(
            store.consumePreparedResponse(sessionId, rootResourceId),
        ).body.toString(Charsets.UTF_8)
        val secondMaster = requireNotNull(
            store.consumePreparedResponse(sessionId, rootResourceId),
        ).body.toString(Charsets.UTF_8)

        assertEquals(firstMaster, secondMaster)
        assertTrue(firstMaster.contains("#EXT-X-STREAM-INF:BANDWIDTH=2000000"))
        val mediaUrl = firstMaster.lineSequence()
            .first { it.startsWith("http://") }
        assertFalse(mediaUrl == prepared.lanContentUrl)
        val mediaResourceId = URI(mediaUrl).path
            .split('/')
            .filter(String::isNotEmpty)[2]
        assertEquals(
            mediaPlaylist,
            requireNotNull(
                store.consumePreparedResponse(sessionId, mediaResourceId),
            ).body.toString(Charsets.UTF_8),
        )
        assertEquals(
            "https://cdn.example/video.m3u8",
            store.resolveCast(sessionId, mediaResourceId)?.upstreamUrl,
        )
    }

    @Test
    fun warmsCombinedSeekPlaylistAndRejectsUnrelatedSiblingMaster() {
        val requests = mutableListOf<MediaProxyTarget>()
        val mediaPlaylist =
            "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MAP:URI=\"init.mp4\"\n" +
                "#EXTINF:4,\nsegment-0001.m4s\n#EXT-X-ENDLIST\n"
        val unrelatedMaster =
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n" +
                "index-f1-v1.m3u8?v=123\n"
        val upstream = object : MediaProxyUpstream {
            override fun execute(
                target: MediaProxyTarget,
                localRequestHeaders: Map<String, String>,
            ): MediaProxyUpstreamResponse {
                requests += target
                val path = URI(target.upstreamUrl).path
                val (contentType, body) = when {
                    path.endsWith("master.m3u8") || path.endsWith("index.m3u8") ->
                        "application/vnd.apple.mpegurl" to unrelatedMaster.toByteArray()
                    path.endsWith(".m3u8") ->
                        "application/vnd.apple.mpegurl" to mediaPlaylist.toByteArray()
                    path.endsWith("init.mp4") -> "video/mp4" to ByteArray(1_175)
                    path.endsWith("segment-0001.m4s") -> "video/mp4" to ByteArray(70_000)
                    else -> "application/octet-stream" to ByteArray(0)
                }
                return MediaProxyUpstreamResponse(
                    200,
                    "OK",
                    mapOf("Content-Type" to contentType),
                    ByteArrayInputStream(body),
                    target.upstreamUrl,
                )
            }
        }
        val store = MediaProxySessionStore()
        val preparer = CastMediaPreparer(
            upstream,
            store,
            access,
            28127,
            validateUrl = { URI(it) },
        )
        val combinedUrl =
            "https://cdn.example/asset/index-f1-v1-a1.m3u8?v=123"

        val prepared = preparer.prepare(
            CastPreparedSource(
                combinedUrl,
                mapOf("Referer" to "https://player.example/"),
            ),
        )

        val warmup = requests.single {
            URI(it.upstreamUrl).path.endsWith("segment-0001.m4s")
        }
        assertEquals("bytes=0-65535", warmup.headers["Range"])
        assertEquals("https://player.example/", warmup.headers["Referer"])
        val rootParts = URI(prepared.lanContentUrl).path
            .split('/')
            .filter(String::isNotEmpty)
        val rootMaster = requireNotNull(
            store.consumePreparedResponse(rootParts[1], rootParts[2]),
        ).body.toString(Charsets.UTF_8)
        assertFalse(rootMaster.contains("index-f1-v1.m3u8?v=123"))
        assertFalse(rootMaster.contains("#EXT-X-MEDIA:TYPE=AUDIO"))
        val localMediaUrl = rootMaster.lineSequence().last { it.startsWith("http://") }
        val mediaResourceId = URI(localMediaUrl).path
            .split('/')
            .filter(String::isNotEmpty)[2]
        assertEquals(
            combinedUrl,
            store.resolveCast(rootParts[1], mediaResourceId)?.upstreamUrl,
        )

        requests.clear()
        preparer.prepare(
            CastPreparedSource(
                "https://cdn.example/asset/index-f1-v1.m3u8?v=999",
                mapOf("Referer" to "https://player.example/"),
            ),
        )
        assertFalse(requests.any {
            URI(it.upstreamUrl).path.endsWith("segment-0001.m4s")
        })
    }

    @Test
    fun discoversMatchingMasterBesideRedirectedCombinedPlaylist() {
        val requests = mutableListOf<MediaProxyTarget>()
        val originalUrl =
            "https://origin.example/start/index-f1-v1-a1.m3u8?v=9"
        val finalUrl =
            "https://cdn.example/asset/index-f1-v1-a1.m3u8?v=9"
        val mediaPlaylist =
            "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MAP:URI=\"init.mp4\"\n" +
                "#EXTINF:4,\nsegment-0001.m4s\n#EXT-X-ENDLIST\n"
        val matchingMaster =
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=7777\n" +
                "index-f1-v1-a1.m3u8?v=9\n"
        data class ResponseFixture(
            val status: Int,
            val contentType: String,
            val body: ByteArray,
            val url: String,
        )
        val upstream = object : MediaProxyUpstream {
            override fun execute(
                target: MediaProxyTarget,
                localRequestHeaders: Map<String, String>,
            ): MediaProxyUpstreamResponse {
                requests += target
                val uri = URI(target.upstreamUrl)
                val fixture = when {
                    target.upstreamUrl == originalUrl -> ResponseFixture(
                        200,
                        "application/vnd.apple.mpegurl",
                        mediaPlaylist.toByteArray(),
                        finalUrl,
                    )
                    uri.host == "cdn.example" && uri.path.endsWith("master.m3u8") -> ResponseFixture(
                        200,
                        "application/vnd.apple.mpegurl",
                        matchingMaster.toByteArray(),
                        target.upstreamUrl,
                    )
                    uri.path.endsWith("init.mp4") ->
                        ResponseFixture(200, "video/mp4", ByteArray(1_175), target.upstreamUrl)
                    uri.path.endsWith("segment-0001.m4s") ->
                        ResponseFixture(206, "video/mp4", ByteArray(65_536), target.upstreamUrl)
                    else -> ResponseFixture(404, "text/plain", ByteArray(0), target.upstreamUrl)
                }
                return MediaProxyUpstreamResponse(
                    fixture.status,
                    if (fixture.status in 200..299) "OK" else "Not Found",
                    mapOf("Content-Type" to fixture.contentType),
                    ByteArrayInputStream(fixture.body),
                    fixture.url,
                )
            }
        }
        val store = MediaProxySessionStore()
        val preparer = CastMediaPreparer(
            upstream,
            store,
            access,
            28127,
            validateUrl = { URI(it) },
        )

        val prepared = preparer.prepare(CastPreparedSource(originalUrl, emptyMap()))
        val rootParts = URI(prepared.lanContentUrl).path
            .split('/')
            .filter(String::isNotEmpty)
        val rootMaster = requireNotNull(
            store.consumePreparedResponse(rootParts[1], rootParts[2]),
        ).body.toString(Charsets.UTF_8)

        assertTrue(rootMaster.contains("BANDWIDTH=7777"))
        assertTrue(requests.any {
            it.upstreamUrl.startsWith("https://cdn.example/asset/master.m3u8")
        })
        assertFalse(requests.any {
            it.upstreamUrl.startsWith("https://origin.example/start/master.m3u8")
        })
    }

    @Test
    fun detectsPngWrappedTsBehindMasterWithSeparateAudio() {
        val requests = mutableListOf<MediaProxyTarget>()
        val wrappedSegment = syntheticPngEnvelope() + syntheticTsPayload()
        val upstream = object : MediaProxyUpstream {
            override fun execute(
                target: MediaProxyTarget,
                localRequestHeaders: Map<String, String>,
            ): MediaProxyUpstreamResponse {
                requests += target
                val (contentType, body) = when {
                    target.upstreamUrl.endsWith("master.m3u8") ->
                        "application/vnd.apple.mpegurl" to """
                            #EXTM3U
                            #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="FranÃ§ais",LANGUAGE="fr",AUTOSELECT=NO,DEFAULT=NO,URI="index-f1-a1.m3u8?v=1"
                            #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="æ—¥æœ¬èªž",LANGUAGE="ja",AUTOSELECT=NO,DEFAULT=NO,URI="index-f1-a2.m3u8?v=1"
                            #EXT-X-STREAM-INF:BANDWIDTH=2168244,RESOLUTION=1920x1080,AUDIO="audio0"
                            index-f2-v1.m3u8?v=1
                        """.trimIndent().toByteArray()
                    target.upstreamUrl.contains("index-f2-v1.m3u8") ->
                        "application/vnd.apple.mpegurl" to
                            "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nsegment-0001.image?v=1\n#EXT-X-ENDLIST\n".toByteArray()
                    else -> "image/png" to wrappedSegment
                }
                return MediaProxyUpstreamResponse(
                    200,
                    "OK",
                    mapOf("Content-Type" to contentType),
                    ByteArrayInputStream(body),
                    target.upstreamUrl,
                )
            }
        }
        val preparer = CastMediaPreparer(
            upstream,
            MediaProxySessionStore(),
            access,
            28127,
            validateUrl = { URI(it) },
        )

        val prepared = preparer.prepare(
            CastPreparedSource(
                "https://cdn.example/master.m3u8",
                mapOf("Referer" to "https://player.example/"),
            ),
        )

        assertEquals(CastMediaProfile.hlsTs(requiresPngTsUnwrap = true), prepared.profile)
        assertEquals(3, requests.size)
        assertEquals(
            "bytes=0-${PngWrappedMpegTs.MAX_PROBE_BYTES - 1}",
            requests.last().headers["Range"],
        )
    }

    @Test
    fun detectsCombinedFmp4SegmentsDisguisedAsWoff2() {
        val requests = mutableListOf<MediaProxyTarget>()
        val tokens = ArrayDeque(
            listOf(
                "cast_session_woff2",
                "cast_resource_woff2_root",
                "cast_resource_woff2_media",
            ),
        )
        val upstream = object : MediaProxyUpstream {
            override fun execute(
                target: MediaProxyTarget,
                localRequestHeaders: Map<String, String>,
            ): MediaProxyUpstreamResponse {
                requests += target
                val path = URI(target.upstreamUrl).path
                val (contentType, body) = when {
                    path.endsWith("master.m3u8") ->
                        "application/vnd.apple.mpegurl" to
                            (
                                "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000\n" +
                                    "index-f1-v1-a1.m3u8\n"
                            ).toByteArray()
                    path.endsWith("index-f1-v1-a1.m3u8") ->
                        "application/vnd.apple.mpegurl" to
                            (
                                "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n" +
                                    "seg-1-f1-v1-a1.woff2\n#EXT-X-ENDLIST\n"
                            ).toByteArray()
                    else -> "video/mp4" to syntheticIsoBmffFragment()
                }
                return MediaProxyUpstreamResponse(
                    200,
                    "OK",
                    mapOf("Content-Type" to contentType),
                    ByteArrayInputStream(body),
                    target.upstreamUrl,
                )
            }
        }
        val preparer = CastMediaPreparer(
            upstream,
            MediaProxySessionStore(
                processSecret = "cast_process_woff2",
                tokenFactory = { tokens.removeFirst() },
            ),
            access,
            28127,
            validateUrl = { URI(it) },
        )

        val prepared = preparer.prepare(
            CastPreparedSource("https://cdn.example/master.m3u8", emptyMap()),
        )

        assertEquals(CastMediaProfile.hlsFmp4(), prepared.profile)
        assertEquals(3, requests.size)
        assertEquals(
            "bytes=0-${PngWrappedMpegTs.MAX_PROBE_BYTES - 1}",
            requests.last().headers["Range"],
        )
    }

    @Test
    fun detectsPlainMpegTsSegmentsDisguisedAsJpeg() {
        val requests = mutableListOf<MediaProxyTarget>()
        val tsSegment = ByteArray(188 * 4).also { bytes ->
            for (packet in 0 until 4) bytes[packet * 188] = 0x47
        }
        val upstream = object : MediaProxyUpstream {
            override fun execute(
                target: MediaProxyTarget,
                localRequestHeaders: Map<String, String>,
            ): MediaProxyUpstreamResponse {
                requests += target
                val path = URI(target.upstreamUrl).path
                val (contentType, body) = when {
                    path.endsWith("master.m3u8") ->
                        "application/vnd.apple.mpegurl" to
                            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000\nvideo.m3u8\n"
                                .toByteArray()
                    path.endsWith("video.m3u8") ->
                        "application/vnd.apple.mpegurl" to
                            "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg-1.jpg\n#EXT-X-ENDLIST\n"
                                .toByteArray()
                    else -> "image/jpeg" to tsSegment
                }
                return MediaProxyUpstreamResponse(
                    200,
                    "OK",
                    mapOf("Content-Type" to contentType),
                    ByteArrayInputStream(body),
                    target.upstreamUrl,
                )
            }
        }
        val preparer = CastMediaPreparer(
            upstream,
            MediaProxySessionStore(),
            access,
            28127,
            validateUrl = { URI(it) },
        )

        val prepared = preparer.prepare(
            CastPreparedSource("https://cdn.example/master.m3u8", emptyMap()),
        )

        assertEquals(CastMediaProfile.hlsTs(), prepared.profile)
        assertEquals(3, requests.size)
    }

    @Test
    fun probesDirectMediaWithoutBufferingTheFullBody() {
        val methods = mutableListOf<String>()
        val upstream = object : MediaProxyUpstream {
            override fun execute(
                target: MediaProxyTarget,
                localRequestHeaders: Map<String, String>,
            ): MediaProxyUpstreamResponse {
                methods += target.method
                return MediaProxyUpstreamResponse(
                    200,
                    "OK",
                    mapOf(
                        "Content-Type" to "video/mp4",
                        "Content-Length" to "999999999",
                        "Accept-Ranges" to "bytes",
                    ),
                    ByteArrayInputStream(ByteArray(0)),
                    target.upstreamUrl,
                )
            }
        }
        val preparer = CastMediaPreparer(
            upstream,
            MediaProxySessionStore(),
            access,
            28127,
            validateUrl = { URI(it) },
        )

        val prepared = preparer.prepare(
            CastPreparedSource("https://cdn.example/video", emptyMap()),
        )

        assertEquals(listOf("HEAD"), methods)
        assertEquals(CastMediaProfile.progressive("video/mp4"), prepared.profile)
    }

    @Test
    fun rejectsOversizedUnsupportedAndErrorResponses() {
        val oversized = "#EXTM3U\n" + "x".repeat(600_000)
        for (upstream in listOf(
            fixedResponse(200, "application/x-mpegurl", oversized),
            fixedResponse(200, "application/x-mpegurl", "#EXTM3U\n#EXT-X-TARGETDURATION:6\n"),
            fixedResponse(503, "text/plain", "unavailable"),
        )) {
            val preparer = CastMediaPreparer(
                upstream,
                MediaProxySessionStore(),
                access,
                28127,
                validateUrl = { URI(it) },
            )
            assertThrows(CastMediaPreparationException::class.java) {
                preparer.prepare(
                    CastPreparedSource("https://cdn.example/media", emptyMap()),
                )
            }
        }
    }

    private fun fixedResponse(
        status: Int,
        contentType: String,
        body: String,
    ) = object : MediaProxyUpstream {
        override fun execute(
            target: MediaProxyTarget,
            localRequestHeaders: Map<String, String>,
        ) = MediaProxyUpstreamResponse(
            status,
            if (status == 200) "OK" else "Error",
            mapOf("Content-Type" to contentType),
            ByteArrayInputStream(body.toByteArray()),
            target.upstreamUrl,
        )
    }

    private fun syntheticPngEnvelope(): ByteArray {
        val signature = byteArrayOf(
            0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        )
        return signature +
            syntheticPngChunk("IHDR", ByteArray(13)) +
            syntheticPngChunk("IDAT", byteArrayOf(1, 2, 3)) +
            syntheticPngChunk("IEND", ByteArray(0))
    }

    private fun syntheticPngChunk(type: String, data: ByteArray): ByteArray {
        val output = ByteArrayOutputStream()
        DataOutputStream(output).use {
            it.writeInt(data.size)
            it.write(type.toByteArray(Charsets.US_ASCII))
            it.write(data)
            it.writeInt(0)
        }
        return output.toByteArray()
    }

    private fun syntheticTsPayload(): ByteArray = ByteArray(3 * 188).also { bytes ->
        repeat(3) { packet -> bytes[packet * 188] = 0x47 }
    }

    private fun syntheticIsoBmffFragment(): ByteArray = byteArrayOf(
        0, 0, 0, 16,
        's'.code.toByte(), 't'.code.toByte(), 'y'.code.toByte(), 'p'.code.toByte(),
        'm'.code.toByte(), 's'.code.toByte(), 'd'.code.toByte(), 'h'.code.toByte(),
        0, 0, 0, 0,
    )
}
