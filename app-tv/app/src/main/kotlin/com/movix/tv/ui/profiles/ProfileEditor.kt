package com.movix.tv.ui.profiles

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.data.account.LinkedProfile
import com.movix.tv.data.account.ProfileRules
import com.movix.tv.data.age.AgeRules
import com.movix.tv.ui.components.AgeBadge
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.focusProgress
import com.movix.tv.ui.components.focusScale
import com.movix.tv.ui.components.pressProgress
import com.movix.tv.ui.components.pressScale
import com.movix.tv.ui.settings.ChoiceRow
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType

/**
 * Formulaire d'un profil, gardé par l'écran pendant le choix de l'avatar.
 * [original] : le profil modifié, `null` pour un nouveau profil.
 */
@Stable
internal class ProfileDraft(val original: LinkedProfile?, name: String, avatar: String, limit: Int) {
    var name by mutableStateOf(name)
    var avatar by mutableStateOf(avatar)
    var limit by mutableIntStateOf(limit)

    /** Limites proposées : Aucune, 7+, 12+, 16+, et 18+ seulement si le profil l'a déjà. */
    val choices: List<Int> = AgeRules.choicesFor(original?.let { AgeRules.profileLimit(it.ageRestriction) })

    /** Clé de la couleur des initiales : celle du profil, pour le reconnaître. */
    val colorKey: String get() = original?.id ?: "new"

    companion object {
        fun of(profile: LinkedProfile) =
            ProfileDraft(profile, profile.name, profile.avatar.orEmpty(), AgeRules.profileLimit(profile.ageRestriction))
    }
}

/** Élément de l'éditeur qui prend le focus quand il s'affiche. */
internal enum class EditorFocus {
    /** Ouverture : « Créer le profil » pour un nouveau profil (un appui suffit), l'avatar sinon. */
    ENTRY,
    /** Retour du choix de l'avatar. */
    AVATAR,
    /** Retour de la confirmation de suppression (« Garder le profil » ou Retour). */
    DELETE,
}

/**
 * Éditeur d'un profil : avatar (OK ouvre le choix), nom, limite d'âge, puis
 * Enregistrer (ou Créer), Annuler et, pour un profil existant, Supprimer.
 * [deleteBlocked] : pourquoi la suppression n'est pas proposée (profil en
 * cours, dernier profil), `null` si elle l'est. [status] : texte d'attente
 * pendant l'envoi ; [error] : dernier échec.
 *
 * Le focus d'entrée n'arrive jamais sur le nom : le clavier ne s'ouvre que
 * si l'on appuie sur OK dessus.
 */
@Composable
internal fun ProfileEditor(
    draft: ProfileDraft,
    siteHost: String?,
    status: Int?,
    error: Int?,
    deleteBlocked: Int?,
    entryFocus: EditorFocus,
    onPickAvatar: () -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
    onDelete: () -> Unit,
) {
    val avatarRequester = remember { FocusRequester() }
    val primaryRequester = remember { FocusRequester() }
    val deleteRequester = remember { FocusRequester() }
    val creating = draft.original == null

    Row(horizontalArrangement = Arrangement.spacedBy(44.dp)) {
        EditorAvatar(
            url = avatarUrl(draft.avatar, siteHost),
            name = draft.name,
            colorKey = draft.colorKey,
            limit = draft.limit,
            onClick = onPickAvatar,
            modifier = Modifier.focusRequester(avatarRequester),
        )
        Column(Modifier.width(440.dp)) {
            Text(stringResource(R.string.profiles_new_name), style = MovixType.Kicker)
            Spacer(Modifier.height(6.dp))
            NameField(draft.name, { draft.name = it.take(ProfileRules.PROFILE_NAME_MAX) }, stringResource(R.string.profiles_name_placeholder))
            Spacer(Modifier.height(18.dp))
            Text(stringResource(R.string.profiles_new_age), style = MovixType.Kicker)
            Spacer(Modifier.height(2.dp))
            val none = stringResource(R.string.profiles_new_none)
            ChoiceRow("", draft.choices.map { it to if (it == 0) none else stringResource(R.string.age_badge, it) }, draft.limit, { draft.limit = it })
            Text(
                when {
                    draft.limit <= 0 -> stringResource(R.string.kids_state_off)
                    draft.limit >= 18 -> stringResource(R.string.kids_state_adult)
                    else -> stringResource(R.string.kids_state_on, draft.limit)
                },
                style = MovixType.Body,
            )
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(
                    stringResource(if (creating) R.string.profiles_new_create else R.string.profiles_save),
                    onSave,
                    Modifier.focusRequester(primaryRequester),
                )
                PillButton(stringResource(R.string.profiles_new_cancel), onCancel)
                if (!creating && deleteBlocked == null) {
                    PillButton(stringResource(R.string.profiles_delete), onDelete, Modifier.focusRequester(deleteRequester), icon = ProfileIcons.Trash)
                }
            }
            if (!creating && deleteBlocked != null) {
                Spacer(Modifier.height(8.dp))
                Text(stringResource(deleteBlocked), style = MovixType.Meta)
            }
            Spacer(Modifier.height(12.dp))
            StatusLine(status, error)
        }
    }

    LaunchedEffect(Unit) {
        val target = when (entryFocus) {
            EditorFocus.ENTRY -> if (creating) primaryRequester else avatarRequester
            EditorFocus.AVATAR -> avatarRequester
            EditorFocus.DELETE -> if (deleteBlocked == null) deleteRequester else primaryRequester
        }
        if (!target.tryFocus()) {
            withFrameNanos { }
            if (!target.tryFocus()) primaryRequester.tryFocus()
        }
    }
}

