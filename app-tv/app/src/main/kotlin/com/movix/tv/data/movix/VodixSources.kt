package com.movix.tv.data.movix

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest

/**
 * Source « Vodix » : nos propres vidéos, comme sur le site (`src/services/vodixService.ts`).
 *
 * La Main API donne les codes des vidéos d'un film ou d'un épisode. La télé
 * demande ensuite à Vodix, pour chaque code, un défi (GET `/e/<code>/challenge`),
 * le résout (preuve de travail : un nombre dont le SHA-256 de « défi:nombre »
 * commence par `bits` bits à zéro) et l'échange (POST `/e/<code>/source`)
 * contre l'adresse du manifeste HLS. Cette adresse est liée à l'IP de la
 * télé et vaut 8 h.
 *
 * Vodix n'accepte ces appels que d'un site autorisé par le propriétaire :
 * le défi et l'échange partent avec l'`Origin` d'un domaine Movix, la lecture
 * (manifeste, segments, sous-titres) avec son `Referer`. Sans eux : 403
 * (vérifié le 2026-11-27 sur vodix.top).
 *
 * L'image n'est jamais réencodée pour la télé : une copie 4K que l'appareil
 * ne sait pas décoder s'efface devant une copie plus petite de la même
 * version, quand il y en a une ([forDevice]).
 */
