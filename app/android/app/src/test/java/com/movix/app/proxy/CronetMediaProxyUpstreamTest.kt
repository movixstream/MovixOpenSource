package com.movix.app.proxy

import java.io.ByteArrayInputStream
import java.net.URI
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CronetMediaProxyUpstreamTest {
    @Test
    fun deliversTheEntireDecodedFctvSegmentToAnHttpClient() {
        // Tailles relevées par ADB : Cronet décompresse le segment Brotli mais
        // conserve dans ses en-têtes la longueur reçue avant décompression.
        val segment = ByteArray(526_212) {
            if (it % 188 == 0) 0x47 else (it % 251).toByte()
        }
        val server = MediaProxyServer(
            upstream = object : MediaProxyUpstream {
                override fun execute(
                    target: MediaProxyTarget,
                    localRequestHeaders: Map<String, String>,
                ) = MediaProxyUpstreamResponse(
                    200,
                    "OK",
                    decodedCronetResponseHeaders(
                        mapOf(
                            "content-type" to "application/json",
                            "content-encoding" to "br",
                            "content-length" to "513183",
                        ),
                    ),
                    ByteArrayInputStream(segment),
                    target.upstreamUrl,
                )
            },
            validateUrl = { URI(it) },
        )
        try {
            val localUrl = server.open(
                "https://cdn.example/segment.json",
                "GET",
                mapOf("Referer" to "https://player.example/"),
            )
            // Un vrai client HTTP s'arrête à Content-Length, contrairement à
            // une lecture brute de la socket qui masquait la troncature.
            OkHttpClient().newCall(Request.Builder().url(localUrl).build()).execute().use {
                assertEquals(200, it.code)
                assertArrayEquals(segment, requireNotNull(it.body).bytes())
                assertEquals(null, it.header("Content-Length"))
                assertEquals(null, it.header("Content-Encoding"))
            }
        } finally {
            server.close()
        }
    }

    @Test
    fun removesEncodedFramingForCronetCompressionRegardlessOfHeaderCase() {
        for (encoding in listOf("br", "gzip", "x-gzip", "deflate", " GZip, BR ")) {
            val upstreamHeaders = linkedMapOf(
                "CoNtEnT-EnCoDiNg" to encoding,
                "content-length" to "120",
                "Content-Length" to "120",
                "Content-Type" to "video/mp2t",
                "Cache-Control" to "max-age=120",
            )
            val headers = decodedCronetResponseHeaders(upstreamHeaders)

            assertFalse(headers.keys.any { it.equals("Content-Length", ignoreCase = true) })
            assertFalse(headers.keys.any { it.equals("Content-Encoding", ignoreCase = true) })
            assertEquals("video/mp2t", headers["Content-Type"])
            assertEquals("max-age=120", headers["Cache-Control"])
            assertEquals(5, upstreamHeaders.size)
        }
    }

    @Test
    fun preservesUncompressedByteRangeFraming() {
        for (encoding in listOf(null, "identity", " IDENTITY ")) {
            val headers = linkedMapOf(
                "Content-Type" to "video/mp4",
                "Content-Length" to "188",
                "Content-Range" to "bytes 188-375/1000",
                "Accept-Ranges" to "bytes",
            )
            if (encoding != null) headers["Content-Encoding"] = encoding

            assertEquals(headers, decodedCronetResponseHeaders(headers))
        }
    }

    @Test
    fun decodesGzipPlaylistsFetchedWithAManualAcceptEncoding() {
        val playlist = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex-v1-a1.m3u8\n"
        val compressed = java.io.ByteArrayOutputStream().also { out ->
            java.util.zip.GZIPOutputStream(out).use { it.write(playlist.toByteArray()) }
        }.toByteArray()
        val headers = mapOf(
            "Content-Type" to "application/vnd.apple.mpegurl",
            "Content-Encoding" to "gzip",
            "Content-Length" to compressed.size.toString(),
        )

        val (decodedHeaders, body) = decodedManualResponse(
            "GET", 200, headers, ByteArrayInputStream(compressed),
        )

        assertEquals(playlist, body.readBytes().decodeToString())
        assertFalse(decodedHeaders.keys.any { it.equals("Content-Encoding", ignoreCase = true) })
        assertFalse(decodedHeaders.keys.any { it.equals("Content-Length", ignoreCase = true) })
        // HEAD : pas de corps à décoder, en-têtes intacts.
        assertEquals(
            headers,
            decodedManualResponse("HEAD", 200, headers, ByteArrayInputStream(ByteArray(0))).first,
        )
    }

    @Test
    fun doesNotAssumeAnUnknownEncodingWasDecoded() {
        val headers = mapOf(
            "Content-Encoding" to "custom-encoding",
            "Content-Length" to "188",
        )
        assertEquals(headers, decodedCronetResponseHeaders(headers))
    }
}
