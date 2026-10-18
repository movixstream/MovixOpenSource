package com.movix.tv.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.local.AccentColor
import com.movix.tv.data.local.HomeRows
import com.movix.tv.data.local.SubtitleStyle
import com.movix.tv.data.local.UiKeys
import com.movix.tv.data.local.UiPrefs
import com.movix.tv.data.tmdb.RowRegistry
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.RailHideable
import com.movix.tv.ui.components.TmdbImage
import com.movix.tv.ui.components.railHiddenSections
import com.movix.tv.ui.components.railIcon
import com.movix.tv.ui.components.railLabel
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import com.movix.tv.ui.theme.subtitleFontFamily
import com.movix.tv.ui.theme.subtitleFontLabel
import kotlinx.coroutines.launch
import com.movix.tv.data.tmdb.TmdbImage as TmdbUrls

/** Réglages de la télé : lus en direct, écrits tout de suite (appliqués par le reste de l'appli). */
@Composable
private fun rememberUiValues(): Pair<Map<String, String>, (String, String?) -> Unit> {
    val container = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val values by container.store.values.collectAsStateWithLifecycle()
    return values to { k, v -> scope.launch { container.store.set(k, v) } }
}

private val PaneScroll = Modifier.fillMaxSize()

// ---------------------------------------------------------------- Apparence

private val AccentNames = mapOf(
    AccentColor.RED to R.string.accent_red,
    AccentColor.BLUE to R.string.accent_blue,
    AccentColor.GREEN to R.string.accent_green,
    AccentColor.PURPLE to R.string.accent_purple,
    AccentColor.ORANGE to R.string.accent_orange,
    AccentColor.PINK to R.string.accent_pink,
    AccentColor.YELLOW to R.string.accent_yellow,
)

