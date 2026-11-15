package com.movix.tv.ui.player

import android.view.SurfaceView
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.local.SubtitleStyle
import com.movix.tv.data.local.UiKeys
import com.movix.tv.data.local.UiPrefs
import com.movix.tv.data.tmdb.TmdbImage
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.embed.EmbedView
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.TmdbImage
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import com.movix.tv.ui.theme.subtitleFontFamily
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

private const val HIDE_AFTER_MS = 4_000L
private const val SEEK_STEP_MS = 10_000L

/**
 * Lecteur plein écran (maquette 3 et 4). Contrôles cachés : gauche/droite =
 * ±10 s, OK = pause ; toute autre touche les montre, et ils disparaissent
 * après 4 s sans touche pendant la lecture.
 */
@Composable
fun PlayerScreen(target: PlayTarget, onExit: () -> Unit, onOpenSettings: () -> Unit) {
    val container = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val c = remember { PlayerController(container, scope, target) }
    DisposableEffect(Unit) { onDispose { c.release() } }
    // Pas d'écran de veille pendant la lecture.
    DisposableEffect(Unit) { com.movix.tv.ui.home.PlaybackActivity.begin(); onDispose { com.movix.tv.ui.home.PlaybackActivity.end() } }

    val values by container.store.values.collectAsState()
    var controls by remember { mutableStateOf(true) }
    var panel by remember { mutableStateOf<PanelPage?>(null) }
    var episodesOpen by remember { mutableStateOf(false) }
    var lastKey by remember { mutableLongStateOf(0L) }
    var seekFlash by remember { mutableLongStateOf(0L) }
    val rootRequester = remember { FocusRequester() }
    val playRequester = remember { FocusRequester() }

    // Façon Netflix : bouton « Passer l'intro / le récap / le générique » sur
    // le passage en cours ; en fin d'épisode, carte « Épisode suivant » avec
    // compte à rebours qui lance la suite (Retour : on regarde le générique).
    // Enchaînement coupé dans les réglages : la carte reste, sans compte à rebours.
    val segment = c.activeSegment?.takeUnless { it.kind.isEnd && c.next != null }
    var creditsKept by remember(c.target.request) { mutableStateOf(false) }
    val nextCard = c.nearEnd && !creditsKept && !c.stillWatching
    val autoplay = UiPrefs.flag(values, UiKeys.AUTOPLAY_NEXT)
    var countdown by remember { mutableIntStateOf(NEXT_COUNTDOWN_S) }
    LaunchedEffect(nextCard, c.isPlaying, autoplay, episodesOpen) {
        if (!nextCard || !autoplay || episodesOpen) { countdown = NEXT_COUNTDOWN_S; return@LaunchedEffect }
        if (!c.isPlaying) return@LaunchedEffect
        while (countdown > 0) { delay(1_000); countdown-- }
        c.autoAdvance()
    }
    val subStyle = remember(values[UiKeys.SUBTITLE_STYLE]) { UiPrefs.subtitleStyle(values) }

    fun back() {
        when {
            c.webSource != null -> c.closeWeb()
            c.stillWatching -> { c.dismissStillWatching(); controls = true }
            episodesOpen -> episodesOpen = false
            panel != null -> panel = panel?.parent
            c.formatIssue != null -> c.dismissFormatIssue()
            nextCard -> creditsKept = true
            controls && c.phase == PlayerPhase.PLAYING -> controls = false
            else -> onExit()
        }
    }
    // Retour est aussi traité dans onPreviewKeyEvent : sinon Compose s'en sert
    // d'abord pour faire sortir le focus du groupe courant (un appui perdu par
    // niveau de panneau). Ce gestionnaire ne sert qu'en l'absence de focus.
    BackHandler { back() }

    // Lecteur web (souris virtuelle) : remplace tout l'écran, Retour y revient.
    c.webSource?.embedUrl?.let { url ->
        EmbedView(url, container.embedFilter, onClose = c::closeWeb, onNext = c::nextWeb)
        return
    }

    // Disparition des contrôles après 4 s sans touche, seulement pendant la lecture.
    LaunchedEffect(controls, lastKey, c.isPlaying, panel, episodesOpen) {
        if (controls && c.isPlaying && panel == null && !episodesOpen) {
            delay(HIDE_AFTER_MS)
            controls = false
        }
    }
    val overlay = episodesOpen || c.stillWatching
    LaunchedEffect(controls, panel, c.phase, c.formatIssue, overlay) {
        delay(16)
        // La fenêtre « format non pris en charge », le panneau Épisodes et
        // « Vous regardez toujours ? » gardent le focus.
        if (panel == null && c.formatIssue == null && !overlay) runCatching { if (controls && c.phase == PlayerPhase.PLAYING) playRequester.requestFocus() else rootRequester.requestFocus() }
    }
    // En pause, les contrôles restent visibles.
    LaunchedEffect(c.isPlaying) { if (!c.isPlaying && c.phase == PlayerPhase.PLAYING && !c.buffering) controls = true }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(rootRequester)
            .onPreviewKeyEvent { e ->
                if (e.key == Key.Back || e.key == Key.Escape) {
                    if (e.type == KeyEventType.KeyUp) { c.userActivity(); back() }
                    return@onPreviewKeyEvent true
                }
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                lastKey = System.nanoTime()
                // Toute touche remet à zéro le compteur de « Vous regardez toujours ? ».
                c.userActivity()
                when (e.key) {
                    Key.MediaPlayPause, Key.MediaPlay, Key.MediaPause -> { c.togglePlay(); return@onPreviewKeyEvent true }
                    Key.MediaFastForward -> { c.seekBy(SEEK_STEP_MS); seekFlash = System.nanoTime(); return@onPreviewKeyEvent true }
                    Key.MediaRewind -> { c.seekBy(-SEEK_STEP_MS); seekFlash = System.nanoTime(); return@onPreviewKeyEvent true }
                    Key.MediaNext -> { c.playNext(); return@onPreviewKeyEvent true }
                }
                if (panel != null || controls || overlay || c.formatIssue != null || c.phase != PlayerPhase.PLAYING) return@onPreviewKeyEvent false
                when (e.key) {
                    Key.DirectionLeft -> { c.seekBy(-SEEK_STEP_MS); seekFlash = System.nanoTime(); true }
                    Key.DirectionRight -> { c.seekBy(SEEK_STEP_MS); seekFlash = System.nanoTime(); true }
                    Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> {
                        when {
                            nextCard -> c.playNext()
                            segment != null -> c.skipSegment(onExit)
                            else -> { c.togglePlay(); controls = true }
                        }
                        true
                    }
                    else -> { controls = true; true }
                }
            }
            .focusable(),
    ) {
        VideoSurface(c)

        when (c.phase) {
            PlayerPhase.LOADING -> Waiting(target, stringResource(c.loadingText))
            // Rien de lisible nativement mais des lecteurs embed : on propose le lecteur web.
            PlayerPhase.NEED_VIP, PlayerPhase.NO_SOURCE -> c.webSources.firstOrNull()?.let { web ->
                Waiting(target, stringResource(R.string.player_web_offer), action = stringResource(R.string.player_web_open), onAction = { c.openWeb(web) })
            } ?: if (c.phase == PlayerPhase.NEED_VIP) {
                Waiting(target, stringResource(R.string.player_need_vip), action = stringResource(R.string.no_key_action), onAction = onOpenSettings)
            } else {
                Waiting(target, stringResource(R.string.player_no_source), action = stringResource(R.string.player_back), onAction = onExit)
            }
            PlayerPhase.PLAYING -> Unit
        }

        if (c.phase == PlayerPhase.PLAYING && c.buffering) {
            Spinner(Modifier.align(Alignment.Center))
        }

        // Sous-titres, au style choisi : plus haut quand la barre est affichée,
        // ou toujours avec la position « Plus haut ».
        c.shownSubtitle?.let { text ->
            val raised = subStyle.position == "raised"
            val bottom = when {
                controls -> if (raised) 200.dp else 150.dp
                else -> if (raised) 140.dp else 44.dp
            }
            Box(Modifier.fillMaxWidth().align(Alignment.BottomCenter).padding(bottom = bottom, start = 80.dp, end = 80.dp), contentAlignment = Alignment.Center) {
                SubtitleText(text, subStyle)
            }
        }

        AnimatedVisibility(controls && !overlay && c.phase == PlayerPhase.PLAYING && c.formatIssue == null, enter = fadeIn(tween(160)), exit = fadeOut(tween(200))) {
            Controls(
                c, playRequester,
                onSettings = { panel = PanelPage.MAIN },
                onSubtitles = { panel = PanelPage.SUBTITLES },
                onAudio = { panel = PanelPage.AUDIO },
                onEpisodes = { episodesOpen = true },
                skipLabel = segment?.let { stringResource(skipLabel(it.kind)) },
                onSkip = { c.skipSegment(onExit) },
            )
        }

        // Contrôles cachés : barre seule pendant 1,5 s après un saut.
        if (!controls && c.phase == PlayerPhase.PLAYING) {
            var flash by remember { mutableStateOf(false) }
            LaunchedEffect(seekFlash) { if (seekFlash != 0L) { flash = true; delay(1_500); flash = false } }
            if (flash) {
                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(120.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.7f)))))
                Progress(c, Modifier.align(Alignment.BottomCenter).padding(start = 48.dp, end = 48.dp, bottom = 30.dp))
            }
            when {
                overlay -> Unit
                nextCard -> NextEpisodeCard(c, countdown.takeIf { autoplay }, Modifier.align(Alignment.BottomEnd).padding(end = 48.dp, bottom = SKIP_BOTTOM))
                segment != null -> OkHint(stringResource(skipLabel(segment.kind)), Modifier.align(Alignment.BottomEnd).padding(end = 48.dp, bottom = SKIP_BOTTOM))
            }
        }

        if (episodesOpen && c.phase == PlayerPhase.PLAYING) {
            EpisodesPanel(c, onClose = { episodesOpen = false })
        }

        if (c.stillWatching) {
            StillWatching(c, onContinue = c::continueWatching, onStop = onExit)
        }

        c.notice?.let {
            Text(
                stringResource(it), style = MovixType.Button,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 24.dp)
                    .background(MovixColors.Ink.copy(alpha = 0.85f), RoundedCornerShape(999.dp)).padding(horizontal = 14.dp, vertical = 7.dp),
            )
        }

        panel?.let { page ->
            PlayerPanel(c, page, onPage = { panel = it }, onClose = { panel = null })
        }

        // Sous le panneau des sources : « Changer de lecteur » l'ouvre par-dessus.
        val issue = c.formatIssue
        if (issue != null && panel == null) {
            FormatDialog(issue, onChange = { panel = PanelPage.SOURCE }, onClose = c::dismissFormatIssue)
        }
    }
}

