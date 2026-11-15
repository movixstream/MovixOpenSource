package com.movix.tv.ui.search

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.components.pressProgress
import com.movix.tv.ui.components.pressScale
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.delay

private val KeyShape = RoundedCornerShape(8.dp)
private val KeyGap = 6.dp

/**
 * Clavier à l'écran façon YouTube : champ avec curseur, onglets de pages
 * (lettres, accents, chiffres et symboles), micro si la télé sait dicter,
 * puis Espace / Effacer / Tout effacer. Le texte vit chez l'appelant.
 */
@Composable
fun SearchKeyboard(
    query: String,
    page: KeyPage,
    onPage: (KeyPage) -> Unit,
    onQuery: (String) -> Unit,
    onVoice: (() -> Unit)?,
    firstKey: FocusRequester,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        QueryField(query)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(KeyGap), modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
            KeyPage.entries.forEach { p ->
                PageTab(p.label, selected = p == page, modifier = Modifier.weight(1f)) { onPage(p) }
            }
            if (onVoice != null) {
                IconKey(MovixIcons.Mic, stringResource(R.string.search_voice), Modifier.width(48.dp).height(32.dp), onVoice)
            }
        }
        page.keys.chunked(KeyPage.COLUMNS).forEachIndexed { rowIndex, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(KeyGap), modifier = Modifier.fillMaxWidth().padding(bottom = KeyGap)) {
                row.forEachIndexed { i, key ->
                    val first = rowIndex == 0 && i == 0
                    TextKey(
                        key,
                        cell().then(if (first) Modifier.focusRequester(firstKey) else Modifier),
                        large = true,
                    ) { onQuery(SearchInput.type(query, key)) }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(KeyGap), modifier = Modifier.fillMaxWidth()) {
            TextKey(stringResource(R.string.search_space), cell(2f)) { onQuery(SearchInput.type(query, " ")) }
            IconKey(MovixIcons.Delete, stringResource(R.string.search_delete), cell()) { onQuery(SearchInput.delete(query)) }
            TextKey(stringResource(R.string.search_clear), cell(2f)) { onQuery("") }
        }
    }
}

/** Touche de la grille : largeur partagée avec ses voisines, hauteur fixe. */
private fun RowScope.cell(weight: Float = 1f): Modifier = Modifier.weight(weight).height(38.dp)

/**
 * Champ de saisie : loupe, texte (la fin reste visible quand il déborde) et
 * curseur rouge qui clignote. Le clignotement ne touche que la couche
 * graphique du curseur : aucune recomposition.
 */
@Composable
private fun QueryField(query: String) {
    val blink = remember { mutableFloatStateOf(1f) }
    LaunchedEffect(query) {
        blink.floatValue = 1f
        while (true) {
            delay(530)
            blink.floatValue = 1f - blink.floatValue
        }
    }
    Row(
        Modifier.fillMaxWidth().height(44.dp).background(MovixColors.Panel, RoundedCornerShape(10.dp)).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(rememberVectorPainter(MovixIcons.Search), null, Modifier.size(16.dp), colorFilter = ColorFilter.tint(MovixColors.Dim))
        Spacer(Modifier.width(10.dp))
        val caret = @Composable {
            Box(Modifier.width(2.dp).height(20.dp).graphicsLayer { alpha = blink.floatValue }.background(MovixColors.Red))
        }
        if (query.isEmpty()) {
            caret()
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.search_hint), style = MovixType.Button.copy(fontSize = 16.sp, color = MovixColors.Dim), maxLines = 1)
        } else {
            Text(
                query,
                style = MovixType.Button.copy(fontSize = 16.sp, color = MovixColors.Text),
                maxLines = 1,
                overflow = TextOverflow.StartEllipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.width(1.dp))
            caret()
        }
    }
}

/** Onglet de page : fond léger quand la page est ouverte, blanc au focus. */
@Composable
private fun PageTab(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    KeyBox(modifier.height(32.dp), onClick, selectedBg = if (selected) MovixColors.Chip else Color.Transparent) { focused ->
        Text(
            label,
            style = MovixType.Button.copy(
                fontSize = 13.sp,
                color = when {
                    focused -> MovixColors.Ink
                    selected -> MovixColors.Text
                    else -> MovixColors.Muted
                },
            ),
            maxLines = 1,
        )
    }
}

@Composable
private fun TextKey(label: String, modifier: Modifier, large: Boolean = false, onClick: () -> Unit) {
    KeyBox(modifier, onClick) { focused ->
        Text(
            label,
            style = MovixType.Button.copy(
                fontSize = if (large) 17.sp else MovixType.Button.fontSize,
                color = if (focused) MovixColors.Ink else MovixColors.Text,
            ),
            maxLines = 1,
        )
    }
}

@Composable
private fun IconKey(icon: ImageVector, description: String, modifier: Modifier, onClick: () -> Unit) {
    KeyBox(modifier.semantics { contentDescription = description }, onClick) { focused ->
        Image(
            rememberVectorPainter(icon),
            null,
            Modifier.size(18.dp),
            colorFilter = ColorFilter.tint(if (focused) MovixColors.Ink else MovixColors.Text),
        )
    }
}

/** Socle commun des touches : blanc au focus, s'enfonce à l'appui sur OK. */
@Composable
private fun KeyBox(
    modifier: Modifier,
    onClick: () -> Unit,
    selectedBg: Color = MovixColors.Panel,
    content: @Composable (focused: Boolean) -> Unit,
) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val press = pressProgress(source)
    Box(
        modifier
            .pressScale(press)
            .background(if (focused) MovixColors.Text else selectedBg, KeyShape)
            .clickable(interactionSource = source, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        content(focused)
    }
}
