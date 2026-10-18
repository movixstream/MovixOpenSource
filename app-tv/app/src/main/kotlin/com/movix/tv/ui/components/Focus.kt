package com.movix.tv.ui.components

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.unit.Density
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.movix.tv.ui.theme.MovixColors

/**
 * Le focus d'une carte : les deux crochets rouges du logo [M], perforations
 * comprises, dessinés autour de la carte. Le dessin vit dans la phase de dessin
 * seulement : passer d'une carte à l'autre ne relance aucune mise en page.
 */
fun Modifier.focusBrackets(visible: () -> Float): Modifier = drawWithCache {
    // Les deux tracés ne dépendent que de la taille de la carte : construits une
    // fois, puis seulement déplacés et redessinés avec la progression du focus.
    val gap = 6.dp.toPx()
    val t = 5.dp.toPx()
    val top = -gap
    val h = size.height + gap * 2
    val left = bracketPath(outerX = -gap - t, inward = 1f, top = top, h = h, t = t, arm = t + gap - 1.dp.toPx())
    val right = bracketPath(outerX = size.width + gap + t, inward = -1f, top = top, h = h, t = t, arm = t + gap - 1.dp.toPx())
    val reach = GRAB_REACH.toPx()
    onDrawWithContent {
        drawContent()
        val p = visible()
        val alpha = p.coerceIn(0f, 1f)
        if (alpha > 0f) {
            // Les crochets « accrochent » : ils arrivent de l'extérieur, un peu
            // étirés, mordent la carte quand le ressort dépasse 1, puis se posent.
            val dx = (1f - p) * reach
            val sy = 1f + (1f - p) * GRAB_STRETCH
            val c = MovixColors.Red.copy(alpha = alpha)
            withTransform({ translate(left = -dx); scale(1f, sy, center) }) { drawPath(left, c) }
            withTransform({ translate(left = dx); scale(1f, sy, center) }) { drawPath(right, c) }
        }
    }
}

/** Distance d'où arrivent les crochets, et étirement vertical au départ. */
private val GRAB_REACH = 12.dp
private const val GRAB_STRETCH = 0.10f

/**
 * Un crochet du logo [M] : la barre et ses deux bras d'un seul tenant, avec
 * les perforations de pellicule découpées dans la barre (règle pair-impair),
 * aux proportions de `brand/movix.svg`.
 */
private fun Density.bracketPath(outerX: Float, inward: Float, top: Float, h: Float, t: Float, arm: Float): Path {
    val x0 = outerX
    val xi = outerX + inward * t
    val xa = outerX + inward * arm
    val path = Path().apply {
        fillType = PathFillType.EvenOdd
        moveTo(x0, top)
        lineTo(xa, top)
        lineTo(xa, top + t)
        lineTo(xi, top + t)
        lineTo(xi, top + h - t)
        lineTo(xa, top + h - t)
        lineTo(xa, top + h)
        lineTo(x0, top + h)
        close()
    }
    // Perforations : moitié de la largeur de la barre, centrées, régulièrement
    // espacées entre les deux bras.
    val holeW = t * 0.5f
    val holeH = t * 0.56f
    val step = 7.dp.toPx()
    val margin = t + 5.dp.toPx()
    val usable = h - margin * 2
    val count = (usable / step).toInt().coerceAtLeast(1)
    val startY = top + margin + (usable - (count - 1) * step) / 2f
    val holeX = minOf(x0, xi) + (t - holeW) / 2f
    repeat(count) { i ->
        val cy = startY + i * step
        path.addRoundRect(
            RoundRect(holeX, cy - holeH / 2f, holeX + holeW, cy + holeH / 2f, CornerRadius(holeW * 0.22f)),
        )
    }
    return path
}

/**
 * Animation du focus partagée par les cartes : zoom et crochets, lus dans la
 * couche graphique. À l'arrivée, un ressort court qui dépasse un peu 1 (les
 * crochets serrent la carte, ≈ 250 ms) ; au départ, un fondu sec de 100 ms.
 * Gardé en mode léger : seuls les crochets sont redessinés, sans mise en page.
 */
@Composable
fun focusProgress(focused: Boolean): State<Float> = animateFloatAsState(
    if (focused) 1f else 0f,
    if (focused) spring(dampingRatio = 0.5f, stiffness = 700f) else tween(100),
    label = "focus",
)

fun Modifier.focusScale(progress: State<Float>, max: Float = 1.06f): Modifier = graphicsLayer {
    // Le zoom ne suit pas le dépassement du ressort : seuls les crochets serrent.
    val s = 1f + (max - 1f) * progress.value.coerceIn(0f, 1f)
    scaleX = s
    scaleY = s
}

/**
 * Appui sur OK : l'élément s'enfonce tant que la touche est tenue, puis revient
 * avec un léger rebond. Sans ça, rien ne montrait que le clic était pris avant
 * que l'écran suivant n'apparaisse.
 */
@Composable
fun pressProgress(source: InteractionSource): State<Float> {
    val pressed by source.collectIsPressedAsState()
    return animateFloatAsState(
        if (pressed) 1f else 0f,
        if (pressed) tween(70) else spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessMediumLow),
        label = "press",
    )
}

fun Modifier.pressScale(progress: State<Float>, min: Float = 0.93f): Modifier = graphicsLayer {
    val s = 1f - (1f - min) * progress.value
    scaleX = s
    scaleY = s
}
/**
 * Garde l'élément sélectionné à une position fixe (`startPx` depuis le bord) au
 * lieu de défiler au minimum : c'est le comportement attendu à la télécommande.
 */
@Stable
class PivotBringIntoViewSpec(private val startPx: Float) : BringIntoViewSpec {
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float = offset - startPx
}
