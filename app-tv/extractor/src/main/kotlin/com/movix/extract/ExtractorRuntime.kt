package com.movix.extract

import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.function
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.nio.charset.Charset
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Sous-titres rendus par un extracteur (Uqload). */
data class ExtractedSubtitle(val url: String, val label: String, val lang: String, val format: String, val isDefault: Boolean)

/**
 * Résultat d'une extraction. [url] : flux à lire, avec [headers] à poser sur
 * chaque requête du lecteur. [isHls] : `null` si le type est inconnu.
 */
data class Extraction(
    val embedUrl: String,
    val url: String?,
    val headers: Map<String, String> = emptyMap(),
    val isHls: Boolean? = null,
    val subtitles: List<ExtractedSubtitle> = emptyList(),
    val error: String? = null,
    val elapsedMs: Long = 0,
) {
    val ok: Boolean get() = url != null
}

/** Cache du bytecode compilé du userscript (clé : empreinte du script). */
interface BytecodeCache {
    fun load(key: String): ByteArray?
    fun save(key: String, bytes: ByteArray)
}

/**
 * Le userscript Movix dans un QuickJS natif, sans WebView.
 *
 * Boucle d'événements pilotée par Kotlin : minuteurs et requêtes réseau sont
 * des fonctions natives synchrones qui rendent la main tout de suite ; Kotlin
 * rappelle le JS quand c'est prêt (`__movixFireTimer`, `__movixOnResponse`).
 * Aucune évaluation n'attend donc une tâche longue, et un minuteur oublié ou
 * une promesse rejetée sans gestionnaire ne bloque rien.
 *
 * Tout le JS tourne sur un seul fil ; le réseau, sur les fils d'E/S.
 * Le runtime se crée à la première extraction et se ferme après
 * [idleCloseMs] sans usage.
 */
