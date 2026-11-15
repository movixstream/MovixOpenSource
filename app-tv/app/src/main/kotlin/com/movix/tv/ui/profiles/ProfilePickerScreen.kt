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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.account.LinkedProfile
import com.movix.tv.data.account.ProfileChange
import com.movix.tv.data.account.ProfileRules
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
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Ce que montre l'écran ; Retour remonte d'un cran (avatars → éditeur → liste). */
private enum class PickerView { LIST, EDITOR, AVATARS, CONFIRM_DELETE, SIGNED_OUT }

/** Élément de la liste qui reprend le focus quand elle revient à l'écran. */
private sealed interface ListFocus {
    /** Le profil actuel, sinon le premier (ou « Réessayer »). */
    data object Default : ListFocus
    data class Tile(val id: String) : ListFocus
    data object Add : ListFocus
    data object Manage : ListFocus
}

/** Limite d'âge proposée d'office à un profil créé sur la télé (profil enfant). */
private const val NEW_PROFILE_LIMIT = 7

/** Voile posé sur les avatars en mode gestion, sous le crayon. */
private val ManageVeil = Color(0x99000000)

/**
 * « Qui regarde ? » façon Netflix : un avatar rond par profil du compte relié.
 * OK bascule la télé sur ce profil (la synchro suit) puis appelle [onDone] ;
 * Retour garde le profil actuel ([onBack]).
 *
 * La liste part des profils gardés sur la télé et se met à jour depuis le
 * serveur (`GET /api/profiles`). La tuile « + » crée un profil sans passer par
 * le site (avatar, nom et limite d'âge : c'est ainsi qu'on fait un profil enfant).
 *
 * « Gérer les profils » (ou [startManaging], depuis les réglages) : OK sur un
 * profil ouvre son éditeur (avatar, nom, limite d'âge, suppression) au lieu de
 * basculer dessus. Retour remonte d'un cran, et le focus revient à l'élément
 * qui avait ouvert le cran quitté.
 */
