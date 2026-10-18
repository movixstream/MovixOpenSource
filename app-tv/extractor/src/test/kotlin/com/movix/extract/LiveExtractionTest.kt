package com.movix.extract

import com.movix.tv.player.MediaHeaders
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Essai réel, sur PC : liens embed pris sur la Main API **sans VIP**, puis
 * extraction avec le vrai userscript dans QuickJS natif, puis lecture du
 * début du flux avec les en-têtes rendus (preuve que le lecteur pourra le lire).
 *
 * Lancer : `MOVIX_LIVE=1 ./gradlew :extractor:test --tests "*LiveExtractionTest*"`.
 */
class LiveExtractionTest {
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS).build()

    private val hostKeys = linkedMapOf(
        "voe" to Regex("""voe\.sx|voe\b|[a-z]+\d*\.(?:com|net|org)/e/[a-z0-9]{12}"""),
        "vidmoly" to Regex("vidmoly|ansembed"),
        "uqload" to Regex("uqload"),
        "sibnet" to Regex("sibnet"),
        "dood" to Regex("dood|d0000d|ds2play|dooood"),
        "lulu" to Regex("lulu"),
        "veev" to Regex("veev"),
        "vidara" to Regex("vidara"),
        "seek" to Regex("seekstream|embedseek"),
        "fsvid" to Regex("fsvid"),
        "vidzy" to Regex("vidzy"),
    )

    private val endpoints = listOf(
        "api/links/movie/550", "api/tmdb/movie/550", "api/fstream/movie/550", "api/wiflix/movie/550",
        "api/links/movie/27205", "api/fstream/movie/27205", "api/wiflix/movie/27205", "api/cpasmal/movie/27205",
        "api/fstream/movie/157336", "api/wiflix/movie/157336", "api/tmdb/movie/157336",
        "api/links/tv/1396?season=1&episode=1", "api/fstream/tv/1396/season/1?episode=1", "api/wiflix/tv/1396/1?episode=1",
        "api/fstream/tv/94997/season/1?episode=1", "api/wiflix/tv/94997/1?episode=1", "api/j1f/movie/550",
    )

    private fun get(url: String, headers: Map<String, String> = emptyMap()): Pair<Int, ByteArray>? = runCatching {
        val b = Request.Builder().url(url)
        headers.forEach { (k, v) -> b.header(k, v) }
        client.newCall(b.build()).execute().use { it.code to (it.body.byteStream().readNBytes(4096)) }
    }.onFailure { if (System.getenv("MOVIX_LIVE_VERBOSE") == "1") println("    GET $url → $it") }.getOrNull()

    @Test
    fun extractsRealEmbeds() = runBlocking {
        assumeTrue("MOVIX_LIVE=1 pour l'essai réel", System.getenv("MOVIX_LIVE") == "1")
        val script = File("../app/src/main/assets/extract/movix.user.js").readText()

        // 1. Liens embed bruts (sans VIP, sans resolve).
        val urlRe = Regex("""https?://[^"\\\s<>]+""")
        val embeds = withContext(Dispatchers.IO) {
            endpoints.flatMap { ep ->
                val body = get("https://api.movix.men/$ep")?.second?.decodeToString().orEmpty()
                urlRe.findAll(body).map { it.value.replace("\\/", "/") }.toList()
            }
        }.distinct().filterNot { it.contains("image.tmdb") || it.contains("movix") || it.endsWith(".jpg") || it.endsWith(".png") }
        val byHost = LinkedHashMap<String, MutableList<String>>()
        for (u in embeds) {
            val key = hostKeys.entries.firstOrNull { it.value.containsMatchIn(u.lowercase()) }?.key ?: continue
            byHost.getOrPut(key) { ArrayList() }.let { if (it.size < 2) it += u }
        }
        println("Liens trouvés par hébergeur : " + byHost.mapValues { it.value.size })

        // 2. Extraction avec le vrai userscript.
        val bridge = OkHttpBridge(client) { url, h ->
            val base = if (h.keys.none { it.equals("User-Agent", true) }) h + ("User-Agent" to MediaHeaders.SIGNED_USER_AGENT) else h
            MediaHeaders.apply(url, base)
        }
        val logs = ArrayList<String>()
        val runtime = ExtractorRuntime(bridge, { script }, MediaHeaders.SIGNED_USER_AGENT, log = { l, m -> if (l != "debug" && l != "log") synchronized(logs) { logs += "[$l] ${m.take(200)}" } })
        val t0 = System.currentTimeMillis()
        runtime.warmUp()
        println("Runtime prêt en ${System.currentTimeMillis() - t0} ms")

        val gate = Semaphore(3)
        val results = byHost.flatMap { (host, urls) -> urls.map { host to it } }.map { (host, url) ->
            async { gate.withPermit { host to runtime.extract(url) } }
        }.awaitAll()

        // 3. Lecture du début du flux avec les en-têtes rendus.
        println("\n%-8s %-6s %-7s %-6s %s".format("hôte", "extr.", "ms", "lu", "détail"))
        var playable = 0
        for ((host, r) in results) {
            val check = r.url?.let { u ->
                withContext(Dispatchers.IO) { get(u, MediaHeaders.apply(u, r.headers + ("Range" to "bytes=0-4095"))) }
            }
            val head = check?.second?.decodeToString(0, minOf(16, check.second.size)).orEmpty()
            val ok = check != null && check.first in 200..299 && (head.startsWith("#EXTM3U") || check.second.size > 8 && String(check.second, 4, 4, Charsets.ISO_8859_1) == "ftyp" || check.second.isNotEmpty())
            if (ok) playable++
            if (!ok && r.ok && System.getenv("MOVIX_LIVE_VERBOSE") == "1") println("    $host ${r.url} en-têtes=${r.headers}")
            println("%-8s %-6s %-7d %-6s %s".format(host, if (r.ok) "oui" else "non", r.elapsedMs, if (ok) "oui" else "non",
                (r.error ?: (check?.first?.toString() + " " + head.replace("\n", " "))).take(70)))
        }
        println("\n$playable / ${results.size} flux lisibles")
        logs.take(25).forEach(::println)
        runtime.close()
    }
}
