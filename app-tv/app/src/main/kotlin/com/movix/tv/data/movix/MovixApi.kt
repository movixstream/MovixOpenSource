package com.movix.tv.data.movix

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

class SourceBody(val body: String, val pending: Boolean)

/** Réponse HTTP qui n'est ni un succès ni une absence connue (404/502). */
class MovixHttpException(val code: Int, message: String) : IOException(message)

@Serializable
data class VipCheck(
    val vip: Boolean = false,
    val expiresAt: JsonElement? = null,
    val duration: JsonElement? = null,
    val reason: String? = null,
) {
    /** `expiresAt` est une date ISO ou `null` (clé à vie) selon la base. */
    val expiresAtText: String? get() = (expiresAt as? JsonPrimitive)?.contentOrNull
}

/**
 * Client de la Main API Movix. **Jamais d'en-tête `Origin` ni `Referer`** :
 * `middleware/security.js` répond alors 404 ou une fausse réponse. OkHttp n'en
 * pose aucun de lui-même ; ne pas en ajouter.
 */
class MovixApi(
    private val client: OkHttpClient,
    private val json: Json,
    val baseUrl: HttpUrl = "https://api.movix.men/".toHttpUrl(),
) {
    // Les routes de sources résolvent les lecteurs côté serveur : jusqu'à 25 s
    // sur une source lente, mesuré sur le site. Le client partagé lit en 20 s.
    private val slowClient: OkHttpClient by lazy {
        client.newBuilder().readTimeout(30, TimeUnit.SECONDS).callTimeout(35, TimeUnit.SECONDS).build()
    }

    /** Lève une exception sur erreur réseau ou HTTP ≥ 500 : l'appelant garde alors l'état connu. */
    suspend fun checkVip(key: String): VipCheck = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url("api/check-vip")).header("x-access-key", key).build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw MovixHttpException(res.code, "check-vip ${res.code}")
            json.decodeFromString(VipCheck.serializer(), res.body.string())
        }
    }

    /**
     * Réponse d'une route de source : `null` si la source est absente (404,
     * 502, 204), [SourceBody.pending] si le serveur prépare encore la réponse
     * (202). Les autres erreurs remontent.
     *
     * [resolve] ajoute `?resolve=1` : le serveur extrait les flux pour un VIP.
     * [vipKey] part en `x-access-key` (PurStream et KissKH s'en servent sans resolve).
     */
    suspend fun getSource(path: String, query: Map<String, String>, vipKey: String?, resolve: Boolean): SourceBody? =
        withContext(Dispatchers.IO) {
            val u = url(path).newBuilder().apply {
                query.forEach { (k, v) -> addQueryParameter(k, v) }
                if (resolve && vipKey != null) addQueryParameter("resolve", "1")
            }.build()
            val req = Request.Builder().url(u).apply { if (vipKey != null) header("x-access-key", vipKey) }.build()
            slowClient.newCall(req).execute().use { res ->
                when {
                    res.code == 404 || res.code == 502 || res.code == 204 -> null
                    res.code == 202 -> SourceBody("", pending = true)
                    !res.isSuccessful -> throw MovixHttpException(res.code, "$path ${res.code}")
                    else -> SourceBody(res.body.string(), pending = false)
                }
            }
        }

    /** Segments (intro, générique) d'un titre, ou `null` s'il n'y en a pas. */
    suspend fun segments(type: String, tmdbId: Int, durationSec: Int, season: Int?, episode: Int?): String? =
        withContext(Dispatchers.IO) {
            val u = url("api/segments/$type/$tmdbId").newBuilder().apply {
                addQueryParameter("duration", durationSec.toString())
                if (season != null) addQueryParameter("season", season.toString())
                if (episode != null) addQueryParameter("episode", episode.toString())
            }.build()
            client.newCall(Request.Builder().url(u).build()).execute().use { res ->
                if (res.isSuccessful) res.body.string() else null
            }
        }

    private fun url(path: String): HttpUrl = baseUrl.newBuilder().addPathSegments(path.trimStart('/')).build()
}
