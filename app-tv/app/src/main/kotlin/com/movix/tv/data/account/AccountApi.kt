package com.movix.tv.data.account

import com.movix.tv.data.age.AgeRules
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/** La session de la télé n'existe plus (supprimée depuis le site) : il faut se reconnecter. */
class SessionRevokedException : IOException("session révoquée")

@Serializable
data class LinkStart(
    val deviceCode: String,
    val userCode: String,
    val verificationUrl: String,
    val expiresIn: Int = 600,
    val interval: Int = 5,
)

/**
 * Profil du compte. `ageRestriction` : 0 ou absent = aucune restriction, sinon
 * 7, 12, 16 ou 18 (profil enfant). Lu sans faire échouer la réponse (voir
 * [AgeRestrictionSerializer]).
 */
@Serializable
data class LinkedProfile(
    val id: String,
    val name: String = "",
    val avatar: String? = null,
    @Serializable(with = AgeRestrictionSerializer::class) val ageRestriction: Int? = null,
)

/**
 * `ageRestriction` lu tel que le site le range : un nombre, parfois écrit en
 * chaîne (« 12 ») ou en décimal (12.0). Une valeur illisible ne fait pas
 * échouer toute la réponse (la liaison serait perdue) et ne vaut jamais
 * « aucune restriction » : elle prend la plus stricte du site.
 */
internal object AgeRestrictionSerializer : KSerializer<Int> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("AgeRestriction", PrimitiveKind.INT)

    override fun deserialize(decoder: Decoder): Int {
        val element = (decoder as? JsonDecoder)?.decodeJsonElement() ?: return decoder.decodeInt()
        val primitive = element as? JsonPrimitive ?: return AgeRules.UNREADABLE_LIMIT
        val number = if (primitive.isString) primitive.content.trim().toDoubleOrNull() else primitive.doubleOrNull
        return number?.takeIf { !it.isNaN() && !it.isInfinite() }?.toInt() ?: AgeRules.UNREADABLE_LIMIT
    }

    override fun serialize(encoder: Encoder, value: Int) = encoder.encodeInt(value)
}

@Serializable
internal data class ProfilesResponse(val profiles: List<LinkedProfile> = emptyList())

/**
 * `expiresAt` : date ISO, ou nombre (millisecondes) sur un serveur plus ancien.
 * Un `String` strict faisait échouer toute la lecture de `/poll` pour un compte
 * VIP, et la réponse « approved » n'est remise qu'une fois : liaison perdue.
 */
@Serializable
data class LinkedVip(val active: Boolean = false, val expiresAt: JsonElement? = null, val accessKey: String? = null)

@Serializable
data class LinkPoll(
    val status: String,
    val token: String? = null,
    val userType: String? = null,
    val userId: String? = null,
    val profileId: String? = null,
    val profile: LinkedProfile? = null,
    val vip: LinkedVip? = null,
)

/** Opération de `/api/sync` : `set` d'une valeur (chaîne JSON) ou `remove`. */
data class SyncOp(val key: String, val value: String?)

/**
 * Liaison de la télé au compte (code à 5 caractères) et synchronisation.
 * Contrat : `app-tv/docs/plans/2026-10-15-phase4-liaison-compte.md`.
 * Jamais d'`Origin` ni de `Referer` vers la Main API.
 */
class AccountApi(private val client: OkHttpClient, private val json: Json, private val baseUrl: HttpUrl) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun start(deviceName: String, clientId: String): LinkStart = post(
        "api/tv/link/start",
        buildJsonObject { put("deviceName", deviceName); put("clientId", clientId) },
        token = null,
    ) { json.decodeFromString(LinkStart.serializer(), it) }

    suspend fun poll(deviceCode: String): LinkPoll = post(
        "api/tv/link/poll",
        buildJsonObject { put("deviceCode", deviceCode) },
        token = null,
    ) { json.decodeFromString(LinkPoll.serializer(), it) }

    /**
     * Profils du compte (`GET /api/profiles`, le même appel que la page
     * « Qui regarde ? » du site) : `{ success, profiles: [{ id, name, avatar, ageRestriction, … }] }`.
     */
    suspend fun profiles(token: String): List<LinkedProfile> = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url("api/profiles")).header("Authorization", "Bearer $token").build()
        client.newCall(req).execute().use { res ->
            if (res.code == 401) throw SessionRevokedException()
            if (!res.isSuccessful) throw IOException("profiles ${res.code}")
            json.decodeFromString(ProfilesResponse.serializer(), res.body.string()).profiles.filter { it.id.isNotBlank() }
        }
    }

    /** Données du profil (clés du site → valeurs en chaîne). */
    suspend fun profileData(token: String, profileId: String): Map<String, String> = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url("api/profiles/$profileId/data")).header("Authorization", "Bearer $token").build()
        client.newCall(req).execute().use { res ->
            if (res.code == 401) throw SessionRevokedException()
            if (!res.isSuccessful) throw IOException("profile data ${res.code}")
            val root = json.parseToJsonElement(res.body.string()) as? JsonObject ?: return@use emptyMap()
            val data = root["data"] as? JsonObject ?: return@use emptyMap()
            data.mapNotNull { (k, v) -> v.asStoredString()?.let { k to it } }.toMap()
        }
    }

    suspend fun sync(token: String, userType: String, userId: String, profileId: String, ops: List<SyncOp>) {
        if (ops.isEmpty()) return
        val body = buildJsonObject {
            put("userType", userType)
            put("userId", userId)
            put("profileId", profileId)
            put("ops", buildJsonArray {
                ops.forEach { op ->
                    add(buildJsonObject {
                        put("op", if (op.value == null) "remove" else "set")
                        put("key", op.key)
                        if (op.value != null) put("value", op.value)
                    })
                }
            })
        }
        post("api/sync", body, token) { }
    }

    /** Supprime la session de la télé côté serveur (« Se déconnecter »). */
    suspend fun deleteSession(token: String, sessionId: String) {
        runCatching { post("api/sessions/delete", buildJsonObject { put("sessionId", sessionId) }, token) { } }
    }

    private suspend fun <T> post(path: String, body: JsonObject, token: String?, parse: (String) -> T): T = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url(path)).post(body.toString().toRequestBody(jsonType))
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .build()
        client.newCall(req).execute().use { res ->
            if (res.code == 401 && token != null) throw SessionRevokedException()
            if (!res.isSuccessful) throw IOException("$path ${res.code}")
            parse(res.body.string())
        }
    }

    private fun url(path: String): HttpUrl = baseUrl.newBuilder().addPathSegments(path.trimStart('/')).build()

    /** Le site range des chaînes ; on accepte aussi un objet ou un tableau (rendu en JSON). */
    private fun JsonElement.asStoredString(): String? = when (this) {
        is JsonPrimitive -> if (isString) content else contentOrNull
        is JsonObject, is JsonArray -> toString()
    }
}
