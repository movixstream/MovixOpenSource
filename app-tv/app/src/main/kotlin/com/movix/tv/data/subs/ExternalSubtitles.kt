package com.movix.tv.data.subs

import com.movix.tv.data.movix.SubtitleTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.util.zip.GZIPInputStream

/**
 * Sous-titres externes du lecteur du site (`src/services/subtitles/`) :
 * Shegu (subs.wing.st) et l'ancienne API REST d'OpenSubtitles, appelés en
 * direct, sans clé. Toutes les langues reviennent ; la langue de l'appli
 * passe devant, puis les plus téléchargés.
 */
class ExternalSubtitles(private val http: OkHttpClient, private val json: Json) {

    /** [imdbId] avec ou sans « tt » ; sans lui, OpenSubtitles est sauté. */
    suspend fun search(tmdbId: Int, imdbId: String?, season: Int?, episode: Int?, preferredLang: String): List<SubtitleTrack> = coroutineScope {
        val shegu = async { withTimeoutOrNull(TIMEOUT_MS) { runCatching { shegu(tmdbId, season, episode) }.getOrNull() }.orEmpty() }
        val os = async { withTimeoutOrNull(TIMEOUT_MS) { runCatching { openSubtitles(imdbId, season, episode) }.getOrNull() }.orEmpty() }
        val all = (shegu.await() + os.await()).distinctBy { it.url }
        // Langue de l'appli, puis français et anglais, puis le reste ; les plus téléchargés d'abord.
        val firstLangs = listOf(preferredLang, "fr", "en").distinct()
        all.sortedWith(compareBy<SubtitleTrack>(
            { firstLangs.indexOf(it.lang).let { i -> if (i < 0) firstLangs.size else i } },
            { -(it.downloads ?: -1) },
            { it.label },
        ))
    }

    private suspend fun shegu(tmdbId: Int, season: Int?, episode: Int?): List<SubtitleTrack> {
        val q = if (season != null) "type=tv&tmdb=$tmdbId&season=$season&episode=${episode ?: 1}" else "type=movie&tmdb=$tmdbId"
        val root = getJson("https://subs.wing.st/subtitles?$q") ?: return emptyList()
        return ((root as? JsonObject)?.get("subtitles") as? JsonArray).orEmpty().mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val url = o.str("url") ?: return@mapNotNull null
            val lang = o.str("language")?.lowercase() ?: return@mapNotNull null
            val format = o.str("type")?.lowercase() ?: "srt"
            if (format != "srt" && format != "vtt") return@mapNotNull null
            SubtitleTrack(url, o.str("display") ?: lang, lang, format, source = "Shegu")
        }
    }

    private suspend fun openSubtitles(imdbId: String?, season: Int?, episode: Int?): List<SubtitleTrack> {
        val imdb = imdbId?.removePrefix("tt")?.takeIf { it.isNotBlank() } ?: return emptyList()
        val path = if (season != null) "episode-${episode ?: 1}/imdbid-$imdb/season-$season" else "imdbid-$imdb"
        val root = getJson("https://rest.opensubtitles.org/search/$path") as? JsonArray ?: return emptyList()
        return root.mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val url = o.str("SubDownloadLink") ?: return@mapNotNull null
            val raw = (o.str("ISO639") ?: o.str("SubLanguageID"))?.lowercase() ?: return@mapNotNull null
            val format = o.str("SubFormat")?.lowercase()?.ifBlank { null } ?: "srt"
            if (format != "srt" && format != "vtt") return@mapNotNull null
            SubtitleTrack(
                url, o.str("SubFileName") ?: o.str("MovieReleaseName") ?: raw, ISO_639_2[raw] ?: raw, format,
                source = "OpenSubtitles", downloads = o.str("SubDownloadsCnt")?.toIntOrNull(),
            )
        }
    }

    private suspend fun getJson(url: String): JsonElement? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url).header("User-Agent", USER_AGENT).build()
        http.newCall(req).execute().use { res -> if (res.isSuccessful) json.parseToJsonElement(res.body.string()) else null }
    }

    private fun JsonObject.str(key: String): String? = (get(key) as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

    companion object {
        const val USER_AGENT = "Movix/1.0"
        private const val TIMEOUT_MS = 12_000L

        private val ISO_639_2 = mapOf(
            "fre" to "fr", "fra" to "fr", "eng" to "en", "ger" to "de", "deu" to "de", "spa" to "es", "ita" to "it",
            "por" to "pt", "pob" to "pt", "dut" to "nl", "nld" to "nl", "ara" to "ar", "rus" to "ru", "tur" to "tr",
            "pol" to "pl", "jpn" to "ja", "kor" to "ko", "chi" to "zh", "zho" to "zh", "rum" to "ro", "ron" to "ro",
        )

        /**
         * Texte d'un fichier de sous-titres : décompressé s'il est en gzip
         * (OpenSubtitles), UTF-16 d'après sa marque, UTF-8 s'il est valide,
         * sinon Windows-1252 (vieux SRT français).
         */
        fun decode(bytes: ByteArray): String {
            val data = if (bytes.size > 2 && bytes[0] == 0x1f.toByte() && bytes[1] == 0x8b.toByte()) {
                runCatching { GZIPInputStream(ByteArrayInputStream(bytes)).use { it.readBytes() } }.getOrDefault(bytes)
            } else bytes
            if (data.size >= 2 && data[0] == 0xFF.toByte() && data[1] == 0xFE.toByte()) return String(data, Charsets.UTF_16LE).removePrefix("﻿")
            if (data.size >= 2 && data[0] == 0xFE.toByte() && data[1] == 0xFF.toByte()) return String(data, Charsets.UTF_16BE).removePrefix("﻿")
            return try {
                Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(data)).toString()
            } catch (_: CharacterCodingException) {
                String(data, Charset.forName("windows-1252"))
            }
        }
    }
}
