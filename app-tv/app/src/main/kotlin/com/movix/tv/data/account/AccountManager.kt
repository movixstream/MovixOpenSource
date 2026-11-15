package com.movix.tv.data.account

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Base64
import com.movix.tv.data.age.AgeLimits
import com.movix.tv.data.age.AgeRules
import com.movix.tv.data.local.LocalStore
import com.movix.tv.data.local.TvKeys
import com.movix.tv.data.movix.VipManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
    /**
     * Restriction d'âge du profil (0 = aucune, 7, 12, 16, 18). `null` : pas
     * encore connue (compte enregistré par une version qui ne la gardait pas) :
     * le catalogue attend de la connaître.
     */
    val ageRestriction: Int? = null,
)

class AccountManager(
    private val context: Context,
    private val store: LocalStore,
    private val api: AccountApi,
    private val vip: VipManager,
    private val json: Json,
) : AgeLimits {
    private val _state = MutableStateFlow<Account?>(null)
    val state: StateFlow<Account?> = _state.asStateFlow()
    val current: Account? get() = _state.value

    // Inconnue tant que le compte enregistré n'a pas été relu (rien n'est montré avant).
    private val _limit = MutableStateFlow<Int?>(null)
    /** Restriction d'âge du profil qui regarde ([AgeLimits.limit]) ; 0 sans compte relié. */
    override val limit: StateFlow<Int?> = _limit.asStateFlow()
    @Volatile private var restored = false

    // Une seule lecture des profils à la fois pour connaître ou rafraîchir la restriction.
    private val limitLock = Mutex()
    @Volatile private var profilesReadAt = 0L

    /** Publie le compte ; la restriction d'abord, pour que ceux qui suivent le compte la lisent à jour. */
    private fun publish(account: Account?) {
        _limit.value = if (account == null) 0 else account.ageRestriction?.let(AgeRules::profileLimit)
        _state.value = account
    }

    private suspend fun save(account: Account) {
        store.writeAll(mapOf(TvKeys.ACCOUNT to json.encodeToString(Account.serializer(), account)))
        publish(account)
    }

    suspend fun restore() {
        val saved = store.read(TvKeys.ACCOUNT)?.let { runCatching { json.decodeFromString(Account.serializer(), it) }.getOrNull() }
        // Compte enregistré sans la restriction : celle des profils gardés sur la télé, s'ils la donnent.
        val account = if (saved != null && saved.ageRestriction == null) {
            val cached = store.read(PROFILES_CACHE)?.let { runCatching { json.decodeFromString(profileList, it) }.getOrNull() }.orEmpty()
            val known = AgeRules.limitOf(saved.profileId, cached)
            if (known == null) saved
            else saved.copy(ageRestriction = known).also { store.writeAll(mapOf(TvKeys.ACCOUNT to json.encodeToString(Account.serializer(), it))) }
        } else saved
        publish(account)
        restored = true
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
            // Absente (serveur plus ancien) : inconnue, demandée avec la liste des profils.
            ageRestriction = poll.profile?.ageRestriction?.let(AgeRules::profileLimit),
        )
        store.writeAll(mapOf(TvKeys.ACCOUNT to json.encodeToString(Account.serializer(), account), PROFILES_CACHE to null))
        profilesReadAt = 0L
        publish(account)
        poll.vip?.accessKey?.takeIf { poll.vip.active && it.isNotBlank() }?.let { runCatching { vip.submit(it) } }
        return account
    }

    /**
     * Profils du compte, lus sur le serveur puis gardés sur la télé : « Qui
     * regarde ? » s'affiche au lancement sans attendre le réseau. Session
     * supprimée depuis le site : déconnexion et liste vide. Autre erreur : levée.
     * La restriction d'âge du profil courant suit la liste (changée sur le site).
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
        profilesReadAt = System.currentTimeMillis()
        // Compte relu : le profil a pu changer entre-temps (« Qui regarde ? »).
        current?.let { now ->
            val known = AgeRules.limitOf(now.profileId, list)
            if (known != null && known != now.ageRestriction) save(now.copy(ageRestriction = known))
        }
        return list
    }

    /** Restriction inconnue : la liste des profils est demandée (une fois à la fois). */
    override suspend fun resolve(): Int? {
        if (!restored) restore()
        if (current == null) return 0
        _limit.value?.let { return it }
        return limitLock.withLock {
            _limit.value ?: run {
                runCatching { profiles() }.onFailure { android.util.Log.w("MovixAccount", "restriction d'âge illisible : $it") }
                _limit.value
            }
        }
    }

    /**
     * Relit les profils au plus toutes les [minIntervalMs] : une restriction
     * changée par un parent sur le site s'applique sur la télé.
     */
    suspend fun refreshProfiles(minIntervalMs: Long) {
        if (current == null || System.currentTimeMillis() - profilesReadAt < minIntervalMs) return
        limitLock.withLock {
            if (System.currentTimeMillis() - profilesReadAt < minIntervalMs) return
            runCatching { profiles() }
        }
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
        // Profil de la liste du serveur : restriction absente = aucune (comme le site).
        val next = account.copy(
            profileId = profile.id,
            profileName = profile.name,
            avatar = profile.avatar,
            ageRestriction = AgeRules.profileLimit(profile.ageRestriction),
        )
        save(next)
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
        publish(null)
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
