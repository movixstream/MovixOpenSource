package com.movix.tv.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.local.TvKeys
import com.movix.tv.data.local.UiKeys
import com.movix.tv.data.local.UiPrefs
import com.movix.tv.data.movix.VipSubmitResult
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import com.movix.tv.ui.update.UpdateSection
import kotlinx.coroutines.launch
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Sections des réglages, dans l'ordre de la colonne de gauche. */
private enum class Pane(val label: Int) {
    ACCOUNT(R.string.settings_account_title),
    APPEARANCE(R.string.settings_section_appearance),
    SUBTITLES(R.string.settings_section_subtitles),
    HOME(R.string.settings_section_home),
    RAIL(R.string.settings_section_rail),
    PLAYBACK(R.string.settings_section_playback),
    VIP(R.string.settings_vip_title),
    TMDB(R.string.settings_tmdb_title),
    ABOUT(R.string.settings_about),
}

/**
 * Réglages : sections à gauche (la section suit le focus, Droite ou OK entre
 * dedans), contenu à droite (Gauche revient sur la section ouverte).
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun SettingsScreen(onLinkAccount: () -> Unit, modifier: Modifier = Modifier, onSwitchProfile: () -> Unit = {}) {
    var pane by rememberSaveable { mutableStateOf(Pane.ACCOUNT) }
    val selectedTab = remember { FocusRequester() }
    val paneRequester = remember { FocusRequester() }
    val enterPane = { runCatching { paneRequester.requestFocus() }; Unit }

    Column(modifier.padding(start = 24.dp, top = 40.dp)) {
        Text(stringResource(R.string.nav_settings), style = MovixType.Title)
        Spacer(Modifier.height(22.dp))
        Row(Modifier.fillMaxSize()) {
            Column(
                Modifier
                    .width(180.dp)
                    // Droite : toujours le haut de la section, pas l'élément le plus proche.
                    .onPreviewKeyEvent {
                        if (it.type == KeyEventType.KeyDown && it.key == Key.DirectionRight) { enterPane(); true } else false
                    }
                    // En revenant du contenu, le focus retrouve la section ouverte.
                    .focusRestorer(selectedTab)
                    .focusGroup()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Pane.entries.forEach { p ->
                    SettingsTab(
                        stringResource(p.label),
                        selected = p == pane,
                        onFocused = { pane = p },
                        onClick = enterPane,
                        modifier = if (p == pane) Modifier.focusRequester(selectedTab) else Modifier,
                    )
                }
            }
            Spacer(Modifier.width(36.dp))
            // Une composition par section : défilement et focus repartent du haut.
            key(pane) {
                Box(Modifier.width(500.dp).fillMaxHeight().focusRequester(paneRequester).focusRestorer().focusGroup()) {
                    when (pane) {
                        Pane.ACCOUNT -> AccountPane(onLinkAccount, onSwitchProfile)
                        Pane.APPEARANCE -> AppearancePane()
                        Pane.SUBTITLES -> SubtitlesPane()
                        Pane.HOME -> HomePane()
                        Pane.RAIL -> RailPane()
                        Pane.PLAYBACK -> PlaybackPane()
                        Pane.VIP -> VipPane()
                        Pane.TMDB -> TmdbPane()
                        Pane.ABOUT -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                            // Version installée et mise à jour depuis l'appli.
                            UpdateSection()
                            Spacer(Modifier.height(40.dp))
                        }
                    }
                }
            }
        }
    }
}

/** Compte relié par le code à 5 caractères, profil et « Qui regarde ? ». */
@Composable
private fun AccountPane(onLinkAccount: () -> Unit, onSwitchProfile: () -> Unit) {
    val container = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val account by container.accounts.state.collectAsStateWithLifecycle()
    val values by container.store.values.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Text(stringResource(R.string.settings_account_title), style = MovixType.Panel)
        Spacer(Modifier.height(6.dp))
        val linked = account
        if (linked == null) {
            Text(stringResource(R.string.settings_account_none), style = MovixType.Body)
            Spacer(Modifier.height(12.dp))
            PillButton(stringResource(R.string.settings_account_link), onLinkAccount)
        } else {
            Text(stringResource(R.string.settings_account_profile, linked.profileName), style = MovixType.Body.copy(color = MovixColors.Text))
            Text(stringResource(R.string.settings_account_synced), style = MovixType.Body)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(stringResource(R.string.settings_account_switch), onSwitchProfile)
                PillButton(stringResource(R.string.settings_account_logout), { scope.launch { container.sync.flush(); container.accounts.logout(remote = true) } })
            }
            Spacer(Modifier.height(16.dp))
            val prompt = UiPrefs.flag(values, UiKeys.PROFILE_PROMPT)
            ToggleRow(
                stringResource(R.string.settings_account_prompt),
                prompt,
                { scope.launch { container.store.set(UiKeys.PROFILE_PROMPT, if (prompt) "0" else null) } },
                body = stringResource(R.string.settings_account_prompt_body),
            )
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun VipPane() {
    val container = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val vip by container.vip.state.collectAsStateWithLifecycle()

    var vipInput by remember { mutableStateOf(vip.key.orEmpty()) }
    var vipMessage by remember { mutableStateOf<Int?>(null) }
    var vipBusy by remember { mutableStateOf(false) }

    fun saveVip() {
        if (vipBusy) return
        vipBusy = true
        scope.launch {
            vipMessage = when (container.vip.submit(vipInput)) {
                VipSubmitResult.OK -> null
                VipSubmitResult.INVALID -> R.string.settings_vip_bad
                VipSubmitResult.NETWORK -> R.string.settings_vip_network
            }
            vipBusy = false
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Text(stringResource(R.string.settings_vip_title), style = MovixType.Panel)
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.settings_vip_body), style = MovixType.Body)
        Spacer(Modifier.height(12.dp))
        // Clé VIP : lettres, chiffres et tirets (`VIP-…`).
        KeyField(vipInput, { vipInput = it.filter { c -> c.isLetterOrDigit() || c == '-' || c == '_' } }, ::saveVip)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PillButton(stringResource(R.string.settings_vip_save), ::saveVip)
            if (vip.key != null) {
                PillButton(stringResource(R.string.settings_vip_remove), {
                    scope.launch { container.vip.clear(); vipInput = ""; vipMessage = null }
                })
            }
        }
        Spacer(Modifier.height(10.dp))
        val vipStatus = when {
            vipMessage != null -> stringResource(vipMessage!!)
            vip.vip && vip.expiresAt != null -> stringResource(R.string.settings_vip_until, formatDate(vip.expiresAt!!))
            vip.vip -> stringResource(R.string.settings_vip_lifetime)
            else -> stringResource(R.string.settings_vip_none)
        }
        Text(vipStatus, style = MovixType.Body.copy(color = if (vipMessage != null) MovixColors.Red else MovixColors.Text))
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun TmdbPane() {
    val container = LocalContext.current.container
    val scope = rememberCoroutineScope()
    var key by remember { mutableStateOf(container.store.get(TvKeys.TMDB_KEY).orEmpty()) }
    var message by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun save() {
        if (busy) return
        busy = true
        scope.launch {
            val k = key.trim()
            message = when (runCatching { container.tmdb.validateKey(k) }.getOrNull()) {
                true -> { container.store.set(TvKeys.TMDB_KEY, k); R.string.settings_tmdb_ok }
                false -> R.string.settings_tmdb_bad
                null -> R.string.settings_tmdb_network
            }
            busy = false
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Text(stringResource(R.string.settings_tmdb_title), style = MovixType.Panel)
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.settings_tmdb_body), style = MovixType.Body)
        Spacer(Modifier.height(12.dp))
        KeyField(key, { key = it.filter { c -> c.isLetterOrDigit() } }, ::save)
        Spacer(Modifier.height(12.dp))
        PillButton(stringResource(R.string.settings_tmdb_save), ::save)
        message?.let {
            Spacer(Modifier.height(10.dp))
            Text(stringResource(it), style = MovixType.Body.copy(color = if (it == R.string.settings_tmdb_ok) MovixColors.Text else MovixColors.Red))
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun KeyField(value: String, onChange: (String) -> Unit, onDone: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = MovixType.Button.copy(fontSize = 15.sp),
        cursorBrush = SolidColor(MovixColors.Text),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        interactionSource = source,
        modifier = Modifier
            .fillMaxWidth()
            .background(MovixColors.Panel, RoundedCornerShape(10.dp))
            .border(2.dp, if (focused) MovixColors.Text else MovixColors.Line, RoundedCornerShape(10.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
    )
}

/** Date ISO du serveur → « 1 janv. 2027 » ; la chaîne brute si elle ne se lit pas. */
private fun formatDate(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.getDefault()))
}.getOrDefault(iso.take(10))
