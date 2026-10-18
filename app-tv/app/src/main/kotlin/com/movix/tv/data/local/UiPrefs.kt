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
}