/** Texte d'attente pendant un envoi, sinon la dernière erreur (en rouge). Hauteur fixe : rien ne saute. */
@Composable
private fun StatusLine(status: Int?, error: Int?) {
    Box(Modifier.height(44.dp)) {
        when {
            status != null -> Text(stringResource(status), style = MovixType.Meta)
            error != null -> Text(stringResource(error), style = MovixType.Body.copy(color = MovixColors.Red), maxLines = 2)
        }
    }
}

/** Grand avatar de l'éditeur, focusable : OK ouvre le choix de l'avatar. Badge « 12+ » de la limite choisie. */
@Composable
private fun EditorAvatar(url: String?, name: String, colorKey: String, limit: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val progress = focusProgress(focused)
    val press = pressProgress(source)
    Column(modifier.width(150.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.pressScale(press).focusScale(progress, max = 1.08f)) {
            Box(
                Modifier
                    .size(140.dp)
                    .border(3.dp, if (focused) MovixColors.Red else MovixColors.Line, CircleShape)
                    .clickable(interactionSource = source, indication = null, onClick = onClick)
                    .padding(8.dp),
            ) {
                AvatarFace(url, name, colorKey, 124.dp)
            }
            // Crayon au coin : l'avatar se change ici.
            Box(
                Modifier.align(Alignment.TopEnd).size(32.dp).background(if (focused) MovixColors.Text else MovixColors.Chip, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Image(rememberVectorPainter(ProfileIcons.Pencil), null, Modifier.size(15.dp), colorFilter = ColorFilter.tint(if (focused) MovixColors.Ink else MovixColors.Text))
            }
            if (limit > 0) AgeBadge(limit, Modifier.align(Alignment.BottomEnd).padding(end = 8.dp, bottom = 8.dp))
        }
        Spacer(Modifier.height(12.dp))
        Text(
            stringResource(R.string.profiles_avatar_change),
            style = MovixType.Button.copy(color = if (focused) MovixColors.Text else MovixColors.Muted, textAlign = TextAlign.Center),
            maxLines = 2,
        )
    }
}

/**
 * Nom du profil. Le cadre prend le focus sans ouvrir le clavier ; OK le passe
 * en saisie (clavier de la télé). « Terminé » du clavier, Retour ou un
 * déplacement du focus finissent la saisie, et le focus revient au cadre.
 */
@Composable
private fun NameField(value: String, onChange: (String) -> Unit, placeholder: String) {
    var editing by remember { mutableStateOf(false) }
    // La saisie finie par « Terminé » ou Retour rend le focus au cadre (pas après un déplacement).
    var refocusBox by remember { mutableStateOf(false) }
    var fieldFocused by remember { mutableStateOf(false) }
    var fieldHadFocus by remember { mutableStateOf(false) }
    val boxRequester = remember { FocusRequester() }
    val fieldRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val source = remember { MutableInteractionSource() }
    val boxFocused by source.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)

    fun stop(refocus: Boolean) {
        if (!editing) return
        keyboard?.hide()
        refocusBox = refocus
        fieldHadFocus = false
        editing = false
    }

    Box(
        Modifier
            .fillMaxWidth()
            .height(46.dp)
            .background(MovixColors.Panel, shape)
            .border(2.dp, if (boxFocused || fieldFocused) MovixColors.Text else MovixColors.Line, shape)
            .focusRequester(boxRequester)
            // Pendant la saisie, c'est le champ qui a le focus, pas le cadre.
            .focusProperties { canFocus = !editing }
            .clickable(interactionSource = source, indication = null) { editing = true }
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (editing) {
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = MovixType.Button.copy(fontSize = 15.sp),
                cursorBrush = SolidColor(MovixColors.Text),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done, autoCorrectEnabled = false),
                keyboardActions = KeyboardActions(onDone = { stop(refocus = true) }),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(fieldRequester)
                    .onFocusChanged {
                        fieldFocused = it.isFocused
                        if (it.isFocused) fieldHadFocus = true
                        else if (fieldHadFocus) stop(refocus = false)
                    }
                    // Clavier fermé, Retour finit la saisie (au lieu de fermer l'éditeur).
                    .onPreviewKeyEvent {
                        if (it.key != Key.Back && it.key != Key.Escape) return@onPreviewKeyEvent false
                        if (it.type == KeyEventType.KeyUp) stop(refocus = true)
                        true
                    },
            )
            LaunchedEffect(Unit) {
                if (!fieldRequester.tryFocus()) {
                    withFrameNanos { }
                    fieldRequester.tryFocus()
                }
                keyboard?.show()
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    value.ifBlank { placeholder },
                    style = MovixType.Button.copy(fontSize = 15.sp, color = if (value.isBlank()) MovixColors.Dim else MovixColors.Text),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (boxFocused) Text(stringResource(R.string.profiles_name_hint), style = MovixType.Meta)
            }
        }
    }

    LaunchedEffect(editing) {
        if (editing || !refocusBox) return@LaunchedEffect
        refocusBox = false
        withFrameNanos { }
        boxRequester.tryFocus()
    }
}

