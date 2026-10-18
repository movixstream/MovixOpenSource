package com.movix.tv.data.account

import android.util.Log
import com.movix.tv.data.local.LocalStore
import com.movix.tv.data.local.TvKeys
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * Synchronisation télé ↔ site (reprise, historique, Ma liste, épisodes vus).
 *
 * - Chaque écriture locale d'une clé synchronisée entre dans une file
 *   persistante, envoyée par lots 5 s après la dernière écriture, et tout de
 *   suite quand l'appli passe en arrière-plan.
 * - Tirage du profil au démarrage, au retour au premier plan (au plus toutes
 *   les 30 s) et toutes les 5 min : fusion par [SyncMerge].
 * - Un 401 du serveur = session supprimée depuis le site : déconnexion.
 */
class SyncManager(
    private val scope: CoroutineScope,
    private val store: LocalStore,
    private val api: AccountApi,
    private val accounts: AccountManager,
    private val json: Json,
) {
    private val mutex = Mutex()
    private val outbox = LinkedHashSet<String>()
    private var flushJob: Job? = null
    private var periodicJob: Job? = null
    private var lastPullAt = 0L
    private val listSerializer = ListSerializer(String.serializer())

    suspend fun start() {
        store.read(TvKeys.SYNC_OUTBOX)?.let { raw ->
            runCatching { json.decodeFromString(listSerializer, raw) }.getOrNull()?.let { synchronized(outbox) { outbox += it } }
        }
        store.onWrite = { key -> if (accounts.current != null && SyncMerge.isSynced(key)) markDirty(key) }
    }

    /** Première synchro après la liaison : la bibliothèque de la télé est réunie à celle du profil. */
    fun onLinked() {
        scope.launch {
            val local = store.snapshot().keys.filter(SyncMerge::isSynced)
            synchronized(outbox) { outbox += local }
            persistOutbox()
            pull(force = true)
        }
    }

    fun onForeground() {
        if (accounts.current == null) return
        scope.launch { pull(force = false) }
        periodicJob?.cancel()
        periodicJob = scope.launch {
            while (isActive) {
                delay(5 * 60_000L)
                pull(force = true)
            }
        }
    }

    fun onBackground() {
        periodicJob?.cancel()
        flushJob?.cancel()
        scope.launch { flush() }
    }

    private fun markDirty(key: String) {
        val added = synchronized(outbox) { outbox.add(key) }
        if (added) scope.launch { persistOutbox() }
        flushJob?.cancel()
        flushJob = scope.launch {
            delay(5_000)
            flush()
        }
    }

    private suspend fun persistOutbox() {
        val snapshot = synchronized(outbox) { outbox.toList() }
        store.writeAll(mapOf(TvKeys.SYNC_OUTBOX to if (snapshot.isEmpty()) null else json.encodeToString(listSerializer, snapshot)))
    }

    /** Envoie la file : la valeur actuelle de chaque clé (`null` = supprimée). */
    suspend fun flush() = mutex.withLock {
        val account = accounts.current ?: return@withLock
        val keys = synchronized(outbox) { outbox.toList() }
        if (keys.isEmpty()) return@withLock
        val values = store.snapshot()
        val sent = keys.associateWith { values[it] }
        try {
            sent.entries.chunked(100).forEach { chunk ->
                api.sync(account.token, account.userType, account.userId, account.profileId, chunk.map { SyncOp(it.key, it.value) })
            }
            // Une clé réécrite pendant l'envoi reste dans la file.
            val now = store.snapshot()
            synchronized(outbox) { sent.forEach { (k, v) -> if (now[k] == v) outbox.remove(k) } }
            persistOutbox()
        } catch (e: SessionRevokedException) {
            accounts.logout(remote = false)
        } catch (e: Exception) {
            Log.w("MovixSync", "envoi reporté : ${e.message}")
        }
    }

    /**
     * « Qui regarde ? » : la télé passe sur [profile]. Les écritures en attente
     * partent d'abord à l'ancien profil ; puis la bibliothèque de la télé
     * (reprise, Ma liste, vus) est remplacée par celle du nouveau profil, sans
     * fusion : sinon l'historique d'un profil se recopierait dans l'autre.
     *
     * `false` si le serveur ne répond pas (rien n'a changé) ou si la session
     * a été supprimée depuis le site (déconnexion).
     */
    suspend fun switchProfile(profile: LinkedProfile): Boolean {
        val account = accounts.current ?: return false
        if (account.profileId == profile.id) return true
        flush()
        if (accounts.current == null) return false
        // Envoi impossible : on ne jette pas les écritures de l'ancien profil.
        if (synchronized(outbox) { outbox.isNotEmpty() }) return false
        val remote = try {
            api.profileData(account.token, profile.id)
        } catch (e: SessionRevokedException) {
            accounts.logout(remote = false)
            return false
        } catch (e: Exception) {
            Log.w("MovixSync", "changement de profil impossible : ${e.message}")
            return false
        }
        mutex.withLock {
            val local = store.snapshot()
            val cleared = local.keys.filter(SyncMerge::isSynced).associateWith<String, String?> { null }
            store.writeAll(cleared + remote.filterKeys(SyncMerge::isSynced))
            synchronized(outbox) { outbox.clear() }
            persistOutbox()
            accounts.useProfile(profile)
            lastPullAt = System.currentTimeMillis()
        }
        accounts.importProfileVip(remote["access_code"])
        Log.i("MovixSync", "profil changé : ${remote.count { SyncMerge.isSynced(it.key) }} clé(s) reçue(s)")
        return true
    }

    /** Tire le profil du serveur et fusionne. */
    suspend fun pull(force: Boolean) {
        val account = accounts.current ?: return
        val now = System.currentTimeMillis()
        if (!force && now - lastPullAt < 30_000) return
        lastPullAt = now
        val remote = try {
            api.profileData(account.token, account.profileId)
        } catch (e: SessionRevokedException) {
            accounts.logout(remote = false)
            return
        } catch (e: Exception) {
            Log.w("MovixSync", "tirage reporté : ${e.message}")
            return
        }
        mutex.withLock {
            // Profil changé pendant le tirage : ces données sont celles de l'ancien.
            if (accounts.current?.profileId != account.profileId) return
            val pending = synchronized(outbox) { outbox.toSet() }
            val result = SyncMerge.merge(store.snapshot(), remote, pending)
            store.writeAll(result.applyLocal)
            synchronized(outbox) { outbox += result.push }
            persistOutbox()
            Log.i("MovixSync", "profil fusionné : ${result.applyLocal.size} reçue(s), ${result.push.size} à envoyer")
        }
        flush()
    }
}
