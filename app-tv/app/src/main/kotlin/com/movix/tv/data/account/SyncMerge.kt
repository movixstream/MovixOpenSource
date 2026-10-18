package com.movix.tv.data.account

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/**
 * Fusion entre la bibliothèque de la télé et le profil du serveur. Fonctions
 * pures (testées sans Android).
 *
 * - `progress_*` : le `timestamp` le plus récent gagne, dans les deux sens.
 * - Autres clés : le serveur gagne (comme le site), sauf si la télé a une
 *   écriture en attente sur la clé ([pending]) : on fusionne alors les deux
 *   (listes réunies par identifiant, objets réunis, la télé prioritaire) et on
 *   renvoie le résultat au serveur.
 */
object SyncMerge {
    private val SYNCED = listOf(
        Regex("^progress_\\d+$"),
        Regex("^progress_tv_\\d+_s\\d+_e\\d+$"),
        Regex("^continueWatching$"),
        Regex("^watchlist_(movie|tv)$"),
        Regex("^watched_(movie|tv)$"),
        Regex("^watched_episodes_tv_\\d+$"),
    )

    fun isSynced(key: String): Boolean = SYNCED.any { it.matches(key) }

    private fun isProgress(key: String) = key.startsWith("progress_")

    /**
     * [applyLocal] : valeurs à écrire sur la télé (`null` = supprimer).
     * [push] : clés dont la valeur (après [applyLocal]) doit partir au serveur.
     */
    data class Result(val applyLocal: Map<String, String?>, val push: Set<String>)

    private val json = Json { ignoreUnknownKeys = true }

    fun merge(local: Map<String, String>, remote: Map<String, String>, pending: Set<String>): Result {
        val apply = LinkedHashMap<String, String?>()
        val push = LinkedHashSet<String>()
        val keys = (local.keys + remote.keys).filter(::isSynced).toSortedSet()
        for (key in keys) {
            val l = local[key]
            val r = remote[key]
            if (l == r) continue
            if (isProgress(key)) {
                when {
                    r == null -> push += key
                    l == null -> apply[key] = r
                    timestampOf(r) > timestampOf(l) -> apply[key] = r
                    else -> push += key
                }
                continue
            }
            if (key in pending) {
                val merged = if (l != null && r != null) union(l, r) else l
                if (merged != l) apply[key] = merged
                push += key
            } else {
                apply[key] = r
            }
        }
        return Result(apply, push)
    }

    private fun timestampOf(raw: String): String =
        runCatching { (json.parseToJsonElement(raw).jsonObject["timestamp"] as? JsonPrimitive)?.contentOrNull }.getOrNull() ?: ""

    /**
     * Réunit deux valeurs JSON : tableaux réunis par identité (`id` + `type`,
     * puis `season`/`episode`), la version de la télé prioritaire ; objets
     * réunis clé par clé. Autre forme : la valeur de la télé.
     */
    fun union(localRaw: String, remoteRaw: String): String {
        val l = runCatching { json.parseToJsonElement(localRaw) }.getOrNull() ?: return localRaw
        val r = runCatching { json.parseToJsonElement(remoteRaw) }.getOrNull() ?: return localRaw
        return when {
            l is JsonArray && r is JsonArray -> {
                val seen = HashSet<String>()
                val out = ArrayList<JsonElement>()
                (l + r).forEach { e -> if (seen.add(identity(e))) out += e }
                JsonArray(out).toString()
            }
            l is JsonObject && r is JsonObject -> JsonObject(r + l).toString()
            else -> localRaw
        }
    }

    private fun identity(e: JsonElement): String {
        val o = e as? JsonObject ?: return e.toString()
        fun f(name: String) = (o[name] as? JsonPrimitive)?.contentOrNull ?: ""
        return listOf(f("id"), f("type"), f("season"), f("episode")).joinToString("|").takeIf { it != "|||" } ?: e.toString()
    }
}
