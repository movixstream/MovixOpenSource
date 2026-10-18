package com.movix.tv.ui.player

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.local.Library
import com.movix.tv.data.tmdb.Episode
import com.movix.tv.data.tmdb.TmdbImage
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.components.ProgressLine
import com.movix.tv.ui.components.TmdbImage
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val CARD_W = 240.dp
private val CARD_H = 135.dp

/** Gauche/Droite au bout d'une rangée : consommée, le focus ne file nulle part. */
private fun Modifier.stopAtRowEnds(first: Boolean, last: Boolean): Modifier =
    if (!first && !last) this else onPreviewKeyEvent { e ->
        e.type == KeyEventType.KeyDown && ((first && e.key == Key.DirectionLeft) || (last && e.key == Key.DirectionRight))
    }

/**
 * Panneau « Épisodes » façon Netflix : la vidéo continue derrière un voile,
 * pastilles de saisons en haut, rangée d'épisodes en dessous. OK lance
 * l'épisode ; Retour ferme (géré par [PlayerScreen]). Haut/Bas passent des
 * saisons aux épisodes, le focus ne sort jamais du panneau.
 */
@Composable
fun EpisodesPanel(c: PlayerController, onClose: () -> Unit) {
    val context = LocalContext.current
    val values by context.container.store.values.collectAsState()
    val scope = rememberCoroutineScope()
    val req = c.target.request
    val tvId = req.tmdbId
    val currentSeason = req.season ?: 1
    val currentEpisode = req.episode ?: 1
    val seasons = c.seasonNumbers.ifEmpty { listOf(currentSeason) }
    var season by remember { mutableStateOf(currentSeason) }
    var hasFocus by remember { mutableStateOf(false) }
    val episodes = c.cachedEpisodes(season).orEmpty()
    val watched = Library.watchedEpisodes(values, tvId)

    // Épisode qui reçoit le focus en descendant des saisons : le dernier visité, sinon l'épisode en cours, sinon le premier.
    var lastFocused by remember(season) { mutableStateOf<Int?>(null) }
    val anchorIndex = episodes.indexOfFirst { it.number == (lastFocused ?: if (season == currentSeason) currentEpisode else -1) }
        .takeIf { it >= 0 } ?: 0
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = (anchorIndex - 1).coerceAtLeast(0))
    val seasonRequesters = remember(seasons) { seasons.associateWith { FocusRequester() } }
    val episodeRequester = remember { FocusRequester() }
    // Autre saison : sa liste se charge et la rangée repart du début.
    var seasonChanged by remember { mutableStateOf(false) }
    LaunchedEffect(season) {
        if (seasonChanged) listState.scrollToItem(0)
        seasonChanged = true
        c.episodesOf(season)
    }

    fun focusEpisodes() {
        if (episodes.isEmpty()) return
        scope.launch {
            if (listState.layoutInfo.visibleItemsInfo.none { it.index == anchorIndex }) listState.scrollToItem((anchorIndex - 1).coerceAtLeast(0))
            delay(16)
            runCatching { episodeRequester.requestFocus() }
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f))) {
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(420.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.94f)))))
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(bottom = 36.dp).onFocusChanged { hasFocus = it.hasFocus }) {
            Text(c.target.title, style = MovixType.Kicker, modifier = Modifier.padding(start = 48.dp))
            Spacer(Modifier.height(2.dp))
            Text(stringResource(R.string.player_eps_title), style = MovixType.Panel.copy(fontSize = 24.sp), modifier = Modifier.padding(start = 48.dp))
            Spacer(Modifier.height(14.dp))
            LazyRow(
                Modifier.onPreviewKeyEvent { e ->
                    if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (e.key) {
                        Key.DirectionDown -> { focusEpisodes(); true }
                        Key.DirectionUp -> true
                        else -> false
                    }
                },
                contentPadding = PaddingValues(horizontal = 48.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                itemsIndexed(seasons, key = { _, n -> n }) { i, n ->
                    SeasonPill(
                        context.getString(R.string.season_n, n), selected = n == season,
                        onFocused = { season = n },
                        modifier = Modifier.focusRequester(seasonRequesters.getValue(n))
                            .stopAtRowEnds(first = i == 0, last = i == seasons.lastIndex),
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            LazyRow(
                Modifier.fillMaxWidth().height(CARD_H + 64.dp).onPreviewKeyEvent { e ->
                    if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (e.key) {
                        Key.DirectionUp -> { runCatching { seasonRequesters.getValue(season).requestFocus() }; true }
                        Key.DirectionDown -> true
                        else -> false
                    }
                },
                state = listState,
                contentPadding = PaddingValues(start = 48.dp, end = 48.dp, top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                itemsIndexed(episodes, key = { _, ep -> "$season:${ep.number}" }) { i, ep ->
                    val p = Library.progress(values, Library.episodeProgressKey(tvId, season, ep.number))
                    val finished = p != null && Library.isFinished(p)
                    val isCurrent = season == currentSeason && ep.number == currentEpisode
                    // Épisode en cours : la position de lecture réelle, pas la dernière sauvegarde.
                    val ratio = if (isCurrent && c.durationMs > 0) c.positionMs.toFloat() / c.durationMs
                        else p?.takeIf { !finished && it.duration > 0 }?.let { (it.position / it.duration).toFloat() }
                    EpisodeCard(
                        ep,
                        imageUrl = TmdbImage.still(ep.stillPath) ?: TmdbImage.landscape(c.target.backdropPath),
                        ratio = ratio,
                        watched = !isCurrent && ("S${season}E${ep.number}" in watched || finished),
                        current = isCurrent,
                        onFocused = { lastFocused = ep.number },
                        onClick = {
                            if (!isCurrent) c.playEpisode(season, ep.number)
                            onClose()
                        },
                        modifier = (if (i == anchorIndex) Modifier.focusRequester(episodeRequester) else Modifier)
                            .stopAtRowEnds(first = i == 0, last = i == episodes.lastIndex),
                    )
                }
            }
        }
    }

    // Focus à l'ouverture : l'épisode en cours, ou la saison si la liste n'est pas
    // encore là ; redemandé tant qu'il n'est pas pris (liste en cours de chargement).
    LaunchedEffect(Unit) {
        repeat(30) {
            delay(50)
            if (hasFocus) return@LaunchedEffect
            runCatching {
                if (c.cachedEpisodes(season)?.isNotEmpty() == true) episodeRequester.requestFocus()
                else seasonRequesters.getValue(season).requestFocus()
            }
        }
    }
}

@Composable
private fun SeasonPill(text: String, selected: Boolean, onFocused: () -> Unit, modifier: Modifier) {
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
    Text(
        text,
        style = MovixType.Button.copy(fontSize = 13.sp, color = fg),
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .clickable(interactionSource = source, indication = null, onClick = onFocused)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/** Vignette d'épisode : image, numéro, titre, durée, progression ; contour blanc au focus. */
@Composable
private fun EpisodeCard(
    ep: Episode,
    imageUrl: String?,
    ratio: Float?,
    watched: Boolean,
    current: Boolean,
    onFocused: () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier,
) {
    val context = LocalContext.current
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    LaunchedEffect(focused) { if (focused) onFocused() }
    Column(Modifier.width(CARD_W)) {
        Box(
            modifier
                .size(CARD_W, CARD_H)
                .clip(RoundedCornerShape(8.dp))
                .border(if (focused) 3.dp else 0.dp, if (focused) MovixColors.Text else Color.Transparent, RoundedCornerShape(8.dp))
                .clickable(interactionSource = source, indication = null, onClick = onClick),
        ) {
            TmdbImage(imageUrl, CARD_W, CARD_H, Modifier.fillMaxSize())
            Text(
                context.getString(R.string.episode_short, ep.number),
                style = MovixType.Badge,
                modifier = Modifier.padding(7.dp).background(Color(0xB30A0A0A), RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
            )
            if (current) {
                Text(
                    stringResource(R.string.player_eps_now),
                    style = MovixType.Badge.copy(color = Color.White),
                    modifier = Modifier.align(Alignment.TopEnd).padding(7.dp).background(MovixColors.Red, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
                )
            } else if (watched) {
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
        Text(
            context.getString(R.string.player_eps_number, ep.number, ep.title.ifBlank { context.getString(R.string.episode_short, ep.number) }),
            style = MovixType.CardTitle.copy(fontSize = 13.sp, color = if (focused || current) MovixColors.Text else MovixColors.Soft),
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        ep.runtime?.let {
            Text(context.getString(R.string.duration_min, it), style = MovixType.CardSub, modifier = Modifier.padding(top = 2.dp))
        }
    }
}
