package com.movix.tv.data.movix

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SourceSelectorTest {
    private fun src(
        provider: Provider,
        lang: Lang = Lang.VF,
        stream: String? = "https://relay/${provider.name}/${lang.name}",
        embed: String? = "https://${provider.name.lowercase()}.embed/${lang.name}",
        host: String? = null,
        kind: StreamKind = StreamKind.HLS,
    ) = PlaybackSource(provider, provider.label, lang, host = host, embedUrl = embed, streamUrl = stream, kind = kind)

    @Test
    fun vfBeforeVostfrWhateverTheRoute() {
        val list = SourceSelector.playable(listOf(src(Provider.FSTREAM, Lang.VOSTFR), src(Provider.PURSTREAM, embed = null)))
        assertEquals(Provider.PURSTREAM, list.first().provider)
    }

    @Test
    fun serverHlsBeforePurstreamBeforeCommunityFiles() {
        val list = SourceSelector.playable(listOf(
            src(Provider.LINKS, embed = null, kind = StreamKind.FILE),
            src(Provider.PURSTREAM, embed = null),
            src(Provider.WIFLIX),
            src(Provider.FSTREAM),
        ))
        assertEquals(listOf(Provider.FSTREAM, Provider.WIFLIX, Provider.PURSTREAM, Provider.LINKS), list.map { it.provider })
    }

    @Test
    fun hostOrderBreaksTies() {
        val list = SourceSelector.playable(listOf(
            src(Provider.WIFLIX, stream = "a", embed = "https://fsvid.lol/e/1", host = "fsvid"),
            src(Provider.WIFLIX, stream = "b", embed = "https://voe.sx/e/1", host = "voe"),
        ))
        assertEquals("voe", list.first().host)
    }

    @Test
    fun duplicatesAndUnplayableAreRemoved() {
        val embed = "https://voe.sx/e/same"
        val list = SourceSelector.playable(listOf(
            src(Provider.FSTREAM, stream = "s1", embed = embed),
            src(Provider.VIPER, stream = "s2", embed = embed), // même lecteur via une autre route
            src(Provider.WIFLIX, stream = "s1", embed = "https://other/e"), // même flux
            src(Provider.J1F, stream = null),
        ))
        assertEquals(listOf(Provider.FSTREAM), list.map { it.provider })
    }

    @Test
    fun deviceOnlyListsUnresolvedEmbeds() {
        val all = listOf(
            src(Provider.FSTREAM, stream = "s1", embed = "https://voe.sx/e/1"),
            src(Provider.VIPER, stream = null, embed = "https://voe.sx/e/1"), // déjà résolu ailleurs
            src(Provider.J1F, stream = null, embed = "https://vidmoly.to/e/2"),
        )
        assertEquals(listOf("https://vidmoly.to/e/2"), SourceSelector.deviceOnly(all).map { it.embedUrl })
    }

    @Test
    fun movieNeverStartsOnKisskhOrCoflixUnlessAlone() {
        val kiss = src(Provider.KISSKH, embed = null)
        val coflix = src(Provider.COFLIX)
        val bravo = src(Provider.PURSTREAM, lang = Lang.VOSTFR, embed = null)
        assertEquals(Provider.PURSTREAM, SourceSelector.pick(SourceSelector.playable(listOf(kiss, coflix, bravo)), isTv = false)?.provider)
        assertEquals(Provider.KISSKH, SourceSelector.pick(SourceSelector.playable(listOf(kiss, coflix)), isTv = true)?.provider)
        assertEquals(Provider.COFLIX, SourceSelector.pick(SourceSelector.playable(listOf(coflix)), isTv = false)?.provider)
        assertNull(SourceSelector.pick(emptyList(), isTv = false))
    }

    // ---------- qualité lue dans les playlists ----------

    private fun hls(provider: Provider, host: String, lang: Lang = Lang.VF) =
        src(provider, lang, stream = "https://relay/$host-proxy/${provider.name}/${lang.name}", embed = "https://$host.embed/${provider.name}/${lang.name}", host = host)

    /** Hauteurs lues, en notes lisibles ici. */
    private fun r(vararg h: Pair<PlaybackSource, Int>) = h.associate { (s, height) -> s.id to SourceSelector.Rating(height) }

    @Test
    fun hdSourceGoesFirstWithinTheLanguage() {
        // Cas réel : FStream VFQ - Vidzy en 864×360 lancé alors que Voe (Lynx) avait du 1728×720.
        val vidzy = hls(Provider.FSTREAM, "vidzy")
        val uqload = hls(Provider.FSTREAM, "uqload")
        val voe = hls(Provider.WIFLIX, "voe")
        val ranked = SourceSelector.playable(listOf(voe, uqload, vidzy))
        assertEquals(listOf(vidzy, uqload, voe), ranked) // ordre des routes seul : FStream d'abord
        val heights = r(vidzy to 486, uqload to 486, voe to 972)
        val sorted = SourceSelector.byQuality(ranked, heights)
        assertEquals(voe, SourceSelector.pick(sorted, isTv = false))
        assertEquals(listOf(voe, vidzy, uqload), sorted)
    }

    @Test
    fun vfStaysBeforeVostfrEvenInLowQuality() {
        val vf = hls(Provider.FSTREAM, "vidzy")
        val vostfr = hls(Provider.FSTREAM, "voe", Lang.VOSTFR)
        val sorted = SourceSelector.byQuality(SourceSelector.playable(listOf(vostfr, vf)), r(vf to 360, vostfr to 1080))
        assertEquals(vf, sorted.first())
        assertEquals(vf, SourceSelector.pick(sorted, isTv = false))
    }

    @Test
    fun unknownBeforeKnownLowAndBestLowFirst() {
        val a = hls(Provider.FSTREAM, "voe")
        val b = hls(Provider.WIFLIX, "voe")
        val c = hls(Provider.VIPER, "voe")
        val d = hls(Provider.J1F, "voe")
        val ranked = SourceSelector.playable(listOf(a, b, c, d))
        // a 360p, b inconnu (pas de réponse), c 480p, d 720p.
        val sorted = SourceSelector.byQuality(ranked, r(a to 360, c to 480, d to 720))
        assertEquals(listOf(d, b, c, a), sorted)
    }

    @Test
    fun routeOrderKeptAmongHdAndWithoutProbe() {
        val a = hls(Provider.FSTREAM, "vidzy")
        val b = hls(Provider.WIFLIX, "voe")
        val ranked = SourceSelector.playable(listOf(b, a))
        assertEquals(ranked, SourceSelector.byQuality(ranked, emptyMap()))
        assertEquals(ranked, SourceSelector.byQuality(ranked, r(a to 720, b to 1080)))
    }

    @Test
    fun probeCandidatesAreOfThePickedLanguage() {
        val vf = hls(Provider.FSTREAM, "vidzy")
        val vostfr = hls(Provider.WIFLIX, "voe", Lang.VOSTFR)
        val file = src(Provider.LINKS, embed = null, kind = StreamKind.FILE)
        val coflix = hls(Provider.COFLIX, "voe")
        val kiss = src(Provider.KISSKH, embed = null)
        val playable = SourceSelector.playable(listOf(vf, vostfr, file, coflix, kiss))
        assertEquals(listOf(vf, file), SourceSelector.probeCandidates(playable, isTv = false))
        assertEquals(listOf(vf, file, kiss), SourceSelector.probeCandidates(playable, isTv = true))
        assertEquals(1, SourceSelector.probeCandidates(playable, isTv = true, limit = 1).size)
        assertEquals(emptyList<PlaybackSource>(), SourceSelector.probeCandidates(emptyList(), isTv = false))
    }

    @Test
    fun masterPlaylistBestHeight() {
        val master = """
            #EXTM3U
            #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",NAME="Français",LANGUAGE="fr",URI="/a.m3u8"
            #EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=604440,RESOLUTION=864x360,CODECS="avc1.64001e,mp4a.40.2"
            /v1.m3u8
            #EXT-X-STREAM-INF:BANDWIDTH=1395370,RESOLUTION=1280x536,FRAME-RATE=25.000
            /v2.m3u8
            #EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=28634,RESOLUTION=3840x2160,URI="/iframes.m3u8"
        """.trimIndent()
        // 1280×536 (cinéma) vaut du 720p ; la variante I-frame 4K ne compte pas.
        assertEquals(720, HlsMaster.bestHeight(master))
        assertEquals(486, HlsMaster.bestHeight("#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=864x360\n/v.m3u8"))
        assertNull(HlsMaster.bestHeight("#EXTM3U\n#EXTINF:6.0,\nseg0.ts\n")) // playlist de segments
        assertNull(HlsMaster.bestHeight("<html>pas une playlist</html>"))
        assertNull(HlsMaster.bestHeight("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/v.m3u8")) // sans résolution
    }

    // ---------- codecs que l'appareil ne sait pas décoder ----------

    /** Télé sans décodeur H.265 ni Dolby Digital Plus. */
    private val noHevc: (String) -> Boolean = { it != "video/hevc" && it != "audio/eac3" }

    @Test
    fun masterPlaylistCodecs() {
        val v = HlsMaster.variants("#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,CODECS=\"hvc1.1.6.L120.90, ec-3\"\n/v.m3u8")
        assertEquals(listOf(Variant(1080, listOf("hvc1.1.6.L120.90", "ec-3"))), v)
    }

    @Test
    fun rateKeepsBestReadableVariant() {
        // H.265 en 1080p, H.264 en 720p : on lira le 720p.
        val both = listOf(Variant(1080, listOf("hvc1.1.6.L120.90", "mp4a.40.2")), Variant(720, listOf("avc1.64001f", "mp4a.40.2")))
        assertEquals(SourceSelector.Rating(720), SourceSelector.rate(both, noHevc))
        assertEquals(SourceSelector.Rating(1080), SourceSelector.rate(both) { true })
        // Rien de lisible : on dit quoi.
        val hevc = listOf(Variant(1080, listOf("hev1.1.6.L120.90", "ec-3")))
        assertEquals(SourceSelector.Rating(1080, listOf("video/hevc", "audio/eac3")), SourceSelector.rate(hevc, noHevc))
        // Codec inconnu ou absent : supposé lisible.
        assertEquals(SourceSelector.Rating(480), SourceSelector.rate(listOf(Variant(480, listOf("xyz1"))), noHevc))
        assertNull(SourceSelector.rate(emptyList(), noHevc))
    }

    @Test
    fun unreadableSourcesGoLastWithinTheLanguage() {
        val hevc = hls(Provider.FSTREAM, "vidzy")
        val low = hls(Provider.WIFLIX, "voe")
        val vostfr = hls(Provider.VIPER, "voe", Lang.VOSTFR)
        val ratings = mapOf(
            hevc.id to SourceSelector.Rating(2160, listOf("video/hevc")),
            low.id to SourceSelector.Rating(360),
        )
        val sorted = SourceSelector.byQuality(SourceSelector.playable(listOf(hevc, low, vostfr)), ratings)
        assertEquals(listOf(low, hevc, vostfr), sorted)
    }

    @Test
    fun declaredQualityCountsWhenNothingWasRead() {
        fun file(label: String, quality: String? = null) =
            PlaybackSource(Provider.PURSTREAM, label, Lang.VF, quality = quality, streamUrl = "https://cdn/$label.mp4", kind = StreamKind.FILE)
        assertEquals(1080, SourceSelector.declaredHeight(file("Bravo - pulse - 1080p - MULTI")))
        assertEquals(2160, SourceSelector.declaredHeight(file("SwiftFlux", quality = "4K")))
        assertEquals(1080, SourceSelector.declaredHeight(file("x", quality = "FHD")))
        assertNull(SourceSelector.declaredHeight(file("Viper", quality = "HD")))
        assertNull(SourceSelector.declaredHeight(file("Film 11080p"))) // pas une qualité
        // Un MP4 annoncé en 1080p passe devant un HLS lu en 360p.
        val mp4 = file("Bravo - pulse - 1080p - MULTI")
        val hlsLow = hls(Provider.FSTREAM, "vidzy")
        val sorted = SourceSelector.byQuality(SourceSelector.playable(listOf(hlsLow, mp4)), r(hlsLow to 486))
        assertEquals(mp4, sorted.first())
    }
}
