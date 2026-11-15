package com.movix.tv.ui.player

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** Icônes propres au lecteur, en traits comme [com.movix.tv.ui.components.MovixIcons]. */
internal object PlayerIcons {
    /** « Épisodes » : trois vignettes empilées, comme Netflix. */
    val Episodes: ImageVector = ImageVector.Builder("episodes", 24.dp, 24.dp, 24f, 24f).apply {
        listOf(
            "M3 10h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z",
            "M5.5 6.5h12a1 1 0 0 1 1 1v9",
            "M8 3h13a1 1 0 0 1 1 1v9",
        ).forEach { d ->
            addPath(
                pathData = addPathNodes(d),
                stroke = SolidColor(Color.White),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
    }.build()
}
