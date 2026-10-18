package com.movix.tv.ui.home

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.graphicsLayer
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.movix.tv.data.local.UiKeys
import com.movix.tv.data.local.UiPrefs
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.local.ContinueEntry
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.MediaType
import com.movix.tv.data.tmdb.RowLayout
import com.movix.tv.data.tmdb.RowRegistry
import com.movix.tv.data.tmdb.TmdbImage
import com.movix.tv.ui.components.Badge
import com.movix.tv.ui.components.LandscapeCard
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.PivotBringIntoViewSpec
import com.movix.tv.ui.components.PosterCard
import com.movix.tv.ui.components.TmdbImage
import com.movix.tv.ui.nav.Section
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import com.movix.tv.ui.update.UpdateBanner
import kotlinx.coroutines.delay
import java.util.Locale

/** Ce que montre la bannière : le titre sélectionné, ou une carte « Reprendre ». */
@Immutable
data class HeroInfo(
    val id: Int,
    val title: String,
    val type: MediaType,
    val backdropPath: String?,
    val overview: String,
    val rating: Double?,
    val year: String?,
    val kicker: String?,
)

private fun MediaItem.hero() = HeroInfo(id, title, type, backdropPath, overview, rating, year, null)

private val ContentStart = 84.dp
// Bord gauche des rangées : une affiche qui défile à gauche disparaît juste
// avant le crochet de la carte sélectionnée, au lieu de dépasser dessous ou
// de passer sous les icônes du rail (l'affiche précédente s'arrête 18 dp
// avant la carte, le bord est à 15 dp, le crochet à 11 dp).
private val RailWidth = 69.dp
private val RowInset = ContentStart - RailWidth
private const val HERO_DEBOUNCE_MS = 160L
private val HeroHeight = 390.dp

