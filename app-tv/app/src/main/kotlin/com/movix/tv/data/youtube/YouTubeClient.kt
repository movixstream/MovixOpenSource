package com.movix.tv.data.youtube

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Flux d'une vidéo YouTube : un manifeste HLS ([hls]), ou image et son
 * séparés. [userAgent] : celui du client qui les a obtenus, à renvoyer au CDN.
 */
data class YouTubeStreams(val videoUrl: String, val audioUrl: String?, val hls: Boolean, val userAgent: String)

/**
 * Bandes-annonces lues dans le lecteur de l'appli, jamais dans une page web.
 *
 * Comme NewPipeExtractor (0.26.5) et JDownloader (2026-10) : API interne
 * « player » avec l'identité VISIONOS (Apple Vision Pro) et un `visitorData`
 * frais demandé à `visitor_id`. Sans ce dernier, YouTube répond « confirmez
 * que vous n'êtes pas un robot ». Elle rend un manifeste HLS jusqu'en 1080p
 * H.264, sans jeton PO, sans signature ni `n` à déchiffrer. Vérifié le
 * 2026-10-16 sur des bandes-annonces de studios (RXe5c9WNay0, gc0t8AfMP6k).
 *
 * Ces URL sont liées à l'IP : l'appel se fait depuis la télé, jamais depuis
 * un serveur. Si YouTube change l'identité acceptée, mettre à jour [VISIONOS]
 * d'après yt-dlp ou NewPipeExtractor.
 */
class YouTubeClient(private val http: OkHttpClient, private val json: Json) {

    private class Client(val name: String, val id: Int, val version: String, val userAgent: String, val extra: Map<String, Any>)

    @Volatile private var visitorData: String? = null

    suspend fun streams(videoId: String, maxHeight: Int = 1080): YouTubeStreams? = withContext(Dispatchers.IO) {
        for (client in CLIENTS) {
            // Un visitorData périmé donne « pas un robot » : un second essai avec un neuf.
            repeat(2) { attempt ->
                val visitor = visitorData ?: fetchVisitorData(client)?.also { visitorData = it }
                val data = runCatching { request(client, videoId, visitor) }.onFailure { Log.w(TAG, "${client.name} : $it") }.getOrNull()
                data?.let { pick(it, maxHeight, client.userAgent) }?.let { return@withContext it }
                Log.i(TAG, "${client.name} refusé pour $videoId (essai ${attempt + 1})")
                visitorData = null
            }
        }
        null
    }

    private fun context(client: Client, visitor: String?) = buildJsonObject {
        putJsonObject("client") {
            put("clientName", client.name)
            put("clientVersion", client.version)
            put("hl", "fr")
            put("gl", "FR")
            visitor?.let { put("visitorData", it) }
            client.extra.forEach { (k, v) -> if (v is Int) put(k, v) else put(k, v.toString()) }
        }
    }

    private fun post(url: String, client: Client, visitor: String?, body: String): JsonObject? {
        val req = Request.Builder().url(url)
            .header("User-Agent", client.userAgent)
            .header("X-YouTube-Client-Name", client.id.toString())
            .header("X-YouTube-Client-Version", client.version)
            .header("X-Goog-Api-Format-Version", "2")
            .apply { visitor?.let { header("X-Goog-Visitor-Id", it) } }
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        return http.newCall(req).execute().use { if (it.isSuccessful) json.parseToJsonElement(it.body.string()) as? JsonObject else null }
    }

    /** `visitorData` neuf (identifiant de visiteur anonyme), comme NewPipe avant chaque lecture. */
    private fun fetchVisitorData(client: Client): String? = runCatching {
        val body = buildJsonObject { put("context", context(client, null)) }.toString()
        val root = post("https://youtubei.googleapis.com/youtubei/v1/visitor_id?prettyPrint=false", client, null, body)
        ((root?.get("responseContext") as? JsonObject)?.get("visitorData") as? JsonPrimitive)?.contentOrNull
    }.onFailure { Log.w(TAG, "visitor_id : $it") }.getOrNull()

    private fun request(client: Client, videoId: String, visitor: String?): JsonObject? {
        val body = buildJsonObject {
            put("videoId", videoId)
            put("context", context(client, visitor))
            put("cpn", randomCpn())
            put("contentCheckOk", true)
            put("racyCheckOk", true)
        }.toString()
        val root = post("https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false&id=$videoId", client, visitor, body) ?: return null
        val status = ((root["playabilityStatus"] as? JsonObject)?.get("status") as? JsonPrimitive)?.contentOrNull
        return if (status == "OK") root["streamingData"] as? JsonObject else null
    }

    /**
     * Manifeste HLS d'abord (Media3 y choisit la qualité) ; sinon H.264 le
     * plus haut sous [maxHeight] + AAC. Jamais le fichier 360p (itag 18) :
     * il renvoie 403 au-delà d'environ 1 Mo.
     */
    private fun pick(data: JsonObject, maxHeight: Int, userAgent: String): YouTubeStreams? {
        fun JsonObject.str(k: String) = (get(k) as? JsonPrimitive)?.contentOrNull
        fun JsonObject.int(k: String) = (get(k) as? JsonPrimitive)?.intOrNull
        data.str("hlsManifestUrl")?.let { return YouTubeStreams(it, null, hls = true, userAgent = userAgent) }
        val adaptive = (data["adaptiveFormats"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.filter { it.str("url") != null }
        val video = adaptive
            .filter { it.str("mimeType")?.startsWith("video/mp4") == true && it.str("mimeType")?.contains("avc1") == true }
            .filter { (it.int("height") ?: 0) in 1..maxHeight }
            .maxByOrNull { (it.int("height") ?: 0) * 100 + (it.int("fps") ?: 0) }
            ?: return null
        val audio = adaptive
            .filter { it.str("mimeType")?.startsWith("audio/mp4") == true }
            .maxByOrNull { it.int("bitrate") ?: 0 }
            ?: return null
        return YouTubeStreams(video.str("url")!!, audio.str("url"), hls = false, userAgent = userAgent)
    }

    private fun randomCpn(): String {
        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        return (1..16).map { chars.random() }.joinToString("")
    }

    companion object {
        private const val TAG = "MovixYouTube"

        /** Identité de NewPipeExtractor 0.26.5 (2026-08), aussi dans yt-dlp et JDownloader. */
        private val VISIONOS = Client(
            "VISIONOS", 101, "1.04",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
            mapOf("deviceMake" to "Apple", "deviceModel" to "RealityDevice17,1", "osName" to "visionOS", "osVersion" to "26.6.0.23O770"),
        )

        /** Secours : URL directes en H.264, sans jeton (retiré des défauts de yt-dlp pour l'itag 18, qu'on n'utilise pas). */
        private val ANDROID_VR = Client(
            "ANDROID_VR", 28, "1.65.10",
            "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
            mapOf("androidSdkVersion" to 32),
        )

        private val CLIENTS = listOf(VISIONOS, ANDROID_VR)

        /** Vignette d'une vidéo (480×360), pour les cartes de la fiche. */
        fun thumbnail(videoId: String) = "https://i.ytimg.com/vi/$videoId/hqdefault.jpg"
    }
}