@Composable
internal fun AppearancePane() {
    val (values, write) = rememberUiValues()
    val current = UiPrefs.accent(values)
    var focusedColor by remember { mutableStateOf<AccentColor?>(null) }
    Column(PaneScroll.verticalScroll(rememberScrollState())) {
        PaneHeader(stringResource(R.string.settings_accent_title), stringResource(R.string.settings_accent_body))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AccentColor.entries.forEach { accent ->
                ColorSwatch(
                    color = Color(accent.argb),
                    selected = accent == current,
                    onClick = { write(UiKeys.ACCENT, if (accent == AccentColor.RED) null else accent.id) },
                    onFocused = { focusedColor = accent },
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        // Nom de la pastille sous le focus, sinon celui de la couleur choisie.
        val shown = focusedColor ?: current
        Text(stringResource(AccentNames.getValue(shown)), style = MovixType.MetaStrong)
    }
}

// ---------------------------------------------------------------- Sous-titres

@Composable
internal fun SubtitlesPane() {
    val (values, write) = rememberUiValues()
    val style = UiPrefs.subtitleStyle(values)
    fun save(next: SubtitleStyle) = write(UiKeys.SUBTITLE_STYLE, if (next == SubtitleStyle()) null else UiPrefs.encode(next))

    Column(Modifier.fillMaxSize()) {
        // L'aperçu reste en place pendant qu'on descend dans les réglages.
        SubtitlePreview(style)
        Spacer(Modifier.height(12.dp))
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            ChoiceRow(
                stringResource(R.string.subs_size),
                listOf(75, 100, 125, 150, 200).map { it to stringResource(R.string.subs_percent, it) },
                style.size,
                { save(style.copy(size = it)) },
            )
            ChoiceRow(
                stringResource(R.string.subs_color),
                listOf(
                    "white" to stringResource(R.string.subs_color_white),
                    "yellow" to stringResource(R.string.subs_color_yellow),
                    "cyan" to stringResource(R.string.subs_color_cyan),
                    "green" to stringResource(R.string.subs_color_green),
                ),
                style.color,
                { save(style.copy(color = it)) },
            )
            ChoiceRow(
                stringResource(R.string.subs_font),
                SubtitleStyle.FONTS.map { it to stringResource(subtitleFontLabel(it)) },
                style.font,
                { save(style.copy(font = it)) },
            )
            ChoiceRow(
                stringResource(R.string.subs_background),
                listOf(0, 25, 45, 75).map { it to if (it == 0) stringResource(R.string.subs_bg_none) else stringResource(R.string.subs_percent, it) },
                style.background,
                { save(style.copy(background = it)) },
            )
            ChoiceRow(
                stringResource(R.string.subs_position),
                listOf("bottom" to stringResource(R.string.subs_pos_bottom), "raised" to stringResource(R.string.subs_pos_raised)),
                style.position,
                { save(style.copy(position = it)) },
            )
            ChoiceRow(
                stringResource(R.string.subs_outline),
                listOf(true to stringResource(R.string.subs_yes), false to stringResource(R.string.subs_no)),
                style.outline,
                { save(style.copy(outline = it)) },
            )
            Spacer(Modifier.height(12.dp))
            PillButton(stringResource(R.string.subs_reset), { save(SubtitleStyle()) })
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** Une image du catalogue (tendances) avec une réplique d'exemple dans le style choisi. */
@Composable
private fun SubtitlePreview(style: SubtitleStyle) {
    val container = LocalContext.current.container
    val backdrop by produceState<String?>(null) {
        value = runCatching {
            container.catalog.page(RowRegistry.home.first(), 1).firstNotNullOfOrNull { TmdbUrls.backdrop(it.backdropPath) }
        }.getOrNull()
    }
    Box(
        Modifier
            .fillMaxWidth()
            .height(150.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Brush.verticalGradient(listOf(Color(0xFF3A4A5C), Color(0xFF1C232B), Color(0xFF2B2118)))),
    ) {
        if (backdrop != null) TmdbImage(backdrop, 520.dp, 150.dp, Modifier.fillMaxSize())
        val color = Color(SubtitleStyle.COLORS[style.color] ?: 0xFFFFFFFF)
        // 100 % ≈ la taille du lecteur ramenée à la largeur de l'aperçu.
        val size = (13f * style.size.coerceIn(50, 250) / 100f).sp
        val base = TextStyle(fontFamily = subtitleFontFamily(style.font), fontWeight = FontWeight.SemiBold, fontSize = size, lineHeight = size * 1.25f, textAlign = TextAlign.Center)
        val line = stringResource(R.string.subs_preview_line)
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = if (style.position == "raised") 40.dp else 12.dp, start = 16.dp, end = 16.dp)
                .background(Color.Black.copy(alpha = style.background.coerceIn(0, 100) / 100f), RoundedCornerShape(4.dp))
                .padding(horizontal = 8.dp, vertical = 3.dp),
        ) {
            if (style.outline) Text(line, style = base.copy(color = Color.Black, drawStyle = Stroke(width = 4f)))
            Text(line, style = base.copy(color = color))
        }
    }
}

// ---------------------------------------------------------------- Accueil

@Composable
internal fun HomePane() {
    val (values, write) = rememberUiValues()
    val choices = remember { RowRegistry.homeChoices() }
    val titles = remember(choices) { choices.toMap() }
    val rows = UiPrefs.homeRows(values)
    // Ordre complet affiché : celui du réglage, puis les autres dans l'ordre par défaut.
    val order = remember(rows) {
        val known = rows.order.distinct().filter { it in titles }
        known + choices.map { it.first }.filter { it !in known }
    }
    // Ce que l'accueil affiche vraiment (même règle que l'écran d'accueil).
    val visible = remember(rows) { RowRegistry.homeRows(rows.order, rows.hidden).map { it.id }.toSet() }

    fun save(nextOrder: List<String>, nextVisible: Set<String>) {
        // Ordre complet + toutes les rangées non affichées en `hidden` : lu
        // tel quel par RowRegistry.homeRows (mode personnalisé).
        write(UiKeys.HOME_ROWS, UiPrefs.encode(HomeRows(order = nextOrder, hidden = nextOrder.filter { it !in nextVisible }.toSet())))
    }

    Column(PaneScroll.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ToggleRow(
            stringResource(R.string.home_banner_video),
            UiPrefs.flag(values, UiKeys.BANNER_VIDEO),
            { write(UiKeys.BANNER_VIDEO, if (UiPrefs.flag(values, UiKeys.BANNER_VIDEO)) "0" else null) },
            body = stringResource(R.string.home_banner_video_body),
        )
        val minutes = UiPrefs.screensaverMinutes(values)
        Column(Modifier.fillMaxWidth().background(MovixColors.Panel, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 8.dp)) {
            Text(stringResource(R.string.home_screensaver), style = MovixType.Button)
            Text(stringResource(R.string.home_screensaver_body), style = MovixType.Meta)
            ChoiceRow(
                "",
                listOf(0, 2, 5, 10, 30).map { it to if (it == 0) stringResource(R.string.home_screensaver_off) else stringResource(R.string.home_screensaver_min, it) },
                minutes,
                { write(UiKeys.SCREENSAVER_MIN, if (it == 5) null else it.toString()) },
            )
        }
        Spacer(Modifier.height(10.dp))
        PaneHeader(stringResource(R.string.home_rows_title), stringResource(R.string.home_rows_body))
        order.forEachIndexed { index, id ->
            // key : la ligne déplacée garde son focus (on peut appuyer plusieurs fois sur ▲).
            key(id) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    val shown = id in visible
                    ToggleRow(
                        titles[id].orEmpty(),
                        shown,
                        {
                            val next = if (shown) visible - id else visible + id
                            // Un accueil vide n'existe pas : la dernière rangée reste.
                            if (next.isNotEmpty()) save(order, next)
                        },
                        modifier = Modifier.weight(1f),
                    )
                    ArrowButton(up = true, enabled = index > 0) {
                        save(order.toMutableList().apply { add(index - 1, removeAt(index)) }, visible)
                    }
                    ArrowButton(up = false, enabled = index < order.lastIndex) {
                        save(order.toMutableList().apply { add(index + 1, removeAt(index)) }, visible)
                    }
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        PillButton(stringResource(R.string.home_rows_reset), { write(UiKeys.HOME_ROWS, null) })
        Spacer(Modifier.height(24.dp))
    }
}

// ---------------------------------------------------------------- Menu de gauche

@Composable
internal fun RailPane() {
    val (values, write) = rememberUiValues()
    val hidden = railHiddenSections(values)
    var refused by remember { mutableStateOf(false) }
    Column(PaneScroll.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PaneHeader(stringResource(R.string.settings_section_rail), stringResource(R.string.rail_body))
        RailHideable.forEach { section ->
            val shown = section !in hidden
            ToggleRow(
                stringResource(railLabel(section)),
                shown,
                {
                    val next = if (shown) hidden + section else hidden - section
                    // Au moins une entrée en plus de Réglages.
                    if (next.size >= RailHideable.size) {
                        refused = true
                    } else {
                        refused = false
                        write(UiKeys.RAIL_HIDDEN, next.takeIf { it.isNotEmpty() }?.joinToString(",") { it.name })
                    }
                },
                icon = railIcon(section),
            )
        }
        if (refused) Text(stringResource(R.string.rail_last), style = MovixType.Body.copy(color = MovixColors.Red))
        Spacer(Modifier.height(24.dp))
    }
}

// ---------------------------------------------------------------- Lecture

@Composable
internal fun PlaybackPane() {
    val (values, write) = rememberUiValues()
    Column(PaneScroll.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PaneHeader(stringResource(R.string.settings_section_playback))
        val autoplay = UiPrefs.flag(values, UiKeys.AUTOPLAY_NEXT)
        ToggleRow(
            stringResource(R.string.playback_autoplay),
            autoplay,
            { write(UiKeys.AUTOPLAY_NEXT, if (autoplay) "0" else null) },
            body = stringResource(R.string.playback_autoplay_body),
        )
    }
}