@OptIn(ExperimentalFoundationApi::class, ExperimentalComposeUiApi::class)
@Composable
fun BrowseScreen(
    section: Section,
    onOpen: (MediaItem) -> Unit,
    onOpenSettings: () -> Unit,
    onResume: (ContinueEntry) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val values by context.container.store.values.collectAsStateWithLifecycle()
    // Accueil : rangées choisies dans les réglages ; les autres pages gardent leur liste.
    val homeRows = if (section == Section.HOME) UiPrefs.homeRows(values) else null
    val specs = remember(section, homeRows) {
        when (section) {
            Section.MOVIES -> RowRegistry.movies.take(RowRegistry.DEFAULT_VISIBLE_ROWS)
            Section.SERIES -> RowRegistry.series.take(RowRegistry.DEFAULT_VISIBLE_ROWS)
            Section.ANIME -> RowRegistry.anime.take(RowRegistry.DEFAULT_VISIBLE_ROWS)
            else -> RowRegistry.homeRows(homeRows?.order.orEmpty(), homeRows?.hidden.orEmpty())
        }
    }
    val vm: BrowseViewModel = viewModel(key = "browse:${section.name}") {
        BrowseViewModel(context.container, specs, withContinue = section == Section.HOME)
    }
    LaunchedEffect(specs) { vm.setSpecs(specs) }
    val state by vm.state.collectAsStateWithLifecycle()
    val continueRow by vm.continueRow.collectAsStateWithLifecycle()

    // La bannière suit le focus, mais avec un léger délai : parcourir une rangée
    // vite ne doit pas lancer le chargement d'une image de fond par carte.
    var focusedHero by remember { mutableStateOf<HeroInfo?>(null) }
    var hero by remember { mutableStateOf<HeroInfo?>(null) }
    LaunchedEffect(focusedHero) {
        if (hero == null) hero = focusedHero else { delay(HERO_DEBOUNCE_MS); hero = focusedHero }
        // Arrêté sur un titre : sa fiche se charge en avance.
        focusedHero?.let { delay(250); context.container.catalog.prefetchDetails(it.type, it.id) }
    }

    // Carte arrêtée 2 s : sa bande-annonce, muette, remplace l'image du bandeau.
    // Arrêt dès que le focus bouge, quitte la page, ou que l'appli passe en fond.
    val trailer = rememberBannerTrailer()
    val bannerVideo = UiPrefs.flag(values, UiKeys.BANNER_VIDEO)
    val lifeState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val resumed = lifeState.isAtLeast(Lifecycle.State.RESUMED)
    // « Reprendre » relu sur le serveur au retour au premier plan (appli, lecteur, fiche).
    DisposableEffect(vm, resumed) {
        vm.setVisible(resumed)
        onDispose { vm.setVisible(false) }
    }
    var contentFocused by remember { mutableStateOf(false) }
    LaunchedEffect(focusedHero, bannerVideo, resumed, contentFocused) {
        trailer.stop()
        val h = focusedHero ?: return@LaunchedEffect
        if (!bannerVideo || !resumed || !contentFocused) return@LaunchedEffect
        delay(BANNER_TRAILER_DELAY_MS)
        trailer.play(h)
    }
    LaunchedEffect(state.rows) {
        if (hero == null) hero = state.rows.firstOrNull()?.items?.firstOrNull()?.hero()
    }

    val firstCard = remember { FocusRequester() }
    // Sauvegardés : au retour d'une fiche, le focus revient sur la carte ouverte.
    var focusedOnce by rememberSaveable { mutableStateOf(false) }
    var lastKey by rememberSaveable { mutableStateOf<String?>(null) }
    // Titre et image d'une entrée « Reprendre » arrivés après le focus (fiche demandée à TMDB) : le bandeau suit.
    LaunchedEffect(continueRow) {
        val k = lastKey ?: return@LaunchedEffect
        continueRow.firstOrNull { "continue|${it.key}" == k }?.let { e ->
            val fresh = continueHero(e, context)
            if (fresh != focusedHero) focusedHero = fresh
        }
    }
    val restore = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        if (focusedOnce && lastKey != null) { delay(48); runCatching { restore.requestFocus() } }
    }

    Box(modifier.onFocusChanged { contentFocused = it.hasFocus }.background(MovixColors.Ink)) {
        when (state.status) {
            BrowseStatus.NoKey -> Message(
                title = stringResource(R.string.no_key_title),
                body = stringResource(R.string.no_key_body),
                action = stringResource(R.string.no_key_action),
                onAction = onOpenSettings,
            )
            BrowseStatus.Error -> Message(
                title = stringResource(R.string.error_title),
                body = stringResource(R.string.error_body),
                action = stringResource(R.string.action_retry),
                onAction = vm::load,
            )
            else -> {
                Hero(hero, trailer)
                val density = LocalDensity.current
                // La carte sélectionnée se cale sous le titre de sa rangée (≈ 36 dp), jamais dessus.
                val columnSpec = remember(density) { PivotBringIntoViewSpec(with(density) { 36.dp.toPx() }) }
                val rowSpec = remember(density) { PivotBringIntoViewSpec(with(density) { RowInset.toPx() }) }
                CompositionLocalProvider(LocalBringIntoViewSpec provides columnSpec) {
                    LazyColumn(
                        Modifier.fillMaxSize().padding(top = 252.dp),
                        contentPadding = PaddingValues(bottom = 120.dp),
                        verticalArrangement = Arrangement.spacedBy(22.dp),
                    ) {
                        if (continueRow.isNotEmpty()) {
                            item(key = "continue", contentType = "continue") {
                                CompositionLocalProvider(LocalBringIntoViewSpec provides rowSpec) {
                                    ContinueRow(
                                        entries = continueRow,
                                        firstRequester = if (!focusedOnce) firstCard else null,
                                        restoreKey = lastKey,
                                        restoreRequester = restore,
                                        onFocus = { key, h -> focusedHero = h; lastKey = key },
                                        // « Reprendre » relance directement la lecture.
                                        onOpen = onResume,
                                    )
                                }
                            }
                        }
                        itemsIndexed(state.rows, key = { _, r -> r.spec.id }, contentType = { _, r -> r.spec.layout }) { index, row ->
                            CompositionLocalProvider(LocalBringIntoViewSpec provides rowSpec) {
                                MediaRow(
                                    title = row.spec.title,
                                    items = row.items,
                                    layout = row.spec.layout,
                                    firstRequester = if (index == 0 && continueRow.isEmpty() && !focusedOnce) firstCard else null,
                                    restoreKey = lastKey?.removePrefix("${row.spec.id}|")?.takeIf { lastKey?.startsWith("${row.spec.id}|") == true },
                                    restoreRequester = restore,
                                    onFocus = { focusedHero = it.hero(); lastKey = "${row.spec.id}|${it.key}" },
                                    onOpen = onOpen,
                                )
                            }
                        }
                    }
                }
                // Premier affichage : focus sur la première carte, une seule fois.
                LaunchedEffect(state.rows.isNotEmpty() || continueRow.isNotEmpty()) {
                    if (!focusedOnce && (state.rows.isNotEmpty() || continueRow.isNotEmpty())) {
                        delay(32)
                        if (runCatching { firstCard.requestFocus() }.isSuccess) focusedOnce = true
                    }
                }
            }
        }
        // Mise à jour disponible : petite carte en haut à droite, sur la bannière,
        // jamais focalisée d'office (Haut depuis la première rangée).
        if (section == Section.HOME) {
            UpdateBanner(Modifier.align(Alignment.TopEnd).padding(top = 16.dp, end = 32.dp))
        }
    }
}

