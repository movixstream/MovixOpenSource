package com.movix.tv.data.age

import com.movix.tv.data.tmdb.MediaType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.File

/** Titre à classer. [adult] : drapeau de TMDB, quand la liste le donne (18 ans d'office). */
data class TitleRef(val type: MediaType, val id: Int, val adult: Boolean = false) {
    val key: String get() = "${type.path}:$id"
}

/** Résultat de la vérification d'un titre. */
sealed interface AgeCheck {
    /** Classification lue ; [age] `null` : TMDB n'en a aucune que l'on sache lire. */
    data class Known(val age: Int?) : AgeCheck

    /** TMDB injoignable : rien n'est gardé, la prochaine demande réessaie. */
    data object Unreachable : AgeCheck
}

/**
 * Âges des titres pour les profils enfant, demandés à TMDB un titre à la fois
 * (`release_dates`, `content_ratings`) comme le fait le site.
 *
 * - Gardés en mémoire et sur disque ([file]) : un âge vérifié sert 30 jours,
 *   « aucune classification » un jour seulement (TMDB finit souvent par en avoir une).
 * - Une seule requête par titre, même demandé par plusieurs listes à la fois,
 *   et [parallel] requêtes en même temps au plus (boîtiers lents).
 * - Un échec réseau n'est pas gardé.
 *
 * Rien n'est demandé tant qu'aucun profil limité ne regarde : [keepAllowed]
 * rend la liste telle quelle sans restriction.
 */
