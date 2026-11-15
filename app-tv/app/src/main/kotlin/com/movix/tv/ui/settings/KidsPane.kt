package com.movix.tv.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.account.ProfileChange
import com.movix.tv.data.age.AgeRules
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.rememberAgeLimit
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Mode enfant : la limite d'âge de ce que la télé propose, choisie ici.
 *
 * Compte relié : c'est la restriction du profil qui regarde, enregistrée sur
 * le serveur (la même que sur le site). Sans compte : le réglage reste sur la
 * télé. La pastille choisie ne bouge qu'une fois le réglage vraiment appliqué.
 * « Gérer les profils » règle la limite des autres profils (celui d'un enfant)
 * sans basculer dessus.
 */
@Composable
internal fun KidsPane(
    onSwitchProfile: () -> Unit,
    onManageProfiles: () -> Unit = {},
    returnTo: ProfilesOpener? = null,
    onReturned: () -> Unit = {},
) {
    val container = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val account by container.accounts.state.collectAsStateWithLifecycle()
    val limit = rememberAgeLimit()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Int?>(null) }
    val switchRequester = remember { FocusRequester() }
    val manageRequester = remember { FocusRequester() }
    ReturnFocus(
        when (returnTo) {
            ProfilesOpener.KIDS_SWITCH -> switchRequester
            ProfilesOpener.KIDS_MANAGE -> manageRequester
            else -> null
        },
        onReturned,
    )

    fun choose(value: Int) {
        if (busy || value == limit) return
        busy = true
        error = null
        scope.launch {
            // Mené au bout même si on quitte la page : sinon le serveur aurait le
            // réglage et la télé garderait l'ancien jusqu'à la prochaine relecture.
            val result = withContext(NonCancellable) { container.accounts.setAgeLimit(value) }
            error = when (result) {
                ProfileChange.OK -> null
                ProfileChange.REFUSED -> R.string.kids_error_refused
                ProfileChange.NETWORK -> R.string.kids_error_network
                ProfileChange.SIGNED_OUT -> R.string.kids_error_signed_out
            }
            busy = false
        }
    }

    // Restriction pas encore connue (compte relié par une ancienne version) : demandée au serveur.
    LaunchedEffect(limit) { if (limit == null) container.catalog.resolveAgeLimit() }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        PaneHeader(stringResource(R.string.kids_title), stringResource(R.string.kids_body))
        val off = stringResource(R.string.kids_off)
        val options = AgeRules.choicesFor(limit).map { it to if (it == 0) off else stringResource(R.string.age_badge, it) }
        ChoiceRow("", options, limit ?: -1, ::choose)
        Spacer(Modifier.height(10.dp))
        val failure = error
        val state = when {
            busy -> stringResource(R.string.kids_saving)
            failure != null -> stringResource(failure)
            limit == null -> stringResource(R.string.settings_account_age_unknown)
            limit <= 0 -> stringResource(R.string.kids_state_off)
            limit >= 18 -> stringResource(R.string.kids_state_adult)
            else -> stringResource(R.string.kids_state_on, limit)
        }
        Text(state, style = MovixType.Body.copy(color = if (failure != null && !busy) MovixColors.Red else MovixColors.Text))
        Spacer(Modifier.height(8.dp))
        val linked = account
        if (linked == null) {
            Text(stringResource(R.string.kids_scope_tv), style = MovixType.Body)
        } else {
            Text(stringResource(R.string.kids_scope_profile, linked.profileName), style = MovixType.Body)
            Spacer(Modifier.height(4.dp))
            Text(stringResource(R.string.kids_tip_profiles), style = MovixType.Body)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(stringResource(R.string.settings_account_switch), onSwitchProfile, Modifier.focusRequester(switchRequester))
                PillButton(stringResource(R.string.profiles_manage), onManageProfiles, Modifier.focusRequester(manageRequester))
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
