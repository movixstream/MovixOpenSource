package com.movix.tv.ui.person

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.PersonCredit
import com.movix.tv.data.tmdb.PersonPage
import com.movix.tv.data.tmdb.TmdbImage
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.PivotBringIntoViewSpec
import com.movix.tv.ui.components.PosterCard
import com.movix.tv.ui.components.TmdbImage
import com.movix.tv.ui.theme.LocalLowRam
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlin.coroutines.cancellation.CancellationException

private val Start = 84.dp

/**
 * Hauteur où se cale la rangée sélectionnée quand l'écran défile : la rangée
 * « Films » laisse l'en-tête entier, « Séries » remonte juste ce qu'il faut.
 */
private val RowPivot = 300.dp

/**
 * Écran d'un acteur, ouvert depuis la distribution d'une fiche : photo, nom,
 * courte biographie, puis ses films et ses séries, les plus connus d'abord.
 * Nom et photo de la fiche s'affichent tout de suite, pendant le chargement.
 * OK sur un titre ouvre sa fiche ; au retour, le focus revient sur ce titre.
 */
@OptIn(ExperimentalComposeUiApi::class, ExperimentalFoundationApi::class)
@Composable
fun PersonScreen(
    id: Int,
    name: String,
    profilePath: String?,
    onOpen: (MediaItem) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val container = LocalContext.current.container
    var reload by remember { mutableIntStateOf(0) }
    val result by produceState<Result<PersonPage>?>(null, id, reload) {
        value = null
        value = try {
            Result.success(container.catalog.person(id))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            android.util.Log.w("MovixPerson", "personne $id illisible", e)
            Result.failure(e)
        }
    }
    val page = result?.getOrNull()

    // Sauvegardés : au retour d'une fiche, le focus revient sur le titre ouvert.
    var focusedOnce by rememberSaveable(id) { mutableStateOf(false) }
    var openedKey by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var hasFocus by remember { mutableStateOf(false) }
    val firstCard = remember { FocusRequester() }
    val restore = remember { FocusRequester() }
    val action = remember { FocusRequester() }
    val moviesState = rememberLazyListState()
    val seriesState = rememberLazyListState()

    LaunchedEffect(page) {
        val p = page ?: return@LaunchedEffect
        val target = openedKey?.takeIf { focusedOnce }
        val inMovies = target?.let { k -> p.movies.indexOfFirst { it.item.key == k } } ?: -1
        val inSeries = target?.let { k -> p.series.indexOfFirst { it.item.key == k } } ?: -1
        when {
            inMovies >= 0 -> { moviesState.scrollToItem(inMovies); restore.requestFocusSoon { hasFocus } }
            inSeries >= 0 -> { seriesState.scrollToItem(inSeries); restore.requestFocusSoon { hasFocus } }
            p.movies.isNotEmpty() -> { moviesState.scrollToItem(0); firstCard.requestFocusSoon { hasFocus } }
            p.series.isNotEmpty() -> { seriesState.scrollToItem(0); firstCard.requestFocusSoon { hasFocus } }
            else -> action.requestFocusSoon { hasFocus }
        }
        focusedOnce = true
    }
    val failed = result?.isFailure == true
    LaunchedEffect(failed) { if (failed) action.requestFocusSoon { hasFocus } }

    val density = LocalDensity.current
    val columnSpec = remember(density) { PivotBringIntoViewSpec(with(density) { RowPivot.toPx() }) }
    val rowSpec = remember(density) { PivotBringIntoViewSpec(with(density) { Start.toPx() }) }
    val lowRam = LocalLowRam.current

    Box(modifier.onFocusChanged { hasFocus = it.hasFocus }.background(MovixColors.Ink)) {
        // Image du titre le plus connu derrière l'en-tête, comme sur la fiche
        // (pas en mode léger : une grande image de moins en mémoire).
        val backdrop = page?.let { p -> (p.movies.firstOrNull() ?: p.series.firstOrNull())?.item?.backdropPath }
        if (!lowRam && backdrop != null) {
            Box(Modifier.align(Alignment.TopEnd).width(640.dp).height(400.dp)) {
                TmdbImage(TmdbImage.backdrop(backdrop), 640.dp, 400.dp, Modifier.fillMaxSize())
                Box(
                    Modifier.fillMaxSize().background(
                        Brush.horizontalGradient(0f to MovixColors.Ink, 0.35f to MovixColors.Ink.copy(alpha = 0.7f), 0.75f to MovixColors.Ink.copy(alpha = 0.15f)),
                    ),
                )
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.4f to MovixColors.Ink.copy(alpha = 0f), 0.98f to MovixColors.Ink)))
            }
        }

        CompositionLocalProvider(LocalBringIntoViewSpec provides columnSpec) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 48.dp, bottom = 48.dp)) {
                PersonHeader(page?.name?.ifBlank { null } ?: name, page?.profilePath ?: profilePath, page)
                when {
                    result == null -> Text(
                        stringResource(R.string.person_loading),
                        style = MovixType.Meta,
                        modifier = Modifier.padding(start = Start, top = 32.dp),
                    )
                    page == null -> StateMessage(stringResource(R.string.person_error), stringResource(R.string.action_retry), action) { reload++ }
                    page.movies.isEmpty() && page.series.isEmpty() ->
                        StateMessage(stringResource(R.string.person_empty, page.name.ifBlank { name }), stringResource(R.string.person_back), action, onBack)
                    else -> CompositionLocalProvider(LocalBringIntoViewSpec provides rowSpec) {
                        val open = { c: PersonCredit -> openedKey = c.item.key; onOpen(c.item) }
                        if (page.movies.isNotEmpty()) {
                            CreditRow(
                                title = stringResource(R.string.person_movies, page.movies.size),
                                credits = page.movies,
                                state = moviesState,
                                firstRequester = firstCard,
                                restoreKey = openedKey,
                                restoreRequester = restore,
                                onOpen = open,
                            )
                        }
                        if (page.series.isNotEmpty()) {
                            CreditRow(
                                title = stringResource(R.string.person_series, page.series.size),
                                credits = page.series,
                                state = seriesState,
                                firstRequester = if (page.movies.isEmpty()) firstCard else null,
                                restoreKey = openedKey,
                                restoreRequester = restore,
                                onOpen = open,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Photo ronde (comme la carte de la distribution), nom, dates et lieu de naissance, biographie. */
@Composable
private fun PersonHeader(name: String, profilePath: String?, page: PersonPage?) {
    Row(Modifier.padding(start = Start, end = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(112.dp).clip(CircleShape).background(MovixColors.Chip), contentAlignment = Alignment.Center) {
            if (profilePath != null) {
                // Même taille d'image que la carte de la fiche : déjà en cache, affichée aussitôt.
                TmdbImage("https://image.tmdb.org/t/p/w185$profilePath", 112.dp, 112.dp, Modifier.fillMaxSize())
            } else {
                Text(name.split(' ').mapNotNull { it.firstOrNull()?.uppercase() }.take(2).joinToString(""), style = MovixType.Panel)
            }
        }
        Spacer(Modifier.width(24.dp))
        Column(Modifier.width(560.dp)) {
            Text(name, style = MovixType.Title, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val life = when {
                page?.birthYear != null && page.deathYear != null -> stringResource(R.string.person_lifespan, page.birthYear, page.deathYear)
                page?.birthYear != null -> stringResource(R.string.person_born, page.birthYear)
                else -> null
            }
            val meta = listOfNotNull(life, page?.placeOfBirth).joinToString(" · ")
            if (meta.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text(meta, style = MovixType.Meta, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            val bio = page?.biography.orEmpty()
            if (bio.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Text(bio, style = MovixType.Body, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/**
 * Rangée « Films » ou « Séries ». Le titre, l'année et le rôle de l'affiche
 * sélectionnée s'écrivent à côté du titre de la rangée : rien ne bouge en
 * hauteur quand le focus passe d'une affiche à l'autre.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun CreditRow(
    title: String,
    credits: List<PersonCredit>,
    state: LazyListState,
    firstRequester: FocusRequester?,
    restoreKey: String?,
    restoreRequester: FocusRequester,
    onOpen: (PersonCredit) -> Unit,
) {
    val context = LocalContext.current
    var focused by remember { mutableStateOf<PersonCredit?>(null) }
    Column {
        Row(
            Modifier.padding(start = Start, end = 48.dp, top = 24.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(title, style = MovixType.Row, maxLines = 1)
            focused?.let { c ->
                val caption = listOfNotNull(c.item.title, c.item.year, c.character?.let { context.getString(R.string.person_as, it) })
                    .joinToString(" · ")
                Text(caption, style = MovixType.Meta, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        LazyRow(
            Modifier.fillMaxWidth().onFocusChanged { if (!it.hasFocus) focused = null }.focusRestorer(),
            state = state,
            contentPadding = PaddingValues(start = Start, end = 48.dp, top = 8.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            itemsIndexed(credits, key = { _, c -> c.item.key }, contentType = { _, _ -> "poster" }) { index, c ->
                PosterCard(
                    imageUrl = TmdbImage.poster(c.item.posterPath),
                    onClick = { onOpen(c) },
                    onFocused = { focused = c },
                    modifier = Modifier
                        .then(if (index == 0 && firstRequester != null) Modifier.focusRequester(firstRequester) else Modifier)
                        .then(if (c.item.key == restoreKey) Modifier.focusRequester(restoreRequester) else Modifier),
                )
            }
        }
    }
}

/** Chargement raté ou filmographie vide : un message et un bouton qui prend le focus. */
@Composable
private fun StateMessage(text: String, action: String, requester: FocusRequester, onAction: () -> Unit) {
    Column(Modifier.padding(start = Start, top = 32.dp).width(520.dp)) {
        Text(text, style = MovixType.Body)
        Spacer(Modifier.height(16.dp))
        PillButton(action, onAction, Modifier.focusRequester(requester))
    }
}

/**
 * Demande le focus jusqu'à ce qu'il arrive dans l'écran (`landed`) : la carte
 * visée n'est parfois composée qu'une ou deux images plus tard (rangée qui
 * vient de défiler, fiche complète qui remplace l'aperçu). Abandonne après
 * une vingtaine d'images.
 */
internal suspend fun FocusRequester.requestFocusSoon(landed: () -> Boolean) {
    repeat(12) {
        withFrameNanos { }
        runCatching { requestFocus() }
        withFrameNanos { }
        if (landed()) return
    }
}
