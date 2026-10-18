package com.movix.tv.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.local.Library
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.MediaType
import com.movix.tv.data.tmdb.TmdbImage
import com.movix.tv.ui.components.PosterCard
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.delay

/** Ma liste : films et séries mêlés, le plus récent ajouté d'abord. */
@Composable
fun WatchlistScreen(onOpen: (MediaItem) -> Unit, onEmptyBack: () -> Unit, modifier: Modifier = Modifier) {
    val values by LocalContext.current.container.store.values.collectAsStateWithLifecycle()
    val items = remember(values) {
        (Library.watchlist(values, MediaType.MOVIE) + Library.watchlist(values, MediaType.TV))
            .sortedByDescending { it.addedAt }
            .map {
                MediaItem(it.id, if (it.type == "tv") MediaType.TV else MediaType.MOVIE, it.title, it.poster_path, null, "", null, null)
            }
    }
    val first = remember { FocusRequester() }
    Column(modifier.padding(start = 24.dp, top = 40.dp)) {
        Text(stringResource(R.string.nav_watchlist), style = MovixType.Title, modifier = Modifier.padding(bottom = 20.dp))
        if (items.isEmpty()) {
            Text(stringResource(R.string.empty_watchlist), style = MovixType.Body)
            LaunchedEffect(Unit) { delay(32); onEmptyBack() }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(92.dp),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = 10.dp, bottom = 60.dp, start = 12.dp, end = 48.dp),
                horizontalArrangement = Arrangement.spacedBy(22.dp),
                verticalArrangement = Arrangement.spacedBy(26.dp),
            ) {
                items(items, key = { it.key }) { item ->
                    PosterCard(
                        imageUrl = TmdbImage.poster(item.posterPath),
                        onClick = { onOpen(item) },
                        onFocused = {},
                        modifier = if (item == items.first()) Modifier.focusRequester(first) else Modifier,
                    )
                }
            }
            LaunchedEffect(Unit) { delay(32); runCatching { first.requestFocus() } }
        }
    }
}