class ContentAges(
    /** Âge vérifié du titre (`null` : pas de classification) ; lève une exception si TMDB ne répond pas. */
    private val fetch: suspend (MediaType, Int) -> Int?,
    private val file: File?,
    /** Portée des requêtes partagées et de l'écriture sur disque (celle de l'appli). */
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
    parallel: Int = MAX_PARALLEL,
) {
    private class Entry(val age: Int?, val at: Long)

    private val lock = Any()
    private val memory = HashMap<String, Entry>()
    private val inFlight = HashMap<String, Deferred<AgeCheck>>()
    private val permits = Semaphore(parallel)
    private val loadMutex = Mutex()
    private val saveMutex = Mutex()
    @Volatile private var loaded = file == null
    // Âges demandés à TMDB depuis la dernière écriture.
    @Volatile private var dirty = false
    private var saveJob: Job? = null

    /** Âge de [type] [id] : cache, sinon TMDB. */
    suspend fun age(type: MediaType, id: Int): AgeCheck {
        ensureLoaded()
        val key = "${type.path}:$id"
        val job = synchronized(lock) {
            fresh(key)?.let { return AgeCheck.Known(it.age) }
            inFlight[key] ?: scope.async(start = CoroutineStart.LAZY) { request(key, type, id) }.also { inFlight[key] = it }
        }
        return job.await()
    }

    /**
     * Âge lu ailleurs (fiche complète, qui porte déjà les classifications) :
     * gardé en mémoire sans requête ni écriture (rien à payer sans profil limité),
     * puis sur disque avec la prochaine écriture.
     */
    fun learn(type: MediaType, id: Int, age: Int?) {
        synchronized(lock) { memory["${type.path}:$id"] = Entry(age, now()) }
    }

    /**
     * Les éléments de [items] visibles pour la restriction [limit], dans leur
     * ordre. Sans restriction : [items] tel quel, sans requête. Un titre dont
     * l'âge n'a pas pu être vérifié compte comme non classé (caché pour un mineur).
     */
    suspend fun <T> keepAllowed(items: List<T>, limit: Int, ref: (T) -> TitleRef): List<T> {
        if (limit <= 0 || items.isEmpty()) return items
        ensureLoaded()
        val refs = items.map(ref)
        val ages: Map<String, Int?> = coroutineScope {
            refs.filter { !it.adult }.distinctBy { it.key }
                .map { r -> async { r.key to (age(r.type, r.id) as? AgeCheck.Known)?.age } }
                .awaitAll().toMap()
        }
        return items.filterIndexed { i, _ ->
            val r = refs[i]
            AgeRules.allows(limit, if (r.adult) ADULT_AGE else ages[r.key])
        }
    }

    /** Écrit le cache sur disque s'il a changé (aussi fait tout seul quelques secondes après un nouvel âge). */
    suspend fun save() {
        synchronized(lock) {
            saveJob?.cancel()
            saveJob = null
        }
        write()
    }

    private suspend fun write() {
        val target = file ?: return
        if (!dirty) return
        // Jamais un fichier écrit sans les âges déjà sur le disque.
        ensureLoaded()
        val text = synchronized(lock) {
            dirty = false
            encode(memory.mapValues { (_, e) -> e.age to e.at })
        }
        saveMutex.withLock {
            withContext(Dispatchers.IO) {
                runCatching {
                    target.parentFile?.mkdirs()
                    val tmp = File(target.parentFile, target.name + ".tmp")
                    tmp.writeText(text)
                    // Remplacement d'un bloc (Linux) ; ailleurs, l'ancien fichier est d'abord retiré.
                    if (!tmp.renameTo(target)) {
                        target.delete()
                        tmp.renameTo(target)
                    }
                }.onFailure { android.util.Log.w("MovixAge", "cache des âges non écrit : $it") }
            }
        }
    }

    private suspend fun request(key: String, type: MediaType, id: Int): AgeCheck = try {
        val age = permits.withPermit { fetch(type, id) }
        put(key, age)
        AgeCheck.Known(age)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        android.util.Log.w("MovixAge", "âge de $key non vérifié : $e")
        AgeCheck.Unreachable
    } finally {
        synchronized(lock) { inFlight.remove(key) }
    }

    private fun put(key: String, age: Int?) {
        synchronized(lock) {
            memory[key] = Entry(age, now())
            if (file == null) return
            dirty = true
            saveJob?.cancel()
            saveJob = scope.launch {
                delay(SAVE_DELAY_MS)
                write()
            }
        }
    }

    /** Entrée encore valable (appelé sous [lock]). */
    private fun fresh(key: String): Entry? {
        val e = memory[key] ?: return null
        return if (isFresh(e.age, e.at, now())) e else null
    }

    private suspend fun ensureLoaded() {
        if (loaded) return
        loadMutex.withLock {
            if (loaded) return
            val text = withContext(Dispatchers.IO) { runCatching { file?.takeIf { it.isFile }?.readText() }.getOrNull() }
            val read = text?.let { decode(it, now()) }.orEmpty()
            // Un âge appris pendant la lecture (fiche ouverte au lancement) est plus récent : il reste.
            synchronized(lock) { read.forEach { (k, v) -> if (k !in memory) memory[k] = Entry(v.first, v.second) } }
            loaded = true
        }
    }

    companion object {
        const val MAX_PARALLEL = 6
        const val VERIFIED_TTL_MS = 30L * 24 * 3_600_000
        const val UNKNOWN_TTL_MS = 24L * 3_600_000
        /** Titres gardés sur disque au plus (les plus récents) : quelques centaines de Ko. */
        const val MAX_SAVED = 5_000
        private const val SAVE_DELAY_MS = 3_000L
        private const val ADULT_AGE = 18
        private const val HEADER = "v1"
        private val KEY = Regex("""^(movie|tv):\d+$""")

        fun isFresh(age: Int?, at: Long, now: Long): Boolean =
            now - at < if (age == null) UNKNOWN_TTL_MS else VERIFIED_TTL_MS

        /** Une ligne par titre : `movie:603 12 1731600000000` (`-` : sans classification). */
        internal fun encode(entries: Map<String, Pair<Int?, Long>>): String = buildString {
            append(HEADER).append('\n')
            entries.entries.sortedByDescending { it.value.second }.take(MAX_SAVED).forEach { (k, v) ->
                append(k).append(' ').append(v.first?.toString() ?: "-").append(' ').append(v.second).append('\n')
            }
        }

        /** Lecture tolérante : lignes abîmées et âges périmés ignorés, fichier d'un autre format ignoré. */
        internal fun decode(text: String, now: Long): Map<String, Pair<Int?, Long>> {
            val lines = text.lineSequence().iterator()
            if (!lines.hasNext() || lines.next().trim() != HEADER) return emptyMap()
            val out = HashMap<String, Pair<Int?, Long>>()
            for (line in lines) {
                val parts = line.trim().split(' ')
                if (parts.size != 3 || !KEY.matches(parts[0])) continue
                val age = if (parts[1] == "-") null else parts[1].toIntOrNull() ?: continue
                val at = parts[2].toLongOrNull() ?: continue
                if (isFresh(age, at, now)) out[parts[0]] = age to at
            }
            return out
        }
    }
}
