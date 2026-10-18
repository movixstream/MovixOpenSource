package com.movix.tv.ui.settings

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.components.TabPill
import com.movix.tv.ui.components.focusProgress
import com.movix.tv.ui.components.focusScale
import com.movix.tv.ui.components.pressProgress
import com.movix.tv.ui.components.pressScale
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType

/**
 * Onglet de la colonne de gauche des réglages : la section suit le focus
 * (comme les réglages d'Android TV), OK entre dans la section.
 */
@Composable
internal fun SettingsTab(text: String, selected: Boolean, onFocused: () -> Unit, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    LaunchedEffect(focused) { if (focused) onFocused() }
    val press = pressProgress(source)
    val bg = when {
        focused -> MovixColors.Text
        selected -> MovixColors.Chip
        else -> Color.Transparent
    }
    val fg = when {
        focused -> MovixColors.Ink
        selected -> MovixColors.Text
        else -> MovixColors.Muted
    }
    Box(modifier.fillMaxWidth()) {
        if (selected) {
            // Même repère que la section courante du rail.
            Box(Modifier.align(Alignment.CenterStart).offset(x = (-10).dp).size(3.dp, 16.dp).background(MovixColors.Red, RoundedCornerShape(2.dp)))
        }
        Text(
            text,
            style = MovixType.Button.copy(color = fg),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .pressScale(press)
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(bg)
                .clickable(interactionSource = source, indication = null, onClick = onClick)
                .padding(horizontal = 14.dp, vertical = 9.dp),
        )
    }
}

/** Titre et texte d'introduction d'un groupe de réglages. */
@Composable
internal fun PaneHeader(title: String, body: String? = null) {
    Text(title, style = MovixType.Panel)
    if (body != null) {
        Spacer(Modifier.height(4.dp))
        Text(body, style = MovixType.Body)
    }
    Spacer(Modifier.height(12.dp))
}

/** Ligne avec interrupteur : toute la ligne prend le focus, OK bascule. */
@Composable
internal fun ToggleRow(
    title: String,
    checked: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    body: String? = null,
    icon: ImageVector? = null,
) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val press = pressProgress(source)
    val fg = if (focused) MovixColors.Ink else MovixColors.Text
    Row(
        modifier
            .pressScale(press, min = 0.97f)
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (focused) MovixColors.Text else MovixColors.Panel)
            .clickable(interactionSource = source, indication = null, onClick = onToggle)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) Image(rememberVectorPainter(icon), null, Modifier.size(18.dp), colorFilter = ColorFilter.tint(fg))
        Column(Modifier.weight(1f)) {
            Text(title, style = MovixType.Button.copy(color = fg), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (body != null) {
                Text(body, style = MovixType.Meta.copy(color = if (focused) MovixColors.Ink.copy(alpha = 0.7f) else MovixColors.Muted), maxLines = 2)
            }
        }
        Switch(checked, focused)
    }
}

/** Interrupteur dessiné : piste à la couleur d'accent quand il est ouvert. */
@Composable
private fun Switch(checked: Boolean, focused: Boolean) {
    val knob by animateDpAsState(if (checked) 20.dp else 3.dp, tween(160), label = "switch")
    val track by animateColorAsState(
        when {
            checked -> MovixColors.Red
            focused -> MovixColors.Dim
            else -> MovixColors.Line
        },
        tween(160),
        label = "track",
    )
    Box(Modifier.size(40.dp, 23.dp).background(track, RoundedCornerShape(999.dp))) {
        Box(Modifier.offset(x = knob, y = 3.dp).size(17.dp).background(Color.White, CircleShape))
    }
}

/**
 * Un réglage à choix : libellé à gauche, pastilles à droite (Gauche/Droite
 * pour passer de l'une à l'autre, OK choisit).
 */
@Composable
internal fun <T> ChoiceRow(label: String, options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically) {
        if (label.isNotEmpty()) Text(label, style = MovixType.Kicker, modifier = Modifier.width(110.dp), maxLines = 1)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            options.forEach { (value, text) -> TabPill(text, value == selected, { onSelect(value) }) }
        }
    }
}

/** Pastille ronde de couleur d'accent : anneau blanc au focus, coche si choisie. */
@Composable
internal fun ColorSwatch(color: Color, selected: Boolean, onClick: () -> Unit, onFocused: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    LaunchedEffect(focused) { if (focused) onFocused() }
    val progress = focusProgress(focused)
    val press = pressProgress(source)
    Box(
        Modifier
            .pressScale(press)
            .focusScale(progress, max = 1.12f)
            .size(52.dp)
            .border(3.dp, if (focused) MovixColors.Text else Color.Transparent, CircleShape)
            .clickable(interactionSource = source, indication = null, onClick = onClick)
            .padding(6.dp)
            .background(color, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            val tint = if (color.luminance() > 0.5f) MovixColors.Ink else Color.White
            Image(rememberVectorPainter(MovixIcons.Check), null, Modifier.size(20.dp), colorFilter = ColorFilter.tint(tint))
        }
    }
}

/** Petit bouton carré à flèche (▲ ▼) des rangées de l'accueil. */
@Composable
internal fun ArrowButton(up: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val press = pressProgress(source)
    val fg = when {
        focused -> MovixColors.Ink
        enabled -> MovixColors.Text
        else -> MovixColors.Dim
    }
    Box(
        Modifier
            .pressScale(press)
            .size(36.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (focused) MovixColors.Text else MovixColors.Panel)
            .clickable(interactionSource = source, indication = null, onClick = { if (enabled) onClick() }),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            rememberVectorPainter(MovixIcons.Chevron),
            null,
            Modifier.size(16.dp).rotate(if (up) -90f else 90f),
            colorFilter = ColorFilter.tint(fg),
        )
    }
}
