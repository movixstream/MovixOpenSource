package com.movix.tv.ui.profiles

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.movix.tv.container
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.theme.Bricolage
import com.movix.tv.ui.theme.LocalLowRam
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Avatar du site : chemin `/avatars/…` du front, ou adresse complète. */
internal fun avatarUrl(avatar: String?, siteHost: String?): String? = when {
    avatar.isNullOrBlank() -> null
    avatar.startsWith("http://") || avatar.startsWith("https://") -> avatar
    avatar.startsWith("/") && siteHost != null -> "https://$siteHost$avatar"
    else -> null
}

/** Domaine actuel du site (celui de la Main API sans `api.`), qui sert les avatars ; `null` tant qu'il n'est pas connu. */
@Composable
internal fun rememberSiteHost(): String? {
    val container = LocalContext.current.container
    val host by produceState<String?>(null) {
        value = runCatching { withContext(Dispatchers.IO) { container.apiHost.current().removePrefix("api.") } }.getOrNull()
    }
    return host
}

/**
 * Image d'un avatar décodée à la taille où elle est montrée ([size]). [grid] :
 * une case de la grille des avatars ; sur une télé à peu de mémoire, elle est
 * décodée plus petite et ne prend pas la place des affiches dans le cache.
 */
@Composable
internal fun rememberAvatarRequest(url: String, size: Dp, grid: Boolean = false): ImageRequest {
    val context = LocalContext.current
    val light = grid && LocalLowRam.current
    val px = with(LocalDensity.current) { (if (light) size * 0.75f else size).roundToPx() }
    return remember(url, px, light) {
        ImageRequest.Builder(context).data(url).size(px, px)
            .apply { if (light) memoryCachePolicy(CachePolicy.READ_ONLY) }
            .build()
    }
}

private val InitialColors = listOf(
    Color(0xFFDC2626), Color(0xFF2563EB), Color(0xFF16A34A), Color(0xFF9333EA),
    Color(0xFFEA580C), Color(0xFFDB2777), Color(0xFF0891B2),
)

/** Couleur de fond d'un profil (sous ses initiales), stable pour un même identifiant. */
internal fun initialColor(key: String): Color = InitialColors[Math.floorMod(key.hashCode(), InitialColors.size)]

internal fun initials(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words[0].take(2).uppercase()
        else -> (words[0].take(1) + words[1].take(1)).uppercase()
    }
}

/**
 * Visage rond d'un profil, [size] de diamètre : ses initiales sur sa couleur,
 * l'avatar par-dessus dès qu'il est chargé (les initiales restent s'il manque).
 */
@Composable
internal fun AvatarFace(url: String?, name: String, colorKey: String, size: Dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(initialColor(colorKey)), contentAlignment = Alignment.Center) {
        Text(initials(name), style = MovixType.Title.copy(fontFamily = Bricolage, fontSize = (size.value * 0.34f).sp, color = Color.White))
        if (url != null) {
            AsyncImage(model = rememberAvatarRequest(url, size), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

/** Pastille « choisi » (coche blanche sur l'accent) au coin d'un avatar. */
@Composable
internal fun CheckBadge(modifier: Modifier = Modifier, size: Dp = 22.dp) {
    Box(modifier.size(size).background(MovixColors.Red, CircleShape), contentAlignment = Alignment.Center) {
        Image(rememberVectorPainter(MovixIcons.Check), null, Modifier.size(size * 0.6f), colorFilter = ColorFilter.tint(Color.White))
    }
}

/** Icônes propres à la gestion des profils, au trait comme celles de [MovixIcons] (style Lucide). */
internal object ProfileIcons {
    private fun stroke(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            paths.forEach { d ->
                addPath(
                    pathData = addPathNodes(d),
                    stroke = SolidColor(Color.White),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    val Pencil = stroke("pencil", "M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z", "m15 5 4 4")
    val Trash = stroke("trash", "M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2")
}

/** Donne le focus à l'élément de [this] ; `false` s'il n'est pas (encore) à l'écran. */
internal fun FocusRequester.tryFocus(): Boolean = runCatching { requestFocus(FocusDirection.Enter) }.getOrDefault(false)
