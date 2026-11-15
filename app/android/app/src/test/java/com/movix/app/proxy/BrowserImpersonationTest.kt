package com.movix.app.proxy

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserImpersonationTest {
    private fun headers(
        url: String,
        bridge: Map<String, String> = emptyMap(),
        local: Map<String, String> = emptyMap(),
        cookie: String? = null,
    ): List<String> = BrowserImpersonation.xhrHeaders(URI(url), bridge, local, cookie)

    private fun List<String>.value(name: String): String? =
        firstOrNull { it.substringBefore(':').equals(name, ignoreCase = true) }
            ?.substringAfter(':')
            ?.trim()

    @Test
    fun emitsTheChromeXhrHeadersInChromeOrder() {
        val lines = headers("https://u14.vidzy.cc/hls2/01/master.m3u8?t=x")
        assertEquals(
            listOf(
                "sec-ch-ua-platform", "user-agent", "sec-ch-ua", "sec-ch-ua-mobile",
                "accept", "origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest",
                "referer", "accept-encoding", "accept-language", "priority",
            ),
            lines.map { it.substringBefore(':') },
        )
        assertEquals("gzip, deflate, br, zstd", lines.value("accept-encoding"))
        assertEquals("*/*", lines.value("accept"))
        assertEquals("u=1, i", lines.value("priority"))
    }

    @Test
    fun keepsTheProfileIdentityOverTheBridgeOne() {
        // Le pont annonce un autre Chrome : le CDN verrait deux navigateurs.
        val lines = headers(
            "https://r1.fsvid.lol/hls2/master.m3u8",
            bridge = mapOf(
                "User-Agent" to "Mozilla/5.0 Chrome/142.0.0.0",
                "Sec-Ch-Ua" to "\"Chromium\";v=\"142\"",
                "Accept-Language" to "en-GB,en;q=0.9",
            ),
        )
        assertEquals(BrowserImpersonation.USER_AGENT, lines.value("user-agent"))
        assertEquals(BrowserImpersonation.SEC_CH_UA, lines.value("sec-ch-ua"))
        assertTrue(BrowserImpersonation.USER_AGENT.contains("Chrome/152."))
        assertTrue(BrowserImpersonation.SEC_CH_UA.contains("v=\"152\""))
        assertEquals("en-GB,en;q=0.9", lines.value("accept-language"))
    }

    @Test
    fun usesThePlayerPageOfTheCdnDomain() {
        val vidzyCc = headers("https://u14.vidzy.cc/a.m3u8", bridge = mapOf("Origin" to "https://vidzy.org"))
        assertEquals("https://vidzy.cc", vidzyCc.value("origin"))
        assertEquals("https://vidzy.cc/", vidzyCc.value("referer"))
        assertEquals("same-site", vidzyCc.value("sec-fetch-site"))

        val fsvid = headers("https://r1.fsvid.lol/a.m3u8")
        assertEquals("https://fsvid.lol", fsvid.value("origin"))
        assertEquals("same-site", fsvid.value("sec-fetch-site"))

        // Même origine que la page : un XHR GET n'envoie pas Origin.
        val apex = headers("https://fsvid.lol/gk")
        assertNull(apex.value("origin"))
        assertEquals("https://fsvid.lol/", apex.value("referer"))
        assertEquals("same-origin", apex.value("sec-fetch-site"))
    }

    @Test
    fun addsCookieAndPlayerHeadersBeforePriority() {
        val lines = headers(
            "https://u14.vidzy.cc/seg-1.ts",
            local = mapOf("Range" to "bytes=0-1023", "Accept-Language" to "ka-GE"),
            cookie = "vz_pe=abc",
        )
        assertEquals("vz_pe=abc", lines.value("cookie"))
        assertEquals("bytes=0-1023", lines.value("range"))
        // Accept-Language décrit l'identité épinglée par le pont, pas le lecteur.
        assertFalse(lines.contains("accept-language: ka-GE"))
        assertEquals("priority: u=1, i", lines.last())
    }

    @Test
    fun parsesTheFinalResponseHeadAndSkipsInterimOnes() {
        val parser = CurlResponseHeadParser()
        val raw = listOf(
            "HTTP/2 103\r\n", "link: </a.css>\r\n", "\r\n",
            "HTTP/2 200\r\n", "content-type: application/vnd.apple.mpegurl\r\n",
            "set-cookie: vz_pe=a; Path=/hls2/\r\n", "set-cookie: other=b\r\n",
            "content-encoding: gzip\r\n", "content-length: 120\r\n", "\r\n",
        )
        val heads = raw.mapNotNull(parser::accept)
        assertEquals(1, heads.size)
        val head = heads.single()
        assertEquals(200, head.statusCode)
        assertEquals("", head.statusMessage)
        assertEquals("application/vnd.apple.mpegurl", head.header("Content-Type"))
        assertEquals(2, head.fields.count { it.first == "set-cookie" })

        val decoded = decodedCurlResponseHeaders(head.mergedHeaders())
        assertFalse(decoded.keys.any { it.equals("content-encoding", ignoreCase = true) })
        assertFalse(decoded.keys.any { it.equals("content-length", ignoreCase = true) })
    }

    @Test
    fun keepsLengthWhenNothingWasDecoded() {
        val plain = mapOf("Content-Length" to "42", "Content-Type" to "video/mp2t")
        assertEquals(plain, decodedCurlResponseHeaders(plain))
        val unknown = mapOf("Content-Encoding" to "compress", "Content-Length" to "42")
        assertEquals(unknown, decodedCurlResponseHeaders(unknown))
    }

    @Test
    fun parsesHttp1StatusMessage() {
        val parser = CurlResponseHeadParser()
        assertNull(parser.accept("HTTP/1.1 302 Found\r\n"))
        assertNull(parser.accept("Location: /troll/master.m3u8\r\n"))
        val head = parser.accept("\r\n")!!
        assertEquals(302, head.statusCode)
        assertEquals("Found", head.statusMessage)
        assertEquals("/troll/master.m3u8", head.header("location"))
    }
}
