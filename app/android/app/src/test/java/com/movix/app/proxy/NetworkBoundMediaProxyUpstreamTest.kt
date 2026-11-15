package com.movix.app.proxy

import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.net.Socket
import javax.net.SocketFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkBoundMediaProxyUpstreamTest {
    @Test
    fun usesOnlyTheSelectedNetworkForDnsAndSockets() {
        val socketFactory = RecordingSocketFactory()
        val binding = FakeNetworkBinding(
            socketFactory,
            mapOf(
                "cdn.example" to listOf(publicAddress()),
            ),
        )
        val upstream = NetworkBoundMediaProxyUpstream(
            network = binding,
            exchange = NetworkHttpExchange { client, request ->
                assertSame(socketFactory, client.socketFactory)
                assertEquals(listOf(publicAddress()), client.dns.lookup(request.url.host))
                NetworkExchangeResponse(
                    200,
                    "OK",
                    mapOf("Content-Type" to "video/mp4"),
                    ByteArrayInputStream(byteArrayOf(1, 2, 3)),
                    request.url.toString(),
                )
            },
        )

        upstream.execute(
            MediaProxyTarget("https://cdn.example/video.mp4", "GET", emptyMap()),
            emptyMap(),
        ).use {
            assertEquals(200, it.statusCode)
        }
        assertEquals(listOf("cdn.example"), binding.lookups)
    }

    @Test
    fun rejectsAnyPrivateDnsAnswerWithoutSystemFallback() {
        val binding = FakeNetworkBinding(
            RecordingSocketFactory(),
            mapOf(
                "cdn.example" to listOf(
                    publicAddress(),
                    InetAddress.getByName("192.168.1.20"),
                ),
            ),
        )
        val upstream = NetworkBoundMediaProxyUpstream(
            network = binding,
            exchange = NetworkHttpExchange { client, request ->
                client.dns.lookup(request.url.host)
                throw AssertionError("Private DNS must fail before exchange")
            },
        )

        assertThrows(Exception::class.java) {
            upstream.execute(
                MediaProxyTarget("https://cdn.example/video.mp4", "GET", emptyMap()),
                emptyMap(),
            )
        }
        assertEquals(listOf("cdn.example"), binding.lookups)
    }

    @Test
    fun revalidatesRedirectsBeforeFollowingThem() {
        val binding = FakeNetworkBinding(
            RecordingSocketFactory(),
            mapOf("cdn.example" to listOf(publicAddress())),
        )
        var calls = 0
        val upstream = NetworkBoundMediaProxyUpstream(
            network = binding,
            exchange = NetworkHttpExchange { client, request ->
                calls += 1
                client.dns.lookup(request.url.host)
                NetworkExchangeResponse(
                    302,
                    "Found",
                    mapOf("Location" to "https://127.0.0.1/private.m3u8"),
                    ByteArrayInputStream(ByteArray(0)),
                    request.url.toString(),
                )
            },
        )

        assertThrows(IllegalArgumentException::class.java) {
            upstream.execute(
                MediaProxyTarget("https://cdn.example/master.m3u8", "GET", emptyMap()),
                emptyMap(),
            )
        }
        assertEquals(1, calls)
        assertTrue(binding.lookups.none { it == "127.0.0.1" })
    }

    @Test
    fun addsBrowserFetchMetadataToEveryUpstreamRequest() {
        val binding = FakeNetworkBinding(
            RecordingSocketFactory(),
            mapOf("cdn.example" to listOf(publicAddress())),
        )
        val upstream = NetworkBoundMediaProxyUpstream(
            network = binding,
            exchange = NetworkHttpExchange { _, request ->
                assertEquals("cross-site", request.header("Sec-Fetch-Site"))
                assertEquals("cors", request.header("Sec-Fetch-Mode"))
                assertEquals("empty", request.header("Sec-Fetch-Dest"))
                NetworkExchangeResponse(
                    200,
                    "OK",
                    mapOf("Content-Type" to "application/vnd.apple.mpegurl"),
                    ByteArrayInputStream("#EXTM3U\n".toByteArray()),
                    request.url.toString(),
                )
            },
        )

        upstream.execute(
            MediaProxyTarget(
                "https://cdn.example/master.m3u8",
                "GET",
                emptyMap(),
            ),
            emptyMap(),
        ).use {
            assertEquals(200, it.statusCode)
        }
    }

    @Test
    fun preservesTheProviderEncodingProfileAndByteRanges() {
        for (host in listOf("r1.fsvid.lol", "u14.vidzy.cc", "strm4.uqload.vc", "strm1.uqload.bz")) {
            val binding = FakeNetworkBinding(
                RecordingSocketFactory(),
                mapOf(host to listOf(publicAddress())),
            )
            NetworkBoundMediaProxyUpstream(
                network = binding,
                exchange = NetworkHttpExchange { _, request ->
                    assertEquals(
                        if (host.contains("uqload")) {
                            "identity, gzip;q=0, deflate;q=0, br;q=0, zstd;q=0"
                        } else {
                            "gzip, deflate, br, zstd"
                        },
                        request.header("Accept-Encoding"),
                    )
                    assertEquals("bytes=0-1023", request.header("Range"))
                    NetworkExchangeResponse(
                        206, "Partial Content", mapOf("Content-Type" to "video/mp2t"),
                        ByteArrayInputStream(byteArrayOf(0x47)), request.url.toString(),
                    )
                },
            ).use { upstream ->
                upstream.execute(
                    MediaProxyTarget("https://$host/seg-1.ts?t=signed", "GET", emptyMap()),
                    mapOf("Range" to "bytes=0-1023", "Accept-Encoding" to "gzip"),
                ).use { assertEquals(206, it.statusCode) }
            }
        }
    }

    private fun publicAddress(): InetAddress =
        InetAddress.getByAddress(byteArrayOf(93, 184.toByte(), 216.toByte(), 34))
}

private class FakeNetworkBinding(
    override val socketFactory: SocketFactory,
    private val answers: Map<String, List<InetAddress>>,
) : NetworkBinding {
    val lookups = mutableListOf<String>()

    override fun getAllByName(hostname: String): List<InetAddress> {
        lookups += hostname
        return answers[hostname].orEmpty()
    }
}

private class RecordingSocketFactory : SocketFactory() {
    override fun createSocket(): Socket = Socket()
    override fun createSocket(host: String?, port: Int): Socket = Socket()
    override fun createSocket(
        host: String?,
        port: Int,
        localHost: InetAddress?,
        localPort: Int,
    ): Socket = Socket()

    override fun createSocket(host: InetAddress?, port: Int): Socket = Socket()
    override fun createSocket(
        address: InetAddress?,
        port: Int,
        localAddress: InetAddress?,
        localPort: Int,
    ): Socket = Socket()
}
