package com.movix.tv.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

private val Context.movixStore: DataStore<Preferences> by preferencesDataStore(name = "movix")

/**
 * Stockage clé → chaîne, au même format que le localStorage du site
 * (`progress_*`, `watchlist_*`, `watched_episodes_tv_*`…). La synchronisation
 * de la phase 4 n'aura qu'à copier ces paires dans `/api/sync`.
 *
 * Tout est lu une fois au démarrage dans [values] ; les écritures passent par
 * DataStore, qui republie la carte entière.
 */
class LocalStore(context: Context, scope: CoroutineScope) {
    private val store = context.movixStore

    val values: StateFlow<Map<String, String>> = store.data
        .map { prefs -> prefs.asMap().entries.associate { (k, v) -> k.name to v.toString() } }
        .stateIn(scope, SharingStarted.Eagerly, emptyMap())

    fun get(key: String): String? = values.value[key]

    /** Toutes les paires, lues sur disque (au démarrage, [values] peut être encore vide). */
    suspend fun snapshot(): Map<String, String> =
        store.data.first().asMap().entries.associate { (k, v) -> k.name to v.toString() }

    /** Valeur lue sur disque : à utiliser au démarrage, avant que [values] soit rempli. */
    suspend fun read(key: String): String? = store.data.first()[stringPreferencesKey(key)]

    /** Prévenu de chaque écriture faite par l'appli (pas celles de la synchro) : la synchro s'y branche. */
    @Volatile var onWrite: ((key: String) -> Unit)? = null

    suspend fun set(key: String, value: String?) {
        writeAll(mapOf(key to value))
        onWrite?.invoke(key)
    }

    /** Écritures venues du serveur : en un seul passage, sans prévenir [onWrite]. */
    suspend fun writeAll(values: Map<String, String?>) {
        if (values.isEmpty()) return
        store.edit { prefs ->
            values.forEach { (key, value) ->
                val k = stringPreferencesKey(key)
                if (value == null) prefs.remove(k) else prefs[k] = value
            }
        }
    }
}

/** Clés propres à la télé, jamais synchronisées. */
object TvKeys {
    const val TMDB_KEY = "movix_tv_tmdb_key"
    /** Titre et images des cartes « Reprendre », par clé de progression. */
    const val WATCH_META = "movix_tv_watch_meta"
    /** Clé VIP (`VIP-…`), envoyée en `x-access-key` à la Main API. */
    const val VIP_KEY = "movix_tv_vip_key"
    /** Préférences du lecteur : langue d'abord, sous-titres, décalage, format. */
    const val PLAYER_PREFS = "movix_tv_player_prefs"
    /** Compte relié (jeton de session, profil). Jamais synchronisé. */
    const val ACCOUNT = "movix_tv_account"
    /** Identifiant stable de la télé, envoyé à la liaison (sessions du site). */
    const val CLIENT_ID = "movix_tv_client_id"
    /** Clés synchronisées modifiées sur la télé, pas encore envoyées. */
    const val SYNC_OUTBOX = "movix_tv_sync_outbox"
    /** L'écran de connexion a déjà été proposé au premier lancement. */
    const val LINK_PROMPTED = "movix_tv_link_prompted"
    /** Mise à jour : dernière vérification (ms). */
    const val UPDATE_LAST_CHECK = "movix_tv_update_last_check"
    /** Mise à jour : dernier manifeste plus récent que l'appli, pour la proposer sans attendre le réseau. */
    const val UPDATE_MANIFEST = "movix_tv_update_manifest"
    /** Mise à jour : `versionCode` mis de côté par « Plus tard » sur l'accueil. */
    const val UPDATE_IGNORED = "movix_tv_update_ignored"
}
