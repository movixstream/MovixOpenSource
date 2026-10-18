package com.movix.tv.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.TmdbImage
import com.movix.tv.ui.components.PosterCard
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.delay

private val Letters = ("abcdefghijklmnopqrstuvwxyz1234567890").map { it.toString() }

/**
 * Recherche au clavier à l'écran : une grille de lettres à la télécommande,
 * plus rapide que le clavier système et sans changer d'appli.
 */
@Composable
fun SearchScreen(onOpen: (MediaItem) -> Unit, modifier: Modifier = Modifier) {
    val container = LocalContext.current.container
    var query by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var searched by remember { mutableStateOf(false) }
    LaunchedEffect(query) {
        val q = query.trim()
        if (q.length < 2) { results = emptyList(); searched = false; return@LaunchedEffect }
        delay(350) // anti-rebond : une requête par pause de frappe
        results = runCatching { container.catalog.search(q) }.getOrDefault(emptyList())
        searched = true
    }
    val firstKey = remember { FocusRequester() }

    Row(modifier.padding(top = 40.dp, start = 24.dp)) {
        Column(Modifier.width(300.dp)) {
            Box(
                Modifier.fillMaxWidth().height(44.dp).background(MovixColors.Panel, RoundedCornerShape(10.dp)).padding(horizontal = 14.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text(
                    if (query.isEmpty()) stringResource(R.string.search_hint) else query,
                    style = MovixType.Button.copy(fontSize = 16.sp, color = if (query.isEmpty()) MovixColors.Dim else MovixColors.Text),
                    maxLines = 1,
                )
            }
            Spacer(Modifier.height(16.dp))
            Letters.chunked(6).forEachIndexed { rowIndex, row ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 6.dp)) {
                    row.forEachIndexed { i, l ->
                        Key(l, Modifier.size(44.dp, 38.dp).then(if (rowIndex == 0 && i == 0) Modifier.focusRequester(firstKey) else Modifier)) {
                            query += l
                        }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Key(stringResource(R.string.search_space), Modifier.size(94.dp, 38.dp)) { if (query.isNotEmpty() && !query.endsWith(" ")) query += " " }
                Key(stringResource(R.string.search_delete), Modifier.size(94.dp, 38.dp)) { query = query.dropLast(1) }
                Key(stringResource(R.string.search_clear), Modifier.size(94.dp, 38.dp)) { query = "" }
            }
        }
        Spacer(Modifier.width(36.dp))
        Box(Modifier.fillMaxHeight().weight(1f)) {
            if (searched && results.isEmpty()) {
                Text(stringResource(R.string.search_empty, query.trim()), style = MovixType.Body, modifier = Modifier.padding(top = 12.dp))
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(92.dp),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = 8.dp, bottom = 60.dp, start = 12.dp, end = 48.dp),
                horizontalArrangement = Arrangement.spacedBy(22.dp),
                verticalArrangement = Arrangement.spacedBy(26.dp),
            ) {
                items(results, key = { it.key }) { item ->
                    PosterCard(TmdbImage.poster(item.posterPath), onClick = { onOpen(item) }, onFocused = {})
                }
            }
        }
    }
    LaunchedEffect(Unit) { delay(32); runCatching { firstKey.requestFocus() } }
}

@Composable
private fun Key(label: String, modifier: Modifier, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    Box(
        modifier
            .background(if (focused) MovixColors.Text else MovixColors.Panel, RoundedCornerShape(8.dp))
            .clickable(interactionSource = source, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = MovixType.Button.copy(color = if (focused) MovixColors.Ink else MovixColors.Text))
    }
}
