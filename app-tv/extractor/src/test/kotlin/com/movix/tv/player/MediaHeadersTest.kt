package com.movix.tv.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class MediaHeadersTest {
    @Test
    fun unknownHostKeepsSourceHeadersUntouched() {
        val input = mapOf("Referer" to "https://exemple.fr/", "X-Test" to "1")
        assertEquals(input, MediaHeaders.apply("https://cdn.exemple.fr/a.m3u8", input))
    }

    @Test
    fun fsvidApexUsesFs13OriginAndSignedChrome() {
        val h = MediaHeaders.apply("https://fsvid.lol/hls/master.m3u8", emptyMap())
        assertEquals("https://fs13.lol", h["Origin"])
        assertEquals("https://fs13.lol/", h["Referer"])
        assertEquals(MediaHeaders.SIGNED_USER_AGENT, h["User-Agent"])
        assertEquals(MediaHeaders.SEC_CH_UA, h["Sec-Ch-Ua"])
        assertEquals("?0", h["Sec-Ch-Ua-Mobile"])
        assertEquals("\"Windows\"", h["Sec-Ch-Ua-Platform"])
        assertEquals(MediaHeaders.ACCEPT_LANGUAGE, h["Accept-Language"])
        assertEquals("cross-site", h["Sec-Fetch-Site"])
    }

    @Test
    fun fsvidSubdomainSegmentsUseFsvidOrigin() {
        val h = MediaHeaders.apply("https://s3.fsvid.lol/seg/001.ts", mapOf("referer" to "https://autre/"))
        assertEquals("https://fsvid.lol", h["Origin"])
        assertEquals("https://fsvid.lol/", h["Referer"])
        // L'ancien nom en minuscules est remplacé, pas doublé.
        assertNull(h["referer"])
    }

    @Test
    fun vidzyKeepsExistingRefererOtherwiseAddsOne() {
        assertEquals("https://vidzy.org/", MediaHeaders.apply("https://cdn.vidzy.cc/a.m3u8", emptyMap())["Referer"])
        val kept = MediaHeaders.apply("https://vidzy.org/a.m3u8", mapOf("Referer" to "https://vidzy.cc/e/1"))
        assertEquals("https://vidzy.cc/e/1", kept["Referer"])
        assertNull(kept["Origin"])
        assertEquals(MediaHeaders.SIGNED_USER_AGENT, kept["User-Agent"])
    }

    @Test
    fun luluCdnReplaysExtractionIdentity() {
        val h = MediaHeaders.apply(
            "https://x7k2.tnmr.org/hls/index.m3u8",
            mapOf("User-Agent" to "WebView", "Sec-Ch-Ua" to "\"Chromium\";v=\"143\"", "Sec-Ch-Ua-Mobile" to ""),
        )
        assertEquals("https://lulustream.com", h["Origin"])
        assertEquals("https://lulustream.com/", h["Referer"])
        assertEquals(MediaHeaders.EXTRACTION_USER_AGENT, h["User-Agent"])
        assertEquals("\"Chromium\";v=\"143\"", h["Sec-Ch-Ua"])
        // Indice vide : retiré, jamais envoyé vide.
        assertFalse(h.containsKey("Sec-Ch-Ua-Mobile"))
        assertFalse(h.containsKey("Sec-Ch-Ua-Platform"))
    }

    @Test
    fun dotSuffixMatchesSubdomainsOnly() {
        // « tnmr.org » seul n'appartient pas à LuluStream, ni « s1q2105.com » à Vidara.
        assertNull(MediaHeaders.apply("https://tnmr.org/a.m3u8", emptyMap())["Origin"])
        assertNull(MediaHeaders.apply("https://s1q2105.com/a.ts", emptyMap())["Origin"])
        assertEquals("https://vidara.to", MediaHeaders.apply("https://s25-wyl7.s1q2105.com/a.ts", emptyMap())["Origin"])
        assertEquals("https://veev.to", MediaHeaders.apply("https://s-eu-1.veevcdn.co/a.ts", emptyMap())["Origin"])
        // Un nom sans point ne matche pas un domaine qui finit pareil.
        assertNull(MediaHeaders.apply("https://notveev.to/a.ts", emptyMap())["Origin"])
    }

    @Test
    fun hostnameParsing() {
        assertEquals("lulustream.com", MediaHeaders.hostnameOf("https://user:pw@LuluStream.com.:443/x"))
        assertEquals("[::1]", MediaHeaders.hostnameOf("http://[::1]:8080/"))
        assertNull(MediaHeaders.hostnameOf("/relatif.m3u8"))
        assertNull(MediaHeaders.hostnameOf("https:///rien"))
    }
}
