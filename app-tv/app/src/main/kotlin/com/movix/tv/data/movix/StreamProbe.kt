package com.movix.tv.data.movix

import com.movix.tv.player.MediaHeaders
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * Une variante d'un flux : hauteur équivalente (voir [HlsMaster.equivalentHeight])
 * et codecs (chaînes RFC 6381 ou codes MP4, voir [com.movix.tv.player.Codecs]).
 */
data class Variant(val height: Int?, val codecs: List<String> = emptyList())

/**
 * Qualité et codecs réels des flux avant de lancer. Le serveur n'annonce
 * souvent que « HD » ; la playlist HLS maîtresse, elle, porte `RESOLUTION=`
 * et `CODECS=` pour chaque variante, et l'en-tête d'un MP4 (boîte `moov`)
 * la taille de l'image et les codecs. Quelques petites requêtes par
 * candidat, en parallèle.
 */
class StreamProbe(http: OkHttpClient) {
    private val client = http.newBuilder()
        .callTimeout(PER_CALL_MS, TimeUnit.MILLISECONDS)
        .build()

    /**
     * Variantes lues pour chaque source de [sources], par [PlaybackSource.id].
     * Une source absente du résultat est inconnue : pas de réponse dans
     * [totalMs], playlist de segments sans variantes, format non reconnu.
     */
    suspend fun variants(sources: List<PlaybackSource>, totalMs: Long = 4_000): Map<String, List<Variant>> = coroutineScope {
        val results = ConcurrentHashMap<String, List<Variant>>()
        val jobs = sources.filter { it.streamUrl != null }.map { s ->
            async {
                val url = s.streamUrl!!
                val found = if (s.kind == StreamKind.HLS) fetch(url, s.headers, 0, MAX_PLAYLIST, ranged = false)?.let { HlsMaster.variants(it.decodeToString()) }
                else Mp4Header.read { offset, length -> fetch(url, s.headers, offset, length, ranged = true) }?.let(::listOf)
                if (!found.isNullOrEmpty()) results[s.id] = found
            }
        }
        // Ce qui n'a pas répondu à temps reste inconnu ; les appels en cours sont coupés.
        withTimeoutOrNull(totalMs) { jobs.awaitAll() }
        jobs.forEach { it.cancel() }
        HashMap(results)
    }

    /**
     * [length] octets à partir de [offset] (requête `Range` si [ranged]), ou
     * `null` si erreur. Un serveur qui ignore `Range` n'est lu qu'au début
     * du fichier. Annuler la coroutine coupe la requête.
     */
    private suspend fun fetch(url: String, headers: Map<String, String>, offset: Long, length: Int, ranged: Boolean): ByteArray? = suspendCancellableCoroutine { cont ->
        val request = Request.Builder().url(url).apply {
            // Mêmes en-têtes que le lecteur (Referer de SwiftFlux, d'une extraction…).
            MediaHeaders.apply(url, headers).forEach { (k, v) -> header(k, v) }
            if (ranged) header("Range", "bytes=$offset-${offset + length - 1}")
        }.build()
        val call = client.newCall(request)
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = cont.resume(null)

            override fun onResponse(call: Call, response: Response) {
                val bytes = runCatching {
                    response.use { r ->
                        if (!r.isSuccessful || (offset > 0 && r.code != 206)) return@use null
                        // Jamais un fichier entier : on s'arrête à la longueur demandée.
                        val src = r.body.source()
                        src.request(length.toLong())
                        src.buffer.readByteArray(minOf(src.buffer.size, length.toLong()))
                    }
                }.getOrNull()
                cont.resume(bytes)
            }
        })
    }

    private companion object {
        const val PER_CALL_MS = 3_500L
        const val MAX_PLAYLIST = 64 * 1024
    }
}

/** Lecture des variantes d'une playlist HLS maîtresse. */
object HlsMaster {
    private val RESOLUTION = Regex("""RESOLUTION=(\d+)x(\d+)""")
    private val CODECS = Regex("""CODECS="([^"]*)"""")

    /**
     * Variantes vidéo (`#EXT-X-STREAM-INF`) ; les variantes I-frame sont
     * ignorées. Vide si le texte n'est pas une playlist maîtresse.
     */
    fun variants(text: String): List<Variant> {
        if (!text.trimStart().startsWith("#EXTM3U")) return emptyList()
        return text.lineSequence().filter { it.startsWith("#EXT-X-STREAM-INF:") }.map { line ->
            val height = RESOLUTION.find(line)?.let { m -> equivalentHeight(m.groupValues[1].toInt(), m.groupValues[2].toInt()) }
            val codecs = CODECS.find(line)?.groupValues?.get(1)?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
            Variant(height, codecs)
        }.toList()
    }

    /**
     * Hauteur équivalente de la meilleure variante, calculée comme
     * l'étiquette du lecteur : un 1728×720 en format cinéma vaut un 972p,
     * un 864×360 un 486p. `null` si aucune résolution n'est annoncée.
     */
    fun bestHeight(text: String): Int? = variants(text).mapNotNull { it.height }.maxOrNull()

    fun equivalentHeight(width: Int, height: Int): Int = maxOf(height, width * 9 / 16)
}

/**
 * En-tête d'un fichier MP4 : taille de l'image (`tkhd`) et code du codec
 * (`stsd`) de chaque piste, lus par petits morceaux. La boîte `moov` est au
 * début (fichier « faststart ») ou après les données (`mdat`) : on saute
 * de boîte en boîte sans jamais lire les données.
 */
object Mp4Header {
    private val CONTAINERS = setOf("moov", "trak", "mdia", "minf", "stbl")
    private const val PAGE = 64 * 1024
    private const val MAX_READS = 8