/** Fenêtre « format non pris en charge » : changer de lecteur, ou fermer et rester. */
@Composable
private fun FormatDialog(issue: FormatIssue, onChange: () -> Unit, onClose: () -> Unit) {
    val requester = remember { FocusRequester() }
    var hasFocus by remember { mutableStateOf(false) }
    val message = when {
        issue.video != null && issue.audio != null -> stringResource(R.string.player_format_both, issue.video, issue.audio)
        issue.video != null -> stringResource(R.string.player_format_video, issue.video)
        else -> stringResource(R.string.player_format_audio, issue.audio ?: "?")
    }
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
        Column(
            Modifier.width(520.dp).background(MovixColors.Panel, RoundedCornerShape(14.dp)).padding(28.dp),
        ) {
            Text(stringResource(R.string.player_format_title), style = MovixType.Panel.copy(fontSize = 22.sp))
            Spacer(Modifier.height(12.dp))
            Text(message, style = MovixType.Body.copy(fontSize = 15.sp, lineHeight = 22.sp, color = MovixColors.Text))
            Spacer(Modifier.height(6.dp))
            Text(stringResource(R.string.player_format_hint), style = MovixType.Body)
            Spacer(Modifier.height(22.dp))
            Row(
                Modifier.onFocusChanged { hasFocus = it.hasFocus },
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                PillButton(stringResource(R.string.player_format_change), onChange, Modifier.focusRequester(requester))
                PillButton(stringResource(R.string.player_format_close), onClose)
            }
        }
    }
    // La fenêtre arrive pendant que le lecteur change d'état (pause,
    // contrôles) : on redemande le focus tant qu'il n'est pas pris.
    LaunchedEffect(Unit) {
        repeat(20) {
            delay(50)
            if (hasFocus) return@LaunchedEffect
            runCatching { requester.requestFocus() }
        }
    }
}

