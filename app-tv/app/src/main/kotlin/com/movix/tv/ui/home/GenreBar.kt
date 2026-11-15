package com.movix.tv.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.data.tmdb.GenrePage
import com.movix.tv.data.tmdb.Genres
import com.movix.tv.ui.components.pressProgress
import com.movix.tv.ui.components.pressScale
import com.movix.tv.ui.nav.Section
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType

/** Puce « Tout » : la page de rangées habituelle. */
internal const val GENRE_ALL = 0

/** Page de genres d'une section du rail, `null` si elle n'a pas de barre de genres. */
internal fun Section.genrePage(): GenrePage? = when (this) {
    Section.MOVIES -> GenrePage.MOVIES
    Section.SERIES -> GenrePage.SERIES
    Section.ANIME -> GenrePage.ANIME
    else -> null
}

/** Nom affiché d'un genre TMDB (les mêmes identifiants pour les films et les séries quand ils existent des deux côtés). */
private fun genreLabel(id: Int): Int? = when (id) {
    GENRE_ALL -> R.string.genre_all
    28 -> R.string.genre_28
    12 -> R.string.genre_12
    35 -> R.string.genre_35
    18 -> R.string.genre_18
    27 -> R.string.genre_27
    53 -> R.string.genre_53
    878 -> R.string.genre_878
    10749 -> R.string.genre_10749
    16 -> R.string.genre_16
    80 -> R.string.genre_80
    14 -> R.string.genre_14
    10751 -> R.string.genre_10751
    9648 -> R.string.genre_9648
    99 -> R.string.genre_99
    10752 -> R.string.genre_10752
    36 -> R.string.genre_36
    10402 -> R.string.genre_10402
    37 -> R.string.genre_37
    10759 -> R.string.genre_10759
    10765 -> R.string.genre_10765
    10762 -> R.string.genre_10762
    10764 -> R.string.genre_10764
    10766 -> R.string.genre_10766
    10768 -> R.string.genre_10768
    else -> null
}

/**
 * Barre de genres, en haut de la page, au-dessus du bandeau : toujours visible,
 * Haut depuis la première rangée y mène, Gauche depuis « Tout » ramène au rail.
 * Entrer dans la barre pose le focus sur la puce choisie ([selectedRequester]).
 *
 * @param restoreKey identifiant (en texte) de la puce à refocaliser au retour sur la page.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
internal fun GenreBar(
    page: GenrePage,
    selected: Int,
    onSelect: (Int) -> Unit,
    onFocus: (Int) -> Unit,
    selectedRequester: FocusRequester,
    restoreKey: String?,
    restoreRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    val genres = remember(page) { listOf(GENRE_ALL) + Genres.of(page).filter { genreLabel(it) != null } }
    // Voile en haut du bandeau : les puces restent lisibles sur une image claire.
    Box(
        modifier.fillMaxWidth().height(64.dp).background(
            Brush.verticalGradient(0f to MovixColors.Ink.copy(alpha = 0.78f), 1f to MovixColors.Ink.copy(alpha = 0f)),
        ),
    ) {
        LazyRow(
            Modifier.fillMaxWidth().padding(start = RailWidth, top = 14.dp).focusRestorer(selectedRequester),
            // Texte de « Tout » aligné sur le titre du bandeau et les affiches.
            contentPadding = PaddingValues(start = RowInset - ChipPadding, end = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items(genres, key = { it }, contentType = { "genre" }) { id ->
                GenreChip(
                    text = stringResource(genreLabel(id) ?: R.string.genre_all),
                    selected = id == selected,
                    onClick = { onSelect(id) },
                    onFocused = { onFocus(id) },
                    modifier = Modifier
                        .then(if (id == selected) Modifier.focusRequester(selectedRequester) else Modifier)
                        .then(if (id.toString() == restoreKey) Modifier.focusRequester(restoreRequester) else Modifier),
                )
            }
        }
    }
}

private val ChipPadding = 12.dp

/** Puce de genre, comme les pastilles de saison : fond léger si choisie, blanche au focus. */
@Composable
private fun GenreChip(text: String, selected: Boolean, onClick: () -> Unit, onFocused: () -> Unit, modifier: Modifier = Modifier) {
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
        maxLines = 1,
        modifier = modifier
            .pressScale(press)
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .clickable(interactionSource = source, indication = null, onClick = onClick)
            .padding(horizontal = ChipPadding, vertical = 6.dp),
    )
}