/**
 * Deuxième temps de la suppression : ce qui sera perdu, puis « Garder le
 * profil » (le focus y arrive : un double appui ne supprime rien) ou
 * « Supprimer définitivement ».
 */
@Composable
internal fun DeleteConfirm(profile: LinkedProfile, siteHost: String?, status: Int?, error: Int?, onKeep: () -> Unit, onConfirm: () -> Unit) {
    val keepRequester = remember { FocusRequester() }
    Column(Modifier.width(560.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        AvatarFace(avatarUrl(profile.avatar, siteHost), profile.name, profile.id, 112.dp)
        Spacer(Modifier.height(18.dp))
        Text(
            stringResource(R.string.profiles_delete_body),
            style = MovixType.Body.copy(color = MovixColors.Text, textAlign = TextAlign.Center),
        )
        Spacer(Modifier.height(22.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PillButton(stringResource(R.string.profiles_delete_keep), onKeep, Modifier.focusRequester(keepRequester))
            PillButton(stringResource(R.string.profiles_delete_confirm), onConfirm, icon = ProfileIcons.Trash)
        }
        Spacer(Modifier.height(14.dp))
        Box(Modifier.height(44.dp), contentAlignment = Alignment.TopCenter) {
            when {
                status != null -> Text(stringResource(status), style = MovixType.Meta)
                error != null -> Text(
                    stringResource(error),
                    style = MovixType.Body.copy(color = MovixColors.Red, textAlign = TextAlign.Center),
                    maxLines = 2,
                )
            }
        }
    }
    LaunchedEffect(Unit) {
        if (!keepRequester.tryFocus()) {
            withFrameNanos { }
            keepRequester.tryFocus()
        }
    }
}
