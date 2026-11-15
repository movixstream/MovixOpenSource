package com.movix.tv.ui.update

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.movix.tv.BuildConfig
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.update.UpdateError
import com.movix.tv.data.update.UpdateManager
import com.movix.tv.data.update.UpdatePhase
import com.movix.tv.data.update.UpdateRules
import com.movix.tv.data.update.UpdateState
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.ProgressLine
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType

/**
 * Section « Mise à jour » des réglages : version installée, recherche à la
 * demande, état (à jour, disponible avec les notes, téléchargement, erreur).
 *
 * Les boutons gardent leur place d'un état à l'autre (« Installer » devient
 * « Annuler » pendant le téléchargement) : le focus de la télécommande ne se
 * perd pas quand l'état change.
 */
@Composable
fun UpdateSection() {
    val updates = LocalContext.current.container.updates
    val state by updates.state.collectAsStateWithLifecycle()
    val manifest = state.manifest

    Text(stringResource(R.string.update_title), style = MovixType.Panel)
    Spacer(Modifier.height(6.dp))
    Text(stringResource(R.string.update_current, BuildConfig.VERSION_NAME), style = MovixType.Body.copy(color = MovixColors.Text))
    statusText(state)?.let {
        Spacer(Modifier.height(4.dp))
        Text(it, style = MovixType.Body.copy(color = if (state.phase == UpdatePhase.ERROR) MovixColors.Red else MovixColors.Text))
    }
    if (manifest != null) {
        val notes = manifest.notesFor(appLanguage())
        if (notes.isNotBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(notes, style = MovixType.Body)
        }
    }
    if (state.phase == UpdatePhase.DOWNLOADING) {
        Spacer(Modifier.height(10.dp))
        ProgressLine(state.progress, Modifier.width(320.dp))
    }
    Spacer(Modifier.height(12.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (manifest != null) PrimaryButton(state, updates)
        PillButton(
            stringResource(if (state.phase == UpdatePhase.CHECKING) R.string.update_checking else R.string.update_check),
            { updates.check() },
        )
    }
}

/**
 * Invite non bloquante de l'accueil : n'a jamais le focus d'office, se
 * rejoint par le haut depuis la première rangée. « Plus tard » met la version
 * de côté (elle reste visible dans les réglages).
 */
@Composable
fun UpdateBanner(modifier: Modifier = Modifier) {
    val container = LocalContext.current.container
    val updates = container.updates
    val state by updates.state.collectAsStateWithLifecycle()
    val values by container.store.values.collectAsStateWithLifecycle()
    val manifest = state.manifest ?: return
    if (state.phase == UpdatePhase.UP_TO_DATE || !UpdateRules.shouldPrompt(manifest, updates.ignoredVersion(values))) return
    val focus = LocalFocusManager.current

    Column(
        modifier
            .width(280.dp)
            .background(MovixColors.Panel.copy(alpha = 0.94f), RoundedCornerShape(12.dp))
            .border(1.dp, MovixColors.Line, RoundedCornerShape(12.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text(stringResource(R.string.update_banner_title, manifest.versionName), style = MovixType.Row, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(4.dp))
        val line = statusText(state)?.takeIf { state.phase != UpdatePhase.AVAILABLE } ?: manifest.notesFor(appLanguage())
        if (line.isNotBlank()) {
            Text(
                line,
                style = MovixType.CardSub.copy(color = if (state.phase == UpdatePhase.ERROR) MovixColors.Red else MovixColors.Muted),
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (state.phase == UpdatePhase.DOWNLOADING) {
            Spacer(Modifier.height(8.dp))
            ProgressLine(state.progress)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton(state, updates)
            PillButton(stringResource(R.string.update_later), {
                // Le bandeau disparaît : le focus descend d'abord sur le catalogue.
                focus.moveFocus(FocusDirection.Down)
                updates.cancel()
                updates.dismiss(manifest.versionCode)
            })
        }
    }
}

/** Installer / Annuler / Réessayer, au même endroit quel que soit l'état. */
@Composable
private fun PrimaryButton(state: UpdateState, updates: UpdateManager) {
    val downloading = state.phase == UpdatePhase.DOWNLOADING || state.phase == UpdatePhase.VERIFYING
    val label = when {
        downloading -> R.string.update_cancel
        state.phase == UpdatePhase.ERROR -> R.string.update_retry
        else -> R.string.update_install
    }
    PillButton(stringResource(label), { if (downloading) updates.cancel() else updates.install() })
}

@Composable
private fun statusText(state: UpdateState): String? = when (state.phase) {
    UpdatePhase.IDLE, UpdatePhase.CHECKING -> null
    UpdatePhase.UP_TO_DATE -> stringResource(R.string.update_up_to_date)
    UpdatePhase.AVAILABLE -> state.manifest?.let { stringResource(R.string.update_available, it.versionName) }
    UpdatePhase.DOWNLOADING -> stringResource(R.string.update_downloading, (state.progress * 100).toInt())
    UpdatePhase.VERIFYING -> stringResource(R.string.update_verifying)
    UpdatePhase.NEEDS_PERMISSION -> stringResource(R.string.update_needs_permission)
    UpdatePhase.INSTALLING -> stringResource(R.string.update_installing)
    UpdatePhase.ERROR -> stringResource(
        when (state.error) {
            UpdateError.NETWORK -> R.string.update_err_network
            UpdateError.BAD_MANIFEST -> R.string.update_err_manifest
            UpdateError.CHECKSUM -> R.string.update_err_checksum
            UpdateError.BAD_APK -> R.string.update_err_apk
            UpdateError.STORAGE -> R.string.update_err_storage
            UpdateError.CONFLICT -> R.string.update_err_conflict
            UpdateError.BLOCKED -> R.string.update_err_blocked
            UpdateError.INSTALL_FAILED, null -> R.string.update_err_install
        },
    )
}

/** Langue de l'interface, pour choisir les notes FR ou EN du manifeste. */
@Composable
private fun appLanguage(): String =
    ConfigurationCompat.getLocales(LocalConfiguration.current).get(0)?.language.orEmpty()
