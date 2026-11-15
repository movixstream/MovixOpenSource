package com.movix.tv.data.movix

import androidx.compose.runtime.Immutable

/**
 * Route de la Main API d'où vient une source, avec le nom de son groupe sur
 * le site (`src/i18n/locales/fr.json`, lecteur HLSPlayer). L'ordre de l'énum
 * ne compte pas.
 */
enum class Provider(val label: String) {
    LINKS("Movix"),
    /** `api/tmdb` : « Lecteurs Multi » sur le site, jamais le nom de la source. */
    COFLIX("Multi"),
    OMEGA("Omega"),
    PURSTREAM("Bravo"),
    FSTREAM("FStream"),
    WIFLIX("Lynx"),
    J1F("1J1F"),
    SWIFTFLOW("SwiftFlow"),
    /** Fichiers MP4 directs de SwiftFlow, réservés aux télés reliées (phase 5). */
    SWIFTFLUX("SwiftFlux"),
    VIPER("Viper"),
    KISSKH("KissKH"),
    VOX("Vox"),
}

enum class Lang(val label: String?) { VF("VF"), VOSTFR("VOSTFR"), VO("VO"), UNKNOWN(null) }

enum class StreamKind { HLS, FILE }

@Immutable
data class SubtitleTrack(
    val url: String,
    val label: String,
    val lang: String,
    val format: String,
    val isDefault: Boolean = false,
    /** « Shegu », « OpenSubtitles » pour les sous-titres cherchés à part ; `null` s'ils viennent de la source. */
    val source: String? = null,
    val downloads: Int? = null,
)

/**
 * Une source de lecture. [streamUrl] est un flux que le lecteur natif sait
 * lire tout de suite (URL signée du relais Movix pour un VIP, ou fichier
 * direct) ; sinon seule [embedUrl] existe, à extraire sur la télé (phase 3).
 */
@Immutable
data class PlaybackSource(
    val provider: Provider,
    val label: String,
    val language: Lang,
    val quality: String? = null,
    val host: String? = null,
    val embedUrl: String? = null,
    val streamUrl: String? = null,
    val kind: StreamKind = StreamKind.HLS,
    val subtitles: List<SubtitleTrack> = emptyList(),
    /** En-têtes de lecture rendus par l'extraction sur la télé (Referer…). */
    val headers: Map<String, String> = emptyMap(),
    /** Flux obtenu par le userscript sur la télé (et non par le serveur). */
    val extracted: Boolean = false,
    /** Fichier SwiftFlux annoncé (bloc `mp4`), dont l'URL reste à demander au serveur. */
    val mp4Index: Int? = null,
) {
    val playable: Boolean get() = streamUrl != null
    val id: String get() = "${provider.name}|${if (extracted) embedUrl else streamUrl ?: embedUrl}"
}

/** Ce qu'on lit : un film, ou un épisode d'une série. */
@Immutable
data class PlayRequest(
    val type: com.movix.tv.data.tmdb.MediaType,
    val tmdbId: Int,
    val season: Int? = null,
    val episode: Int? = null,
    val imdbId: String? = null,
) {
    val isTv: Boolean get() = type == com.movix.tv.data.tmdb.MediaType.TV
}
