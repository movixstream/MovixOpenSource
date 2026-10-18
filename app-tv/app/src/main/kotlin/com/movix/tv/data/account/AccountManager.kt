package com.movix.tv.data.account

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Base64
import com.movix.tv.data.local.LocalStore
import com.movix.tv.data.local.TvKeys
import com.movix.tv.data.movix.VipManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import java.util.UUID

/** Compte relié à la télé : jeton de session Movix (session « tv ») et profil choisi sur le site. */
@Serializable
data class Account(
    val token: String,
    val userType: String,
    val userId: String,
    val profileId: String,
    val profileName: String,
    val avatar: String? = null,
    val sessionId: String? = null,
)

class AccountManager(
    private val context: Context,
    private val store: LocalStore,
    private val api: AccountApi,
    private val vip: VipManager,
    private val json: Json,
) {
    private val _state = MutableStateFlow<Account?>(null)
    val state: StateFlow<Account?> = _state.asStateFlow()
    val current: Account? get() = _state.value

    suspend fun restore() {
        _state.value = store.read(TvKeys.ACCOUNT)?.let { runCatching { json.decodeFromString(Account.serializer(), it) }.getOrNull() }
    }

    /** Identifiant stable de la télé (réutilisé à chaque liaison : une seule session par télé sur le site). */
    suspend fun clientId(): String =
        store.read(TvKeys.CLIENT_ID) ?: UUID.randomUUID().toString().also { store.writeAll(mapOf(TvKeys.CLIENT_ID to it)) }

    /** Nom affiché sur le site (« Connecter Fire TV ? »). */
    fun deviceName(): String {
        val named = runCatching { Settings.Global.getString(context.contentResolver, "device_name") }.getOrNull()
        val model = Build.MODEL.orEmpty()
        val name = when {
            !named.isNullOrBlank() -> named
            model.startsWith("AFT") -> "Fire TV"
            model.isNotBlank() -> model
            else -> "Télé Android"
        }
        return name.take(40)
    }

    /** Liaison réussie : enregistre le compte et importe la clé VIP du profil (revérifiée). */
    suspend fun onLinked(poll: LinkPoll): Account? {
        val token = poll.token ?: return null
        val account = Account(
            token = token,
            userType = poll.userType ?: return null,
            userId = poll.userId ?: return null,
            profileId = poll.profileId ?: poll.profile?.id ?: return null,
            profileName = poll.profile?.name.orEmpty(),
            avatar = poll.profile?.avatar,
            sessionId = sessionIdOf(token),
        )
        store.writeAll(mapOf(TvKeys.ACCOUNT to json.encodeToString(Account.serializer(), account), PROFILES_CACHE to null))
        _state.value = account
        poll.vip?.accessKey?.takeIf { poll.vip.active && it.isNotBlank() }?.let { runCatching { vip.submit(it) } }
        return account
    }

    /**
     * Profils du compte, lus sur le serveur puis gardés sur la télé : « Qui
     * regarde ? » s'affiche au lancement sans attendre le réseau. Session
     * supprimée depuis le site : déconnexion et liste vide. Autre erreur : levée.
     */
    suspend fun profiles(): List<LinkedProfile> {
        val account = current ?: return emptyList()
        val list = try {
            api.profiles(account.token)
        } catch (e: SessionRevokedException) {
            logout(remote = false)
            return emptyList()
        }
        store.writeAll(mapOf(PROFILES_CACHE to json.encodeToString(profileList, list)))
        return list
    }

    /** Derniers profils connus (vide sans compte ou avant le premier appel). */
    suspend fun cachedProfiles(): List<LinkedProfile> {
        if (current == null) return emptyList()
        return store.read(PROFILES_CACHE)?.let { runCatching { json.decodeFromString(profileList, it) }.getOrNull() }.orEmpty()
    }

    /**
     * Bascule le compte sur [profile] (même jeton : le serveur vérifie à chaque
     * appel que le profil appartient au compte). La bibliothèque est échangée
     * par [SyncManager.switchProfile], qui appelle cette fonction.
     */
    internal suspend fun useProfile(profile: LinkedProfile) {
        val account = current ?: return
        val next = account.copy(profileId = profile.id, profileName = profile.name, avatar = profile.avatar)
        store.writeAll(mapOf(TvKeys.ACCOUNT to json.encodeToString(Account.serializer(), next)))
        _state.value = next
    }

    /**
     * Clé VIP rangée dans le profil choisi (`access_code`, comme à la liaison) :
     * importée seulement si la télé n'est pas déjà VIP ; revérifiée par le serveur.
     */
    internal suspend fun importProfileVip(raw: String?) {
        val key = raw?.trim()?.removeSurrounding("\"")?.trim()?.takeIf { it.isNotEmpty() } ?: return
        if (vip.state.value.vip) return
        runCatching { vip.submit(key) }
    }

    /**
     * Déconnexion. [remote] : supprime aussi la session côté serveur (bouton
     * « Se déconnecter ») ; sinon la session est déjà morte (supprimée sur le site).
     * La bibliothèque locale (reprise, liste) reste sur la télé.
     */
    suspend fun logout(remote: Boolean) {
        val account = current ?: return
        if (remote) account.sessionId?.let { api.deleteSession(account.token, it) }
        store.writeAll(mapOf(TvKeys.ACCOUNT to null, TvKeys.SYNC_OUTBOX to null, PROFILES_CACHE to null))
        _state.value = null
    }

    private val profileList = ListSerializer(LinkedProfile.serializer())

    companion object {
        /** Profils du compte relié (JSON), pour « Qui regarde ? ». Jamais synchronisé. */
        const val PROFILES_CACHE = "movix_tv_profiles"

        /** `sessionId` de la charge utile du JWT (sans vérifier la signature : seul le serveur le fait). */
        fun sessionIdOf(token: String): String? = runCatching {
            val payload = token.split('.')[1]
            val bytes = Base64.decode(payload, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
            (Json.parseToJsonElement(String(bytes)).jsonObject["sessionId"] as? JsonPrimitive)?.contentOrNull
        }.getOrNull()
    }
}
