package com.movix.tv.adblock

import android.content.Context
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicLong

/**
 * Bloqueur du lecteur web : moteur adblock-rust chargé depuis les assets
 * (`adblock/engine.dat` et `adblock/resources.json`).
 *
 * - Chargement paresseux : au premier [ready], sur [Dispatchers.IO], une
 *   seule fois ; le moteur reste ensuite en mémoire tant que l'appli vit
 *   (jamais au démarrage de l'appli).
 * - Tant que le moteur n'est pas prêt (ou si le chargement a échoué),
 *   [check] laisse tout passer et [cosmetic] renvoie `null`.
 * - Appels thread-safe : le moteur natif est en lecture seule après sa
 *   création, les fils réseau de la WebView peuvent l'interroger en parallèle.
 */
object AdblockEngine {
    private const val TAG = "MovixAdblock"
    private const val ENGINE_ASSET = "adblock/engine.dat"
    private const val RESOURCES_ASSET = "adblock/resources.json"
    /** Un résumé du temps de `check` dans le journal tous les N appels. */
    private const val STATS_EVERY = 500L

    @Volatile
    private var handle = 0L
    @Volatile
    private var failed = false
    private val loadLock = Mutex()

    private val checkCount = AtomicLong()
    private val checkNanos = AtomicLong()

    /** Moteur chargé et utilisable. */
    val isReady: Boolean get() = handle != 0L

    /**
     * Charge le moteur si besoin (une seule fois, même en appels concurrents).
     * Renvoie `true` si le bloqueur est actif. Un échec n'est pas retenté :
     * le lecteur web marche alors sans bloqueur.
     */
    suspend fun ready(context: Context): Boolean {
        if (handle != 0L) return true
        if (failed) return false
        val app = context.applicationContext
        return loadLock.withLock {
            if (handle != 0L) return@withLock true
            if (failed) return@withLock false
            withContext(Dispatchers.IO) {
                val start = SystemClock.elapsedRealtime()
                val created = runCatching {
                    val engine = app.assets.open(ENGINE_ASSET).use { it.readBytes() }
                    val resources = app.assets.open(RESOURCES_ASSET).use { it.readBytes().decodeToString() }
                    AdblockNative.create(engine, resources)
                }.onFailure { Log.w(TAG, "chargement du bloqueur impossible", it) }.getOrDefault(0L)
                if (created == 0L) {
                    failed = true
                    Log.w(TAG, "bloqueur inactif (moteur non chargé)")
                    false
                } else {
                    handle = created
                    Log.i(TAG, "bloqueur prêt en ${SystemClock.elapsedRealtime() - start} ms")
                    true
                }
            }
        }
    }

    /**
     * Sort d'une requête : `null` = laisser passer (ou moteur pas prêt),
     * `""` = bloquer, sinon URL `data:` de la ressource de remplacement.
     * [type] : `document`, `subdocument`, `script`, `stylesheet`, `image`,
     * `media`, `font`, `xmlhttprequest`, `websocket`, `other`.
     */
    fun check(url: String, sourceUrl: String, type: String): String? {
        val h = handle
        if (h == 0L) return null
        val start = System.nanoTime()
        val verdict = runCatching { AdblockNative.check(h, url, sourceUrl, type) }.getOrNull()
        val total = checkNanos.addAndGet(System.nanoTime() - start)
        val count = checkCount.incrementAndGet()
        if (count % STATS_EVERY == 0L) {
            Log.i(TAG, "check : %.3f ms en moyenne sur %d appels".format(total / 1e6 / count, count))
        }
        return verdict
    }

    /**
     * JSON cosmétique de la page/frame [url] (voir [AdblockNative.cosmetic]),
     * ou `null` si le moteur n'est pas prêt.
     */
    fun cosmetic(url: String): String? {
        val h = handle
        if (h == 0L) return null
        return runCatching { AdblockNative.cosmetic(h, url) }.getOrNull()
    }

    /**
     * Sélecteurs génériques à cacher pour ces classes et ids. [exceptions] :
     * le tableau `exceptions` du JSON de [cosmetic] pour la même frame.
     */
    fun hiddenSelectors(
        classes: Array<String>,
        ids: Array<String>,
        exceptions: Array<String> = emptyArray(),
    ): Array<String> {
        val h = handle
        if (h == 0L || (classes.isEmpty() && ids.isEmpty())) return emptyArray()
        // Le natif peut renvoyer null si la JVM manque de mémoire.
        @Suppress("USELESS_ELVIS")
        return runCatching { AdblockNative.hiddenSelectors(h, classes, ids, exceptions) ?: emptyArray() }
            .getOrDefault(emptyArray())
    }
}