/** Surface vidéo : `SurfaceView` (jamais `TextureView`, plus lente), cadrée selon le format choisi. */
@Composable
private fun VideoSurface(c: PlayerController) {
    val aspect = c.videoAspect
    val format = c.format
    Layout(
        content = {
            AndroidView(
                factory = { ctx -> SurfaceView(ctx).apply { keepScreenOn = true; c.player.setVideoSurfaceView(this) } },
                onRelease = { c.player.clearVideoSurfaceView(it) },
            )
        },
        modifier = Modifier.fillMaxSize().clipToBounds(),
    ) { measurables, constraints ->
        val w0 = constraints.maxWidth
        val h0 = constraints.maxHeight
        val screen = w0.toFloat() / h0
        val (w, h) = when (format) {
            VideoFormat.STRETCH -> w0 to h0
            VideoFormat.FIT -> if (screen > aspect) (h0 * aspect).roundToInt() to h0 else w0 to (w0 / aspect).roundToInt()
            VideoFormat.FILL -> if (screen > aspect) w0 to (w0 / aspect).roundToInt() else (h0 * aspect).roundToInt() to h0
        }
        val p = measurables.first().measure(Constraints.fixed(w, h))
        layout(w0, h0) { p.place((w0 - w) / 2, (h0 - h) / 2) }
    }
}

