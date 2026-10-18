package com.movix.tv.player

/**
 * Codecs d'un flux, sans dépendre d'Android (testable) : chaîne RFC 6381
 * d'une playlist HLS (`hvc1.1.6.L120.90`, `mp4a.40.2`, `ec-3`) ou code à
 * quatre lettres d'un MP4 (`hev1`, `ac-3`, `Opus`) → type MIME, et nom lisible.
 */
object Codecs {
    /** Type MIME, ou `null` pour un codec inconnu (alors supposé lisible). */
    fun mimeOf(codec: String): String? {
        val c = codec.trim().lowercase()
        return when {
            c.startsWith("avc1") || c.startsWith("avc3") -> "video/avc"
            c.startsWith("hvc1") || c.startsWith("hev1") -> "video/hevc"
            c.startsWith("dvh1") || c.startsWith("dvhe") || c.startsWith("dva1") || c.startsWith("dvav") -> "video/dolby-vision"
            c.startsWith("av01") -> "video/av01"
            c.startsWith("vp09") || c == "vp9" -> "video/x-vnd.on2.vp9"
            c.startsWith("mp4v") -> "video/mp4v-es"
            c.startsWith("mp4a") -> "audio/mp4a-latm"
            c == "ac-3" -> "audio/ac3"
            c == "ec-3" -> "audio/eac3"
            c == "ec+3" -> "audio/eac3-joc"
            c == "ac-4" -> "audio/ac4"
            c == "opus" -> "audio/opus"
            c == "flac" -> "audio/flac"
            c == "dtsc" -> "audio/vnd.dts"
            c == "dtsh" || c == "dtsl" || c == "dtse" -> "audio/vnd.dts.hd"
            c == "mlpa" -> "audio/true-hd"
            else -> null
        }
    }

    fun isVideo(mime: String) = mime.startsWith("video/")

    /** Nom affiché dans la fenêtre « format non pris en charge ». */
    fun displayName(mime: String?, codecs: String? = null): String = when (mime?.lowercase()) {
        "video/hevc" -> "H.265 (HEVC)"
        "video/dolby-vision" -> "Dolby Vision"
        "video/av01" -> "AV1"
        "video/x-vnd.on2.vp9" -> "VP9"
        "video/avc" -> "H.264"
        "video/mp4v-es" -> "MPEG-4"
        "audio/ac3" -> "Dolby Digital (AC-3)"
        "audio/eac3" -> "Dolby Digital Plus (E-AC-3)"
        "audio/eac3-joc" -> "Dolby Atmos (E-AC-3 JOC)"
        "audio/ac4" -> "Dolby AC-4"
        "audio/true-hd" -> "Dolby TrueHD"
        "audio/vnd.dts" -> "DTS"
        "audio/vnd.dts.hd" -> "DTS-HD"
        "audio/opus" -> "Opus"
        "audio/flac" -> "FLAC"
        "audio/mp4a-latm" -> "AAC"
        else -> codecs?.takeIf { it.isNotBlank() } ?: mime?.substringAfter('/')?.uppercase() ?: "?"
    }
}
