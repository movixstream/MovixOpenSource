package com.movix.tv.data.movix

import com.movix.tv.player.MediaHeaders
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Lecture des réponses des routes de sources (contrat relevé le 2026-10-15
 * dans les routes de `API/Mainapi` et `utils/embedExtraction.js`). Fonctions pures
 * et tolérantes : un champ absent ou d'un autre type donne une liste vide,
 * jamais une exception.
 *
 * Avec `?resolve=1` et une clé VIP valide, le serveur pose `m3u8Url` (et
 * parfois `subtitles`) sur chaque lecteur qu'il sait extraire. C'est une URL
 * signée du relais Movix : aucun en-tête à ajouter.
 */
object SourceParsers {
    // ---------- accès JSON tolérants ----------
    private operator fun JsonElement?.get(key: String): JsonElement? = (this as? JsonObject)?.get(key)
    private val JsonElement?.str: String? get() = (this as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
    private val JsonElement?.list: List<JsonElement> get() = (this as? JsonArray).orEmpty()
    private val JsonElement?.bool: Boolean get() = (this as? JsonPrimitive)?.booleanOrNull == true

    fun isPending(root: JsonElement?): Boolean = root["pending"].bool

    fun language(raw: String?): Lang {
        val s = raw?.trim()?.lowercase() ?: return Lang.UNKNOWN
        return when {
            s.contains("vostfr") || s == "vost" -> Lang.VOSTFR
            s.startsWith("vf") || s.contains("french") || s.contains("français") || s.contains("francais") || s == "fr" || s.contains("truefrench") -> Lang.VF
            s.startsWith("vo") || s.contains("english") || s == "en" -> Lang.VO
            else -> Lang.UNKNOWN
        }
    }

    private val HOSTS = listOf(
        "voe", "vidmoly", "vidzy", "uqload", "sibnet", "veev", "doodstream", "dood", "lulustream", "lulu",
        "vidara", "seekstreaming", "smoothpre", "minochinos", "darkibox", "supervideo", "dropload", "oneupload", "fsvid",
    )

    /** Hébergeur reconnu dans l'URL (« voe », « uqload »…), ou `null`. */
    fun hoster(url: String?): String? {
        val host = url?.let { MediaHeaders.hostnameOf(it) } ?: return null
        return when (val h = HOSTS.firstOrNull { host.contains(it) }) {
            "dood" -> "doodstream"
            "lulu" -> "lulustream"
            else -> h
        }
    }

    /** Hébergeurs dont le relais sert un fichier MP4 et non un manifeste HLS. */
    private val FILE_HOSTS = setOf("uqload", "doodstream", "sibnet", "veev")

    fun kindFor(streamUrl: String, host: String?): StreamKind {
        val lower = streamUrl.lowercase()
        return when {
            lower.contains(".m3u8") || lower.contains("m3u8%") -> StreamKind.HLS
            lower.substringBefore('?').endsWith(".mp4") || lower.contains(".mp4%") || lower.contains(".mp4&") -> StreamKind.FILE
            host in FILE_HOSTS -> StreamKind.FILE
            else -> StreamKind.HLS
        }
    }

    private fun subtitles(e: JsonElement?): List<SubtitleTrack> = e.list.mapNotNull { s ->
        val url = s["url"].str?.takeIf { it.startsWith("https://") } ?: return@mapNotNull null
        val lang = s["lang"].str ?: "und"
        SubtitleTrack(url, s["label"].str ?: lang.uppercase(), lang, s["format"].str ?: "vtt", s["default"].bool)
    }

    /** Un lecteur « embed » des routes catalogue, avec son éventuel `m3u8Url`. */
    private fun player(
        provider: Provider,
        p: JsonElement,
        lang: Lang,
        label: (host: String?) -> String,
        quality: String? = null,
        urlKeys: List<String> = listOf("url", "link", "decoded_url"),
    ): PlaybackSource? {
        val embed = urlKeys.firstNotNullOfOrNull { p[it].str }
        val m3u8 = p["m3u8Url"].str
        if (embed == null && m3u8 == null) return null
        val host = hoster(embed)
        return PlaybackSource(
            provider = provider,
            label = label(host),
            language = lang,
            quality = quality,
            host = host,
            embedUrl = embed,
            streamUrl = m3u8,
            kind = m3u8?.let { kindFor(it, host) } ?: StreamKind.HLS,
            subtitles = subtitles(p["subtitles"]),
        )
    }

    private fun hostLabel(host: String?, fallback: String?) =
        host?.let(::hosterLabel) ?: fallback ?: "Lecteur"

    /** Noms d'hébergeurs du site (`src/utils/hosterRegistry.ts`, HOSTER_LABELS). */
    private val HOSTER_LABELS = mapOf(
        "voe" to "Voe", "vidmoly" to "Vidmoly", "uqload" to "Uqload", "sibnet" to "Sibnet", "veev" to "Veev",
        "doodstream" to "DoodStream", "darkibox" to "Darkibox", "dropload" to "Dropload", "fsvid" to "Fsvid",
        "lulustream" to "LuluStream", "vidara" to "Vidara", "seekstreaming" to "SeekStreaming", "smoothpre" to "SmoothPre",
        "minochinos" to "Minochinos", "vidzy" to "Vidzy", "supervideo" to "Supervideo", "oneupload" to "OneUpload",
    )

    /** « doodstream » → « DoodStream » ; un id inconnu prend une majuscule, comme sur le site. */
    fun hosterLabel(id: String): String = HOSTER_LABELS[id.lowercase()] ?: id.replaceFirstChar { it.uppercase() }

    /**
     * Nom d'un lecteur extrait sur la télé, comme le groupe Nexus du site
     * (`runExtractionPass.ts`) : hébergeur puis langue, sans le site d'origine.
     */
    fun extractedLabel(host: String, lang: Lang): String = listOfNotNull(hosterLabel(host), lang.label).joinToString(" ")

    /** Nom de lecteur rendu par une route : « premium » est le Fsvid de FStream. */
    private fun playerName(raw: String?, host: String?): String? =
        if (host == "fsvid" || raw.equals("premium", ignoreCase = true)) "Fsvid" else raw

    // ---------- /api/links ----------
    fun links(root: JsonElement?): List<PlaybackSource> {
        val data = root["data"]
        val links = if (data is JsonArray) data.firstOrNull()["links"] else data["links"]
        val m3u8By = root["m3u8ByPlayer"] as? JsonObject
        val subsBy = root["subtitlesByPlayer"] as? JsonObject
        var n = 0
        return links.list.mapNotNull { l ->
            val url = l.str ?: l["url"].str ?: return@mapNotNull null
            val lang = language(l["language"].str).takeIf { it != Lang.UNKNOWN } ?: Lang.VF
            val host = hoster(url)
            if (url.substringBefore('?').lowercase().endsWith(".mp4")) {
                PlaybackSource(Provider.LINKS, l["label"].str ?: "Viblix", lang, host = host, streamUrl = url, kind = StreamKind.FILE)
            } else {
                // Comme le site : « uqload.cx · Lecteur Movix 2 » (domaine sans www).
                n++
                val domain = MediaHeaders.hostnameOf(url)?.removePrefix("www.")
                val label = when {
                    host == "seekstreaming" -> "SeekStreaming $n"
                    domain != null -> "$domain · Lecteur Movix $n"
                    else -> "Lecteur Movix $n"
                }
                val m3u8 = m3u8By?.get(url).str
                PlaybackSource(
                    Provider.LINKS, label, lang, host = host,
                    embedUrl = url, streamUrl = m3u8, kind = m3u8?.let { kindFor(it, host) } ?: StreamKind.HLS,
                    subtitles = subtitles(subsBy?.get(url)),
                )
            }
        }
    }

    // ---------- /api/tmdb (« Lecteurs Multi » sur le site) ----------
    fun coflix(root: JsonElement?): List<PlaybackSource> {
        val players = root["current_episode"]["player_links"].list.ifEmpty { root["player_links"].list }
        return players.mapIndexedNotNull { i, p ->
            val lang = language(p["language"].str).takeIf { it != Lang.UNKNOWN } ?: Lang.VF
            // `quality` est le nom du lecteur (« Voe / HD ») : seule sa première partie s'affiche.
            val name = p["quality"].str?.substringBefore('/')?.trim()?.takeIf { it.isNotEmpty() }
            player(Provider.COFLIX, p, lang, { h -> playerName(name, h) ?: name ?: hostLabel(h, "Source ${i + 1}") },
                urlKeys = listOf("decoded_url", "clone_url", "url"))
        }
    }

    // ---------- /api/imdb (Omega, films) ----------
    fun omega(root: JsonElement?): List<PlaybackSource> = root["player_links"].list.mapIndexedNotNull { i, p ->
        player(Provider.OMEGA, p, Lang.VF, { h -> p["player"].str?.replaceFirstChar { it.uppercase() } ?: hostLabel(h, "Lecteur ${i + 1}") },
            quality = if (p["is_hd"].bool) "HD" else null, urlKeys = listOf("link", "url"))
    }

    // ---------- /api/purstream (Bravo) ----------
    fun purstream(root: JsonElement?): List<PlaybackSource> = root["sources"].list.mapNotNull { s ->
        val url = s["url"].str ?: return@mapNotNull null
        val name = (s["name"].str ?: "Bravo").replace(Regex("""^pur\s*\|\s*""", RegexOption.IGNORE_CASE), "").replace(" | ", " - ")
        val format = s["format"].str?.lowercase().orEmpty()
        PlaybackSource(
            Provider.PURSTREAM, name, language(name).takeIf { it != Lang.UNKNOWN } ?: Lang.VF,
            streamUrl = url, kind = if (format.contains("mp4")) StreamKind.FILE else kindFor(url, null),
        )
    }

    // ---------- /api/fstream ----------
    fun fstream(root: JsonElement?, episode: Int?): List<PlaybackSource> {
        val groups: JsonElement? = if (episode != null) root["episodes"][episode.toString()]["languages"] else root["players"]
        val order = if (episode != null) listOf("VF", "VOSTFR", "VOENG", "Default") else listOf("VFQ", "VFF", "VOSTFR", "Default")
        val obj = groups as? JsonObject ?: return emptyList()
        val keys = order.filter { it in obj } + obj.keys.filterNot { it in order }
        return keys.flatMap { cat ->
            val lang = if (cat == "Default") Lang.VF else language(cat)
            obj[cat].list.mapNotNull { p ->
                // Site : « VFF - Vidzy HD » (nom du lecteur puis qualité).
                player(Provider.FSTREAM, p, lang, { h ->
                    listOfNotNull("$cat - ${playerName(p["player"].str, h) ?: hostLabel(h, null)}", p["quality"].str).joinToString(" ")
                }, quality = p["quality"].str)
            }
        }
    }

    /** Wiflix, 1J1F, SwiftFlow : `players.{vf,vostfr}` (film) ou `episodes[N].{vf,vostfr}` (série). */
    fun vfVostfr(provider: Provider, root: JsonElement?, episode: Int?): List<PlaybackSource> {
        val container = if (episode != null) root["episodes"][episode.toString()] else root["players"]
        return listOf("vf" to Lang.VF, "vostfr" to Lang.VOSTFR).flatMap { (key, lang) ->
            container[key].list.mapNotNull { p ->
                val name = playerName(p["label"].str ?: p["name"].str, null)
                player(provider, p, lang, { h -> "${provider.label} ${lang.label} - ${playerName(name, h) ?: hostLabel(h, null)}" }, quality = p["label"].str?.takeIf { it.contains('p') })
            }
        }
    }

    /**
     * Fichiers MP4 annoncés par SwiftFlow (bloc `mp4.entries`, jamais d'URL) :
     * une source à résoudre par entrée, via la route signée des télés.
     */
    fun swiftfluxEntries(root: JsonElement?): List<PlaybackSource> {
        val block = root["mp4"]
        if (!block["available"].bool) return emptyList()
        return block["entries"].list.mapNotNull { e ->
            val index = (e["index"] as? JsonPrimitive)?.contentOrNull?.toIntOrNull() ?: return@mapNotNull null
            val lang = language(e["language"].str).takeIf { it != Lang.UNKNOWN } ?: Lang.VF
            val quality = e["quality"].str
            PlaybackSource(
                provider = Provider.SWIFTFLUX,
                label = "SwiftFlux ${lang.label}" + (quality?.let { " - $it" } ?: ""),
                language = lang,
                quality = quality,
                kind = StreamKind.FILE,
                mp4Index = index,
            )
        }
    }

    // ---------- /api/cpasmal (Viper) ----------
    /** Site : « Viper VF - voe 1 » pour un film, le serveur seul pour une série. */
    fun viper(root: JsonElement?, isTv: Boolean = false): List<PlaybackSource> = listOf("vf" to Lang.VF, "vostfr" to Lang.VOSTFR).flatMap { (key, lang) ->
        root["links"][key].list.mapIndexedNotNull { i, p ->
            player(Provider.VIPER, p, lang, { h ->
                val server = p["server"].str ?: hostLabel(h, null)
                if (isTv) server else "Viper ${lang.label} - $server ${i + 1}"
            }, quality = "HD")
        }
    }

    // ---------- /api/kisskh ----------
    fun kisskh(root: JsonElement?): List<PlaybackSource> {
        // Sous-titres : seuls les SRT en clair (les `txt*` sont chiffrés, phase ultérieure).
        val subs = root["subtitles"].list.mapNotNull { s ->
            if (s["cipher"]["mode"].str != "none") return@mapNotNull null
            val url = s["proxyUrl"].str ?: s["sourceUrl"].str ?: return@mapNotNull null
            val lang = s["lang"].str ?: "und"
            SubtitleTrack(url, s["label"].str ?: lang, lang, s["format"].str ?: "srt")
        }
        return root["sources"].list.mapNotNull { s ->
            val url = s["url"].str ?: return@mapNotNull null
            PlaybackSource(
                Provider.KISSKH, "KissKH", Lang.VOSTFR, streamUrl = url,
                kind = if (s["type"].str == "mp4") StreamKind.FILE else StreamKind.HLS, subtitles = subs,
            )
        }
    }

    // ---------- /api/drama (Vox, séries) ----------
    fun vox(root: JsonElement?): List<PlaybackSource> = root["data"].list.mapNotNull { p ->
        player(Provider.VOX, p, Lang.VOSTFR, { h -> p["name"].str ?: hostLabel(h, null) }, urlKeys = listOf("link", "url"))
    }
}