    /**
     * [read] rend jusqu'à `length` octets à partir de `offset` (moins en fin
     * de fichier), ou `null`. `null` si le fichier n'est pas un MP4 lisible.
     */
    suspend fun read(read: suspend (offset: Long, length: Int) -> ByteArray?): Variant? {
        val pages = Pages(read)
        // Boîtes de premier niveau jusqu'à `moov`.
        var offset = 0L
        var moov: LongRange? = null
        while (moov == null) {
            val box = pages.box(offset) ?: return null
            if (offset == 0L && box.type != "ftyp") return null
            if (box.type == "moov") moov = box.content
            offset = box.end
        }
        var height: Int? = null
        val codecs = ArrayList<String>()
        pages.walk(moov) { type, content ->
            when (type) {
                "tkhd" -> {
                    // Largeur et hauteur (16.16) : les 8 derniers octets de la boîte.
                    val wh = pages.bytes(content.last - 7, 8) ?: return@walk
                    val w = u32(wh, 0) ushr 16
                    val h = u32(wh, 4) ushr 16
                    if (w > 0 && h > 0) height = maxOf(height ?: 0, HlsMaster.equivalentHeight(w.toInt(), h.toInt()))
                }
                "stsd" -> {
                    // version/drapeaux (4), nombre d'entrées (4), puis taille (4) et code de la première entrée.
                    val head = pages.bytes(content.first, 16) ?: return@walk
                    codecs += String(head, 12, 4, Charsets.ISO_8859_1)
                }
            }
        }
        return if (height == null && codecs.isEmpty()) null else Variant(height, codecs)
    }

    private class Box(val type: String, val content: LongRange, val end: Long)

    /** Lecture par pages de 64 Ko gardées en mémoire, [MAX_READS] requêtes au plus. */
    private class Pages(private val read: suspend (Long, Int) -> ByteArray?) {
        private val cache = HashMap<Long, ByteArray>()
        private var reads = 0

        suspend fun bytes(offset: Long, length: Int): ByteArray? {
            val out = ByteArray(length)
            var done = 0
            while (done < length) {
                val pos = offset + done
                val start = pos - pos % PAGE
                val page = cache[start] ?: run {
                    if (++reads > MAX_READS) return null
                    read(start, PAGE)?.also { cache[start] = it } ?: return null
                }
                val i = (pos - start).toInt()
                if (i >= page.size) return null
                val n = minOf(length - done, page.size - i)
                System.arraycopy(page, i, out, done, n)
                done += n
            }
            return out
        }

        suspend fun box(offset: Long): Box? {
            val h = bytes(offset, 8) ?: return null
            var size = u32(h, 0)
            val type = String(h, 4, 4, Charsets.ISO_8859_1)
            var header = 8
            if (size == 1L) {
                val large = bytes(offset + 8, 8) ?: return null
                size = (u32(large, 0) shl 32) or u32(large, 4)
                header = 16
            }
            if (size < header) return null // taille 0 (« jusqu'à la fin ») ou corrompue
            return Box(type, (offset + header) until (offset + size), offset + size)
        }

        /**
         * Parcourt les boîtes de [range], en descendant dans les conteneurs
         * utiles. Après `stsd`, le reste de `stbl` (tables d'index, souvent
         * des centaines de Ko) est sauté : rien d'utile, et autant de lectures.
         */
        suspend fun walk(range: LongRange, visit: suspend (String, LongRange) -> Unit) {
            var offset = range.first
            while (offset + 8 <= range.last + 1) {
                val box = box(offset) ?: return
                if (box.type in CONTAINERS) walk(box.content, visit) else visit(box.type, box.content)
                if (box.type == "stsd") return
                offset = box.end
            }
        }
    }

    private fun u32(b: ByteArray, i: Int): Long =
        ((b[i].toLong() and 0xff) shl 24) or ((b[i + 1].toLong() and 0xff) shl 16) or
            ((b[i + 2].toLong() and 0xff) shl 8) or (b[i + 3].toLong() and 0xff)
}