class ExtractorRuntime(
    private val http: HttpBridge,
    private val userscript: () -> String,
    private val userAgent: String,
    private val bytecodeCache: BytecodeCache? = null,
    private val log: (level: String, message: String) -> Unit = { l, m -> println("[$l] $m") },
    private val idleCloseMs: Long = 120_000,
) {
    private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "movix-quickjs").apply { isDaemon = true } }
    private val loop = executor.asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + loop)
    private val startMutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }
    private val random = SecureRandom()

    private var qjs: QuickJs? = null
    private var idleJob: Job? = null
    private val active = AtomicLong(0)
    private val seq = AtomicLong(0)

    private class Timer(val dueNanos: Long, val order: Long, val id: Long)
    private val timerQueue = java.util.PriorityQueue<Timer>(compareBy<Timer>({ it.dueNanos }, { it.order }))
    private var timerJob: Job? = null
    private val timerWake = kotlinx.coroutines.channels.Channel<Unit>(kotlinx.coroutines.channels.Channel.CONFLATED)
    private val requestJobs = ConcurrentHashMap<Long, Job>()
    private val responses = ConcurrentHashMap<Long, Result<BridgeResponse>>()
    private val extractions = ConcurrentHashMap<Long, CompletableDeferred<String>>()
    private val sandboxes = ConcurrentHashMap<Long, QuickJs>()

    /** Chargé et prêt (pour mesurer). */
    val isRunning: Boolean get() = qjs != null

    /** Prépare le runtime à l'avance (appelé dès qu'une extraction est probable). */
    suspend fun warmUp() {
        ensureStarted()
        scheduleIdleClose()
    }

    suspend fun extract(embedUrl: String, timeoutMs: Long = 25_000): Extraction {
        val started = System.currentTimeMillis()
        active.incrementAndGet()
        idleJob?.cancel()
        try {
            val engine = ensureStarted() ?: return Extraction(embedUrl, null, error = "runtime_unavailable")
            val id = seq.incrementAndGet()
            val done = CompletableDeferred<String>()
            extractions[id] = done
            evaluate(engine, "__movixExtract($id, ${JsonPrimitive(embedUrl)})")
            val raw = withTimeoutOrNull(timeoutMs) { done.await() }
            extractions.remove(id)
            val elapsed = System.currentTimeMillis() - started
            return if (raw == null) Extraction(embedUrl, null, error = "timeout", elapsedMs = elapsed)
            else parseExtraction(embedUrl, raw, elapsed)
        } finally {
            if (active.decrementAndGet() == 0L) scheduleIdleClose()
        }
    }

    /**
     * Type d'hébergeur que le userscript reconnaît pour chaque lien (« voe »,
     * « uqload »…), `null` s'il ne sait pas l'extraire : même règle que
     * l'extraction (`detectEmbedType`), sans copie à tenir à jour. Carte vide
     * si le runtime ne démarre pas.
     */
    suspend fun embedTypes(urls: List<String>): Map<String, String?> {
        if (urls.isEmpty()) return emptyMap()
        active.incrementAndGet()
        idleJob?.cancel()
        try {
            val engine = ensureStarted() ?: return emptyMap()
            val arg = JsonArray(urls.map(::JsonPrimitive)).toString()
            val raw = withContext(loop) {
                runCatching {
                    engine.evaluate<String>(
                        "JSON.stringify(($arg).map(function (u) { try { return globalThis.MovixExtractors.detectEmbedType(u) || null } catch (e) { return null } }))",
                        "embed-types.js",
                    )
                }.onFailure { log("warn", "types d'hébergeur illisibles : ${it.message?.take(200)}") }.getOrNull()
            } ?: return emptyMap()
            val types = runCatching { json.parseToJsonElement(raw).jsonArray }.getOrNull() ?: return emptyMap()
            return urls.mapIndexed { i, u -> u to (types.getOrNull(i) as? JsonPrimitive)?.contentOrNull }.toMap()
        } finally {
            if (active.decrementAndGet() == 0L) scheduleIdleClose()
        }
    }

    fun close() {
        runBlocking(loop) { shutdown() }
    }

    // ---------- cycle de vie ----------

    private suspend fun ensureStarted(): QuickJs? = startMutex.withLock {
        qjs?.let { return@withLock it }
        withContext(loop) {
            val t0 = System.currentTimeMillis()
            val engine = runCatching { QuickJs.create(loop) }.getOrElse {
                log("error", "QuickJS indisponible : $it")
                return@withContext null
            }
            engine.memoryLimit = 96L * 1024 * 1024
            engine.maxStackSize = 1024L * 1024
            defineNatives(engine)
            startTimerLoop(engine)
            evaluate(engine, resource("polyfills.js"), "polyfills.js")
            evaluate(engine, resource("host.js"), "host.js")
            loadUserscript(engine)
            val ready = runCatching { engine.evaluate<Boolean>("typeof movixExtractM3u8 === 'function'") }.getOrDefault(false)
            if (!ready) {
                log("error", "userscript non chargé : movixExtractM3u8 absent")
                engine.close()
                return@withContext null
            }
            qjs = engine
            log("info", "runtime prêt en ${System.currentTimeMillis() - t0} ms")
            engine
        }
    }

    private suspend fun loadUserscript(engine: QuickJs) {
        val patched = UserscriptPatcher.apply(userscript())
        if (patched.missing.isNotEmpty()) log("warn", "retouches du userscript introuvables : ${patched.missing}")
        val key = sha256Hex((patched.source + "|" + engine.version).toByteArray())
        val cached = bytecodeCache?.load(key)
        if (cached != null) {
            val ok = runCatching { engine.evaluate<Any?>(cached) }.onFailure { log("warn", "bytecode en cache refusé : $it") }.isSuccess
            if (ok) return
        }
        val bytecode = runCatching { engine.compile(patched.source, "movix.user.js") }.getOrElse {
            log("error", "compilation du userscript : $it")
            return
        }
        bytecodeCache?.runCatching { save(key, bytecode) }
        runCatching { engine.evaluate<Any?>(bytecode) }.onFailure { log("warn", "initialisation du userscript : $it") }
    }

    private fun scheduleIdleClose() {
        idleJob?.cancel()
        idleJob = scope.launch {
            delay(idleCloseMs)
            if (active.get() == 0L) startMutex.withLock { shutdown() }
        }
    }

    private fun shutdown() {
        timerJob?.cancel(); timerJob = null
        synchronized(timerQueue) { timerQueue.clear() }
        requestJobs.values.forEach { it.cancel() }; requestJobs.clear()
        responses.clear()
        sandboxes.values.forEach { runCatching { it.close() } }; sandboxes.clear()
        qjs?.let { runCatching { it.close() } }
        if (qjs != null) log("info", "runtime fermé")
        qjs = null
    }

    /** Évalue sur le fil du JS. Une erreur (promesse rejetée, exception) est journalisée, jamais propagée. */
    private suspend fun evaluate(engine: QuickJs, code: String, filename: String = "host-call.js") {
        withContext(loop) {
            runCatching { engine.evaluate<Any?>(code, filename) }.onFailure { e ->
                if (e !is kotlinx.coroutines.CancellationException) log("debug", "JS ($filename) : ${e.message?.take(300)}")
            }
        }
    }

    /** Réveille la boucle des minuteurs (sans l'interrompre si elle exécute un rappel). */
    private fun wakeTimers() {
        timerWake.trySend(Unit)
    }

    /**
     * Boucle unique des minuteurs : attend la prochaine échéance (ou un
     * réveil quand la file change), puis déclenche dans l'ordre tous les
     * minuteurs échus.
     */
    private fun startTimerLoop(engine: QuickJs) {
        timerJob?.cancel()
        timerJob = scope.launch {
            while (true) {
                val next = synchronized(timerQueue) { timerQueue.peek() }
                if (next == null) { timerWake.receive(); continue }
                val waitMs = (next.dueNanos - System.nanoTime()) / 1_000_000
                if (waitMs > 0) { withTimeoutOrNull(waitMs) { timerWake.receive() }; continue }
                while (true) {
                    val due = synchronized(timerQueue) {
                        timerQueue.peek()?.takeIf { it.dueNanos <= System.nanoTime() }?.also { timerQueue.poll() }
                    } ?: break
                    evaluate(engine, "__movixFireTimer(${due.id})")
                }
            }
        }
    }

    private fun callback(code: String) {
        scope.launch {
            val engine = qjs ?: return@launch
            evaluate(engine, code)
        }
    }

    // ---------- fonctions natives ----------

    private fun defineNatives(q: QuickJs) {
        q.function("__n_log") { a -> log(a[0] as? String ?: "log", a[1] as? String ?: ""); null }
        q.function("__n_userAgent") { userAgent }

        // Minuteurs : une seule file triée par échéance, comme un navigateur
        // (deux minuteurs ne se déclenchent jamais dans le désordre).
        q.function("__n_setTimer") { a ->
            val id = (a[0] as Number).toLong()
            val ms = (a[1] as? Number)?.toLong() ?: 0L
            synchronized(timerQueue) {
                timerQueue.removeIf { it.id == id }
                timerQueue += Timer(System.nanoTime() + ms * 1_000_000, seq.incrementAndGet(), id)
            }
            wakeTimers()
            null
        }
        q.function("__n_clearTimer") { a ->
            val id = (a[0] as Number).toLong()
            synchronized(timerQueue) { timerQueue.removeIf { it.id == id } }
            null
        }

        // Réseau
        q.function("__n_request") { a ->
            val id = (a[0] as Number).toLong()
            val headers = runCatching {
                json.parseToJsonElement(a[3] as String).jsonObject.mapValues { it.value.jsonPrimitive.content }
            }.getOrDefault(emptyMap())
            val body = (a[4] as? String)?.toByteArray() ?: (a[5] as? UByteArray)?.toByteArray()
            val timeout = (a[6] as? Number)?.toLong() ?: 30_000L
            val request = BridgeRequest(a[1] as String, a[2] as String, headers, body, timeout)
            requestJobs[id] = scope.launch(Dispatchers.IO) {
                val result = try {
                    Result.success(withTimeout(timeout) { http.execute(request) })
                } catch (e: TimeoutCancellationException) {
                    Result.failure(RequestTimeout())
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    Result.failure(e)
                }
                requestJobs.remove(id)
                responses[id] = result
                callback("__movixOnResponse($id)")
            }
            null
        }
        q.function("__n_abortRequest") { a -> val id = (a[0] as Number).toLong(); requestJobs.remove(id)?.cancel(); responses.remove(id); null }
        q.function("__n_dropResponse") { a -> responses.remove((a[0] as Number).toLong()); null }
        q.function("__n_responseMeta") { a ->
            val result = responses[(a[0] as Number).toLong()]
            val r = result?.getOrNull()
            if (r == null) {
                val e = result?.exceptionOrNull()
                buildJsonObject {
                    put("error", e?.message ?: e?.javaClass?.simpleName ?: "network_error")
                    put("timeout", e is RequestTimeout)
                }.toString()
            } else {
                val contentType = r.contentType
                buildJsonObject {
                    put("status", r.status)
                    put("statusText", r.statusText)
                    put("headers", r.headers.joinToString("") { "${it.first.lowercase()}: ${it.second}\r\n" })
                    put("finalUrl", r.finalUrl)
                    put("contentType", contentType ?: "")
                    put("charset", contentType?.let { Regex("charset=([\\w-]+)", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1) } ?: "utf-8")
                }.toString()
            }
        }
        q.function("__n_responseBody") { a ->
            val r = responses.remove((a[0] as Number).toLong())?.getOrNull()
            (r?.body ?: ByteArray(0)).toUByteArray()
        }

        // Encodages
        q.function("__n_utf8Encode") { a -> (a[0] as? String ?: "").toByteArray(Charsets.UTF_8).toUByteArray() }
        q.function("__n_textDecode") { a ->
            val bytes = (a[0] as? UByteArray)?.toByteArray() ?: ByteArray(0)
            String(bytes, charsetOf(a[1] as? String))
        }
        q.function("__n_atob") { a -> atob(a[0] as? String ?: "") }
        q.function("__n_btoa") { a -> btoa(a[0] as? String ?: "") }
        q.function("__n_parseUrl") { a -> UrlParts.parse(a[0] as? String ?: "", a[1] as? String) }

        // Hasard et chiffrement
        q.function("__n_randomBytes") { a -> ByteArray(((a[0] as? Number)?.toInt() ?: 0).coerceIn(0, 65536)).also(random::nextBytes).toUByteArray() }
        q.function("__n_randomUUID") { UUID.randomUUID().toString() }
        q.function("__n_digest") { a ->
            val alg = when ((a[0] as? String ?: "").uppercase()) {
                "SHA-1" -> "SHA-1"
                "SHA-384" -> "SHA-384"
                "SHA-512" -> "SHA-512"
                else -> "SHA-256"
            }
            MessageDigest.getInstance(alg).digest((a[1] as? UByteArray)?.toByteArray() ?: ByteArray(0)).toUByteArray()
        }
        q.function("__n_aes") { a ->
            runCatching {
                val encrypt = a[0] as Boolean
                val name = (a[1] as String).uppercase()
                val key = SecretKeySpec((a[2] as UByteArray).toByteArray(), "AES")
                val iv = (a[3] as? UByteArray)?.toByteArray() ?: ByteArray(0)
                val data = (a[4] as UByteArray).toByteArray()
                val mode = if (encrypt) Cipher.ENCRYPT_MODE else Cipher.DECRYPT_MODE
                val cipher = when (name) {
                    "AES-GCM" -> Cipher.getInstance("AES/GCM/NoPadding").apply {
                        init(mode, key, GCMParameterSpec(((a[5] as? Number)?.toInt() ?: 128), iv))
                        (a[6] as? UByteArray)?.takeIf { it.isNotEmpty() }?.let { updateAAD(it.toByteArray()) }
                    }
                    "AES-CTR" -> Cipher.getInstance("AES/CTR/NoPadding").apply { init(mode, key, IvParameterSpec(iv)) }
                    else -> Cipher.getInstance("AES/CBC/PKCS5Padding").apply { init(mode, key, IvParameterSpec(iv)) }
                }
                cipher.doFinal(data).toUByteArray()
            }.getOrElse { log("debug", "aes : $it"); null }
        }

        // Bac à sable QuickJS (Fsvid / Vidzy)
        q.function("__n_sandboxCreate") { a ->
            val id = seq.incrementAndGet()
            val sandbox = QuickJs.create(Dispatchers.Default).apply {
                memoryLimit = ((a[0] as? Number)?.toLong() ?: (32L shl 20)).coerceIn(4L shl 20, 64L shl 20)
                maxStackSize = ((a[1] as? Number)?.toLong() ?: (512L shl 10)).coerceIn(256L shl 10, 2L shl 20)
            }
            sandboxes[id] = sandbox
            id
        }
        q.function("__n_sandboxEval") { a ->
            val sandbox = sandboxes[(a[0] as Number).toLong()]
            val remaining = (a[3] as? Number)?.toLong() ?: 0L
            if (sandbox == null) return@function """{"ok":false,"error":"closed"}"""
            sandbox.evaluationTimeoutMillis = if (remaining > 0) remaining else 1_500
            runCatching {
                runBlocking { sandbox.evaluate<Any?>(a[1] as String, a[2] as? String ?: "eval.js") }
            }.fold(
                onSuccess = { v -> buildJsonObject { put("ok", true); put("value", v?.toString()) }.toString() },
                onFailure = { e -> buildJsonObject { put("ok", false); put("error", e.message ?: "error") }.toString() },
            )
        }
        q.function("__n_sandboxDispose") { a -> sandboxes.remove((a[0] as Number).toLong())?.let { runCatching { it.close() } }; null }

        // Fin d'extraction
        q.function("__n_extractDone") { a ->
            extractions[(a[0] as Number).toLong()]?.complete(a[1] as? String ?: "{}")
            null
        }
    }

    // ---------- utilitaires ----------

    private class RequestTimeout : Exception("timeout")

    private fun resource(name: String): String =
        ExtractorRuntime::class.java.getResourceAsStream("/movix-extract/$name")?.use { it.readBytes().decodeToString() }
            ?: error("ressource absente : $name")

    private fun charsetOf(label: String?): Charset = when (label?.lowercase()?.trim()) {
        null, "", "utf-8", "utf8", "unicode-1-1-utf-8" -> Charsets.UTF_8
        "latin1", "iso-8859-1", "iso8859-1", "us-ascii", "ascii" -> Charsets.ISO_8859_1
        "windows-1252", "cp1252" -> runCatching { Charset.forName("windows-1252") }.getOrDefault(Charsets.ISO_8859_1)
        "utf-16le", "utf-16" -> Charsets.UTF_16LE
        "utf-16be" -> Charsets.UTF_16BE
        else -> runCatching { Charset.forName(label) }.getOrDefault(Charsets.UTF_8)
    }

    private fun atob(input: String): String? {
        val clean = input.filterNot { it == ' ' || it == '\t' || it == '\n' || it == '\r' || it == '\u000c' }.trimEnd('=')
        if (clean.length % 4 == 1) return null
        val padded = clean + "=".repeat((4 - clean.length % 4) % 4)
        val bytes = runCatching { Base64.getDecoder().decode(padded) }.getOrNull() ?: return null
        return String(bytes, Charsets.ISO_8859_1)
    }

    private fun btoa(input: String): String? {
        if (input.any { it.code > 0xFF }) return null
        return Base64.getEncoder().encodeToString(input.toByteArray(Charsets.ISO_8859_1))
    }

    private fun parseExtraction(embedUrl: String, raw: String, elapsed: Long): Extraction {
        val root = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull()
            ?: return Extraction(embedUrl, null, error = "bad_result", elapsedMs = elapsed)
        val result = root["result"] as? JsonObject
        val stream = (root["stream"] as? JsonPrimitive)?.contentOrNull
        val prepared = root["prepared"] as? JsonObject
        if (stream == null) {
            val error = result?.get("error")?.let { (it as? JsonPrimitive)?.contentOrNull ?: it.toString() }
                ?: result?.get("reason")?.let { (it as? JsonPrimitive)?.contentOrNull }
                ?: "no_stream"
            return Extraction(embedUrl, null, error = error, elapsedMs = elapsed)
        }
        val url = (prepared?.get("url") as? JsonPrimitive)?.contentOrNull ?: stream
        val headers = (prepared?.get("headers") as? JsonObject)
            ?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { k to it } }?.toMap().orEmpty()
        val hls = when {
            result?.get("hlsUrl").isPresent() -> true
            url.contains(".m3u8", ignoreCase = true) -> true
            Regex("""\.(mp4|mkv|webm)(\?|$)""", RegexOption.IGNORE_CASE).containsMatchIn(url) -> false
            else -> null
        }
        val subtitles = (result?.get("subtitles") as? JsonArray).orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val subUrl = (o["url"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.startsWith("http") } ?: return@mapNotNull null
            ExtractedSubtitle(
                url = subUrl,
                label = (o["label"] as? JsonPrimitive)?.contentOrNull ?: "",
                lang = (o["lang"] as? JsonPrimitive)?.contentOrNull ?: "",
                format = (o["format"] as? JsonPrimitive)?.contentOrNull ?: "vtt",
                isDefault = (o["default"] as? JsonPrimitive)?.booleanOrNull ?: false,
            )
        }
        return Extraction(embedUrl, url, headers, hls, subtitles, elapsedMs = elapsed)
    }

    private fun JsonElement?.isPresent(): Boolean = this != null && this !is JsonNull && !(this is JsonPrimitive && this.contentOrNull.isNullOrEmpty())

    companion object {
        fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