class VodixSources(
    private val api: MovixApi,
    private val http: OkHttpClient,
    private val json: Json,
    /** L'appareil décode-t-il du 2160p ([com.movix.tv.player.CodecSupport.decodes2160p]) ? */
    private val decodes2160p: () -> Boolean = { true },
) {
    internal data class Listed(val code: String, val quality: String?, val language: String?, val label: String?)

    suspend fun load(req: PlayRequest): List<PlaybackSource> {
        // Numéros d'anime-sama : l'épisode TMDB demandé serait un autre.
        if (req.isAnimeMode) return emptyList()
        val path = if (req.isTv) "api/vodix/tv/${req.tmdbId}/${req.season ?: 1}/${req.episode ?: 1}" else "api/vodix/movie/${req.tmdbId}"
        val body = runCatching { api.getSource(path, emptyMap(), vipKey = null, resolve = false) }.getOrNull() ?: return emptyList()
        if (body.pending) return emptyList()
        val (base, listed) = parseList(runCatching { json.parseToJsonElement(body.body) }.getOrNull()) ?: return emptyList()
        com.movix.tv.player.IpBoundHosts.add(base.host)
        val kept = forDevice(listed.take(MAX_SOURCES), decodes2160p())
        return coroutineScope {
            kept.map { item ->
                async {
                    runCatching { open(base, item) }
                        .onFailure { e -> runCatching { Log.w("MovixSources", "Vodix ${item.code} ignorée : ${e.message}") } }
                        .getOrNull()
                }
            }.awaitAll().filterNotNull()
        }
    }

    /** Échange le défi d'une vidéo et rend la source prête à jouer, avec ses sous-titres. */
    private suspend fun open(base: HttpUrl, item: Listed): PlaybackSource {
        val manifest = manifest(base, item.code)
        return PlaybackSource(
            provider = Provider.VODIX,
            label = label(item),
            language = language(item.language),
            langTag = langTag(item.language),
            shownLang = shownLang(item.language),
            quality = item.quality,
            host = "vodix",
            streamUrl = manifest.toString(),
            kind = StreamKind.HLS,
            headers = PLAY_HEADERS,
            // Un échec des sous-titres ne retire pas la source.
            subtitles = runCatching { subtitles(manifest, item.language) }.getOrDefault(emptyList()),
        )
    }

    private suspend fun manifest(base: HttpUrl, code: String): HttpUrl {
        val gateUrl = sameOrigin(base, "/e/$code/challenge") ?: error("adresse Vodix invalide")
        val gate = getJson(gateUrl, GATE_HEADERS) as? JsonObject ?: error("défi refusé")
        val challenge = gate.text("challenge") ?: error("défi illisible")
        val exchange = gate.text("url")?.let { sameOrigin(base, it) } ?: error("défi illisible")
        val nonce = withContext(Dispatchers.Default) { solve(challenge, (gate["bits"] as? JsonPrimitive)?.intOrNull ?: 0) }
        val payload = json.encodeToString(JsonObject.serializer(), JsonObject(mapOf("challenge" to JsonPrimitive(challenge), "nonce" to JsonPrimitive(nonce))))
        val answer = withContext(Dispatchers.IO) {
            val request = Request.Builder().url(exchange).post(payload.toRequestBody(JSON_TYPE)).apply { GATE_HEADERS.forEach { (k, v) -> header(k, v) } }.build()
            http.newCall(request).execute().use { res ->
                if (!res.isSuccessful) error("échange refusé (HTTP ${res.code})")
                json.parseToJsonElement(res.body.string())
            }
        } as? JsonObject
        return answer?.text("url")?.let { sameOrigin(base, it) } ?: error("réponse sans adresse de lecture")
    }

    /**
     * Sous-titres texte extraits du fichier (`subtitles.json`) et ajoutés dans
     * le Studio (`external-subtitles`), à côté du manifeste et lus avec son
     * jeton. Le français d'abord ; la piste par défaut : en VO/VOSTFR les
     * français complets, sinon les français « forcés » s'il y en a.
     */
    private suspend fun subtitles(manifest: HttpUrl, language: String?): List<SubtitleTrack> = coroutineScope {
        val lists = listOf("subtitles.json", "external-subtitles").map { name ->
            async { manifest.resolve(name)?.let { runCatching { getJson(it, PLAY_HEADERS) }.getOrNull() } }
        }.awaitAll()
        parseSubtitles(manifest, lists, language)
    }

    private suspend fun getJson(url: HttpUrl, headers: Map<String, String>): JsonElement? = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url).apply { headers.forEach { (k, v) -> header(k, v) } }.build()
        http.newCall(request).execute().use { res ->
            if (!res.isSuccessful) error("HTTP ${res.code}")
            json.parseToJsonElement(res.body.string())
        }
    }

    companion object {
        /** Au plus 8 vidéos par titre, comme le site. */
        const val MAX_SOURCES = 8

        /** Domaine Movix autorisé dans les règles d'accès de Vodix. */
        private const val SITE_ORIGIN = "https://movix.luxe"
        private val GATE_HEADERS = mapOf("Origin" to SITE_ORIGIN)
        val PLAY_HEADERS = mapOf("Referer" to "$SITE_ORIGIN/")
        private val JSON_TYPE = "application/json".toMediaType()

        private operator fun JsonElement?.get(key: String): JsonElement? = (this as? JsonObject)?.get(key)
        private fun JsonElement?.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }

        /** Adresse de [path] sur l'hôte de [base], ou `null` si elle mène ailleurs. */
        internal fun sameOrigin(base: HttpUrl, path: String): HttpUrl? =
            base.resolve(path)?.takeIf { it.scheme == base.scheme && it.host == base.host && it.port == base.port }

        /** `{ base, sources: [{ code, quality, language, label }] }` de la Main API. */
        internal fun parseList(root: JsonElement?): Pair<HttpUrl, List<Listed>>? {
            val base = root.text("base")?.toHttpUrlOrNull() ?: return null
            val listed = (root["sources"] as? JsonArray).orEmpty().mapNotNull { s ->
                val code = s.text("code")?.takeIf { CODE.matches(it) } ?: return@mapNotNull null
                Listed(code, s.text("quality"), s.text("language"), s.text("label"))
            }
            return if (listed.isEmpty()) null else base to listed.sortedWith(BEST_FIRST)
        }

        private val CODE = Regex("^[A-Za-z0-9_-]{4,64}$")

        /**
         * Sans décodeur 2160p, une copie 4K est retirée quand une copie plus
         * petite de la même version existe. Seule, elle reste : le lecteur
         * passe à la source suivante si elle échoue.
         */
        internal fun forDevice(list: List<Listed>, decodes2160p: Boolean): List<Listed> {
            if (decodes2160p) return list
            return list.filter { item ->
                heightOf(item.quality) < 2160 || list.none { other -> heightOf(other.quality) in 1..2159 && language(other.language) == language(item.language) }
            }
        }

        /** « Vodix 1080p VOSTFR », ou « Vodix » + le libellé posé dans le catalogue. */
        internal fun label(item: Listed): String =
            item.label?.let { "Vodix $it" } ?: listOfNotNull("Vodix", item.quality, item.language).joinToString(" ")

        /** MULTi, VFF, TRUEFRENCH, VF, FRENCH, VFQ → VF ; VOSTFR ; VO. */
        internal fun language(raw: String?): Lang = when (raw?.trim()?.uppercase()) {
            null, "" -> Lang.UNKNOWN
            "MULTI", "VFF", "TRUEFRENCH", "VF", "FRENCH", "VFQ", "VFI" -> Lang.VF
            else -> SourceParsers.language(raw)
        }

        /** « MULTI » affiché tel quel (son français et VO), rangé comme la VF. */
        internal fun shownLang(raw: String?): String? = raw?.trim()?.uppercase()?.takeIf { it == "MULTI" }

        /** VFQ (doublage québécois) se distingue de la VF ; les autres non. */
        internal fun langTag(raw: String?): String? = raw?.trim()?.uppercase()?.takeIf { it == "VFQ" }

        private val LANGUAGE_RANK = listOf("MULTI", "VFF", "TRUEFRENCH", "VF", "FRENCH", "VFQ", "VOSTFR", "VO")
        private fun rankOf(value: String?): Int = LANGUAGE_RANK.indexOf(value?.uppercase()).let { if (it < 0) LANGUAGE_RANK.size else it }

        internal fun heightOf(quality: String?): Int {
            val text = quality.orEmpty().lowercase()
            if (Regex("2160|4k|uhd").containsMatchIn(text)) return 2160
            return Regex("(\\d{3,4})p").find(text)?.groupValues?.get(1)?.toInt() ?: 0
        }

        /** 4K avant 1080p avant 720p ; à définition égale, MULTi avant VF, puis VFQ, VOSTFR. */
        private val BEST_FIRST = compareByDescending<Listed> { heightOf(it.quality) }.thenBy { rankOf(it.language) }

        /**
         * Le nombre attendu : le premier dont le SHA-256 de « [challenge]:nombre »
         * commence par [bits] bits à zéro (32 au plus, comme le site).
         */
        internal suspend fun solve(challenge: String, bits: Int): String {
            val want = bits.coerceIn(0, 32)
            if (want == 0) return "0"
            val limit = 1L shl (32 - want)
            val digest = MessageDigest.getInstance("SHA-256")
            val prefix = "$challenge:".toByteArray(Charsets.US_ASCII)
            var nonce = 0L
            while (true) {
                digest.update(prefix)
                val hash = digest.digest(nonce.toString().toByteArray(Charsets.US_ASCII))
                val head = ((hash[0].toLong() and 0xff) shl 24) or ((hash[1].toLong() and 0xff) shl 16) or
                    ((hash[2].toLong() and 0xff) shl 8) or (hash[3].toLong() and 0xff)
                if (head < limit) return nonce.toString()
                if (nonce % 20_000 == 19_999L) kotlinx.coroutines.currentCoroutineContext().ensureActive()
                nonce++
            }
        }

        private val LANGUAGE_CODES = mapOf(
            "fre" to "fr", "fra" to "fr", "fr" to "fr", "eng" to "en", "en" to "en", "spa" to "es", "es" to "es", "ita" to "it", "it" to "it",
            "ger" to "de", "deu" to "de", "de" to "de", "por" to "pt", "pt" to "pt", "ara" to "ar", "ar" to "ar", "jpn" to "ja", "ja" to "ja", "kor" to "ko", "ko" to "ko",
        )
        private val LANGUAGE_NAMES = mapOf(
            "fr" to "Français", "en" to "Anglais", "es" to "Espagnol", "it" to "Italien", "de" to "Allemand", "pt" to "Portugais",
            "ar" to "Arabe", "ja" to "Japonais", "ko" to "Coréen",
        )

        private fun subtitleLang(value: String?): String {
            val code = value.orEmpty().lowercase()
            return LANGUAGE_CODES[code] ?: if (Regex("^[a-z]{2,3}$").matches(code)) code else "und"
        }

        /** « Français forcés · SDH » : la langue, puis le libellé d'origine s'il apprend quelque chose. */
        private fun subtitleLabel(original: String?, lang: String, forced: Boolean): String {
            val name = LANGUAGE_NAMES[lang] ?: if (lang == "und") "Sous-titres" else lang.uppercase()
            val base = if (forced) "$name forcés" else name
            val text = original.orEmpty().trim()
            val informative = text.isNotEmpty() && !Regex("^sous-titres?\\s*\\d*$", RegexOption.IGNORE_CASE).matches(text) && !text.equals(name, ignoreCase = true)
            return if (informative) "$base · ${text.take(40)}" else base
        }

        private data class Sub(val url: String, val lang: String, val forced: Boolean, val label: String)

        /** Pistes texte de [lists] (réponses de `subtitles.json` et `external-subtitles`), sur l'hôte du manifeste. */
        internal fun parseSubtitles(manifest: HttpUrl, lists: List<JsonElement?>, language: String? = null): List<SubtitleTrack> {
            val subs = lists.flatMap { (it as? JsonArray).orEmpty() }.mapNotNull { track ->
                val raw = track.text("url") ?: return@mapNotNull null
                if (track.text("format") == "bitmap") return@mapNotNull null
                val url = manifest.resolve(raw)?.takeIf { it.host == manifest.host } ?: return@mapNotNull null
                val lang = subtitleLang(track.text("language"))
                val forced = (track["forced"] as? JsonPrimitive)?.booleanOrNull == true
                Sub(url.toString(), lang, forced, subtitleLabel(track.text("label"), lang, forced))
            }.sortedWith(compareBy<Sub>({ if (it.lang == "fr") 0 else 1 }, { if (it.forced) 1 else 0 }))
            val original = language?.trim()?.uppercase() in setOf("VO", "VOSTFR")
            val wanted = if (original) subs.firstOrNull { it.lang == "fr" && !it.forced } ?: subs.firstOrNull { it.lang == "fr" }
            else subs.firstOrNull { it.lang == "fr" && it.forced }
            return subs.map { SubtitleTrack(it.url, it.label, it.lang, "vtt", isDefault = it === wanted, headers = PLAY_HEADERS) }
        }
    }
}
