package com.movix.tv.ui.profiles

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.movix.tv.R
import com.movix.tv.data.account.AvatarCatalog
import com.movix.tv.data.account.AvatarCategory
import com.movix.tv.ui.components.TabPill
import com.movix.tv.ui.components.focusProgress
import com.movix.tv.ui.components.focusScale
import com.movix.tv.ui.components.pressProgress
import com.movix.tv.ui.components.pressScale
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType

/** Diamètre d'une case de la grille, anneau compris, et de l'image dedans. */
private val TileSize = 76.dp
private val ImageSize = 66.dp

/**
 * Choix de l'avatar, comme le sélecteur du site : une pastille par plateforme
 * (Crunchyroll, Disney+…, Classiques), puis une rangée par série. Rangées et
 * cases ne sont composées qu'à l'écran (listes paresseuses) et chaque image est
 * décodée à la taille de sa case.
 *
 * À l'ouverture, la plateforme et la série de l'avatar [current] sont montrées
 * et il prend le focus. OK sur une case appelle [onPick] ; Retour est géré par
 * l'écran qui l'ouvre (l'avatar ne change pas).
 */
@Composable
internal fun AvatarPicker(current: String?, siteHost: String?, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    val groups = AvatarCatalog.groups
    val spot = remember(current) { AvatarCatalog.locate(current) }
    var group by remember { mutableIntStateOf(spot?.group ?: 0) }
    val pillRequester = remember { FocusRequester() }
    // Case qui prend le focus à l'ouverture : l'avatar choisi, sinon le premier de la plateforme.
    val targetRequester = remember { FocusRequester() }
    val classics = stringResource(R.string.profiles_avatar_classics)

    Column(modifier.fillMaxSize().padding(start = 56.dp, top = 36.dp)) {
        Text(stringResource(R.string.profiles_avatar_title), style = MovixType.Title)
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.profiles_avatar_body), style = MovixType.Body)
        Spacer(Modifier.height(14.dp))
        // En remontant des rangées, le focus retrouve la plateforme ouverte. La plateforme suit le focus.
        Row(Modifier.focusRestorer(pillRequester).focusGroup(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            groups.forEachIndexed { i, g ->
                Box(if (i == group) Modifier.focusRequester(pillRequester) else Modifier) {
                    TabPill(if (g.name == AvatarCatalog.CLASSICS) classics else g.name, i == group, onClick = { group = i }, onFocused = { group = i })
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        // Une composition par plateforme : ses rangées repartent du haut.
        key(group) {
            val categories = groups[group].categories
            val here = spot?.takeIf { it.group == group }
            val listState = rememberLazyListState(initialFirstVisibleItemIndex = here?.category ?: 0)
            LazyColumn(
                Modifier.fillMaxSize(),
                state = listState,
                contentPadding = PaddingValues(bottom = 48.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                itemsIndexed(categories, key = { _, c -> c.name }) { c, category ->
                    val target = c == (here?.category ?: 0)
                    AvatarRow(
                        category = category,
                        current = current,
                        siteHost = siteHost,
                        targetIndex = if (target) here?.index ?: 0 else -1,
                        targetRequester = if (target) targetRequester else null,
                        onPick = onPick,
                    )
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        // La rangée de l'avatar choisi est posée en une ou deux images.
        repeat(10) {
            withFrameNanos { }
            if (targetRequester.tryFocus()) return@LaunchedEffect
        }
        pillRequester.tryFocus()
    }
}

/** Une série : son nom, puis ses avatars en rangée (Gauche/Droite). */
@Composable
private fun AvatarRow(
    category: AvatarCategory,
    current: String?,
    siteHost: String?,
    targetIndex: Int,
    targetRequester: FocusRequester?,
    onPick: (String) -> Unit,
) {
    Column {
        Text(category.name, style = MovixType.Row, modifier = Modifier.padding(start = 10.dp, bottom = 4.dp))
        // L'avatar choisi arrive à l'écran sans défiler depuis le début de la série.
        val rowState = rememberLazyListState(initialFirstVisibleItemIndex = (targetIndex - 3).coerceAtLeast(0))
        LazyRow(
            // En revenant dans la rangée, le focus retrouve la case quittée.
            Modifier.fillMaxWidth().focusRestorer(),
            state = rowState,
            contentPadding = PaddingValues(start = 10.dp, end = 48.dp, top = 6.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            itemsIndexed(category.avatars, contentType = { _, _ -> "avatar" }) { i, path ->
                AvatarTile(
                    url = avatarUrl(path, siteHost),
                    selected = path == current,
                    onClick = { onPick(path) },
                    modifier = if (i == targetIndex && targetRequester != null) Modifier.focusRequester(targetRequester) else Modifier,
                )
            }
        }
    }
}

/** Case ronde d'un avatar : anneau d'accent et zoom au focus, anneau clair et coche s'il est l'avatar choisi. */
@Composable
private fun AvatarTile(url: String?, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val progress = focusProgress(focused)
    val press = pressProgress(source)
    Box(modifier.zIndex(if (focused) 1f else 0f).pressScale(press).focusScale(progress, max = 1.15f)) {
        Box(
            Modifier
                .size(TileSize)
                .border(
                    if (focused) 3.dp else 2.dp,
                    when {
                        focused -> MovixColors.Red
                        selected -> MovixColors.Text
                        else -> Color.Transparent
                    },
                    CircleShape,
                )
                .clickable(interactionSource = source, indication = null, onClick = onClick)
                .padding(5.dp)
                .clip(CircleShape)
                .background(MovixColors.Panel),
        ) {
            if (url != null) {
                AsyncImage(
                    model = rememberAvatarRequest(url, ImageSize, grid = true),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        if (selected) CheckBadge(Modifier.align(Alignment.BottomEnd))
    }
}
