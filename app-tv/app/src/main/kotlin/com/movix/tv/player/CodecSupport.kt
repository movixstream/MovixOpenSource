package com.movix.tv.player

import android.content.Context
import android.media.MediaCodecList
import androidx.media3.common.AudioAttributes
import androidx.media3.common.MimeTypes
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.media3.exoplayer.audio.AudioCapabilities
import java.util.concurrent.ConcurrentHashMap

/**
 * Ce que l'appareil sait lire : un décodeur pour le type MIME, ou, pour le
 * son Dolby/DTS, le passage direct vers la barre de son ou l'ampli (HDMI), à
 * défaut le décodage par FFmpeg dans l'appli.
 * Dolby Vision se rabat sur sa couche HEVC quand il n'a pas de décodeur.
 */
class CodecSupport(private val context: Context) {
    private val decoders: Set<String> by lazy {
        MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
            .filter { !it.isEncoder }
            .flatMap { it.supportedTypes.map(String::lowercase) }
            .toSet()
    }
    private val cache = ConcurrentHashMap<String, Boolean>()

    fun supports(mime: String): Boolean = cache.getOrPut(mime.lowercase()) {
        val m = mime.lowercase()
        when {
            m in decoders -> true
            m == "video/dolby-vision" -> "video/hevc" in decoders
            m.startsWith("audio/") -> passthrough(m) || ffmpeg(m)
            else -> false
        }
    }

    /**
     * Un décodeur H.265, H.264 ou AV1 accepte-t-il une image 3840×2160 ? Faux
     * sur les box 1080p (Fire TV Stick Lite, Bbox) : on leur donne alors la
     * copie 1080p de Vodix plutôt que la 4K.
     */
    val decodes2160p: Boolean by lazy {
        runCatching {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }.any { info ->
                info.supportedTypes.any { type ->
                    type.lowercase() in setOf("video/hevc", "video/avc", "video/av01") &&
                        runCatching { info.getCapabilitiesForType(type).videoCapabilities?.isSizeSupported(3840, 2160) == true }.getOrDefault(false)
                }
            }
        }.getOrDefault(true)
    }

    private fun passthrough(mime: String): Boolean = runCatching {
        val encoding = MimeTypes.getEncoding(mime, null)
        encoding != androidx.media3.common.C.ENCODING_INVALID &&
            AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null).supportsEncoding(encoding)
    }.getOrDefault(false)

    private fun ffmpeg(mime: String): Boolean = runCatching { FfmpegLibrary.supportsFormat(mime) }.getOrDefault(false)
}
