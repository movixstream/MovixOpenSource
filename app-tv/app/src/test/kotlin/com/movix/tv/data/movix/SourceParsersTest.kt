package com.movix.tv.data.movix

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Réponses écrites d'après le contrat serveur (API/Mainapi/routes, 2026-10-15). */
class SourceParsersTest {
    private fun j(s: String) = Json.parseToJsonElement(s)
    private val proxy = "https://proxiesembed.movix.men"

    @Test
    fun linksMovieWithResolvedMaps() {
        val list = SourceParsers.links(j("""
            {"success":true,"type":"movie","data":{"id":1,"links":[
              "https://uqload.is/embed-abc.html",
              {"url":"https://cdn.exemple/film.mp4","label":"Viblix","language":"Français","isVip":false},
              {"url":"https://voe.sx/e/xyz","language":"VOSTFR"}]},
             "m3u8ByPlayer":{"https://uqload.is/embed-abc.html":"$proxy/uqload-proxy?url=x&exp=1&sig=s"},
             "subtitlesByPlayer":{"https://uqload.is/embed-abc.html":[{"url":"https://s/fr.vtt","label":"Français","lang":"fr","format":"vtt","default":true},{"url":"http://non-https.srt","lang":"en","format":"srt"}]}}
        """))
        assertEquals(3, list.size)
        val uq = list[0]
        assertEquals("$proxy/uqload-proxy?url=x&exp=1&sig=s", uq.streamUrl)
        assertEquals(StreamKind.FILE, uq.kind) // uqload : fichier MP4 via le relais
        assertEquals("uqload", uq.host)
        assertEquals(1, uq.subtitles.size) // l'URL non https est écartée
        assertTrue(uq.subtitles[0].isDefault)
        val mp4 = list[1]
        assertEquals("https://cdn.exemple/film.mp4", mp4.streamUrl)
        assertNull(mp4.embedUrl)
        assertEquals(Lang.VF, mp4.language)
        val voe = list[2]
        assertNull(voe.streamUrl)
        assertEquals(Lang.VOSTFR, voe.language)
    }

    @Test
    fun linksTvTakesFirstRow() {
        val list = SourceParsers.links(j("""{"success":true,"type":"tv","data":[{"season_number":1,"episode_number":2,"links":["https://vidmoly.to/embed-1.html"]}]}"""))
        assertEquals("vidmoly", list.single().host)
    }

    @Test
    fun coflixPrefersCurrentEpisode() {
        val list = SourceParsers.coflix(j("""
            {"player_links":[{"decoded_url":"https://old/1"}],
             "current_episode":{"player_links":[{"decoded_url":"https://voe.sx/e/1","quality":"HD","language":"French","m3u8Url":"$proxy/voe-proxy?url=a.m3u8"}]}}
        """))
        val s = list.single()
        assertEquals(Provider.COFLIX, s.provider)
        assertEquals(Lang.VF, s.language)
        assertEquals(StreamKind.HLS, s.kind)
        assertTrue(s.playable)
    }

    @Test
    fun fstreamMovieAndEpisode() {
        val movie = SourceParsers.fstream(j("""
            {"success":true,"players":{"VOSTFR":[{"url":"https://vidzy.org/e/2","player":"Vidzy","quality":"HD"}],
              "VFF":[{"url":"https://fsvid.lol/e/1","player":"Premium","quality":"HD","m3u8Url":"$proxy/fsvid-proxy?url=b&exp=1&sig=z"}]}}
        """), null)
        // Catégories dans l'ordre VFQ, VFF, VOSTFR, Default.
        assertEquals(listOf(Lang.VF, Lang.VOSTFR), movie.map { it.language })
        // « premium » est le Fsvid de FStream ; la qualité suit le nom, comme sur le site.
        assertEquals("VFF - Fsvid HD", movie[0].label)
        assertTrue(movie[0].playable)

        val ep = SourceParsers.fstream(j("""
            {"success":true,"episodes":{"3":{"number":3,"languages":{"VF":[{"url":"https://uqload.is/e/3","player":"Uqload","m3u8Url":"$proxy/uqload-proxy?url=c"}]}},
                                        "4":{"number":4,"languages":{"VF":[{"url":"https://uqload.is/e/4"}]}}}}
        """), 3)
        assertEquals("https://uqload.is/e/3", ep.single().embedUrl)
    }