@Composable
private fun Waiting(target: PlayTarget, message: String, action: String? = null, onAction: () -> Unit = {}) {
    val requester = remember { FocusRequester() }
    Box(Modifier.fillMaxSize()) {
        TmdbImage(TmdbImage.backdrop(target.backdropPath), 960.dp, 540.dp, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(MovixColors.Ink.copy(alpha = 0.78f)))
        Column(Modifier.align(Alignment.CenterStart).padding(start = 84.dp).width(460.dp)) {
            Text(target.title, style = MovixType.Title, maxLines = 2)
            Spacer(Modifier.height(14.dp))
            Text(message, style = MovixType.Body)
            if (action != null) {
                Spacer(Modifier.height(18.dp))
                PillButton(action, onAction, Modifier.focusRequester(requester))
                LaunchedEffect(Unit) { delay(32); runCatching { requester.requestFocus() } }
            } else {
                Spacer(Modifier.height(18.dp))
                Spinner()
            }
        }
    }
}

@Composable
private fun Spinner(modifier: Modifier = Modifier) {
    val transition = androidx.compose.animation.core.rememberInfiniteTransition(label = "spin")
    val angle by transition.animateFloat(
        0f, 360f,
        androidx.compose.animation.core.infiniteRepeatable(tween(900, easing = androidx.compose.animation.core.LinearEasing)),
        label = "angle",
    )
    Canvas(modifier.size(36.dp)) {
        drawArc(MovixColors.Track, 0f, 360f, false, style = androidx.compose.ui.graphics.drawscope.Stroke(3.dp.toPx()))
        drawArc(MovixColors.Text, angle, 90f, false, style = androidx.compose.ui.graphics.drawscope.Stroke(3.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
    }
}

@Composable
private fun Controls(
    c: PlayerController,
    playRequester: FocusRequester,
    onSettings: () -> Unit,
    onSubtitles: () -> Unit,
    onAudio: () -> Unit,
    onEpisodes: () -> Unit,
    skipLabel: String?,
    onSkip: () -> Unit,
) {
    val context = LocalContext.current
    var nextFocused by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxWidth().height(120.dp).background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.75f), Color.Transparent))))
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(190.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.88f)))))

        Column(Modifier.padding(start = 48.dp, top = 24.dp)) {
            val req = c.target.request
            if (req.isTv) {
                Text(c.target.title, style = MovixType.Kicker)
                Spacer(Modifier.height(4.dp))
                val s = req.season ?: 1
                val e = req.episode ?: 1
                Text(
                    c.episodeTitle?.let { context.getString(R.string.player_episode_title, s, e, it) } ?: context.getString(R.string.player_episode_short, s, e),
                    style = MovixType.Panel.copy(fontSize = 20.sp),
                )
            } else {
                Text(c.target.title, style = MovixType.Panel.copy(fontSize = 20.sp))
            }
        }

        // Bouton « Passer… » juste au-dessus de la barre, à droite (Haut depuis la barre).
        if (skipLabel != null) {
            PillButton(skipLabel, onSkip, Modifier.align(Alignment.BottomEnd).padding(end = 48.dp, bottom = SKIP_BOTTOM))
        }

        // Haut depuis les boutons : la barre prend le focus, Gauche/Droite déplacent la lecture.
        Progress(c, Modifier.align(Alignment.BottomCenter).padding(start = 48.dp, end = 48.dp, bottom = 66.dp), interactive = true)

        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(start = 48.dp, end = 48.dp, bottom = 16.dp).height(48.dp)) {
            Row(Modifier.align(Alignment.CenterStart), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                c.current?.language?.label?.let { Chip(it) }
                c.qualityText?.let { Chip(it) }
            }
            Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                CircleButton(MovixIcons.Back, { c.seekBy(-SEEK_STEP_MS) }, badge = "10")
                CircleButton(if (c.isPlaying) MovixIcons.Pause else MovixIcons.Play, c::togglePlay, Modifier.focusRequester(playRequester), size = 48)
                CircleButton(MovixIcons.Forward, { c.seekBy(SEEK_STEP_MS) }, badge = "10")
            }
            Row(Modifier.align(Alignment.CenterEnd), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                if (c.next != null) {
                    PillButton(
                        stringResource(R.string.player_next_episode), c::playNext,
                        Modifier.onFocusChanged { nextFocused = it.hasFocus }, icon = MovixIcons.Next,
                    )
                }
                if (c.target.request.isTv) CircleButton(PlayerIcons.Episodes, onEpisodes)
                CircleButton(MovixIcons.Subtitles, onSubtitles)
                CircleButton(MovixIcons.Audio, onAudio)
                CircleButton(MovixIcons.Gear, onSettings)
            }
        }

        // Bouton « Épisode suivant » sélectionné : aperçu de l'épisode au-dessus, comme Netflix.
        if (nextFocused && c.next != null) {
            NextEpisodeInfo(
                c,
                Modifier.align(Alignment.BottomEnd)
                    .padding(end = 48.dp, bottom = SKIP_BOTTOM + if (skipLabel != null) 48.dp else 0.dp)
                    .width(NEXT_CARD_WIDTH)
                    .background(MovixColors.Ink.copy(alpha = 0.88f), RoundedCornerShape(12.dp))
                    .padding(10.dp),
            )
        }
    }
}

