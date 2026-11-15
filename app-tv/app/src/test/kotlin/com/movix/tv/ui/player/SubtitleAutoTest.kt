package com.movix.tv.ui.player

import com.movix.tv.data.movix.Lang
import com.movix.tv.data.movix.PlaybackSource
import com.movix.tv.data.movix.Provider
import com.movix.tv.data.movix.SubtitleTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Sous-titres ouverts d'office d'après la préférence de lecture. */
class SubtitleAutoTest {
    private fun sub(lang: String, default: Boolean = false, from: String? = null) =
        SubtitleTrack("https://subs.test/$lang/${from ?: "source"}/$default", lang.uppercase(), lang, "vtt", default, source = from)

    private fun src(lang: Lang, vararg subs: SubtitleTrack) =
        PlaybackSource(Provider.FSTREAM, "Source", lang, streamUrl = "https://relay.test/${lang.name}", subtitles = subs.toList())

    private fun embedded(lang: String?, track: Int) = TrackOption("", 0, track, number = track + 1, language = lang)

    @Test
    fun withoutPreferenceTheOldRuleStays() {
        // Français d'office sur une VOSTFR, piste « par défaut » de la source, sinon rien.
        val fr = sub("fr")
        assertEquals(SubtitleChoice.External(fr), SubtitleAuto.pick(null, src(Lang.VOSTFR, sub("en"), fr), emptyList(), emptyList()))
        assertEquals(SubtitleChoice.Off, SubtitleAuto.pick(null, src(Lang.VF, fr), listOf(embedded("fr", 0)), listOf(sub("fr", from = "Shegu"))))
        val byDefault = sub("en", default = true)
        assertEquals(SubtitleChoice.External(byDefault), SubtitleAuto.pick(null, src(Lang.VF, byDefault), emptyList(), emptyList()))
    }

    @Test
    fun offPreferenceKeepsSubtitlesOffEvenOnVostfr() {
        assertEquals(SubtitleChoice.Off, SubtitleAuto.pick(SubtitleAuto.OFF, src(Lang.VOSTFR, sub("fr", default = true)), listOf(embedded("fr", 0)), emptyList()))
    }

    @Test
    fun sourceTracksFirstThenStreamTracksThenOnline() {
        val online = sub("fr", from = "OpenSubtitles")
        val ownFr = sub("fre")
        assertEquals(
            SubtitleChoice.External(ownFr),
            SubtitleAuto.pick("fr", src(Lang.VO, sub("en"), ownFr), listOf(embedded("fr", 1)), listOf(online)),
        )
        val streamFr = embedded("fr", 1)
        assertEquals(
            SubtitleChoice.Embedded(streamFr),
            SubtitleAuto.pick("fr", src(Lang.VO, sub("en")), listOf(embedded("en", 0), streamFr), listOf(online)),
        )
        // En ligne : la liste arrive triée (les plus téléchargés d'abord), on prend le premier de la langue.
        assertEquals(
            SubtitleChoice.External(online),
            SubtitleAuto.pick("fr", src(Lang.VO), listOf(embedded("en", 0)), listOf(sub("en", from = "Shegu"), online, sub("fr", from = "Shegu"))),
        )
    }

    @Test
    fun defaultTrackWinsAmongTracksOfTheLanguage() {
        val plain = sub("fr")
        val marked = sub("fr-FR", default = true)
        assertEquals(SubtitleChoice.External(marked), SubtitleAuto.pick("fr", src(Lang.VOSTFR, plain, marked), emptyList(), emptyList()))
    }

    @Test
    fun waitsWhenNothingInTheLanguageIsKnownYet() {
        // Les sous-titres en ligne arrivent après le début de la lecture : rien n'est décidé.
        assertNull(SubtitleAuto.pick("fr", src(Lang.VO, sub("en")), listOf(embedded("en", 0)), emptyList()))
        assertNull(SubtitleAuto.pick("de", src(Lang.VOSTFR, sub("fr")), emptyList(), listOf(sub("en", from = "Shegu"))))
    }

    @Test
    fun languageCodesAreNormalised() {
        for (raw in listOf("fr", "FR", "fr-FR", "fr_CA", "fre", "fra", "French", "Français", "francais", " french (forced) ")) {
            assertEquals(raw, "fr", SubtitleAuto.langOf(raw))
        }
        assertEquals("en", SubtitleAuto.langOf("eng"))
        assertEquals("en", SubtitleAuto.langOf("English"))
        assertEquals("pt", SubtitleAuto.langOf("pt-BR"))
        assertNull(SubtitleAuto.langOf("und"))
        assertNull(SubtitleAuto.langOf(""))
        assertNull(SubtitleAuto.langOf(null))
    }

    @Test
    fun versionFollowsTheAudioPlayingThenTheSource() {
        // La version sert de clé à la préférence : VF, VOSTFR ou VO.
        assertEquals(Lang.VF, SubtitleAuto.version(Lang.VF, null))
        assertEquals(Lang.VOSTFR, SubtitleAuto.version(Lang.VOSTFR, null))
        assertEquals(Lang.VO, SubtitleAuto.version(Lang.VO, null))
        assertEquals(Lang.VO, SubtitleAuto.version(Lang.UNKNOWN, null))
        assertEquals(Lang.VO, SubtitleAuto.version(null, null))
        // Piste française lue : son français, quoi que dise la source.
        assertEquals(Lang.VF, SubtitleAuto.version(Lang.VOSTFR, "fr"))
        assertEquals(Lang.VF, SubtitleAuto.version(Lang.UNKNOWN, "fr"))
        // Source « VF » (multi) jouée en anglais : c'est de la VO.
        assertEquals(Lang.VO, SubtitleAuto.version(Lang.VF, "en"))
        assertEquals(Lang.VOSTFR, SubtitleAuto.version(Lang.VOSTFR, "en"))
    }
}