    @Test
    fun wiflixJ1fSwiftflowShapes() {
        val movie = SourceParsers.vfVostfr(Provider.WIFLIX, j("""
            {"success":true,"players":{"vf":[{"name":"voe.sx","url":"https://voe.sx/e/9","type":"VF","m3u8Url":"$proxy/voe-proxy?url=d"}],"vostfr":[{"name":"vidmoly","url":"https://vidmoly.to/e/8"}]}}
        """), null)
        assertEquals(2, movie.size)
        assertEquals("Lynx VF - voe.sx", movie[0].label)
        assertEquals(Lang.VOSTFR, movie[1].language)

        // Série : l'épisode EST la carte des langues.
        val ep = SourceParsers.vfVostfr(Provider.J1F, j("""{"success":true,"episodes":{"2":{"vf":[{"name":"x","url":"https://voe.sx/e/2"}],"vostfr":[],"label":""}}}"""), 2)
        assertEquals(1, ep.size)
    }

    @Test
    fun pendingIsDetected() {
        assertTrue(SourceParsers.isPending(j("""{"success":false,"pending":true,"tmdb_id":1}""")))
        assertEquals(false, SourceParsers.isPending(j("""{"success":true}""")))
    }

    @Test
    fun viperLabelsAndResolve() {
        val list = SourceParsers.viper(j("""{"title":"T","links":{"vf":[{"server":"Voe","url":"https://voe.sx/e/5","m3u8Url":"$proxy/voe-proxy?u"}],"vostfr":[{"server":"Dood","url":"https://dood.to/e/6"}]}}"""))
        assertEquals("Viper VF - Voe 1", list[0].label)
        assertEquals("doodstream", list[1].host)
    }

    @Test
    fun purstreamIsDirectlyPlayable() {
        val list = SourceParsers.purstream(j("""{"purstream_id":1,"sources":[{"url":"$proxy/cinep-proxy?url=e&exp=1&sig=q","name":"pur | 1080p | VF","format":"m3u8"}]}"""))
        val s = list.single()
        assertEquals("1080p - VF", s.label)
        assertEquals(StreamKind.HLS, s.kind)
        assertTrue(s.playable)
    }

    @Test
    fun kisskhKeepsOnlyClearSubtitles() {
        val list = SourceParsers.kisskh(j("""
            {"match":{"tmdbId":1,"season":1,"episode":1},"sources":[{"id":"kisskh-primary","label":"KissKH","type":"hls","url":"$proxy/kisskh-proxy?url=f"}],
             "subtitles":[{"id":"1","lang":"fr","label":"Français","format":"srt","proxyUrl":"$proxy/kisskh-proxy?sub=1","cipher":{"mode":"none"}},
                          {"id":"2","lang":"en","label":"English","format":"txt2","proxyUrl":"$proxy/kisskh-proxy?sub=2","cipher":{"mode":"aes-128-cbc"}}]}
        """))
        assertEquals("fr", list.single().subtitles.single().lang)
    }

    @Test
    fun voxAndOmega() {
        assertEquals("VoirDrama", SourceParsers.vox(j("""{"success":true,"data":[{"name":"VoirDrama","link":"https://x.example/e/1"}]}""")).single().label)
        val omega = SourceParsers.omega(j("""{"iframe_src":null,"player_links":[{"player":"Supervideo","link":"https://supervideo.cc/e/1","is_hd":true}]}"""))
        assertEquals("HD", omega.single().quality)
        assertEquals("supervideo", omega.single().host)
    }

    @Test
    fun garbageGivesEmptyLists() {
        val junk = j("""{"message":"Contenu non disponible"}""")
        assertTrue(SourceParsers.links(junk).isEmpty())
        assertTrue(SourceParsers.coflix(junk).isEmpty())
        assertTrue(SourceParsers.fstream(junk, 1).isEmpty())
        assertTrue(SourceParsers.vfVostfr(Provider.WIFLIX, j("[]"), null).isEmpty())
        assertTrue(SourceParsers.viper(null).isEmpty())
    }

    @Test
    fun languageNormalisation() {
        assertEquals(Lang.VF, SourceParsers.language("VFQ"))
        assertEquals(Lang.VF, SourceParsers.language("Français"))
        assertEquals(Lang.VOSTFR, SourceParsers.language("vostfr"))
        assertEquals(Lang.VO, SourceParsers.language("English"))
        assertEquals(Lang.UNKNOWN, SourceParsers.language("Unknown"))
    }
}
