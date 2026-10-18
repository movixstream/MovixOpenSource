package com.movix.tv.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme
import com.movix.tv.R

/**
 * Couleurs de la maquette. Le rouge ne marque que deux choses : la progression
 * de lecture et les crochets du focus (repris du logo [M]).
 */
object MovixColors {
    val Ink = Color(0xFF0A0A0A)
    val Panel = Color(0xFF151515)
    val Line = Color(0xFF2A2A2A)
    val Text = Color(0xFFF4F4F0)
    val Soft = Color(0xFFD2D2CE)
    val Muted = Color(0xFFA1A1A1)
    val Dim = Color(0xFF6B6B6B)

    /**
     * Couleur d'accent choisie dans les réglages (rouge Movix par défaut).
     * État Compose : tout ce qui lit [Red] se redessine quand elle change.
     */
    private val accent = androidx.compose.runtime.mutableStateOf(Color(0xFFDC2626))
    val Red: Color get() = accent.value
    fun setAccent(color: Color) { if (accent.value != color) accent.value = color }

    val Gold = Color(0xFFE8C468)
    val Chip = Color(0x1FFFFFFF)
    val Track = Color(0x40FFFFFF)
}

val Bricolage = FontFamily(
    Font(R.font.bricolage_700, FontWeight.Bold),
    Font(R.font.bricolage_800, FontWeight.ExtraBold),
)

val Instrument = FontFamily(
    Font(R.font.instrument_400, FontWeight.Normal),
    Font(R.font.instrument_500, FontWeight.Medium),
    Font(R.font.instrument_600, FontWeight.SemiBold),
    Font(R.font.instrument_700, FontWeight.Bold),
)

/**
 * Polices des sous-titres (ids de `SubtitleStyle.FONTS`, les mêmes que le
 * site quand elles existent). Les polices de lisibilité n'embarquent qu'une
 * graisse, déclarée en SemiBold comme le texte des sous-titres.
 */
fun subtitleFontFamily(id: String): FontFamily = when (id) {
    "atkinson" -> FontFamily(Font(R.font.atkinson_700, FontWeight.SemiBold))
    "lexend" -> FontFamily(Font(R.font.lexend_600, FontWeight.SemiBold))
    "opendyslexic" -> FontFamily(Font(R.font.opendyslexic_700, FontWeight.SemiBold))
    "system" -> FontFamily.SansSerif
    "serif" -> FontFamily.Serif
    "monospace" -> FontFamily.Monospace
    else -> Instrument
}

/** Nom affiché d'une police des sous-titres. */
fun subtitleFontLabel(id: String): Int = when (id) {
    "atkinson" -> R.string.subs_font_atkinson
    "lexend" -> R.string.subs_font_lexend
    "opendyslexic" -> R.string.subs_font_opendyslexic
    "system" -> R.string.subs_font_system
    "serif" -> R.string.subs_font_serif
    "monospace" -> R.string.subs_font_monospace
    else -> R.string.subs_font_standard
}

/**
 * Échelle typographique de la maquette, dessinée sur 960×540 : sur une télé
 * 1080p (densité xhdpi), 1 px de maquette = 1 dp.
 */
object MovixType {
    val Hero = TextStyle(fontFamily = Bricolage, fontWeight = FontWeight.ExtraBold, fontSize = 42.sp, lineHeight = 44.sp, letterSpacing = (-0.02).em, color = MovixColors.Text)
    val Title = TextStyle(fontFamily = Bricolage, fontWeight = FontWeight.ExtraBold, fontSize = 40.sp, lineHeight = 42.sp, letterSpacing = (-0.02).em, color = MovixColors.Text)
    val Panel = TextStyle(fontFamily = Bricolage, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = MovixColors.Text)
    val Row = TextStyle(fontFamily = Bricolage, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = (-0.01).em, color = MovixColors.Text)
    val Body = TextStyle(fontFamily = Instrument, fontSize = 13.5.sp, lineHeight = 21.sp, color = MovixColors.Soft)
    val Meta = TextStyle(fontFamily = Instrument, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, color = MovixColors.Muted)
    val MetaStrong = Meta.copy(fontWeight = FontWeight.SemiBold, color = MovixColors.Text)
    val Kicker = TextStyle(fontFamily = Instrument, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = MovixColors.Muted)
    val Button = TextStyle(fontFamily = Instrument, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = MovixColors.Text)
    val CardTitle = TextStyle(fontFamily = Instrument, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = MovixColors.Text)
    val CardSub = TextStyle(fontFamily = Instrument, fontSize = 11.sp, lineHeight = 15.sp, color = MovixColors.Muted)
    val Badge = TextStyle(fontFamily = Instrument, fontWeight = FontWeight.Bold, fontSize = 11.sp, color = MovixColors.Text)
}

/**
 * Appareil à peu de mémoire (Fire TV Stick Lite…) : mode léger, sans fondu
 * entre deux grandes images (deux fonds plein écran en mémoire en même temps).
 */
val LocalLowRam = staticCompositionLocalOf { false }

@Composable
fun MovixTheme(lowRam: Boolean = false, content: @Composable () -> Unit) = CompositionLocalProvider(LocalLowRam provides lowRam) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            background = MovixColors.Ink,
            surface = MovixColors.Ink,
            onBackground = MovixColors.Text,
            onSurface = MovixColors.Text,
            primary = MovixColors.Text,
            onPrimary = MovixColors.Ink,
        ),
        content = content,
    )
}
