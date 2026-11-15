package com.movix.tv.ui.profiles

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
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
import com.movix.tv.data.account.ProfileChange
import com.movix.tv.data.age.AgeRules
import com.movix.tv.data.local.UiKeys
import com.movix.tv.data.local.UiPrefs
import com.movix.tv.ui.components.AgeBadge
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.focusProgress
import com.movix.tv.ui.components.focusScale
import com.movix.tv.ui.components.pressProgress
import com.movix.tv.ui.components.pressScale
import com.movix.tv.ui.settings.ChoiceRow
import com.movix.tv.ui.theme.Bricolage
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * « Qui regarde ? » façon Netflix : un avatar rond par profil du compte relié.
 * OK bascule la télé sur ce profil (la synchro suit) puis appelle [onDone] ;
 * Retour garde le profil actuel ([onBack]).
 *
 * La liste part des profils gardés sur la télé et se met à jour depuis le
 * serveur (`GET /api/profiles`). La tuile « + » crée un profil sans passer par
 * le site (nom et limite d'âge : c'est ainsi qu'on fait un profil enfant).
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

    // Nouveau profil (tuile « + ») : le formulaire prend la place des profils.
    var creating by remember { mutableStateOf(false) }
    var creatingBusy by remember { mutableStateOf(false) }
    var createError by remember { mutableStateOf<Int?>(null) }
    // Profil qui prend le focus au retour du formulaire : celui qu'on vient de créer.
    var focusId by remember { mutableStateOf<String?>(null) }
    // Formulaire refermé sans rien créer : le focus revient sur la tuile « + ».
    var focusAdd by remember { mutableStateOf(false) }
    fun closeForm() {
        focusAdd = true
        createError = null
        creating = false
    }

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

    BackHandler {
        when {
            // Formulaire ouvert : Retour le referme (pas pendant l'envoi).
            creating -> if (!creatingBusy) closeForm()
            !switching -> onBack()
        }
    }

    val currentId = account?.profileId
    val firstRequester = remember { FocusRequester() }
    val addRequester = remember { FocusRequester() }
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

    fun create(name: String, limit: Int) {
        if (creatingBusy) return
        if (AgeRules.profileName(name) == null) { createError = R.string.profiles_new_name_empty; return }
        creatingBusy = true
        createError = null
        scope.launch {
            // Mené au bout même si l'écran se ferme : le profil créé est gardé sur la télé.
            val result = withContext(NonCancellable) { container.accounts.createProfile(name, limit) }
            creatingBusy = false
            when (result.status) {
                ProfileChange.OK -> {
                    result.profile?.let { created ->
                        profiles = profiles.filter { it.id != created.id } + created
                        // Le focus arrive sur le nouveau profil : OK y bascule.
                        focusId = created.id
                    }
                    focusAdd = false
                    creating = false
                    // La liste du serveur fait foi (elle a pu être lue avant la création).
                    attempt++
                }
                ProfileChange.REFUSED -> createError = R.string.profiles_new_refused
                ProfileChange.NETWORK -> createError = R.string.profiles_error
                // Session supprimée depuis le site : l'écran se ferme (plus de compte).
                ProfileChange.SIGNED_OUT -> Unit
            }
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
            Text(stringResource(if (creating) R.string.profiles_new_title else R.string.profiles_title), style = MovixType.Hero)
            Spacer(Modifier.height(8.dp))
            Text(stringResource(if (creating) R.string.profiles_new_body else R.string.profiles_body), style = MovixType.Body)
            Spacer(Modifier.height(36.dp))
            // Le profil qui reçoit le focus : celui qu'on vient de créer, sinon l'actuel, sinon le premier.
            val ids = profiles.map { it.id }
            val targetId = focusId?.takeIf { it in ids } ?: currentId?.takeIf { it in ids } ?: ids.firstOrNull()
            when {
                creating -> NewProfileForm(creatingBusy, createError, ::create, onCancel = { if (!creatingBusy) closeForm() })
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
                            modifier = if (p.id == targetId) Modifier.focusRequester(firstRequester) else Modifier,
                        )
                    }
                    // Profil enfant créé depuis la télé (le serveur en garde cinq au plus).
                    if (profiles.size < AgeRules.MAX_PROFILES) {
                        AddProfileTile({ if (!switching) { createError = null; creating = true } }, Modifier.focusRequester(addRequester))
                    }
                }
            }
            if (!creating) {
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
    }

    // Focus d'entrée : le profil actuel (ou le premier, ou « Réessayer ») ; au
    // retour du formulaire, la tuile « + » quittée ou le profil créé.
    LaunchedEffect(loading, failed, profiles.size, creating) {
        if (loading || creating) return@LaunchedEffect
        val entered = focusAdd && runCatching { addRequester.requestFocus() }.isSuccess
        focusAdd = false
        if (!entered) runCatching { firstRequester.requestFocus() }
    }
}