/** Hauteur du bouton « Passer… » et de la carte « Épisode suivant » : juste au-dessus de la barre. */
private val SKIP_BOTTOM = 124.dp

/**
 * Barre de progression. [interactive] : elle prend le focus (Haut depuis
 * les boutons) et Gauche/Droite déplacent la lecture de 10 s, puis de 30 s
 * quand la touche reste enfoncée. Les passages connus (intro, récap,
 * générique…) y sont tracés aux couleurs du site.
 */
@Composable
private fun Progress(c: PlayerController, modifier: Modifier = Modifier, interactive: Boolean = false) {
    val dur = c.durationMs
    val played = if (dur > 0) (c.positionMs.toFloat() / dur).coerceIn(0f, 1f) else 0f
    val buffered = if (dur > 0) (c.bufferedMs.toFloat() / dur).coerceIn(0f, 1f) else 0f
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val keys = if (!interactive) Modifier else Modifier
        .onKeyEvent { e ->
            if (e.type != KeyEventType.KeyDown) return@onKeyEvent false
            val step = if (e.nativeKeyEvent.repeatCount >= 4) 30_000L else SEEK_STEP_MS
            when (e.key) {
                Key.DirectionLeft -> { c.seekBy(-step); true }
                Key.DirectionRight -> { c.seekBy(step); true }
                Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> { c.togglePlay(); true }
                else -> false
            }
        }
        .focusable(interactionSource = source)
    Column(modifier.fillMaxWidth().then(keys)) {
        Canvas(Modifier.fillMaxWidth().height(17.dp)) {
            val y = size.height / 2
            val th = (if (focused) 7 else 4).dp.toPx()
            val r = CornerRadius(th / 2)
            drawRoundRect(MovixColors.Track, Offset(0f, y - th / 2), Size(size.width, th), r)
            drawRoundRect(Color.White.copy(alpha = 0.35f), Offset(0f, y - th / 2), Size(size.width * buffered, th), r)
            drawRoundRect(MovixColors.Red, Offset(0f, y - th / 2), Size(size.width * played, th), r)
            // Passages par-dessus : leurs teintes restent lisibles sur le rouge comme sur le gris.
            if (dur > 0) for (s in c.segments) {
                val x0 = size.width * (s.range.first.toFloat() / dur).coerceIn(0f, 1f)
                val x1 = size.width * ((s.range.last + 1).toFloat() / dur).coerceIn(0f, 1f)
                if (x1 > x0) drawRoundRect(Color(s.kind.color).copy(alpha = 0.9f), Offset(x0, y - th / 2), Size(x1 - x0, th), r)
            }
            val thumb = Offset(size.width * played, y)
            if (focused) drawCircle(MovixColors.Text.copy(alpha = 0.3f), 13.dp.toPx(), thumb)
            drawCircle(MovixColors.Text, (if (focused) 8.5 else 6.5).dp.toPx(), thumb)
        }
        Spacer(Modifier.height(4.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            val timeStyle = MovixType.Meta.copy(fontSize = 12.sp, fontFeatureSettings = "tnum")
            Text(formatTime(c.positionMs), style = timeStyle)
            Text(if (dur > 0) "−" + formatTime(dur - c.positionMs) else "", style = timeStyle)
        }
    }
}

@Composable
private fun Chip(text: String) {
    Text(
        text, style = MovixType.Badge,
        modifier = Modifier.background(Color.White.copy(alpha = 0.14f), RoundedCornerShape(5.dp)).padding(horizontal = 7.dp, vertical = 3.dp),
    )
}

@Composable
private fun CircleButton(icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier, size: Int = 40, badge: String? = null) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val fg = if (focused) MovixColors.Ink else MovixColors.Text
    Box(
        modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(if (focused) MovixColors.Text else Color.Transparent)
            .clickable(interactionSource = source, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Image(rememberVectorPainter(icon), null, Modifier.size(20.dp), colorFilter = ColorFilter.tint(fg))
        if (badge != null) {
            Text(badge, style = MovixType.Badge.copy(fontSize = 7.sp, fontWeight = FontWeight.Bold, color = fg), modifier = Modifier.padding(top = 1.dp))
        }
    }
}

@Composable
private fun OkHint(text: String, modifier: Modifier) {
    Row(
        modifier.background(MovixColors.Ink.copy(alpha = 0.85f), RoundedCornerShape(999.dp)).padding(start = 6.dp, end = 14.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("OK", style = MovixType.Badge.copy(color = MovixColors.Ink), modifier = Modifier.background(MovixColors.Text, RoundedCornerShape(999.dp)).padding(horizontal = 7.dp, vertical = 2.dp))
        Text(text, style = MovixType.Button)
    }
}

private fun skipLabel(kind: SegmentKind): Int = when (kind) {
    SegmentKind.INTRO -> R.string.player_skip_intro
    SegmentKind.RECAP -> R.string.player_skip_recap
    SegmentKind.OUTRO, SegmentKind.CREDITS -> R.string.player_skip_credits
    SegmentKind.PREVIEW -> R.string.player_skip_preview
}

/** Seconde avant de lancer l'épisode suivant depuis le générique. */
private const val NEXT_COUNTDOWN_S = 10

/** Largeur de la carte « Épisode suivant » et de l'aperçu du bouton. */
private val NEXT_CARD_WIDTH = 360.dp

/** Image, « Épisode suivant · S1 É2 » et titre de l'épisode suivant. */
@Composable
private fun NextEpisodeInfo(c: PlayerController, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val (s, e) = c.next ?: return
    val ep = c.nextEpisode
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        TmdbImage(
            TmdbImage.still(ep?.stillPath) ?: TmdbImage.landscape(c.target.backdropPath), 128.dp, 72.dp,
            Modifier.size(128.dp, 72.dp).clip(RoundedCornerShape(6.dp)),
        )
        Column(Modifier.weight(1f)) {
            Text(context.getString(R.string.player_next_kicker, s, e), style = MovixType.Kicker, maxLines = 1)
            Spacer(Modifier.height(3.dp))
            Text(
                ep?.title?.takeIf { it.isNotBlank() } ?: context.getString(R.string.player_episode_short, s, e),
                style = MovixType.Panel.copy(fontSize = 15.sp, lineHeight = 19.sp),
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * Carte de fin d'épisode : l'épisode suivant (image, S/É, titre), compte à
 * rebours qui se remplit ([seconds], `null` quand l'enchaînement est coupé :
 * bouton plein, OK lance), et rappel des touches.
 */
@Composable
private fun NextEpisodeCard(c: PlayerController, seconds: Int?, modifier: Modifier) {
    val context = LocalContext.current
    if (c.next == null) return
    val fill by androidx.compose.animation.core.animateFloatAsState(
        targetValue = if (seconds == null) 1f else 1f - seconds / NEXT_COUNTDOWN_S.toFloat(),
        animationSpec = tween(1_000, easing = androidx.compose.animation.core.LinearEasing),
        label = "countdown",
    )
    Column(
        modifier.width(NEXT_CARD_WIDTH).background(MovixColors.Ink.copy(alpha = 0.88f), RoundedCornerShape(12.dp)).padding(10.dp),
    ) {
        NextEpisodeInfo(c)
        Spacer(Modifier.height(10.dp))
        Box(
            Modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(8.dp)).background(Color.White.copy(alpha = 0.25f)),
        ) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(fill).background(MovixColors.Text))
            Row(Modifier.align(Alignment.Center), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Image(rememberVectorPainter(MovixIcons.Next), null, Modifier.size(18.dp), colorFilter = ColorFilter.tint(MovixColors.Ink))
                Text(
                    if (seconds != null) context.getString(R.string.player_next_in, seconds) else context.getString(R.string.player_next_episode),
                    style = MovixType.Button.copy(color = MovixColors.Ink),
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(context.getString(R.string.player_next_keys), style = MovixType.Meta.copy(fontSize = 12.sp), modifier = Modifier.align(Alignment.End))
    }
}

/**
 * « Vous regardez toujours ? » après plusieurs épisodes enchaînés sans
 * touche : la lecture est en pause ; Continuer lance l'épisode suivant,
 * Arrêter quitte le lecteur.
 */
@Composable
private fun StillWatching(c: PlayerController, onContinue: () -> Unit, onStop: () -> Unit) {
    val requester = remember { FocusRequester() }
    var hasFocus by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(MovixColors.Ink.copy(alpha = 0.86f))) {
        Column(Modifier.align(Alignment.CenterStart).padding(start = 84.dp).width(520.dp)) {
            Text(stringResource(R.string.player_still_title), style = MovixType.Title)
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.player_still_body), style = MovixType.Body)
            if (c.next != null) {
                Spacer(Modifier.height(20.dp))
                NextEpisodeInfo(c, Modifier.width(NEXT_CARD_WIDTH))
            }
            Spacer(Modifier.height(24.dp))
            Row(Modifier.onFocusChanged { hasFocus = it.hasFocus }, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(stringResource(R.string.player_still_continue), onContinue, Modifier.focusRequester(requester), icon = MovixIcons.Play)
                PillButton(stringResource(R.string.player_still_stop), onStop)
            }
        }
    }
    // Arrive pendant que le lecteur change d'état : focus redemandé tant qu'il n'est pas pris.
    LaunchedEffect(Unit) {
        repeat(20) {
            delay(50)
            if (hasFocus) return@LaunchedEffect
            runCatching { requester.requestFocus() }
        }
    }
}

/**
 * Réplique au style choisi (Réglages ou panneau du lecteur) : taille,
 * couleur, fond plus ou moins opaque (0 = sans fond), contour noir épais
 * dessiné sous le texte, sinon une ombre portée.
 */
@Composable
private fun SubtitleText(text: String, style: SubtitleStyle) {
    val scale = style.size.coerceIn(50, 300) / 100f
    val color = Color(SubtitleStyle.COLORS[style.color] ?: 0xFFFFFFFF)
    val base = MovixType.Button.copy(fontFamily = subtitleFontFamily(style.font), fontSize = 21.sp * scale, lineHeight = 28.sp * scale)
    val bgAlpha = style.background.coerceIn(0, 100) / 100f
    val outlinePx = with(LocalDensity.current) { (3.5f * scale).dp.toPx() }
    Box(
        (if (bgAlpha > 0f) Modifier.background(Color.Black.copy(alpha = bgAlpha), RoundedCornerShape(4.dp)) else Modifier)
            .padding(horizontal = 10.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (style.outline) {
            Text(text, textAlign = TextAlign.Center, style = base.copy(color = Color.Black, drawStyle = Stroke(width = outlinePx, join = StrokeJoin.Round)))
        }
        Text(
            text, textAlign = TextAlign.Center,
            style = base.copy(color = color, shadow = if (style.outline) null else Shadow(Color.Black, Offset(0f, 2f), 6f)),
        )
    }
}

/** 83 000 → « 1:23 » ; 3 723 000 → « 1:02:03 ». */
internal fun formatTime(ms: Long): String {
    val total = (ms.coerceAtLeast(0) / 1000).toInt()
    val h = total / 3600
    val m = total % 3600 / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
