package com.movix.tv.ui.home

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.TmdbImage
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.PosterCard
import com.movix.tv.ui.components.focusBrackets
import com.movix.tv.ui.components.focusProgress
import com.movix.tv.ui.components.focusScale
import com.movix.tv.ui.components.pressProgress
import com.movix.tv.ui.components.pressScale
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType

/** Clé de la carte « Voir tout » dans sa rangée (jamais celle d'un titre : « movie:12 »). */
internal const val SEE_ALL_KEY = "see-all"

private val PosterWidth = 92.dp
private val GridGap = 22.dp
private val GridEnd = 48.dp

/** Affiches par ligne de grille : sept sur une télé (960 dp de large), sans déborder à droite. */
@Composable
internal fun rememberGridColumns(): Int {
    val width = LocalConfiguration.current.screenWidthDp
    return remember(width) {
        ((width - ContentStart.value - GridEnd.value + GridGap.value) / (PosterWidth.value + GridGap.value)).toInt().coerceIn(3, 10)
    }
}

/**
 * Grille d'affiches paginée, en lignes d'une LazyColumn : partagée par
 * « Voir tout » et la grille d'un genre. Haut / Bas passent d'une ligne à
 * l'autre, la dernière ligne est suivie d'un pied (chargement, échec et
 * « Réessayer », liste vide).
 *
 * @param onFocus carte focalisée et sa position dans la liste (chargement de la page suivante).
 * @param retryRequester focus du bouton « Réessayer » (premier chargement en échec).
 */
internal fun LazyListScope.posterGrid(
    titles: PagedTitles,
    columns: Int,
    firstRequester: FocusRequester?,
    restoreKey: String?,
    restoreRequester: FocusRequester,
    onFocus: (Int, MediaItem) -> Unit,
    onOpen: (MediaItem) -> Unit,
    onRetry: () -> Unit,
    retryRequester: FocusRequester? = null,
) {
    val list = titles.items
    val rows = (list.size + columns - 1) / columns
    // Les titres ne font que s'ajouter à la fin : une ligne garde sa clé et son contenu.
    items(count = rows, key = { "grid:$it" }, contentType = { "grid" }) { r ->
        Row(
            Modifier.fillMaxWidth().padding(start = ContentStart, top = 8.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(GridGap),
        ) {
            for (i in r * columns until minOf((r + 1) * columns, list.size)) {
                val item = list[i]
                key(item.key) {
                    PosterCard(
                        imageUrl = TmdbImage.poster(item.posterPath),
                        onClick = { onOpen(item) },
                        onFocused = { onFocus(i, item) },
                        modifier = Modifier
                            .then(if (i == 0 && firstRequester != null) Modifier.focusRequester(firstRequester) else Modifier)
                            .then(if (item.key == restoreKey) Modifier.focusRequester(restoreRequester) else Modifier),
                    )
                }
            }
        }
    }
    item(key = "grid:footer", contentType = "grid-footer") {
        GridFooter(titles, onRetry, retryRequester)
    }
}

@Composable
private fun GridFooter(titles: PagedTitles, onRetry: () -> Unit, retryRequester: FocusRequester?) {
    val empty = titles.items.isEmpty()
    Column(Modifier.padding(start = ContentStart, end = GridEnd, top = if (empty) 24.dp else 4.dp)) {
        when {
            titles.failed -> {
                Text(stringResource(if (empty) R.string.error_body else R.string.grid_more_failed), style = MovixType.Body)
                Spacer(Modifier.height(12.dp))
                PillButton(
                    stringResource(R.string.action_retry),
                    onRetry,
                    if (retryRequester != null) Modifier.focusRequester(retryRequester) else Modifier,
                )
            }
            titles.loading -> Text(stringResource(R.string.grid_loading), style = MovixType.Meta)
            // Le profil (restriction d'âge) masque tout ce que TMDB a donné ici.
            titles.onlyHidden -> Text(stringResource(R.string.age_grid_empty), style = MovixType.Body)
            titles.ended && empty -> Text(stringResource(R.string.grid_empty), style = MovixType.Body)
        }
    }
}

/**
 * Carte « Voir tout » en fin de rangée, au format des affiches : mêmes crochets
 * et même zoom au focus, pour qu'elle se lise comme une carte de plus.
 */
@Composable
internal fun SeeAllCard(onClick: () -> Unit, onFocused: () -> Unit, modifier: Modifier = Modifier) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    LaunchedEffect(focused) { if (focused) onFocused() }
    val progress = focusProgress(focused)
    val press = pressProgress(source)
    val shape = RoundedCornerShape(7.dp)
    Box(
        modifier
            .zIndex(if (focused) 1f else 0f)
            .pressScale(press)
            .focusScale(progress)
            .focusBrackets { progress.value }
            .clickable(interactionSource = source, indication = null, onClick = onClick)
            .size(PosterWidth, 138.dp)
            .clip(shape)
            .background(MovixColors.Panel)
            .border(1.dp, MovixColors.Line, shape),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(34.dp).background(if (focused) MovixColors.Text else MovixColors.Chip, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    rememberVectorPainter(MovixIcons.Chevron),
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    colorFilter = ColorFilter.tint(if (focused) MovixColors.Ink else MovixColors.Text),
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                stringResource(R.string.see_all),
                style = MovixType.CardTitle,
                textAlign = TextAlign.Center,
                maxLines = 2,
                modifier = Modifier.padding(horizontal = 8.dp),
            )
        }
    }
}
