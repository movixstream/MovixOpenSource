package com.movix.tv.player

import android.content.Context
import android.media.MediaCodecList
import androidx.media3.common.AudioAttributes
import androidx.media3.common.MimeTypes
import androidx.media3.exoplayer.audio.AudioCapabilities
import java.util.concurrent.ConcurrentHashMap

/**
 * Ce que l'appareil sait lire : un décodeur pour le type MIME, ou, pour le
 * son Dolby/DTS, le passage direct vers la barre de son ou l'ampli (HDMI).
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
            m.startsWith("audio/") -> passthrough(m)
            else -> false
        }
    }

    private fun passthrough(mime: String): Boolean = runCatching {
        val encoding = MimeTypes.getEncoding(mime, null)
        encoding != androidx.media3.common.C.ENCODING_INVALID &&
            AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null).supportsEncoding(encoding)
    }.getOrDefault(false)
}
