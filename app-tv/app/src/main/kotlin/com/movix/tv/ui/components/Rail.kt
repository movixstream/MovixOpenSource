package com.movix.tv.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.data.local.UiPrefs
import com.movix.tv.ui.nav.Section
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType

private data class RailEntry(val section: Section, val icon: ImageVector, val label: Int)

private val Entries = listOf(
    RailEntry(Section.SEARCH, MovixIcons.Search, R.string.nav_search),
    RailEntry(Section.HOME, MovixIcons.Home, R.string.nav_home),
    RailEntry(Section.MOVIES, MovixIcons.Film, R.string.nav_movies),
    RailEntry(Section.SERIES, MovixIcons.Tv, R.string.nav_series),
    RailEntry(Section.ANIME, MovixIcons.Spark, R.string.nav_anime),
    RailEntry(Section.WATCHLIST, MovixIcons.Plus, R.string.nav_watchlist),
)
private val SettingsEntry = RailEntry(Section.SETTINGS, MovixIcons.Gear, R.string.nav_settings)

/** Entrées du rail que l'utilisateur peut cacher (Réglages ne l'est jamais), dans l'ordre du rail. */
val RailHideable: List<Section> = Entries.map { it.section }

/**
 * Entrées cachées d'après le réglage `UiKeys.RAIL_HIDDEN`. Noms inconnus et
 * Réglages ignorés ; tout caché ne compte pas (le rail garderait Réglages seul).
 */
fun railHiddenSections(values: Map<String, String>): Set<Section> {
    val hidden = UiPrefs.railHidden(values).mapNotNull { name -> RailHideable.firstOrNull { it.name == name } }.toSet()
    return if (hidden.size >= RailHideable.size) emptySet() else hidden
}

/** Libellé d'une entrée du rail (pour les réglages). */
fun railLabel(section: Section): Int = (Entries + SettingsEntry).first { it.section == section }.label

/** Icône d'une entrée du rail (pour les réglages). */
fun railIcon(section: Section): ImageVector = (Entries + SettingsEntry).first { it.section == section }.icon

/** Première section visible du rail (Accueil en tête si elle l'est). */
fun firstVisibleSection(hidden: Set<Section>): Section =
    if (Section.HOME !in hidden) Section.HOME else RailHideable.firstOrNull { it !in hidden } ?: Section.SETTINGS

/**
 * Rail de gauche. Replié (icônes seules) tant qu'il n'a pas le focus ; ouvert,
 * il montre les libellés sur un dégradé. La section courante porte un trait rouge.
 * [hidden] : entrées cachées dans les réglages (lues en direct).
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun Rail(
    current: Section,
    onSelect: (Section) -> Unit,
    focusRequester: FocusRequester,
    onFocusChanged: (Boolean) -> Unit,
    onEnterContent: () -> Unit,
    modifier: Modifier = Modifier,
    hidden: Set<Section> = emptySet(),
) {
    var expanded by remember { mutableStateOf(false) }
    val currentRequester = remember { FocusRequester() }
    Column(
        modifier
            // Droite : on entre dans la page. La recherche 2D de Compose ne trouve
            // rien quand le rail ouvert recouvre le début des rangées.
            .onPreviewKeyEvent {
                if (it.type == KeyEventType.KeyDown && it.key == Key.DirectionRight) { onEnterContent(); true } else false
            }
            .fillMaxHeight()
            .width(if (expanded) 220.dp else 60.dp)
            .background(
                Brush.horizontalGradient(
                    if (expanded) listOf(MovixColors.Ink, MovixColors.Ink.copy(alpha = 0.92f), MovixColors.Ink.copy(alpha = 0f))
                    else listOf(MovixColors.Ink.copy(alpha = 0.92f), MovixColors.Ink.copy(alpha = 0f)),
                ),
            )
            .focusRequester(focusRequester)
            .focusRestorer(currentRequester)
            .onFocusChanged { expanded = it.hasFocus; onFocusChanged(it.hasFocus) }
            .focusGroup()
            .padding(top = 26.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Image(
            painterResource(R.drawable.ic_movix_mark),
            contentDescription = null,
            modifier = Modifier.padding(start = 13.dp, bottom = 12.dp).size(34.dp),
        )
        // key : une entrée cachée ou remontrée ne déplace pas l'état (focus) des autres.
        Entries.filter { it.section !in hidden }.forEach { e -> key(e.section) {
            RailItem(e, e.section == current, expanded, if (e.section == current) currentRequester else null) { onSelect(e.section) }
        } }
        Spacer(Modifier.weight(1f))
        RailItem(SettingsEntry, current == Section.SETTINGS, expanded, if (current == Section.SETTINGS) currentRequester else null) {
            onSelect(Section.SETTINGS)
        }
    }
}

@Composable
private fun RailItem(entry: RailEntry, isCurrent: Boolean, expanded: Boolean, requester: FocusRequester?, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val fg = when {
        focused -> MovixColors.Ink
        isCurrent || expanded -> MovixColors.Text
        else -> MovixColors.Dim
    }
    Box(Modifier.padding(start = 13.dp)) {
        if (isCurrent) {
            Box(Modifier.offset(x = (-13).dp, y = 9.dp).size(3.dp, 16.dp).background(MovixColors.Red, RoundedCornerShape(2.dp)))
        }
        Row(
            Modifier
                .then(if (requester != null) Modifier.focusRequester(requester) else Modifier)
                .height(34.dp)
                .then(if (expanded) Modifier.width(180.dp) else Modifier.width(34.dp))
                .background(if (focused) MovixColors.Text else MovixColors.Ink.copy(alpha = 0f), RoundedCornerShape(10.dp))
                .clickable(interactionSource = source, indication = null, onClick = onClick)
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Image(rememberVectorPainter(entry.icon), null, Modifier.size(18.dp), colorFilter = ColorFilter.tint(fg))
            if (expanded) Text(stringResource(entry.label), style = MovixType.Button.copy(color = fg), maxLines = 1)
        }
    }
}
