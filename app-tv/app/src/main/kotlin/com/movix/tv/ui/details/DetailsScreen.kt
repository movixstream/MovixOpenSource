package com.movix.tv.ui.details

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import com.movix.tv.data.tmdb.CastMember
import com.movix.tv.data.tmdb.VideoClip
import com.movix.tv.data.youtube.YouTubeClient
import com.movix.tv.ui.components.PosterCard
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.local.Library
import com.movix.tv.data.movix.PlayRequest
import com.movix.tv.data.tmdb.Details
import com.movix.tv.data.tmdb.Episode
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.MediaType
import com.movix.tv.data.tmdb.TmdbImage
import com.movix.tv.ui.components.Badge
import com.movix.tv.ui.components.LandscapeCard
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.PivotBringIntoViewSpec
import com.movix.tv.ui.components.TabPill
import com.movix.tv.ui.components.TmdbImage
import com.movix.tv.ui.home.Message
import com.movix.tv.ui.player.PlayTarget
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

private val Start = 84.dp

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun DetailsScreen(
    type: MediaType,
    id: Int,
    preview: MediaItem?,
    onPlay: (PlayTarget) -> Unit,
    modifier: Modifier = Modifier,
    /** Titre similaire choisi en bas de la fiche. */
    onOpen: (MediaItem) -> Unit = {},
) {
    val context = LocalContext.current
    val container = context.container
    var reload by remember { mutableStateOf(0) }
    val details by produceState<Result<Details>?>(null, type, id, reload) {
        value = runCatching { container.catalog.details(type, id) }
    }
    // Pendant le chargement : titre, image et résumé déjà connus, sans écran noir.
    // Un seul appel à DetailsContent : la fiche complète remplace l'aperçu sans
    // recréer l'écran ni perdre le focus.
    val loaded = details?.getOrNull()
    val shown = loaded ?: preview?.let { Details(it, emptyList(), null, emptyList(), null, null, null) }
    Box(modifier.background(MovixColors.Ink)) {
        if (details?.isFailure == true && preview == null) {
            Message(
                stringResource(R.string.error_title),
                stringResource(R.string.error_body),
                stringResource(R.string.action_retry),
            ) { reload++ }
        } else if (shown != null) {
            DetailsContent(shown, onPlay, onOpen)
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun DetailsContent(d: Details, onPlay: (PlayTarget) -> Unit, onOpen: (MediaItem) -> Unit) {
    val context = LocalContext.current
    // Bande-annonce ou bonus lu par-dessus la fiche, dans l'appli.
    var video by remember { mutableStateOf<VideoClip?>(null) }
    val container = context.container
    val scope = rememberCoroutineScope()
    val values by container.store.values.collectAsStateWithLifecycle()
    val item = d.item
    val inList = Library.isInWatchlist(values, item)
    val resume = if (item.type == MediaType.TV) Library.resumeEpisode(values, item.id) else null
    // L'aperçu (carte de l'accueil) n'a pas de saisons : la saison et les
    // épisodes se recalculent quand la fiche complète arrive, sinon la liste
    // restait vide.
    val hasSeasons = d.seasonNumbers.isNotEmpty()
    var season by rememberSaveable(item.id, hasSeasons) { mutableStateOf(resume?.first ?: d.seasonNumbers.firstOrNull() ?: 1) }
    val episodes by produceState<List<Episode>>(emptyList(), item.id, season, hasSeasons) {
        value = if (item.type == MediaType.TV && hasSeasons) {
            runCatching { container.catalog.episodes(item.id, season) }
                .onFailure { android.util.Log.w("MovixDetails", "épisodes S$season de ${item.id} illisibles", it) }
                .getOrDefault(emptyList())
        } else emptyList()
    }
    val playRequester = remember { FocusRequester() }
    fun play(season: Int?, episode: Int?) =
        onPlay(PlayTarget(PlayRequest(item.type, item.id, season, episode, d.imdbId), item.title, item.backdropPath))
    val playMain = {
        if (item.type == MediaType.TV) play(resume?.first ?: d.seasonNumbers.firstOrNull() ?: 1, resume?.second ?: 1) else play(null, null)
    }

    Box(Modifier.fillMaxSize()) {
        Box(Modifier.align(Alignment.TopEnd).width(640.dp).height(400.dp)) {
            TmdbImage(TmdbImage.backdrop(item.backdropPath), 640.dp, 400.dp, Modifier.fillMaxSize())
            Box(
                Modifier.fillMaxSize().background(
                    Brush.horizontalGradient(0f to MovixColors.Ink, 0.35f to MovixColors.Ink.copy(alpha = 0.6f), 0.7f to MovixColors.Ink.copy(alpha = 0f)),
                ),
            )
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.5f to MovixColors.Ink.copy(alpha = 0f), 0.98f to MovixColors.Ink)))
        }

        // La fiche défile : les rangées du bas (vidéos, similaires, distribution) dépassent l'écran.
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 52.dp, bottom = 48.dp)) {
        Column(Modifier.padding(start = Start).width(460.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Badge(stringResource(if (item.type == MediaType.TV) R.string.badge_tv else R.string.badge_movie))
                d.studio?.let { Text(it, style = MovixType.Kicker) }
            }
            Spacer(Modifier.height(12.dp))
            Text(item.title, style = MovixType.Title, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                item.rating?.let { Text("★ " + String.format(Locale.FRANCE, "%.1f", it), style = MovixType.MetaStrong) }
                item.year?.let { Text(it, style = MovixType.Meta) }
                if (item.type == MediaType.TV && d.seasonNumbers.isNotEmpty()) {
                    Text(
                        if (d.seasonNumbers.size == 1) stringResource(R.string.season_one) else stringResource(R.string.seasons_count, d.seasonNumbers.size),
                        style = MovixType.Meta,
                    )
                }
                if (item.type == MediaType.MOVIE) d.runtime?.let { Text(formatDuration(context, it), style = MovixType.Meta) }
                d.certification?.let { Text(if (it.all(Char::isDigit)) "$it+" else it, style = MovixType.Meta) }
                if (d.genres.isNotEmpty()) Text(d.genres.take(2).joinToString(", "), style = MovixType.Meta, maxLines = 1)
            }
            if (item.overview.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Text(item.overview, style = MovixType.Body, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val playLabel = when {
                    resume != null -> stringResource(R.string.resume_episode, resume.first, resume.second)
                    item.type == MediaType.MOVIE && Library.progress(values, Library.movieProgressKey(item.id)) != null -> stringResource(R.string.action_resume)
                    else -> stringResource(R.string.action_play)
                }
                PillButton(playLabel, playMain, Modifier.focusRequester(playRequester), icon = MovixIcons.Play)
                PillButton(
                    stringResource(if (inList) R.string.action_watchlist_remove else R.string.action_watchlist_add),
                    onClick = {
                        scope.launch {
                            container.store.set(Library.watchlistKey(item.type), Library.toggleWatchlist(container.store.values.value, item))
                        }
                    },
                    icon = if (inList) MovixIcons.Check else MovixIcons.Plus,
                )
                d.trailerKey?.let { key ->
                    PillButton(stringResource(R.string.action_trailer), onClick = {
                        video = d.videos.firstOrNull { it.key == key } ?: VideoClip(key, item.title, "Trailer")
                    }, icon = MovixIcons.Film)
                }
            }
        }

        // Saisons et épisodes suivent le bloc d'infos : un titre sur deux lignes ne les chevauche pas.
        if (item.type == MediaType.TV && d.seasonNumbers.isNotEmpty()) {
            val density = LocalDensity.current
            val rowSpec = remember(density) { PivotBringIntoViewSpec(with(density) { Start.toPx() }) }
            val watched = Library.watchedEpisodes(values, item.id)
            Column(Modifier.padding(top = 18.dp)) {
                LazyRow(
                    Modifier.focusRestorer(),
                    contentPadding = PaddingValues(start = Start, end = 48.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(d.seasonNumbers, key = { it }) { n ->
                        TabPill(stringResource(R.string.season_n, n), selected = n == season, onClick = { season = n }, onFocused = { season = n })
                    }
                }
                Spacer(Modifier.height(12.dp))
                CompositionLocalProvider(LocalBringIntoViewSpec provides rowSpec) {
                    LazyRow(
                        Modifier.fillMaxWidth().focusRestorer(),
                        contentPadding = PaddingValues(start = Start, end = 48.dp, top = 8.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(26.dp),
                    ) {
                        items(episodes, key = { "$season:${it.number}" }, contentType = { "episode" }) { ep ->
                            val p = Library.progress(values, Library.episodeProgressKey(item.id, season, ep.number))
                            val ratio = p?.takeIf { !Library.isFinished(it) }?.let { (it.position / it.duration).toFloat() }
                            val sub = listOfNotNull(ep.runtime?.let { context.getString(R.string.duration_min, it) }, ep.overview.takeIf { it.isNotBlank() })
                                .joinToString(". ")
                            LandscapeCard(
                                imageUrl = TmdbImage.still(ep.stillPath) ?: TmdbImage.landscape(item.backdropPath),
                                title = ep.title.ifBlank { context.getString(R.string.episode_short, ep.number) },
                                subtitle = sub,
                                ratio = ratio,
                                onClick = { play(season, ep.number) },
                                onFocused = {},
                                width = 196.dp,
                                height = 110.dp,
                                badge = context.getString(R.string.episode_short, ep.number),
                                watched = "S${season}E${ep.number}" in watched || (p != null && Library.isFinished(p)),
                            )
                        }
                    }
                }
            }
        }
        DetailsExtras(d, onOpen = onOpen, onVideo = { video = it })
        }

        video?.let { clip -> TrailerOverlay(clip, onClose = { video = null }) }
    }
    LaunchedEffect(item.id) { delay(32); runCatching { playRequester.requestFocus() } }
}

/**
 * Bas de la fiche, comme Netflix : bandes-annonces et bonus (lus dans
 * l'appli), titres similaires, distribution. Une rangée vide n'est pas montrée.
 */
@OptIn(ExperimentalComposeUiApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun DetailsExtras(d: Details, onOpen: (MediaItem) -> Unit, onVideo: (VideoClip) -> Unit) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val rowSpec = remember(density) { PivotBringIntoViewSpec(with(density) { Start.toPx() }) }
    @Composable
    fun Title(res: Int) = Text(stringResource(res), style = MovixType.Row, modifier = Modifier.padding(start = Start, top = 26.dp, bottom = 10.dp))

    CompositionLocalProvider(LocalBringIntoViewSpec provides rowSpec) {
        if (d.videos.isNotEmpty()) {
            Title(R.string.details_videos)
            LazyRow(
                Modifier.fillMaxWidth().focusRestorer(),
                contentPadding = PaddingValues(start = Start, end = 48.dp, top = 8.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(26.dp),
            ) {
                items(d.videos, key = { it.key }) { v ->
                    LandscapeCard(
                        imageUrl = YouTubeClient.thumbnail(v.key),
                        title = v.name,
                        subtitle = context.getString(videoTypeLabel(v.type)),
                        ratio = null,
                        onClick = { onVideo(v) },
                        onFocused = {},
                        width = 220.dp,
                        height = 124.dp,
                    )
                }
            }
        }
        if (d.similar.isNotEmpty()) {
            Title(R.string.details_similar)
            LazyRow(
                Modifier.fillMaxWidth().focusRestorer(),
                contentPadding = PaddingValues(start = Start, end = 48.dp, top = 8.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                items(d.similar, key = { it.key }) { m ->
                    PosterCard(imageUrl = TmdbImage.poster(m.posterPath), onClick = { onOpen(m) }, onFocused = {})
                }
            }
        }
        if (d.cast.isNotEmpty()) {
            Title(R.string.details_cast)
            LazyRow(
                Modifier.fillMaxWidth().focusRestorer(),
                contentPadding = PaddingValues(start = Start, end = 48.dp, top = 8.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                items(d.cast, key = { it.name + it.character }) { c -> CastCard(c) }
            }
        }
    }
}

/** Acteur : photo ronde, nom, rôle. Prend le focus pour faire défiler la rangée ; anneau blanc au focus. */
@Composable
private fun CastCard(c: CastMember) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    Column(Modifier.width(112.dp).focusable(interactionSource = source), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(96.dp).clip(CircleShape).background(MovixColors.Chip)
                .border(if (focused) 3.dp else 0.dp, if (focused) MovixColors.Text else Color.Transparent, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (c.profilePath != null) {
                TmdbImage("https://image.tmdb.org/t/p/w185${c.profilePath}", 96.dp, 96.dp, Modifier.fillMaxSize())
            } else {
                Text(c.name.split(' ').mapNotNull { it.firstOrNull()?.uppercase() }.take(2).joinToString(""), style = MovixType.Button)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(c.name, style = MovixType.Button.copy(fontSize = 13.sp, color = if (focused) MovixColors.Text else MovixColors.Muted), maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        c.character?.let { Text(it, style = MovixType.Meta.copy(fontSize = 11.sp), maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center) }
    }
}

private fun videoTypeLabel(type: String): Int = when (type) {
    "Trailer" -> R.string.video_trailer
    "Teaser" -> R.string.video_teaser
    "Clip" -> R.string.video_clip
    "Featurette" -> R.string.video_featurette
    "Behind the Scenes", "Bloopers" -> R.string.video_behind
    else -> R.string.video_other
}

private fun formatDuration(context: android.content.Context, minutes: Int): String =
    if (minutes >= 60) context.getString(R.string.duration_hm, minutes / 60, minutes % 60)
    else context.getString(R.string.duration_min, minutes)
