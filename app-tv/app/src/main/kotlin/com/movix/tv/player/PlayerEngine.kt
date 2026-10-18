package com.movix.tv.player

import android.content.Context
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cronet.CronetDataSource
import androidx.media3.datasource.cronet.CronetUtil
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import com.movix.tv.data.movix.StreamKind
import okhttp3.OkHttpClient
import org.chromium.net.CronetEngine
import java.util.concurrent.Executors

/**
 * Fabrique du lecteur, partagée par toute l'appli.
 *
 * Chaîne réseau d'une requête du lecteur (manifeste, segments, clés) :
 * Cronet (empreinte TLS de Chrome ; OkHttp si les services Google manquent,
 * cas des Fire TV) → en-têtes par hôte ([MediaHeaders]) → déballage des
 * segments PNG+MPEG-TS ([PngTsDataSource]).
 */
class PlayerEngine(private val context: Context, private val http: OkHttpClient, private val lowRam: Boolean) {
    private val cronetExecutor by lazy { Executors.newFixedThreadPool(4) }

    /**
     * Moteur Cronet, construit une fois (chargement du fournisseur des services
     * Google : 50 à 200 ms). Appelé hors du fil principal, pendant la
     * recherche des sources.
     */
    val cronet: CronetEngine? by lazy {
        if (cronetDisabledForTest()) return@lazy null.also { Log.i("MovixPlayer", "Cronet coupé (debug.movix.nocronet), repli OkHttp") }
        runCatching { CronetUtil.buildCronetEngine(context, MediaHeaders.SIGNED_USER_AGENT, false) }
            .getOrNull()
            .also { Log.i("MovixPlayer", if (it != null) "Cronet ${it.versionString}" else "Cronet absent, repli OkHttp") }
    }

    /**
     * Essai d'un appareil sans Cronet (Fire TV sans services Google) sur un
     * émulateur qui en a : `adb shell setprop debug.movix.nocronet 1`.
     * Ignoré en release.
     */
    private fun cronetDisabledForTest(): Boolean = com.movix.tv.BuildConfig.BUILD_TYPE != "release" && runCatching {
        Class.forName("android.os.SystemProperties").getMethod("get", String::class.java).invoke(null, "debug.movix.nocronet") == "1"
    }.getOrDefault(false)

    private fun upstream(): DataSource.Factory =
        cronet?.let {
            CronetDataSource.Factory(it, cronetExecutor)
                .setConnectionTimeoutMs(8_000)
                .setReadTimeoutMs(20_000)
                .setHandleSetCookieRequests(true)
        } ?: OkHttpDataSource.Factory(http)

    /** Usine de `DataSource` pour une source : [baseHeaders] + règles par hôte sur chaque requête. */
    fun dataSourceFactory(baseHeaders: Map<String, String> = emptyMap()): DataSource.Factory {
        val resolving = ResolvingDataSource.Factory(upstream()) { spec ->
            val headers = MediaHeaders.apply(spec.uri.toString(), baseHeaders + spec.httpRequestHeaders)
            if (headers == spec.httpRequestHeaders) spec else spec.withRequestHeaders(headers)
        }
        return PngTsDataSource.Factory(resolving)
    }

    fun newPlayer(): ExoPlayer {
        // Buffer plafonné en octets : sur 1 Go de RAM, un flux 1080p remplit
        // 50 s de tampon (≈ 60 Mo) et le système tue l'appli.
        val loadControl = DefaultLoadControl.Builder()
            .setTargetBufferBytes(if (lowRam) 16 * 1024 * 1024 else 48 * 1024 * 1024)
            .setPrioritizeTimeOverSizeThresholds(false)
            .setBufferDurationsMs(15_000, if (lowRam) 30_000 else 50_000, 1_500, 3_000)
            .build()
        val trackSelector = DefaultTrackSelector(context).apply {
            parameters = buildUponParameters()
                // Jamais plus que l'écran : décoder du 4K pour un écran 1080p
                // sature les petits SoC.
                .setViewportSizeToPhysicalDisplaySize(true)
                .setPreferredAudioLanguages("fr", "fre", "fra")
                .build()
        }
        val renderers = DefaultRenderersFactory(context).setEnableDecoderFallback(true)
        return ExoPlayer.Builder(context, renderers)
            .setLoadControl(loadControl)
            .setTrackSelector(trackSelector)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .build()
    }

    /**
     * Bande-annonce YouTube : image et son en deux fichiers lus ensemble, ou un
     * seul fichier. OkHttp direct : ni en-têtes Movix ni déballage PNG.
     */
    fun trailerSource(videoUrl: String, audioUrl: String?, hls: Boolean, userAgent: String): MediaSource {
        val upstream = OkHttpDataSource.Factory(http).setUserAgent(userAgent)
        if (hls) {
            return androidx.media3.exoplayer.hls.HlsMediaSource.Factory(upstream)
                .createMediaSource(MediaItem.Builder().setUri(videoUrl).setMimeType(MimeTypes.APPLICATION_M3U8).build())
        }
        // Par morceaux : le CDN de YouTube refuse les requêtes « jusqu'à la fin » (403).
        val factory = androidx.media3.exoplayer.source.ProgressiveMediaSource.Factory(ChunkedDataSource.Factory(upstream))
        val video = factory.createMediaSource(MediaItem.fromUri(videoUrl))
        return if (audioUrl == null) video
        else androidx.media3.exoplayer.source.MergingMediaSource(video, factory.createMediaSource(MediaItem.fromUri(audioUrl)))
    }

    /** Source Media3 : type imposé (les URL du relais n'ont pas d'extension). */
    fun mediaSource(url: String, kind: StreamKind, headers: Map<String, String> = emptyMap()): MediaSource {
        val item = MediaItem.Builder()
            .setUri(url)
            .setMimeType(if (kind == StreamKind.HLS) MimeTypes.APPLICATION_M3U8 else null)
            .build()
        return DefaultMediaSourceFactory(dataSourceFactory(headers)).createMediaSource(item)
    }
}