@Composable
fun ProfilePickerScreen(onDone: () -> Unit, onBack: () -> Unit, modifier: Modifier = Modifier, startManaging: Boolean = false) {
    val container = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val account by container.accounts.state.collectAsStateWithLifecycle()
    val values by container.store.values.collectAsStateWithLifecycle()
    // Avatars du site (`/avatars/…`) : servis par le domaine actuel du site.
    val siteHost = rememberSiteHost()

    var profiles by remember { mutableStateOf<List<LinkedProfile>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    var switching by remember { mutableStateOf(false) }
    var switchFailed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }

    var managing by remember { mutableStateOf(startManaging) }
    // Éditeur ouvert (nouveau profil ou profil existant), gardé pendant le choix de l'avatar.
    var draft by remember { mutableStateOf<ProfileDraft?>(null) }
    var pickingAvatar by remember { mutableStateOf(false) }
    var confirmingDelete by remember { mutableStateOf(false) }
    var editorFocus by remember { mutableStateOf(EditorFocus.ENTRY) }
    // Envoi au serveur en cours (texte d'attente) et dernier échec, dits sous le formulaire.
    var busy by remember { mutableStateOf<Int?>(null) }
    var error by remember { mutableStateOf<Int?>(null) }
    var signedOut by remember { mutableStateOf(false) }
    var listFocus by remember { mutableStateOf<ListFocus>(ListFocus.Default) }
    var focusNonce by remember { mutableIntStateOf(0) }

    val view = when {
        signedOut -> PickerView.SIGNED_OUT
        draft != null && pickingAvatar -> PickerView.AVATARS
        draft != null && confirmingDelete -> PickerView.CONFIRM_DELETE
        draft != null -> PickerView.EDITOR
        else -> PickerView.LIST
    }
    val currentId = account?.profileId
    val defaultName = stringResource(R.string.profiles_new_default_name)

    val tileRequesters = remember { mutableMapOf<String, FocusRequester>() }
    fun requesterFor(id: String): FocusRequester = tileRequesters.getOrPut(id) { FocusRequester() }
    val addRequester = remember { FocusRequester() }
    val manageRequester = remember { FocusRequester() }
    val retryRequester = remember { FocusRequester() }

    LaunchedEffect(attempt) {
        failed = false
        if (profiles.isEmpty()) profiles = container.accounts.cachedProfiles()
        loading = profiles.isEmpty()
        val fresh = runCatching { container.accounts.profiles() }.getOrNull()
        if (fresh != null && fresh.isNotEmpty()) profiles = fresh
        failed = fresh == null && profiles.isEmpty()
        loading = false
    }
    // Plus de compte (session supprimée depuis le site) : plus rien à choisir ni à gérer, on le dit.
    LaunchedEffect(account) { if (account == null) signedOut = true }

    // Éditeur ouvert : le choix d'avatar est préparé (catalogue, premières vignettes) et s'ouvrira
    // sans attente. Éditeur fermé : les vignettes sont rendues.
    val thumbs = rememberAvatarThumbs()
    val avatarsPerRow = rememberAvatarsPerRow()
    val editorOpen = draft != null
    val editedAvatar = draft?.avatar
    LaunchedEffect(editorOpen, editedAvatar) {
        if (editorOpen) prepareAvatarPicker(thumbs, editedAvatar, avatarsPerRow) else thumbs.trim()
    }

    fun focusList(target: ListFocus) {
        listFocus = target
        focusNonce++
    }

    fun closeEditor(target: ListFocus) {
        draft = null
        pickingAvatar = false
        confirmingDelete = false
        error = null
        focusList(target)
    }

    fun choose(p: LinkedProfile) {
        if (switching) return
        if (p.id == currentId) { onDone(); return }
        switching = true
        switchFailed = false
        scope.launch {
            val ok = container.sync.switchProfile(p)
            switching = false
            if (ok) onDone() else switchFailed = true
        }
    }

    fun openEditor(p: LinkedProfile) {
        if (switching || busy != null) return
        error = null
        editorFocus = EditorFocus.ENTRY
        draft = ProfileDraft.of(p)
    }

    fun openNew() {
        if (switching || busy != null) return
        error = null
        editorFocus = EditorFocus.ENTRY
        // Un avatar que les autres profils n'ont pas, proposé d'office : on peut le changer.
        draft = ProfileDraft(null, defaultName, ProfileRules.newProfileAvatar(profiles.map { it.avatar }), NEW_PROFILE_LIMIT)
    }

    fun setManaging(on: Boolean) {
        if (switching) return
        switchFailed = false
        // Ouvert en mode gestion (depuis les réglages) : « Terminé » referme l'écran.
        if (!on && startManaging) { onBack(); return }
        managing = on
        focusList(if (on) ListFocus.Default else ListFocus.Manage)
    }

    fun save() {
        val d = draft ?: return
        if (busy != null) return
        if (ProfileRules.profileName(d.name) == null) { error = R.string.profiles_new_name_empty; return }
        val original = d.original
        error = null
        busy = if (original == null) R.string.profiles_new_creating else R.string.profiles_saving
        scope.launch {
            // Mené au bout même si l'écran se ferme : le profil enregistré est gardé sur la télé.
            val result = withContext(NonCancellable) {
                if (original == null) container.accounts.createProfile(d.name, d.limit, d.avatar)
                else container.accounts.updateProfile(original, d.name, d.avatar, d.limit)
            }
            busy = null
            when (result.status) {
                ProfileChange.OK -> {
                    val saved = result.profile
                    if (saved != null) {
                        profiles = if (profiles.any { it.id == saved.id }) profiles.map { if (it.id == saved.id) saved else it } else profiles + saved
                    }
                    // Le focus revient sur le profil enregistré (en mode normal, OK y bascule).
                    closeEditor(saved?.let { ListFocus.Tile(it.id) } ?: ListFocus.Default)
                    // La liste du serveur fait foi (elle a pu être lue avant l'envoi). Rien envoyé : rien à relire.
                    if (saved !== original) attempt++
                }
                ProfileChange.REFUSED -> error = if (original == null) R.string.profiles_new_refused else R.string.profiles_edit_refused
                ProfileChange.NETWORK -> error = R.string.profiles_network
                // Session supprimée depuis le site : l'écran le dit (plus de compte).
                ProfileChange.SIGNED_OUT -> signedOut = true
            }
        }
    }

    fun delete() {
        val target = draft?.original ?: return
        if (busy != null) return
        error = null
        busy = R.string.profiles_deleting
        scope.launch {
            val status = withContext(NonCancellable) { container.accounts.deleteProfile(target) }
            busy = null
            when (status) {
                ProfileChange.OK -> {
                    val index = profiles.indexOfFirst { it.id == target.id }
                    profiles = profiles.filter { it.id != target.id }
                    // Le focus va au profil d'à côté (celui d'avant, sinon le premier), ou à « + ».
                    val neighbor = profiles.getOrNull((index - 1).coerceAtLeast(0))
                    closeEditor(neighbor?.let { ListFocus.Tile(it.id) } ?: ListFocus.Add)
                    attempt++
                }
                ProfileChange.REFUSED -> error = R.string.profiles_delete_refused
                ProfileChange.NETWORK -> error = R.string.profiles_network
                ProfileChange.SIGNED_OUT -> signedOut = true
            }
        }
    }

    fun keepProfile() {
        if (busy != null) return
        confirmingDelete = false
        error = null
        editorFocus = EditorFocus.DELETE
    }

    BackHandler {
        when (view) {
            PickerView.SIGNED_OUT -> onBack()
            // L'avatar ne change pas ; le focus revient sur l'avatar de l'éditeur.
            PickerView.AVATARS -> {
                pickingAvatar = false
                editorFocus = EditorFocus.AVATAR
            }
            PickerView.CONFIRM_DELETE -> keepProfile()
            // Rien n'est enregistré ; le focus revient sur la tuile qui a ouvert l'éditeur.
            PickerView.EDITOR -> if (busy == null) closeEditor(draft?.original?.let { ListFocus.Tile(it.id) } ?: ListFocus.Add)
            PickerView.LIST -> when {
                switching -> Unit
                managing && !startManaging -> setManaging(false)
                else -> onBack()
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
        val editing = draft
        if (view == PickerView.AVATARS && editing != null) {
            AvatarPicker(
                current = editing.avatar,
                siteHost = siteHost,
                onPick = { path ->
                    editing.avatar = path
                    pickingAvatar = false
                    editorFocus = EditorFocus.AVATAR
                },
            )
        } else Column(horizontalAlignment = Alignment.CenterHorizontally) {
            val title = when (view) {
                PickerView.LIST -> stringResource(if (managing) R.string.profiles_manage else R.string.profiles_title)
                PickerView.EDITOR, PickerView.AVATARS ->
                    stringResource(if (editing?.original == null) R.string.profiles_new_title else R.string.profiles_edit_title)
                PickerView.CONFIRM_DELETE -> stringResource(R.string.profiles_delete_title, editing?.original?.name.orEmpty())
                PickerView.SIGNED_OUT -> stringResource(R.string.profiles_signed_out_title)
            }
            val body = when (view) {
                PickerView.LIST -> stringResource(if (managing) R.string.profiles_manage_body else R.string.profiles_body)
                PickerView.EDITOR, PickerView.AVATARS ->
                    stringResource(if (editing?.original == null) R.string.profiles_new_body else R.string.profiles_edit_body)
                PickerView.CONFIRM_DELETE -> null
                PickerView.SIGNED_OUT -> stringResource(R.string.profiles_signed_out)
            }
            Text(title, style = MovixType.Hero, textAlign = TextAlign.Center, modifier = Modifier.width(820.dp))
            if (body != null) {
                Spacer(Modifier.height(8.dp))
                Text(body, style = MovixType.Body, textAlign = TextAlign.Center, modifier = Modifier.width(620.dp))
            }
            Spacer(Modifier.height(36.dp))
            when (view) {
                PickerView.SIGNED_OUT -> {
                    val closeRequester = remember { FocusRequester() }
                    PillButton(stringResource(R.string.profiles_close), onBack, Modifier.focusRequester(closeRequester))
                    LaunchedEffect(Unit) {
                        withFrameNanos { }
                        closeRequester.tryFocus()
                    }
                }
                PickerView.CONFIRM_DELETE -> editing?.original?.let { target ->
                    DeleteConfirm(
                        profile = target,
                        siteHost = siteHost,
                        status = busy,
                        error = error,
                        onKeep = ::keepProfile,
                        onConfirm = ::delete,
                    )
                }
                PickerView.EDITOR, PickerView.AVATARS -> if (editing != null) {
                    // Jamais le profil en cours ni le dernier : le serveur en recréerait un, historique perdu.
                    val deleteBlocked = editing.original?.let { p ->
                        when {
                            ProfileRules.canDelete(p.id, currentId, profiles.size) -> null
                            p.id == currentId -> R.string.profiles_delete_current
                            else -> R.string.profiles_delete_last
                        }
                    }
                    ProfileEditor(
                        draft = editing,
                        siteHost = siteHost,
                        status = busy,
                        error = error,
                        deleteBlocked = deleteBlocked,
                        entryFocus = editorFocus,
                        onPickAvatar = { if (busy == null) pickingAvatar = true },
                        onSave = ::save,
                        onCancel = { if (busy == null) closeEditor(editing.original?.let { ListFocus.Tile(it.id) } ?: ListFocus.Add) },
                        onDelete = {
                            if (busy == null) {
                                error = null
                                confirmingDelete = true
                            }
                        },
                    )
                }
                PickerView.LIST -> ProfileList(
                    profiles = profiles,
                    loading = loading,
                    failed = failed,
                    currentId = currentId,
                    managing = managing,
                    siteHost = siteHost,
                    requesterFor = ::requesterFor,
                    addRequester = addRequester,
                    retryRequester = retryRequester,
                    onRetry = { attempt++ },
                    onProfile = { p -> if (managing) openEditor(p) else choose(p) },
                    onAdd = ::openNew,
                )
            }
            if (view == PickerView.LIST) {
                Spacer(Modifier.height(28.dp))
                Box(Modifier.height(22.dp)) {
                    when {
                        switching -> Text(stringResource(R.string.profiles_switching), style = MovixType.Meta)
                        switchFailed -> Text(stringResource(R.string.profiles_error), style = MovixType.Body.copy(color = MovixColors.Red))
                    }
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (!loading && !failed) {
                        PillButton(
                            stringResource(if (managing) R.string.profiles_manage_done else R.string.profiles_manage),
                            { setManaging(!managing) },
                            Modifier.focusRequester(manageRequester),
                            icon = if (managing) MovixIcons.Check else ProfileIcons.Pencil,
                        )
                    }
                    if (!managing) {
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
        }
    }

    // Focus de la liste : à l'entrée le profil actuel (ou le premier, ou
    // « Réessayer ») ; au retour de l'éditeur la tuile qui l'a ouvert, le
    // profil créé ou le voisin du profil supprimé ; « Gérer les profils » en
    // quittant le mode gestion. L'éditeur, les avatars et la confirmation
    // donnent eux-mêmes leur focus d'entrée.
    LaunchedEffect(view, loading, failed, focusNonce) {
        if (view != PickerView.LIST || loading) return@LaunchedEffect
        withFrameNanos { }
        val wanted = listFocus
        listFocus = ListFocus.Default
        val ids = profiles.map { it.id }
        val done = when (wanted) {
            is ListFocus.Tile -> wanted.id in ids && requesterFor(wanted.id).tryFocus()
            ListFocus.Add -> addRequester.tryFocus()
            ListFocus.Manage -> manageRequester.tryFocus()
            ListFocus.Default -> false
        }
        if (done) return@LaunchedEffect
        if (failed) {
            retryRequester.tryFocus()
            return@LaunchedEffect
        }
        val fallback = currentId?.takeIf { it in ids } ?: ids.firstOrNull()
        if (fallback == null || !requesterFor(fallback).tryFocus()) addRequester.tryFocus()
    }
}

/** Les profils en tuiles rondes, puis « + » (cinq profils au plus) ; ou le chargement, ou l'erreur et « Réessayer ». */
@Composable
private fun ProfileList(
    profiles: List<LinkedProfile>,
    loading: Boolean,
    failed: Boolean,
    currentId: String?,
    managing: Boolean,
    siteHost: String?,
    requesterFor: (String) -> FocusRequester,
    addRequester: FocusRequester,
    retryRequester: FocusRequester,
    onRetry: () -> Unit,
    onProfile: (LinkedProfile) -> Unit,
    onAdd: () -> Unit,
) {
    when {
        loading -> Text(stringResource(R.string.profiles_loading), style = MovixType.Meta)
        failed -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.profiles_error), style = MovixType.Body.copy(color = MovixColors.Red))
            Spacer(Modifier.height(14.dp))
            PillButton(stringResource(R.string.profiles_retry), onRetry, Modifier.focusRequester(retryRequester))
        }
        else -> Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            profiles.forEach { p ->
                ProfileTile(
                    profile = p,
                    current = p.id == currentId,
                    managing = managing,
                    avatarUrl = avatarUrl(p.avatar, siteHost),
                    onClick = { onProfile(p) },
                    modifier = Modifier.focusRequester(requesterFor(p.id)),
                )
            }
            // Profil (enfant) créé depuis la télé : le serveur en garde cinq au plus.
            if (profiles.size < ProfileRules.MAX_PROFILES) AddProfileTile(onAdd, Modifier.focusRequester(addRequester))
        }
    }
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

/**
 * Tuile d'un profil. En mode gestion ([managing]), un voile et un crayon sur
 * l'avatar, comme sur le site : OK ouvre l'éditeur.
 */
@Composable
private fun ProfileTile(
    profile: LinkedProfile,
    current: Boolean,
    managing: Boolean,
    avatarUrl: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val progress = focusProgress(focused)
    val press = pressProgress(source)
    Column(modifier.width(120.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        // Badge « 12+ » des profils enfant, au coin de l'avatar comme sur le site ; il suit le zoom du focus.
        Box(Modifier.pressScale(press).focusScale(progress, max = 1.1f)) {
            Box(
                Modifier
                    .size(112.dp)
                    // Anneau à la couleur d'accent au focus, comme les crochets des cartes.
                    .border(3.dp, if (focused) MovixColors.Red else Color.Transparent, CircleShape)
                    .clickable(interactionSource = source, indication = null, onClick = onClick)
                    .padding(7.dp),
                contentAlignment = Alignment.Center,
            ) {
                // Initiales sous l'image : visibles tant qu'elle charge ou si elle manque.
                AvatarFace(avatarUrl, profile.name, profile.id, 98.dp)
                if (managing) {
                    Box(Modifier.size(98.dp).clip(CircleShape).background(ManageVeil), contentAlignment = Alignment.Center) {
                        Image(rememberVectorPainter(ProfileIcons.Pencil), null, Modifier.size(28.dp), colorFilter = ColorFilter.tint(Color.White))
                    }
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
            when {
                current -> Text(stringResource(R.string.profiles_current), style = MovixType.Kicker.copy(color = MovixColors.Red, fontSize = 11.sp))
                managing && focused -> Text(stringResource(R.string.profiles_manage_edit), style = MovixType.Kicker.copy(fontSize = 11.sp))
            }
        }
    }
}