/** Limite d'âge proposée d'office à un profil créé sur la télé (profil enfant). */
private const val NEW_PROFILE_LIMIT = 7

/**
 * Nouveau profil : son nom, sa limite d'âge, puis « Créer le profil ». Le
 * focus arrive sur ce bouton : le nom et la limite proposés donnent un profil
 * enfant en un appui, et le clavier ne s'ouvre que si l'on monte sur le nom.
 */
@Composable
private fun NewProfileForm(busy: Boolean, error: Int?, onCreate: (String, Int) -> Unit, onCancel: () -> Unit) {
    val defaultName = stringResource(R.string.profiles_new_default_name)
    var name by remember { mutableStateOf(defaultName) }
    var limit by remember { mutableIntStateOf(NEW_PROFILE_LIMIT) }
    val createRequester = remember { FocusRequester() }
    Column(Modifier.width(460.dp)) {
        Text(stringResource(R.string.profiles_new_name), style = MovixType.Kicker)
        Spacer(Modifier.height(6.dp))
        NameField(name, { name = it.take(AgeRules.PROFILE_NAME_MAX) }, onDone = { runCatching { createRequester.requestFocus() } })
        Spacer(Modifier.height(18.dp))
        Text(stringResource(R.string.profiles_new_age), style = MovixType.Kicker)
        Spacer(Modifier.height(2.dp))
        val none = stringResource(R.string.profiles_new_none)
        ChoiceRow("", AgeRules.CHOICES.map { it to if (it == 0) none else stringResource(R.string.age_badge, it) }, limit, { limit = it })
        Text(
            if (limit > 0) stringResource(R.string.kids_state_on, limit) else stringResource(R.string.kids_state_off),
            style = MovixType.Body,
        )
        Spacer(Modifier.height(22.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PillButton(stringResource(R.string.profiles_new_create), { onCreate(name, limit) }, Modifier.focusRequester(createRequester))
            PillButton(stringResource(R.string.profiles_new_cancel), onCancel)
        }
        Spacer(Modifier.height(14.dp))
        Box(Modifier.height(22.dp)) {
            when {
                busy -> Text(stringResource(R.string.profiles_new_creating), style = MovixType.Meta)
                error != null -> Text(stringResource(error), style = MovixType.Body.copy(color = MovixColors.Red))
            }
        }
    }
    LaunchedEffect(Unit) { runCatching { createRequester.requestFocus() } }
}

/** Champ du nom : bordure claire au focus, OK ouvre le clavier de la télé. */
@Composable
private fun NameField(value: String, onChange: (String) -> Unit, onDone: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = MovixType.Button.copy(fontSize = 15.sp),
        cursorBrush = SolidColor(MovixColors.Text),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        interactionSource = source,
        modifier = Modifier
            .fillMaxWidth()
            .background(MovixColors.Panel, RoundedCornerShape(10.dp))
            .border(2.dp, if (focused) MovixColors.Text else MovixColors.Line, RoundedCornerShape(10.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
    )
}

/** Tuile « + » au bout des profils : ouvre le formulaire d'un nouveau profil. */
@Composable
private fun AddProfileTile(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val progress = focusProgress(focused)
    val press = pressProgress(source)
    Column(modifier.width(120.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .pressScale(press)
                .focusScale(progress, max = 1.1f)
                .size(112.dp)
                .border(3.dp, if (focused) MovixColors.Red else Color.Transparent, CircleShape)
                .clickable(interactionSource = source, indication = null, onClick = onClick)
                .padding(7.dp)
                .clip(CircleShape)
                .background(MovixColors.Chip),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                rememberVectorPainter(MovixIcons.Plus),
                null,
                Modifier.size(34.dp),
                colorFilter = ColorFilter.tint(if (focused) MovixColors.Text else MovixColors.Muted),
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(
            stringResource(R.string.profiles_add),
            style = MovixType.Button.copy(color = if (focused) MovixColors.Text else MovixColors.Muted, textAlign = TextAlign.Center),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
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
        // Badge « 12+ » des profils enfant, au coin de l'avatar comme sur le site ; il suit le zoom du focus.
        Box(Modifier.pressScale(press).focusScale(progress, max = 1.1f)) {
            Box(
                Modifier
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
            val limit = AgeRules.profileLimit(profile.ageRestriction)
            if (limit > 0) AgeBadge(limit, Modifier.align(Alignment.BottomEnd).padding(end = 6.dp, bottom = 6.dp))
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
