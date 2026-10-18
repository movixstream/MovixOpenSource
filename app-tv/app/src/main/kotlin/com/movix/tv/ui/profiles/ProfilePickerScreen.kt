package com.movix.tv.ui.profiles

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.account.LinkedProfile
import com.movix.tv.data.local.UiKeys
import com.movix.tv.data.local.UiPrefs
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.focusProgress
import com.movix.tv.ui.components.focusScale
import com.movix.tv.ui.components.pressProgress
import com.movix.tv.ui.components.pressScale
import com.movix.tv.ui.theme.Bricolage
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * « Qui regarde ? » façon Netflix : un avatar rond par profil du compte relié.
 * OK bascule la télé sur ce profil (la synchro suit) puis appelle [onDone] ;
 * Retour garde le profil actuel ([onBack]).
 *
 * La liste part des profils gardés sur la télé et se met à jour depuis le
 * serveur (`GET /api/profiles`).
 */
@Composable
fun ProfilePickerScreen(onDone: () -> Unit, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val container = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val account by container.accounts.state.collectAsStateWithLifecycle()
    val values by container.store.values.collectAsStateWithLifecycle()

    var profiles by remember { mutableStateOf<List<LinkedProfile>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    var switching by remember { mutableStateOf(false) }
    var attempt by remember { mutableStateOf(0) }

    LaunchedEffect(attempt) {
        failed = false
        if (profiles.isEmpty()) profiles = container.accounts.cachedProfiles()
        loading = profiles.isEmpty()
        val fresh = runCatching { container.accounts.profiles() }.getOrNull()
        if (fresh != null && fresh.isNotEmpty()) profiles = fresh
        failed = fresh == null && profiles.isEmpty()
        loading = false
    }
    // Plus de compte (session supprimée depuis le site) : rien à choisir.
    LaunchedEffect(account) { if (account == null) onBack() }

    // Avatars du site (`/avatars/…`) : servis par le domaine actuel du site.
    val siteHost by produceState<String?>(null) {
        value = runCatching { withContext(Dispatchers.IO) { container.apiHost.current().removePrefix("api.") } }.getOrNull()
    }

    BackHandler { if (!switching) onBack() }

    val currentId = account?.profileId
    val firstRequester = remember { FocusRequester() }
    var errorText by remember { mutableStateOf(false) }

    fun choose(p: LinkedProfile) {
        if (switching) return
        if (p.id == currentId) { onDone(); return }
        switching = true
        errorText = false
        scope.launch {
            val ok = container.sync.switchProfile(p)
            switching = false
            if (ok) onDone() else errorText = true
        }
    }

    Box(
        modifier
            .fillMaxSize()
            .background(MovixColors.Ink)
            // Le focus ne sort pas de l'écran (rien derrière ne doit le prendre).
            .focusProperties { onExit = { cancelFocusChange() } }
            .focusGroup(),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.profiles_title), style = MovixType.Hero)
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.profiles_body), style = MovixType.Body)
            Spacer(Modifier.height(36.dp))
            when {
                loading -> Text(stringResource(R.string.profiles_loading), style = MovixType.Meta)
                failed -> {
                    Text(stringResource(R.string.profiles_error), style = MovixType.Body.copy(color = MovixColors.Red))
                    Spacer(Modifier.height(14.dp))
                    PillButton(stringResource(R.string.profiles_retry), { attempt++ }, Modifier.focusRequester(firstRequester))
                }
                else -> Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    profiles.forEach { p ->
                        ProfileTile(
                            profile = p,
                            current = p.id == currentId,
                            avatarUrl = avatarUrl(p.avatar, siteHost),
                            onClick = { choose(p) },
                            modifier = if (p.id == currentId || (currentId !in profiles.map { it.id } && p == profiles.first())) Modifier.focusRequester(firstRequester) else Modifier,
                        )
                    }
                }
            }
            Spacer(Modifier.height(28.dp))
            Box(Modifier.height(22.dp)) {
                when {
                    switching -> Text(stringResource(R.string.profiles_switching), style = MovixType.Meta)
                    errorText -> Text(stringResource(R.string.profiles_error), style = MovixType.Body.copy(color = MovixColors.Red))
                }
            }
            Spacer(Modifier.height(12.dp))
            val prompt = UiPrefs.flag(values, UiKeys.PROFILE_PROMPT)
            PillButton(
                stringResource(R.string.profiles_dont_ask),
                { scope.launch { container.store.set(UiKeys.PROFILE_PROMPT, if (prompt) "0" else null) } },
                icon = if (!prompt) MovixIcons.Check else null,
                selected = !prompt,
            )
        }
    }

    // Focus d'entrée : le profil actuel (ou le premier, ou « Réessayer »).
    LaunchedEffect(loading, failed, profiles.size) {
        if (!loading) runCatching { firstRequester.requestFocus() }
    }
}

/** Avatar du site : chemin `/avatars/…` du front, ou adresse complète. */
private fun avatarUrl(avatar: String?, siteHost: String?): String? = when {
    avatar.isNullOrBlank() -> null
    avatar.startsWith("http://") || avatar.startsWith("https://") -> avatar
    avatar.startsWith("/") && siteHost != null -> "https://$siteHost$avatar"
    else -> null
}

private val InitialColors = listOf(
    Color(0xFFDC2626), Color(0xFF2563EB), Color(0xFF16A34A), Color(0xFF9333EA),
    Color(0xFFEA580C), Color(0xFFDB2777), Color(0xFF0891B2),
)

@Composable
private fun ProfileTile(profile: LinkedProfile, current: Boolean, avatarUrl: String?, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val progress = focusProgress(focused)
    val press = pressProgress(source)
    val context = LocalContext.current
    val density = LocalDensity.current
    Column(modifier.width(120.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .pressScale(press)
                .focusScale(progress, max = 1.1f)
                .size(112.dp)
                // Anneau à la couleur d'accent au focus, comme les crochets des cartes.
                .border(3.dp, if (focused) MovixColors.Red else Color.Transparent, CircleShape)
                .clickable(interactionSource = source, indication = null, onClick = onClick)
                .padding(7.dp)
                .clip(CircleShape)
                .background(InitialColors[Math.floorMod(profile.id.hashCode(), InitialColors.size)]),
            contentAlignment = Alignment.Center,
        ) {
            // Initiales sous l'image : visibles tant qu'elle charge ou si elle manque.
            Text(
                initials(profile.name),
                style = MovixType.Title.copy(fontFamily = Bricolage, fontSize = 34.sp, color = Color.White),
            )
            if (avatarUrl != null) {
                val px = with(density) { 98.dp.roundToPx() }
                val request = remember(avatarUrl) { ImageRequest.Builder(context).data(avatarUrl).size(px, px).build() }
                AsyncImage(model = request, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(
            profile.name.ifBlank { "?" },
            style = MovixType.Button.copy(color = if (focused) MovixColors.Text else MovixColors.Muted, textAlign = TextAlign.Center),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Box(Modifier.height(18.dp)) {
            if (current) Text(stringResource(R.string.profiles_current), style = MovixType.Kicker.copy(color = MovixColors.Red, fontSize = 11.sp))
        }
    }
}

private fun initials(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words[0].take(2).uppercase()
        else -> (words[0].take(1) + words[1].take(1)).uppercase()
    }
}
