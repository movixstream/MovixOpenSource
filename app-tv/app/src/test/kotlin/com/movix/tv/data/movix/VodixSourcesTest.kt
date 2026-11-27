package com.movix.tv.data.movix

import com.movix.tv.data.tmdb.MediaType
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.security.MessageDigest

class VodixSourcesTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun solvedNonceStartsWithTheAskedZeroBits() = runBlocking {
        val challenge = "tp6crs.ac705f9bc114f8ed.a24CCoJ8OKbpGeAlvm6v_A"
        val nonce = VodixSources.solve(challenge, 16)
        val hash = MessageDigest.getInstance("SHA-256").digest("$challenge:$nonce".toByteArray())
        assertEquals(0, hash[0].toInt())
        assertEquals(0, hash[1].toInt())
        assertEquals("0", VodixSources.solve(challenge, 0))
    }

    @Test
    fun listIsSortedBestFirstAndKeepsValidCodesOnly() {
        val root = json.parseToJsonElement(
            """{"success":true,"base":"https://vodix.top","sources":[
              {"code":"aaaa1111","quality":"1080p","language":"VOSTFR","label":""},
              {"code":"bad code!","quality":"2160p","language":"MULTI"},
              {"code":"bbbb2222","quality":"1080p","language":"MULTI"},
              {"code":"cccc3333","quality":"2160p","language":"VFF"}]}""",
        )
        val (base, list) = VodixSources.parseList(root)!!
        assertEquals("vodix.top", base.host)
        assertEquals(listOf("cccc3333", "bbbb2222", "aaaa1111"), list.map { it.code })
        // Libellé vide : qualité et version à la place.
        assertEquals("Vodix 1080p VOSTFR", VodixSources.label(list[2]))
        assertNull(VodixSources.parseList(json.parseToJsonElement("""{"base":"","sources":[]}""")))
    }

    @Test
    fun fourKGivesWayToSmallerCopyOnlyWithout2160pDecoder() {
        val uhd = VodixSources.Listed("cccc3333", "2160p", "MULTI", null)
        val fhd = VodixSources.Listed("bbbb2222", "1080p", "VFF", null)
        val vo = VodixSources.Listed("dddd4444", "2160p", "VOSTFR", null)
        assertEquals(listOf(uhd, fhd, vo), VodixSources.forDevice(listOf(uhd, fhd, vo), decodes2160p = true))
        // MULTi et VFF sont la même version (VF) : la 4K part ; la VOSTFR, seule de sa version, reste.
        assertEquals(listOf(fhd, vo), VodixSources.forDevice(listOf(uhd, fhd, vo), decodes2160p = false))
    }

    @Test
    fun languagesMapToPlayerVersions() {
        assertEquals(Lang.VF, VodixSources.language("MULTI"))
        assertEquals(Lang.VF, VodixSources.language("TRUEFRENCH"))
        assertEquals(Lang.VF, VodixSources.language("VFQ"))
        assertEquals("VFQ", VodixSources.langTag("vfq"))
        assertNull(VodixSources.langTag("MULTI"))
        assertEquals(Lang.VOSTFR, VodixSources.language("VOSTFR"))
        assertEquals(Lang.VO, VodixSources.language("VO"))
        assertEquals(Lang.UNKNOWN, VodixSources.language(null))
    }

    @Test
    fun subtitlesStayOnManifestHostWithFrenchFirst() {
        val manifest = "https://vodix.top/media/x/y/tok/index.m3u8?v=0".toHttpUrl()
        val lists = listOf(
            json.parseToJsonElement(
                """[{"label":"English","language":"eng","url":"sub-0.vtt"},
                    {"label":"Sous-titres 2","language":"fre","url":"sub-1.vtt","forced":true},
                    {"language":"fre","url":"sub-2.vtt"},
                    {"language":"fre","url":"sub-3.sup","format":"bitmap"},
                    {"language":"fre","url":"https://ailleurs.example/x.vtt"}]""",
            ),
            null,
        )
        val tracks = VodixSources.parseSubtitles(manifest, lists, language = "VOSTFR")
        assertEquals(listOf("Français", "Français forcés", "Anglais · English"), tracks.map { it.label })
        assertEquals("https://vodix.top/media/x/y/tok/sub-2.vtt", tracks[0].url)
        // VOSTFR : les français complets d'office, et le Referer de Vodix pour les lire.
        assertTrue(tracks[0].isDefault)
        assertEquals(VodixSources.PLAY_HEADERS, tracks[0].headers)
        // VF : seulement les « forcés ».
        val vf = VodixSources.parseSubtitles(manifest, lists, language = "MULTI")
        assertEquals("Français forcés", vf.single { it.isDefault }.label)
    }

    @Test
    fun otherHostsAreRefused() {
        val base = "https://vodix.top".toHttpUrl()
        assertEquals("https://vodix.top/e/abcd/source", VodixSources.sameOrigin(base, "/e/abcd/source").toString())
        assertNull(VodixSources.sameOrigin(base, "https://evil.example/e/abcd/source"))
        assertFalse(VodixSources.sameOrigin(base, "//evil.example/x")?.host == "evil.example")
    }

    /**
     * Essai réel, sur PC : liste de la vraie Main API, défi, échange et
     * manifeste de Vodix. New York Unité Spéciale S28E04 (VOSTFR 1080p,
     * relevé le 2026-11-27).
     *
     * Lancer : `MOVIX_LIVE=1 ./gradlew :app:testDebugUnitTest --tests "*VodixSourcesTest*"`.
     */
    @Test
    fun liveEpisodeOpensAPlayableManifest() = runBlocking {
        assumeTrue("MOVIX_LIVE=1 pour l'essai réel", System.getenv("MOVIX_LIVE") == "1")
        val http = OkHttpClient()
        val api = MovixApi(http, json, "https://api.movix.men/".toHttpUrl())
        val sources = VodixSources(api, http, json).load(PlayRequest(MediaType.TV, 2734, 28, 4))
        assertTrue("aucune source Vodix", sources.isNotEmpty())
        val first = sources.first()
        assertEquals(Provider.VODIX, first.provider)
        val playlist = http.newCall(
            okhttp3.Request.Builder().url(first.streamUrl!!).apply { first.headers.forEach { (k, v) -> header(k, v) } }.build(),
        ).execute().use { it.body.string() }
        assertTrue(playlist, playlist.startsWith("#EXTM3U") && "CODECS=" in playlist)
    }
}
