package com.movix.tv.ui.home

import android.view.TextureView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.movix.tv.AppContainer
import com.movix.tv.container
import com.movix.tv.ui.theme.LocalLowRam
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Carte arrêtée depuis ce délai : la bande-annonce se lance dans le bandeau. */
internal const val BANNER_TRAILER_DELAY_MS = 2_000L
/** Fondu image ↔ vidéo. */
internal const val BANNER_FADE_MS = 600

private const val FIRST_FRAME_TIMEOUT_MS = 15_000L
private const val MAX_PLAY_MS = 30_000L
/** Au-delà de cette durée, la vidéo démarre à [SKIP_INTRO_MS] (logos des studios). */
private const val SKIP_INTRO_ABOVE_MS = 40_000L
private const val SKIP_INTRO_MS = 10_000L

internal val HeroInfo.trailerKey: String get() = "${type.path}:$id"

/**
 * Bande-annonce muette du bandeau. Un seul lecteur pour tout l'écran, créé au
 * premier besoin et relâché quand l'écran s'en va ([release]).
 *
 * Jamais de son : piste audio désactivée, volume 0, sans prise du focus audio.
 * Tout échec est silencieux : l'image de fond reste.
 */
@Stable
internal class BannerTrailer(
    private val container: AppContainer,
    private val scope: CoroutineScope,
    private val lowRam: Boolean,
) {
    private var player: ExoPlayer? = null
    private var surface: TextureView? = null
    private var stopJob: Job? = null

    /** Le `SurfaceView` doit être composé (lecture en cours ou en train de s'arrêter). */
    var surfaceNeeded by mutableStateOf(false)
        private set

    /** Titre ([HeroInfo.trailerKey]) dont la vidéo est visible : son image s'efface. */
    var shownFor by mutableStateOf<String?>(null)
        private set

    private var firstFrame: CompletableDeferred<Unit>? = null
    private var ended: CompletableDeferred<Unit>? = null
    // La lecture ne démarre qu'une fois la durée connue (saut de l'intro).
    private var started = false
    private var frameRendered = false

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            val p = player ?: return
            when (state) {
                Player.STATE_READY -> if (!started) {
                    started = true
                    val duration = p.duration
                    if (duration != C.TIME_UNSET && duration > SKIP_INTRO_ABOVE_MS && p.currentPosition < SKIP_INTRO_MS) {
                        frameRendered = false
                        p.seekTo(SKIP_INTRO_MS)
                    } else if (frameRendered) {
                        firstFrame?.complete(Unit)
                    }
                    p.playWhenReady = true
                }
                Player.STATE_ENDED -> ended?.complete(Unit)
                else -> Unit
            }
        }

        override fun onRenderedFirstFrame() {
            frameRendered = true
            if (started) firstFrame?.complete(Unit)
        }

        override fun onPlayerError(error: PlaybackException) {
            firstFrame?.completeExceptionally(error)
            ended?.complete(Unit)
        }
    }

    private fun player(): ExoPlayer = player ?: container.playerEngine.newPlayer().also { p ->
        p.volume = 0f
        // Sans prise du focus audio : la musique d'une autre appli continue.
        p.setAudioAttributes(AudioAttributes.DEFAULT, false)
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            // H.264 d'abord : le VP9 est mal décodé par certaines box.
            .setPreferredVideoMimeType(MimeTypes.VIDEO_H264)
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)
            .build()
        p.addListener(listener)
        surface?.let { p.setVideoTextureView(it) }
        player = p
    }

    /**
     * Joue la bande-annonce de [item] jusqu'à 30 s, puis revient à l'image.
     * S'arrête aussi quand la coroutine est annulée (focus déplacé, écran quitté).
     */
    suspend fun play(item: HeroInfo) {
        try {
            val key = runCatching { container.catalog.details(item.type, item.id).trailerKey }.getOrNull() ?: return
            // Image seule (sans le fichier audio) : moins de données, et aucun son possible.
            val streams = container.youtube.streams(key, maxHeight = if (lowRam) 480 else 720) ?: return
            stopJob?.cancel()
            stopJob = null
            val p = player()
            p.stop()
            val frame = CompletableDeferred<Unit>().also { firstFrame = it }
            val end = CompletableDeferred<Unit>().also { ended = it }
            started = false
            frameRendered = false
            surfaceNeeded = true
            p.setMediaSource(container.playerEngine.trailerSource(streams.videoUrl, null, streams.hls, streams.userAgent))
            p.playWhenReady = false
            p.prepare()
            withTimeoutOrNull(FIRST_FRAME_TIMEOUT_MS) { frame.await() } ?: return
            shownFor = item.trailerKey
            withTimeoutOrNull(MAX_PLAY_MS) { end.await() }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Échec silencieux : l'image reste.
        } finally {
            stop()
        }
    }

    /** Retour à l'image en fondu, puis arrêt du lecteur (gardé pour la suivante). */
    fun stop() {
        if (!surfaceNeeded && player?.isPlaying != true) return
        val wasShown = shownFor != null
        shownFor = null
        firstFrame = null
        ended = null
        stopJob?.cancel()
        stopJob = scope.launch {
            if (wasShown) delay(BANNER_FADE_MS.toLong())
            player?.stop()
            player?.clearMediaItems()
            surfaceNeeded = false
        }
    }

    fun release() {
        stopJob?.cancel()
        shownFor = null
        surfaceNeeded = false
        player?.removeListener(listener)
        player?.release()
        player = null
    }

    internal fun attach(view: TextureView) {
        surface = view
        player?.setVideoTextureView(view)
    }

    internal fun detach(view: TextureView) {
        if (surface === view) surface = null
        player?.clearVideoTextureView(view)
    }
}

/** Le lecteur du bandeau, relâché quand l'écran quitte la composition. */
@Composable
internal fun rememberBannerTrailer(): BannerTrailer {
    val container = LocalContext.current.container
    val lowRam = LocalLowRam.current
    val scope = rememberCoroutineScope()
    val trailer = remember { BannerTrailer(container, scope, lowRam) }
    DisposableEffect(trailer) { onDispose { trailer.release() } }
    return trailer
}

/**
 * Surface de la vidéo. `TextureView` et non `SurfaceView` : celle-ci est
 * dessinée sous la fenêtre, et le fond opaque de la page la cachait. Ici la
 * vidéo prend sa place parmi les calques : l'image, les dégradés et le texte
 * composés après elle restent par-dessus.
 */
@Composable
internal fun BannerTrailerSurface(trailer: BannerTrailer, modifier: Modifier = Modifier) {
    AndroidView(
        factory = { ctx -> TextureView(ctx).also { trailer.attach(it) } },
        onRelease = { trailer.detach(it) },
        modifier = modifier,
    )
}
