package com.movix.tv.data.movix

import androidx.compose.runtime.Immutable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@Immutable
data class VipState(
    val key: String? = null,
    val vip: Boolean = false,
    val expiresAt: String? = null,
)

/** Résultat d'une saisie de clé dans les réglages. */
enum class VipSubmitResult { OK, INVALID, NETWORK }

/**
 * État de la clé VIP, comme l'ancienne appli TV : vérifiée au démarrage puis
 * toutes les 10 min. `vip:false` efface la clé ; une erreur réseau ne change
 * rien (on ne punit pas une coupure de box).
 *
 * `read`/`write` lisent et écrivent la clé dans le stockage local : le
 * gestionnaire reste testable sans Android.
 */
class VipManager(
    private val api: MovixApi,
    private val scope: CoroutineScope,
    private val read: suspend () -> String?,
    private val write: suspend (String?) -> Unit,
    private val periodMs: Long = 10 * 60 * 1000L,
) {
    private val _state = MutableStateFlow(VipState())
    val state: StateFlow<VipState> = _state.asStateFlow()
    private var loop: Job? = null

    /** Clé à envoyer en `x-access-key`, seulement si elle est reconnue VIP. */
    val activeKey: String? get() = _state.value.takeIf { it.vip }?.key

    /**
     * La clé enregistrée est réputée valide jusqu'à preuve du contraire :
     * l'appli démarre hors ligne sans perdre le VIP.
     */
    suspend fun restore() {
        read()?.takeIf { it.isNotBlank() }?.let { _state.value = VipState(it, vip = true) }
    }

    fun start() {
        loop?.cancel()
        loop = scope.launch {
            restore()
            while (isActive) {
                refresh()
                delay(periodMs)
            }
        }
    }

    suspend fun refresh() {
        val key = _state.value.key ?: return
        val check = runCatching { api.checkVip(key) }.getOrNull() ?: return
        if (check.vip) {
            _state.value = VipState(key, true, check.expiresAtText)
        } else if (_state.value.key == key) {
            write(null)
            _state.value = VipState()
        }
    }

    suspend fun submit(raw: String): VipSubmitResult {
        val key = raw.trim()
        if (key.isEmpty()) return VipSubmitResult.INVALID
        val check = runCatching { api.checkVip(key) }.getOrNull() ?: return VipSubmitResult.NETWORK
        if (!check.vip) return VipSubmitResult.INVALID
        write(key)
        _state.value = VipState(key, true, check.expiresAtText)
        return VipSubmitResult.OK
    }

    suspend fun clear() {
        write(null)
        _state.value = VipState()
    }
}