@Composable
private fun Hero(info: HeroInfo?, trailer: BannerTrailer) {
    // Mode léger : changement sec, jamais deux fonds plein écran en mémoire à la fois.
    val lowRam = com.movix.tv.ui.theme.LocalLowRam.current
    Crossfade(targetState = info, animationSpec = tween(if (lowRam) 0 else 220), label = "hero") { h ->
        if (h == null) return@Crossfade
        val imageAlpha by animateFloatAsState(
            targetValue = if (trailer.shownFor == h.trailerKey) 0f else 1f,
            animationSpec = tween(BANNER_FADE_MS),
            label = "heroVideo",
        )
        Box(Modifier.fillMaxWidth().height(HeroHeight)) {
            // Bande-annonce sous l'image, dans le cadre du bandeau : 16:9 sur toute
            // la largeur, centrée et rognée comme l'image. L'image s'efface pour la montrer.
            if (trailer.surfaceNeeded) {
                Box(Modifier.fillMaxSize().clipToBounds()) {
                    BannerTrailerSurface(
                        trailer,
                        // Hauteur libérée d'abord, sinon le 16:9 est écrasé à la hauteur du bandeau.
                        Modifier.align(Alignment.Center).fillMaxWidth().wrapContentHeight(unbounded = true).aspectRatio(16f / 9f),
                    )
                }
            }
            TmdbImage(TmdbImage.backdrop(h.backdropPath), 960.dp, HeroHeight, Modifier.fillMaxSize().graphicsLayer { alpha = imageAlpha })
            Box(
                Modifier.fillMaxSize().background(
                    Brush.horizontalGradient(
                        0.04f to MovixColors.Ink,
                        0.30f to MovixColors.Ink.copy(alpha = 0.85f),
                        0.66f to MovixColors.Ink.copy(alpha = 0.10f),
                    ),
                ),
            )
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(0.55f to MovixColors.Ink.copy(alpha = 0f), 1f to MovixColors.Ink),
                ),
            )
            Column(Modifier.padding(start = ContentStart, top = 56.dp).width(560.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Badge(stringResource(if (h.type == MediaType.TV) R.string.badge_tv else R.string.badge_movie))
                    if (h.kicker != null) Text(h.kicker, style = MovixType.Kicker)
                }
                Spacer(Modifier.height(12.dp))
                Text(h.title, style = MovixType.Hero, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    h.rating?.let { Text("★ " + String.format(Locale.FRANCE, "%.1f", it), style = MovixType.MetaStrong) }
                    h.year?.let { Text(it, style = MovixType.Meta) }
                }
                Spacer(Modifier.height(10.dp))
                Text(h.overview, style = MovixType.Body, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(380.dp))
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun MediaRow(
    title: String,
    items: List<MediaItem>,
    layout: RowLayout,
    firstRequester: FocusRequester?,
    restoreKey: String?,
    restoreRequester: FocusRequester,
    onFocus: (MediaItem) -> Unit,
    onOpen: (MediaItem) -> Unit,
) {
    Column {
        Text(title, style = MovixType.Row, modifier = Modifier.padding(start = ContentStart, bottom = 10.dp))
        LazyRow(
            Modifier.fillMaxWidth().padding(start = RailWidth).focusRestorer(),
            contentPadding = PaddingValues(start = RowInset, end = 48.dp, top = 8.dp, bottom = 8.dp),
            // 18 dp : place pour les crochets (barre de 5 dp à 6 dp de la carte)
            // sans mordre sur les affiches voisines.
            horizontalArrangement = Arrangement.spacedBy(if (layout == RowLayout.RANK) 6.dp else 18.dp),
        ) {
            itemsIndexed(items, key = { _, it -> it.key }, contentType = { _, _ -> layout }) { index, item ->
                PosterCard(
                    imageUrl = TmdbImage.poster(item.posterPath),
                    onClick = { onOpen(item) },
                    onFocused = { onFocus(item) },
                    rank = if (layout == RowLayout.RANK) index + 1 else null,
                    modifier = Modifier
                        .then(if (index == 0 && firstRequester != null) Modifier.focusRequester(firstRequester) else Modifier)
                        .then(if (item.key == restoreKey) Modifier.focusRequester(restoreRequester) else Modifier),
                )
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun ContinueRow(
    entries: List<ContinueEntry>,
    firstRequester: FocusRequester?,
    restoreKey: String?,
    restoreRequester: FocusRequester,
    onFocus: (String, HeroInfo) -> Unit,
    onOpen: (ContinueEntry) -> Unit,
) {
    val context = LocalContext.current
    Column {
        Text(stringResource(R.string.row_continue), style = MovixType.Row, modifier = Modifier.padding(start = ContentStart, bottom = 10.dp))
        LazyRow(
            Modifier.fillMaxWidth().padding(start = RailWidth).focusRestorer(),
            contentPadding = PaddingValues(start = RowInset + 12.dp, end = 48.dp, top = 10.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            items(entries, key = { it.key }, contentType = { "continue" }) { e ->
                val title = e.meta?.title ?: ""
                val remaining = e.remainingSeconds / 60
                val left = if (remaining >= 60) context.getString(R.string.hours_minutes_left, remaining / 60, remaining % 60)
                else context.getString(R.string.minutes_left, remaining.coerceAtLeast(1))
                // Progression inconnue (titre ouvert sur le site sans position enregistrée) : pas de temps restant.
                val known = e.progress.duration > 0
                val sub = when {
                    e.season != null && known -> "S${e.season} É${e.episode}, $left"
                    e.season != null -> listOfNotNull("S${e.season} É${e.episode}", e.meta?.episodeName?.takeUnless { PLACEHOLDER_EPISODE.matches(it.trim()) }).joinToString(" · ")
                    known -> left.replaceFirstChar { it.uppercase() }
                    else -> ""
                }
                LandscapeCard(
                    imageUrl = TmdbImage.landscape(e.meta?.backdropPath),
                    title = title,
                    subtitle = sub,
                    ratio = e.ratio,
                    onClick = { onOpen(e) },
                    onFocused = { onFocus("continue|${e.key}", continueHero(e, context)) },
                    modifier = Modifier
                        .then(if (e == entries.first() && firstRequester != null) Modifier.focusRequester(firstRequester) else Modifier)
                        .then(if ("continue|${e.key}" == restoreKey) Modifier.focusRequester(restoreRequester) else Modifier),
                )
            }
        }
    }
}

/** Titres d'épisode génériques que TMDB met quand il n'en a pas de vrai (« Épisode 3 », « Episode 3 »). */
private val PLACEHOLDER_EPISODE = Regex("""^[ÉéEe]pisode\s*\d+$""")

/** Bandeau d'une entrée « Reprendre » : titre, image et nom de l'épisode en cours. */
private fun continueHero(e: ContinueEntry, context: android.content.Context) = HeroInfo(
    id = e.id,
    title = e.meta?.title.orEmpty(),
    type = e.type,
    backdropPath = e.meta?.backdropPath,
    // « Bête Noire. » puis le résumé de l'épisode (ou du film), comme les autres bandeaux.
    // Un titre bouche-trou de TMDB (« Épisode 1 ») n'apprend rien : seul le résumé reste.
    overview = listOfNotNull(e.meta?.episodeName?.takeIf { it.isNotBlank() && !PLACEHOLDER_EPISODE.matches(it.trim()) }, e.meta?.overview?.takeIf { it.isNotBlank() })
        .joinToString(" · "),
    rating = e.meta?.rating,
    year = e.meta?.year,
    kicker = if (e.season != null) context.getString(R.string.resume_kicker, e.season, e.episode) else null,
)

@Composable
internal fun Message(title: String, body: String, action: String, onAction: () -> Unit) {
    val requester = remember { FocusRequester() }
    Column(Modifier.fillMaxSize().padding(start = 140.dp, top = 150.dp).width(520.dp)) {
        Text(title, style = MovixType.Title.copy(fontSize = MovixType.Title.fontSize * 0.8f))
        Spacer(Modifier.height(14.dp))
        Text(body, style = MovixType.Body)
        Spacer(Modifier.height(22.dp))
        PillButton(action, onAction, Modifier.focusRequester(requester))
    }
    LaunchedEffect(Unit) { delay(32); runCatching { requester.requestFocus() } }
}
