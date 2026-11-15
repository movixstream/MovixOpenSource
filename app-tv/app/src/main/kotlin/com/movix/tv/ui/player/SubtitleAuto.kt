package com.movix.tv.ui.player

import com.movix.tv.data.local.PlaybackPrefs
import com.movix.tv.data.movix.Lang
import com.movix.tv.data.movix.PlaybackSource
import com.movix.tv.data.movix.SubtitleTrack

/**
 * Sous-titres ouverts d'office d'après la préférence de lecture (fonctions
 * pures, testées sans Android). Le lecteur les rappelle à chaque nouvelle
 * piste connue : pistes du flux (après le démarrage), sous-titres trouvés
 * en ligne (quelques secondes plus tard).
 */
object SubtitleAuto {
    const val OFF = PlaybackPrefs.OFF

    /**
     * Choix à appliquer pour [pref] (`null` : règle d'origine, [OFF], ou un
     * code de langue), ou `null` s'il faut attendre : rien dans la langue
     * voulue pour l'instant. Ordre de recherche : sous-titres de la source
     * (la piste « par défaut » d'abord), pistes du flux, puis en ligne
     * ([searched] arrive trié, les plus téléchargés d'abord).
     */
    fun pick(pref: String?, source: PlaybackSource, embedded: List<TrackOption>, searched: List<SubtitleTrack>): SubtitleChoice? {
        if (pref == null) {
            // Règle d'avant les préférences : français d'office pour une VOSTFR, ou la piste par défaut.
            val fr = source.subtitles.firstOrNull { it.lang.startsWith("fr") } ?: source.subtitles.firstOrNull { it.isDefault }
            return if (fr != null && (source.language == Lang.VOSTFR || fr.isDefault)) SubtitleChoice.External(fr) else SubtitleChoice.Off
        }
        if (pref == OFF) return SubtitleChoice.Off
        val own = source.subtitles.filter { langOf(it.lang) == pref }
        (own.firstOrNull { it.isDefault } ?: own.firstOrNull())?.let { return SubtitleChoice.External(it) }
        embedded.firstOrNull { langOf(it.language) == pref }?.let { return SubtitleChoice.Embedded(it) }
        searched.firstOrNull { langOf(it.lang) == pref }?.let { return SubtitleChoice.External(it) }
        return null
    }

    /**
     * Version qui sert de clé à la préférence de sous-titres : le son lu
     * d'abord (piste française = VF, une source « VF » multi jouée dans une
     * autre langue = VO), sinon ce qu'annonce la source ; inconnu = VO.
     */
    fun version(source: Lang?, audioLang: String?): Lang = when {
        audioLang == "fr" -> Lang.VF
        source == Lang.VF -> if (audioLang != null) Lang.VO else Lang.VF
        source == Lang.VOSTFR -> Lang.VOSTFR
        else -> Lang.VO
    }

    /**
     * Code de langue à deux lettres (« fr ») d'un code ou d'un nom tel que
     * les sources l'écrivent (« fr-FR », « fre », « French », « Français »),
     * `null` pour « und » ou vide. Un code inconnu de 2-3 lettres est gardé tel quel.
     */
    fun langOf(raw: String?): String? {
        val s = raw?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        val head = s.split('-', '_', ' ', '(', ',').firstOrNull { it.isNotEmpty() } ?: return null
        if (head in UNDEFINED) return null
        NAMES[head]?.let { return it }
        return head.takeIf { it.length in 2..3 && it.all(Char::isLetter) }
    }

    private val UNDEFINED = setOf("und", "mul", "zxx", "unk", "mis")

    /** Codes ISO 639-2 et noms courants (anglais, français, nom local) → code à deux lettres. */
    private val NAMES = mapOf(
        "fre" to "fr", "fra" to "fr", "french" to "fr", "français" to "fr", "francais" to "fr",
        "eng" to "en", "english" to "en", "anglais" to "en",
        "spa" to "es", "spanish" to "es", "espagnol" to "es", "español" to "es",
        "ger" to "de", "deu" to "de", "german" to "de", "allemand" to "de", "deutsch" to "de",
        "ita" to "it", "italian" to "it", "italien" to "it", "italiano" to "it",
        "por" to "pt", "pob" to "pt", "portuguese" to "pt", "portugais" to "pt", "português" to "pt",
        "dut" to "nl", "nld" to "nl", "dutch" to "nl", "néerlandais" to "nl",
        "ara" to "ar", "arabic" to "ar", "arabe" to "ar",
        "rus" to "ru", "russian" to "ru", "russe" to "ru",
        "tur" to "tr", "turkish" to "tr", "turc" to "tr",
        "pol" to "pl", "polish" to "pl", "polonais" to "pl",
        "jpn" to "ja", "japanese" to "ja", "japonais" to "ja",
        "kor" to "ko", "korean" to "ko", "coréen" to "ko",
        "chi" to "zh", "zho" to "zh", "chinese" to "zh", "chinois" to "zh",
        "rum" to "ro", "ron" to "ro", "romanian" to "ro", "roumain" to "ro",
    )
}
