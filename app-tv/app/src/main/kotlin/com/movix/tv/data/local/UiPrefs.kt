package com.movix.tv.data.local

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Réglages d'interface de la télé, rangés dans [LocalStore] (jamais
 * synchronisés avec le site). Un réglage absent vaut sa valeur par défaut.
 */
object UiKeys {
    /** Couleur d'accent : [AccentColor.id]. */
    const val ACCENT = "movix_tv_accent"
    /** Style des sous-titres : JSON de [SubtitleStyle]. */
    const val SUBTITLE_STYLE = "movix_tv_subtitle_style"
    /** Rangées de l'accueil : JSON de [HomeRows]. */
    const val HOME_ROWS = "movix_tv_home_rows"
    /** Entrées du menu de gauche cachées : noms de `Section` séparés par des virgules. */
    const val RAIL_HIDDEN = "movix_tv_rail_hidden"
    /** Enchaîner l'épisode suivant : "1" (défaut) ou "0". */
    const val AUTOPLAY_NEXT = "movix_tv_autoplay_next"
    /** Bande-annonce muette dans le bandeau de l'accueil : "1" (défaut) ou "0". */
    const val BANNER_VIDEO = "movix_tv_banner_video"
    /** Écran de veille après N minutes sans touche : nombre, "0" = coupé ; défaut 5. */
    const val SCREENSAVER_MIN = "movix_tv_screensaver_min"
    /** Demander « Qui regarde ? » au lancement : "1" (défaut si le compte a plusieurs profils) ou "0". */
    const val PROFILE_PROMPT = "movix_tv_profile_prompt"
    /**
     * Préférences de lecture : JSON de [PlaybackPrefs]. Une clé par profil
     * relié (suffixe `_<compte>_<profil>`, voir [UiPrefs.playbackKey]), cette
     * clé seule sans compte : la langue et les sous-titres sont personnels.
     */
    const val PLAYBACK = "movix_tv_playback"
}

/** Couleurs d'accent proposées (crochets du focus, progression, boutons actifs). */
enum class AccentColor(val id: String, val argb: Long) {
    RED("red", 0xFFDC2626),
    BLUE("blue", 0xFF2563EB),
    GREEN("green", 0xFF16A34A),
    PURPLE("purple", 0xFF9333EA),
    ORANGE("orange", 0xFFEA580C),
    PINK("pink", 0xFFDB2777),
    YELLOW("yellow", 0xFFEAB308);

    companion object {
        fun of(id: String?): AccentColor = entries.firstOrNull { it.id == id } ?: RED
    }
}

/**
 * Style des sous-titres, le même pour toutes les vidéos.
 * [size] en % de la taille de base (75–200), [color] parmi
 * `white`, `yellow`, `cyan`, `green`, [background] : opacité du fond en %
 * (0 = sans fond), [position] : `bottom` ou `raised` (plus haut).
 */
@Serializable
data class SubtitleStyle(
    val size: Int = 100,
    val color: String = "white",
    val background: Int = 45,
    val position: String = "bottom",
    /** Contour noir autour des lettres (lisible sans fond). */
    val outline: Boolean = false,
    /** Police : un id de [FONTS]. */
    val font: String = "standard",
) {
    companion object {
        val COLORS = mapOf("white" to 0xFFFFFFFF, "yellow" to 0xFFFFE066, "cyan" to 0xFF7DE3F4, "green" to 0xFF8BE28B)
        /** Polices proposées, dans l'ordre des listes. */
        val FONTS = listOf("standard", "atkinson", "lexend", "opendyslexic", "system", "serif", "monospace")
    }
}

/**
 * Rangées de l'accueil choisies par l'utilisateur : [order] (ids de `RowSpec`
 * dans l'ordre voulu, les autres suivent dans l'ordre par défaut) et [hidden]
 * (ids cachés). Vide = disposition par défaut.
 */
@Serializable
data class HomeRows(val order: List<String> = emptyList(), val hidden: Set<String> = emptySet())

