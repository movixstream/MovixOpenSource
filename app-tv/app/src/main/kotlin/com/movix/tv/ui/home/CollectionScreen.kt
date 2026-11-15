package com.movix.tv.ui.home

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.MediaType
import com.movix.tv.data.tmdb.RowRegistry
import com.movix.tv.ui.components.Badge
import com.movix.tv.ui.components.PivotBringIntoViewSpec
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import java.util.Locale
import kotlinx.coroutines.delay

/**
 * « Voir tout » : la liste complète d'une rangée, en grille paginée. Titre de la
 * rangée en haut, puis le nom du titre sélectionné (la grille ne montre que des
 * affiches). Retour revient à la page d'origine, sur la carte « Voir tout ».
 *
 * @param session une ouverture de la page : la même au retour d'une fiche (grille
 *   et position gardées), une autre à la prochaine ouverture (la grille repart du début).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun CollectionScreen(
    rowId: String,
    session: String,
    onOpen: (MediaItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val spec = remember(rowId) { RowRegistry.find(rowId) }
    // Une seule grille « Voir tout » en mémoire, quelle que soit la rangée ouverte.
    val vm: TitlePagerViewModel = viewModel(key = "collection") { TitlePagerViewModel(context.container.catalog) }
    // Ouverte avant la première lecture de l'état : pas une image de la grille précédente.
    remember(session) { spec?.let { vm.open(session, it) } }
    val grid by vm.state.collectAsStateWithLifecycle()
    val titles = grid.titlesFor(session)
    val columns = rememberGridColumns()

    // Sauvegardés : au retour d'une fiche, le focus revient sur l'affiche ouverte.
    var focusedOnce by rememberSaveable { mutableStateOf(false) }
    var lastKey by rememberSaveable { mutableStateOf<String?>(null) }
    var focused by remember { mutableStateOf<MediaItem?>(null) }
    val first = remember { FocusRequester() }
    val restore = remember { FocusRequester() }
    val retry = remember { FocusRequester() }
    val listState = rememberLazyListState()

    LaunchedEffect(Unit) {
        if (focusedOnce && lastKey != null) { delay(48); runCatching { restore.requestFocus() } }
    }
    // Premier affichage : la première affiche, ou « Réessayer » si la première page a échoué.
    LaunchedEffect(titles.items.isNotEmpty(), titles.failed) {
        if (focusedOnce) return@LaunchedEffect
        delay(32)
        if (titles.items.isNotEmpty()) {
            if (runCatching { first.requestFocus() }.isSuccess) focusedOnce = true
        } else if (titles.failed) {
            runCatching { retry.requestFocus() }
        }
    }

    Column(modifier.background(MovixColors.Ink)) {
        Column(Modifier.fillMaxWidth().padding(start = ContentStart, end = 48.dp, top = 34.dp)) {
            Text(
                spec?.title.orEmpty(),
                style = MovixType.Title.copy(fontSize = 30.sp, lineHeight = 34.sp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(10.dp))
            FocusedLine(focused)
        }
        val density = LocalDensity.current
        val pivot = remember(density) { PivotBringIntoViewSpec(with(density) { 12.dp.toPx() }) }
        CompositionLocalProvider(LocalBringIntoViewSpec provides pivot) {
            LazyColumn(
                Modifier.fillMaxSize().padding(top = 10.dp),
                state = listState,
                contentPadding = PaddingValues(top = 4.dp, bottom = 80.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                posterGrid(
                    titles = titles,
                    columns = columns,
                    firstRequester = if (!focusedOnce) first else null,
                    restoreKey = lastKey,
                    restoreRequester = restore,
                    onFocus = { index, item ->
                        focused = item
                        lastKey = item.key
                        vm.onFocus(index)
                    },
                    onOpen = onOpen,
                    onRetry = {
                        // Le bouton disparaît pendant le chargement : le focus attend sur la dernière affiche.
                        if (titles.items.isNotEmpty()) runCatching { restore.requestFocus() }
                        vm.retry()
                    },
                    retryRequester = retry,
                )
            }
        }
    }
}

/** Titre sélectionné : nom, type, année et note, sur une ligne de hauteur fixe. */
@Composable
private fun FocusedLine(item: MediaItem?) {
    Row(Modifier.height(24.dp), verticalAlignment = Alignment.CenterVertically) {
        if (item == null) return@Row
        Badge(stringResource(if (item.type == MediaType.TV) R.string.badge_tv else R.string.badge_movie))
        Spacer(Modifier.width(10.dp))
        Text(item.title, style = MovixType.MetaStrong, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        item.year?.let { Text("  ·  $it", style = MovixType.Meta, maxLines = 1) }
        item.rating?.let { Text("  ·  ★ " + String.format(Locale.FRANCE, "%.1f", it), style = MovixType.Meta, maxLines = 1) }
    }
}
