package com.movix.tv.ui.details

import android.view.SurfaceView
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.tmdb.VideoClip
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.delay

/**
 * Bande-annonce plein écran, dans l'appli : flux YouTube direct
 * ([com.movix.tv.data.youtube.YouTubeClient]) lu par Media3. OK : pause,
 * Gauche/Droite : 10 s, Retour : retour à la fiche. Le titre s'efface après 3 s.
 */
@Composable
fun TrailerOverlay(clip: VideoClip, onClose: () -> Unit) {
    val container = LocalContext.current.container
    val player = remember { container.playerEngine.newPlayer() }
    var state by remember { mutableStateOf(TrailerState.LOADING) }
    var showTitle by remember { mutableStateOf(true) }
    val focus = remember { FocusRequester() }

    BackHandler(onBack = onClose)
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(s: Int) {
                if (s == Player.STATE_READY) state = TrailerState.PLAYING
                if (s == Player.STATE_ENDED) onClose()
            }
            override fun onPlayerError(error: PlaybackException) { state = TrailerState.FAILED }
            // L'image arrive avant la fin du premier tampon (READY) : sans ça,
            // « Chargement de la vidéo… » restait écrit par-dessus la vidéo.
            override fun onRenderedFirstFrame() { if (state == TrailerState.LOADING) state = TrailerState.PLAYING }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener); player.release() }
    }
    LaunchedEffect(clip.key) {
        val streams = container.youtube.streams(clip.key)
        if (streams == null) { state = TrailerState.FAILED; return@LaunchedEffect }
        // H.264 d'abord : le manifeste propose aussi du VP9, mal décodé par certaines box.
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setPreferredVideoMimeType(androidx.media3.common.MimeTypes.VIDEO_H264).build()
        player.setMediaSource(container.playerEngine.trailerSource(streams.videoUrl, streams.audioUrl, streams.hls, streams.userAgent))
        player.prepare()
        player.playWhenReady = true
    }
    LaunchedEffect(Unit) { delay(32); runCatching { focus.requestFocus() } }
    LaunchedEffect(state, showTitle) { if (state == TrailerState.PLAYING && showTitle) { delay(3_000); showTitle = false } }

    Box(
        Modifier.fillMaxSize().background(Color.Black)
            .focusRequester(focus)
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (e.key) {
                    Key.DirectionCenter, Key.Enter, Key.NumPadEnter, Key.MediaPlayPause -> { player.playWhenReady = !player.playWhenReady; showTitle = true; true }
                    Key.DirectionLeft, Key.MediaRewind -> { player.seekTo((player.currentPosition - 10_000).coerceAtLeast(0)); showTitle = true; true }
                    Key.DirectionRight, Key.MediaFastForward -> { player.seekTo(player.currentPosition + 10_000); showTitle = true; true }
                    else -> false
                }
            }
            .focusable(),
    ) {
        AndroidView(
            factory = { ctx -> SurfaceView(ctx).apply { keepScreenOn = true; player.setVideoSurfaceView(this) } },
            onRelease = { player.clearVideoSurfaceView(it) },
            modifier = Modifier.fillMaxSize(),
        )
        when (state) {
            TrailerState.LOADING -> Text(stringResource(R.string.trailer_loading), style = MovixType.Body, modifier = Modifier.align(Alignment.Center))
            TrailerState.FAILED -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(R.string.trailer_failed), style = MovixType.Body)
                Spacer(Modifier.height(6.dp))
                Text(stringResource(R.string.trailer_back), style = MovixType.Meta)
            }
            TrailerState.PLAYING -> if (showTitle) {
                Text(
                    clip.name, style = MovixType.Button,
                    modifier = Modifier.align(Alignment.TopStart).padding(start = 48.dp, top = 32.dp)
                        .background(MovixColors.Ink.copy(alpha = 0.7f), RoundedCornerShape(8.dp)).padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }
    }
}

private enum class TrailerState { LOADING, PLAYING, FAILED }
