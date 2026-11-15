package com.movix.tv.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.zIndex
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.movix.tv.ui.theme.Bricolage
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType

private val CardShape = RoundedCornerShape(8.dp)

/**
 * Image TMDB décodée à la taille exacte de la carte : sur 1 Go de RAM, une
 * affiche décodée en pleine taille coûte dix fois plus que nécessaire.
 */
@Composable
fun TmdbImage(url: String?, width: Dp, height: Dp, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val request = remember(url, width, height) {
        val w = with(density) { width.roundToPx() }
        val h = with(density) { height.roundToPx() }
        ImageRequest.Builder(context).data(url).size(w, h).build()
    }
    AsyncImage(
        model = request,
        contentDescription = null,
        contentScale = contentScale,
        modifier = modifier.background(MovixColors.Panel),
    )
}

@Composable
fun ProgressLine(ratio: Float, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(3.dp).background(MovixColors.Track)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(ratio.coerceIn(0f, 1f)).background(MovixColors.Red))
    }
}

/** Carte focusable : signale son focus (pour la bannière) et se clique à OK. */
@Composable
private fun rememberFocusable(onFocused: () -> Unit): Pair<MutableInteractionSource, Boolean> {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    LaunchedEffect(focused) { if (focused) onFocused() }
    return source to focused
}

@Composable
fun PosterCard(
    imageUrl: String?,
    onClick: () -> Unit,
    onFocused: () -> Unit,
    modifier: Modifier = Modifier,
    rank: Int? = null,
) {
    val (source, focused) = rememberFocusable(onFocused)
    val progress = focusProgress(focused)
    val press = pressProgress(source)
    // Au premier plan quand elle a le focus : sinon la carte suivante, dessinée
    // après elle, recouvre son crochet de droite.
    Row(modifier.zIndex(if (focused) 1f else 0f), verticalAlignment = Alignment.Bottom) {
        if (rank != null) {
            Text(
                rank.toString(),
                style = MovixType.Hero.copy(fontFamily = Bricolage, fontSize = 64.sp, color = MovixColors.Line),
                modifier = Modifier.padding(end = 2.dp),
            )
        }
        Box(
            Modifier
                .pressScale(press)
                .focusScale(progress)
                .focusBrackets { progress.value }
                .clickable(interactionSource = source, indication = null, onClick = onClick)
                .size(92.dp, 138.dp)
                .clip(RoundedCornerShape(7.dp)),
        ) {
            TmdbImage(imageUrl, 92.dp, 138.dp, Modifier.fillMaxSize())
        }
    }
}

@Composable
fun LandscapeCard(
    imageUrl: String?,
    title: String,
    subtitle: String,
    ratio: Float?,
    onClick: () -> Unit,
    onFocused: () -> Unit,
    modifier: Modifier = Modifier,
    width: Dp = 178.dp,
    height: Dp = 100.dp,
    badge: String? = null,
    watched: Boolean = false,
) {
    val (source, focused) = rememberFocusable(onFocused)
    val progress = focusProgress(focused)
    val press = pressProgress(source)
    Column(modifier.zIndex(if (focused) 1f else 0f).width(width)) {
        Box(
            Modifier
                .pressScale(press)
                .focusScale(progress)
                .focusBrackets { progress.value }
                .clickable(interactionSource = source, indication = null, onClick = onClick)
                .size(width, height)
                .clip(CardShape),
        ) {
            TmdbImage(imageUrl, width, height, Modifier.fillMaxSize())
            if (badge != null) {
                Text(
                    badge,
                    style = MovixType.Badge,
                    modifier = Modifier.padding(7.dp).background(Color(0xB30A0A0A), RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
            if (watched) {
                Box(
                    Modifier.align(Alignment.TopEnd).padding(7.dp).size(18.dp).background(Color(0xB30A0A0A), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(rememberVectorPainter(MovixIcons.Check), null, Modifier.size(11.dp), colorFilter = ColorFilter.tint(MovixColors.Text))
                }
            }
            if (ratio != null) ProgressLine(ratio, Modifier.align(Alignment.BottomStart))
        }
        Spacer(Modifier.height(8.dp))
        Text(title, style = MovixType.CardTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (subtitle.isNotEmpty()) {
            Text(subtitle, style = MovixType.CardSub, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

/** Bouton pilule : blanc plein au focus, texte noir. */
@Composable
fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    selected: Boolean = false,
) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val bg = when {
        focused -> MovixColors.Text
        selected -> MovixColors.Chip
        else -> MovixColors.Chip
    }
    val fg = if (focused) MovixColors.Ink else MovixColors.Text
    val press = pressProgress(source)
    Row(
        modifier
            .pressScale(press)
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .clickable(interactionSource = source, indication = null, onClick = onClick)
            .height(36.dp)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (icon != null) {
            Image(rememberVectorPainter(icon), null, Modifier.size(16.dp), colorFilter = ColorFilter.tint(fg))
        }
        Text(text, style = MovixType.Button.copy(color = fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Pastille de saison : fond léger si choisie, blanche au focus. */
@Composable
fun TabPill(text: String, selected: Boolean, onClick: () -> Unit, onFocused: () -> Unit = {}) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    LaunchedEffect(focused) { if (focused) onFocused() }
    val bg = when {
        focused -> MovixColors.Text
        selected -> MovixColors.Chip
        else -> Color.Transparent
    }
    val fg = when {
        focused -> MovixColors.Ink
        selected -> MovixColors.Text
        else -> MovixColors.Muted
    }
    val press = pressProgress(source)
    Text(
        text,
        style = MovixType.Button.copy(fontSize = 13.sp, color = fg),
        modifier = Modifier
            .pressScale(press)
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .clickable(interactionSource = source, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

@Composable
fun Badge(text: String) {
    Text(
        text,
        style = MovixType.Kicker.copy(color = MovixColors.Text),
        modifier = Modifier.background(MovixColors.Chip, RoundedCornerShape(5.dp)).padding(horizontal = 7.dp, vertical = 3.dp),
    )
}
