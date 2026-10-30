package com.movix.tv.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserImpersonationTest {
    private fun List<String>.value(name: String): String? =
        firstOrNull { it.substringBefore(':').equals(name, ignoreCase = true) }?.substringAfter(':')?.trim()

    @Test
    fun routesOnlyFsvidAndVidzy() {
        for (url in listOf("https://r1.fsvid.lol/m.m3u8", "https://fsvid.lol/gk", "https://u14.vidzy.cc/a.ts", "https://V6.VIDZY.ORG./m.m3u8")) {
            assertTrue(url, BrowserImpersonation.requiresImpersonation(url))
        }
        for (url in listOf("https://vidzy.cc.attacker.example/m.m3u8", "https://notfsvid.lol/m.m3u8", "https://strm4.uqload.vc/m.m3u8", "nope")) {
            assertFalse(url, BrowserImpersonation.requiresImpersonation(url))
        }
    }

    @Test
    fun emitsTheChromeXhrHeadersInChromeOrder() {
        val input = MediaHeaders.apply("https://u14.vidzy.cc/hls2/master.m3u8", emptyMap())
        val lines = BrowserImpersonation.xhrHeaders("https://u14.vidzy.cc/hls2/master.m3u8", input, null, null)
        assertEquals(
            listOf(
                "sec-ch-ua-platform", "user-agent", "sec-ch-ua", "sec-ch-ua-mobile",
                "accept", "origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest",
                "referer", "accept-encoding", "accept-language", "priority",
            ),
            lines.map { it.substringBefore(':') },
        )
        // L'identité est celle du profil TLS, pas le Chrome 142 de MediaHeaders.
        assertEquals(BrowserImpersonation.USER_AGENT, lines.value("user-agent"))
        assertTrue(BrowserImpersonation.USER_AGENT.contains("Chrome/152."))
        assertEquals("https://vidzy.cc", lines.value("origin"))
        assertEquals("https://vidzy.cc/", lines.value("referer"))
        assertEquals("same-site", lines.value("sec-fetch-site"))
        assertEquals("gzip, deflate, br, zstd", lines.value("accept-encoding"))
        assertEquals(MediaHeaders.ACCEPT_LANGUAGE, lines.value("accept-language"))
    }

    @Test
    fun addsCookieAndRangeBeforePriority() {
        val lines = BrowserImpersonation.xhrHeaders("https://r1.fsvid.lol/seg-1.ts", emptyMap(), "fsv_pe=abc", "bytes=0-1023")
        assertEquals("fsv_pe=abc", lines.value("cookie"))
        assertEquals("bytes=0-1023", lines.value("range"))
        assertEquals("https://fsvid.lol", lines.value("origin"))
        assertEquals("priority: u=1, i", lines.last())
        // Même origine que la page : un XHR GET n'envoie pas Origin.
        val apex = BrowserImpersonation.xhrHeaders("https://fsvid.lol/gk", emptyMap(), null, null)
        assertNull(apex.value("origin"))
        assertEquals("same-origin", apex.value("sec-fetch-site"))
    }

    @Test
    fun parsesTheFinalResponseHeadAndDropsCompressedLength() {
        val parser = CurlResponseHeadParser()
        val raw = listOf(
            "HTTP/2 103\r\n", "link: </a.css>\r\n", "\r\n",
            "HTTP/2 200\r\n", "content-type: application/vnd.apple.mpegurl\r\n",
            "set-cookie: vz_pe=a; Path=/hls2/\r\n", "content-encoding: gzip\r\n", "content-length: 120\r\n", "\r\n",
        )
        val head = raw.mapNotNull(parser::accept).single()
        assertEquals(200, head.statusCode)
        assertEquals("application/vnd.apple.mpegurl", head.header("Content-Type"))
        val decoded = decodedCurlResponseHeaders(head.headerMap())
        assertFalse(decoded.keys.any { it.equals("content-length", ignoreCase = true) })
        assertFalse(decoded.keys.any { it.equals("content-encoding", ignoreCase = true) })
        val plain = mapOf("Content-Length" to listOf("42"))
        assertEquals(plain, decodedCurlResponseHeaders(plain))
    }
}
