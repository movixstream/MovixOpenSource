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
import kotlinx.coroutines.CancellationException
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

/** Issue d'un réglage de profil demandé depuis la télé. */
enum class ProfileChange {
    OK,
    /** Le serveur a dit non (nom refusé, cinq profils déjà) : réessayer tel quel ne changera rien. */
    REFUSED,
    /** Serveur injoignable ou en panne : rien n'a changé, on peut réessayer. */
    NETWORK,
    /** La session a été supprimée depuis le site : la télé n'est plus reliée. */
    SIGNED_OUT,
}

/** Profil créé depuis la télé ([profile] seulement si [status] vaut [ProfileChange.OK]). */
data class ProfileCreation(val status: ProfileChange, val profile: LinkedProfile? = null)

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

    // Mode enfant gardé sur la télé : il vaut tant qu'aucun compte n'est relié
    // (avec un compte, c'est la restriction du profil qui regarde).
    @Volatile private var localLimit = 0

    /** Publie le compte ; la restriction d'abord, pour que ceux qui suivent le compte la lisent à jour. */
    private fun publish(account: Account?) {
        _limit.value = if (account == null) localLimit else account.ageRestriction?.let(AgeRules::profileLimit)
        _state.value = account
    }

    private suspend fun save(account: Account) {
        store.writeAll(mapOf(TvKeys.ACCOUNT to json.encodeToString(Account.serializer(), account)))
        publish(account)
    }

    suspend fun restore() {
        localLimit = AgeRules.storedLimit(store.read(TvKeys.KID_LIMIT))
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
        if (current == null) return localLimit
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

    /** Range [profile] (modifié ou créé depuis la télé) dans les profils gardés : « Qui regarde ? » le montre sans attendre le réseau. */
    private suspend fun cacheProfile(profile: LinkedProfile) {
        val list = cachedProfiles()
        val next = if (list.any { it.id == profile.id }) list.map { if (it.id == profile.id) profile else it } else list + profile
        store.writeAll(mapOf(PROFILES_CACHE to json.encodeToString(profileList, next)))
    }

    /**
     * Mode enfant : [limit] (0 = désactivé, sinon 7, 12, 16 ou 18) devient la
     * limite d'âge de ce qui est proposé.
     *
     * Compte relié : c'est la restriction du profil qui regarde, enregistrée sur
     * le serveur (la même que sur le site) ; rien ne change sur la télé tant que
     * le serveur n'a pas répondu, et c'est la valeur qu'il a gardée qui
     * s'applique. Sans compte : le réglage reste sur la télé.
     */
    suspend fun setAgeLimit(limit: Int): ProfileChange {
        val value = AgeRules.profileLimit(limit)
        val account = current
        if (account == null) {
            store.writeAll(mapOf(TvKeys.KID_LIMIT to value.takeIf { it > 0 }?.toString()))
            localLimit = value
            // Un compte relié entre-temps garde la restriction de son profil.
            if (current == null) _limit.value = value
            return ProfileChange.OK
        }
        val saved = try {
            api.updateProfileAge(account.token, account.profileId, value)
        } catch (e: SessionRevokedException) {
            logout(remote = false)
            return ProfileChange.SIGNED_OUT
        } catch (e: ProfileRefusedException) {
            return ProfileChange.REFUSED
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            android.util.Log.w("MovixAccount", "mode enfant non enregistré : $e")
            return ProfileChange.NETWORK
        }
        cacheProfile(saved)
        // Profil changé pendant l'appel (« Qui regarde ? ») : sa restriction n'est pas celle-ci.
        current?.takeIf { it.profileId == saved.id }?.let { save(it.copy(ageRestriction = AgeRules.profileLimit(saved.ageRestriction))) }
        return ProfileChange.OK
    }

    /**
     * Nouveau profil du compte, créé depuis « Qui regarde ? » : [name] et sa
     * limite d'âge [limit]. L'avatar est un de ceux du site, à changer là-bas.
     * La télé reste sur le profil actuel : c'est l'écran qui propose de basculer.
     */
    suspend fun createProfile(name: String, limit: Int): ProfileCreation {
        val account = current ?: return ProfileCreation(ProfileChange.SIGNED_OUT)
        val safeName = AgeRules.profileName(name) ?: return ProfileCreation(ProfileChange.REFUSED)
        val avatar = AgeRules.newProfileAvatar(cachedProfiles().map { it.avatar })
        val created = try {
            api.createProfile(account.token, safeName, avatar, AgeRules.profileLimit(limit))
        } catch (e: SessionRevokedException) {
            logout(remote = false)
            return ProfileCreation(ProfileChange.SIGNED_OUT)
        } catch (e: ProfileRefusedException) {
            return ProfileCreation(ProfileChange.REFUSED)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            android.util.Log.w("MovixAccount", "profil non créé : $e")
            return ProfileCreation(ProfileChange.NETWORK)
        }
        cacheProfile(created)
        return ProfileCreation(ProfileChange.OK, created)
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