/**
 * Préférences de lecture. Les valeurs par défaut sont le comportement
 * d'avant : son français, VF d'abord, sous-titres selon la règle d'origine
 * (français d'office sur une VOSTFR qui en fournit).
 */
@Serializable
data class PlaybackPrefs(
    /** Langue audio préférée (code ISO 639-1). */
    val audio: String = "fr",
    /** Version préférée pour le choix de la source : « VF », « VOSTFR » ou « VO ». */
    val version: String = "VF",
    /**
     * Sous-titres par version (« VF », « VOSTFR », « VO ») : [OFF] ou un code
     * de langue ; une version absente suit la règle d'origine. Une préférence
     * par version : couper les sous-titres d'une VF ne les coupe pas en VOSTFR.
     */
    val subtitles: Map<String, String> = emptyMap(),
    /** Les choix faits pendant la lecture deviennent les préférences. */
    val remember: Boolean = true,
) {
    fun subtitlesFor(version: String): String? = subtitles[version]

    /** [value] `null` : retour à la règle d'origine pour [version]. */
    fun withSubtitles(version: String, value: String?): PlaybackPrefs =
        copy(subtitles = if (value == null) subtitles - version else subtitles + (version to value))

    companion object {
        const val OFF = "off"

        /** Langues données au lecteur : le français garde ses trois codes d'avant (« fr », « fre », « fra »). */
        fun audioLanguages(audio: String): List<String> = if (audio == "fr") listOf("fr", "fre", "fra") else listOf(audio)
    }
}

object UiPrefs {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun accent(values: Map<String, String>): AccentColor = AccentColor.of(values[UiKeys.ACCENT])

    fun subtitleStyle(values: Map<String, String>): SubtitleStyle =
        values[UiKeys.SUBTITLE_STYLE]?.let { runCatching { json.decodeFromString(SubtitleStyle.serializer(), it) }.getOrNull() } ?: SubtitleStyle()

    fun encode(style: SubtitleStyle): String = json.encodeToString(SubtitleStyle.serializer(), style)

    fun homeRows(values: Map<String, String>): HomeRows =
        values[UiKeys.HOME_ROWS]?.let { runCatching { json.decodeFromString(HomeRows.serializer(), it) }.getOrNull() } ?: HomeRows()

    fun encode(rows: HomeRows): String = json.encodeToString(HomeRows.serializer(), rows)

    fun railHidden(values: Map<String, String>): Set<String> =
        values[UiKeys.RAIL_HIDDEN]?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.toSet().orEmpty()

    fun flag(values: Map<String, String>, key: String, default: Boolean = true): Boolean =
        when (values[key]) { "1" -> true; "0" -> false; else -> default }

    /** Minutes avant l'écran de veille, 0 = coupé. */
    fun screensaverMinutes(values: Map<String, String>): Int = values[UiKeys.SCREENSAVER_MIN]?.toIntOrNull()?.coerceIn(0, 60) ?: 5

    /** Profil dont on lit les préférences de lecture : `<compte>_<profil>`, `null` sans compte relié. */
    fun playbackScope(userId: String?, profileId: String?): String? =
        if (userId.isNullOrBlank() || profileId.isNullOrBlank()) null else "${userId}_$profileId"

    fun playbackKey(scope: String?): String = if (scope == null) UiKeys.PLAYBACK else "${UiKeys.PLAYBACK}_$scope"

    /**
     * Préférences du profil [scope] ; à défaut celles de la télé (choisies
     * avant la liaison du compte), sinon les valeurs par défaut.
     */
    fun playback(values: Map<String, String>, scope: String?): PlaybackPrefs {
        fun read(key: String) = values[key]?.let { runCatching { json.decodeFromString(PlaybackPrefs.serializer(), it) }.getOrNull() }
        return scope?.let { read(playbackKey(it)) } ?: read(UiKeys.PLAYBACK) ?: PlaybackPrefs()
    }

    fun encode(prefs: PlaybackPrefs): String = json.encodeToString(PlaybackPrefs.serializer(), prefs)
}
