package com.movix.tv.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * Les quelques icônes de la maquette, en traits (style Lucide), écrites à la
 * main : pas de `material-icons-extended` (plusieurs Mo).
 */
object MovixIcons {
    private fun stroke(name: String, vararg paths: String, filled: Boolean = false): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            paths.forEach { d ->
                addPath(
                    pathData = addPathNodes(d),
                    fill = if (filled) SolidColor(Color.White) else null,
                    stroke = if (filled) null else SolidColor(Color.White),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    val Search = stroke("search", "M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z", "M20 20l-3.5-3.5")
    val Home = stroke("home", "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z")
    val Film = stroke("film", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4")
    val Tv = stroke("tv", "M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", "M8 2l4 4 4-4")
    val Spark = stroke("spark", "M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z")
    val Plus = stroke("plus", "M12 5v14M5 12h14")
    val Check = stroke("check", "M5 12.5 10 17l9-10")
    val Gear = stroke(
        "gear",
        "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
        "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    )
    val Play = stroke("play", "M7 4.5v15l12.5-7.5z", filled = true)
    val Chevron = stroke("chevron", "m9 6 6 6-6 6")
    val Pause = stroke("pause", "M8 5v14M16 5v14")
    val Back = stroke("back", "M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5")
    val Forward = stroke("forward", "M21 12a9 9 0 1 1-3-6.7L21 8", "M21 3v5h-5")
    val Next = stroke("next", "M5 5v14l10-7zM19 5v14")
    val Subtitles = stroke("cc", "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3")
    val Audio = stroke("audio", "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14")
    val Mouse = stroke("mouse", "M5 3l14 7-6 2-2 6z")
    val Delete =stroke("delete", "M21 5H8l-6 7 6 7h13a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z", "M17 9l-6 6M11 9l6 6")
}
