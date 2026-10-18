package com.movix.tv.ui.player

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.local.SubtitleStyle
import com.movix.tv.data.local.UiPrefs
import com.movix.tv.data.movix.Lang
import com.movix.tv.data.movix.PlaybackSource
import com.movix.tv.data.movix.Provider
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import com.movix.tv.ui.theme.subtitleFontLabel
import kotlinx.coroutines.delay
import java.util.Locale

/** Pages du panneau de réglages ; [parent] : où ramène Retour. */
enum class PanelPage(val title: Int) {
    MAIN(R.string.player_settings),
    SOURCE(R.string.player_source),
    QUALITY(R.string.player_quality),
    AUDIO(R.string.player_audio),
    SUBTITLES(R.string.player_subtitles),
    OFFSET(R.string.player_offset),
    SPEED(R.string.player_speed),
    FORMAT(R.string.player_format),
    /** Choix de la langue des sous-titres (filtre), ouvert depuis SUBTITLES. */
    SUBTITLE_LANG(R.string.player_subtitle_lang),
    /** Langue de traduction des sous-titres, ouverte depuis SUBTITLES. */
    SUBTITLE_TRANSLATE(R.string.player_translate),
    /** Style des sous-titres (même réglage que l'écran Réglages), et ses six choix. */
    SUBTITLE_STYLE(R.string.player_st_title),
    STYLE_SIZE(R.string.player_st_size),
    STYLE_COLOR(R.string.player_st_color),
    STYLE_FONT(R.string.subs_font),
    STYLE_BACKGROUND(R.string.player_st_background),
    STYLE_POSITION(R.string.player_st_position),
    STYLE_OUTLINE(R.string.player_st_outline);

    val parent: PanelPage?
        get() = when (this) {
            MAIN -> null
            SUBTITLE_LANG, SUBTITLE_TRANSLATE -> SUBTITLES
            STYLE_SIZE, STYLE_COLOR, STYLE_FONT, STYLE_BACKGROUND, STYLE_POSITION, STYLE_OUTLINE -> SUBTITLE_STYLE
            else -> MAIN
        }

    /** Ligne de la liste principale qui mène à cette page. */
    val root: PanelPage get() = if (parent == MAIN || parent == null) this else parent!!.root
}

/** Touche ↑/↓ au bout d'une liste : consommée, sinon le focus file vers les boutons cachés sous le panneau. */
private fun Modifier.stopAtEnds(first: Boolean, last: Boolean): Modifier =
    if (!first && !last) this else onPreviewKeyEvent { e ->
        e.type == KeyEventType.KeyDown && ((last && e.key == Key.DirectionDown) || (first && e.key == Key.DirectionUp))
    }

private val SPEEDS = listOf(0.75f, 1f, 1.25f, 1.5f, 2f)
private val OFFSETS = (-10..10).map { it * 500L }

/** Une ligne d'un sous-panneau. */
private class Option(val title: String, val subtitle: String? = null, val selected: Boolean = false, val enabled: Boolean = true, val vip: Boolean = false, val group: String? = null, val onClick: () -> Unit = {})

/**
 * Panneau de réglages à droite (maquette 4) : la liste principale à droite,
 * le sous-panneau choisi à sa gauche. Le voile assombrit la vidéo.
 */
@Composable
fun PlayerPanel(c: PlayerController, page: PanelPage, onPage: (PanelPage) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    // Style des sous-titres : relu en direct, la coche suit le choix.
    val values by context.container.store.values.collectAsState()
    val style = UiPrefs.subtitleStyle(values)
    // Gauche = un niveau en arrière : sous-panneau → liste principale → panneau fermé.
    val back = { page.parent?.let(onPage) ?: onClose() }
    val requesters = remember { PanelPage.entries.associateWith { FocusRequester() } }
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f))) {
        Row(Modifier.align(Alignment.CenterEnd).fillMaxHeight()) {
            if (page != PanelPage.MAIN) {
                SubPanel(
                    context.getString(page.title), options(c, page, context, onClose, onPage, style),
                    Modifier.width(320.dp).background(Color(0xF70E0E0E))
                        .onPreviewKeyEvent { e ->
                            if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                            when (e.key) {
                                Key.DirectionLeft -> { back(); true }
                                // Droite : la ligne du réglage ouvert, jamais les boutons du lecteur cachés dessous.
                                Key.DirectionRight -> { runCatching { requesters.getValue(page.root).requestFocus() }; true }
                                else -> false
                            }
                        },
                )
            }
            MainPanel(
                c, page, onPage, requesters, style,
                Modifier.width(300.dp).background(Color(0xF7121212))
                    .onPreviewKeyEvent { e -> if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionLeft && page == PanelPage.MAIN) { onClose(); true } else false },
            )
        }
    }
}

@Composable
private fun MainPanel(c: PlayerController, page: PanelPage, onPage: (PanelPage) -> Unit, requesters: Map<PanelPage, FocusRequester>, style: SubtitleStyle, modifier: Modifier) {
    val context = LocalContext.current
    // De retour sur la liste principale, le focus revient sur la ligne qu'on vient de quitter.
    var lastRoot by remember { mutableStateOf(PanelPage.SOURCE) }
    if (page != PanelPage.MAIN) lastRoot = page.root
    val rows = listOf(
        PanelPage.SOURCE to (c.current?.label ?: "—"),
        PanelPage.QUALITY to (c.selectedVideo?.label ?: c.qualityText ?: context.getString(R.string.player_auto)),
        PanelPage.AUDIO to (c.selectedAudio?.display(context, audioFallback(c)) ?: context.getString(R.string.player_auto)),
        PanelPage.SUBTITLES to subtitleLabel(c, context),
        PanelPage.SUBTITLE_STYLE to "${percentLabel(style.size, context)}, ${colorLabel(style.color, context)}",
        PanelPage.OFFSET to offsetLabel(c.subtitleOffsetMs),
        PanelPage.SPEED to speedLabel(c.speed, context),
        PanelPage.FORMAT to context.getString(formatLabel(c.format)),
    )
    Column(modifier.fillMaxHeight().padding(horizontal = 22.dp, vertical = 28.dp)) {
        Text(stringResource(R.string.player_settings), style = MovixType.Panel, modifier = Modifier.padding(bottom = 16.dp))
        rows.forEachIndexed { i, (p, value) ->
            OptRow(
                context.getString(p.title), value, selected = p == page.root && page != PanelPage.MAIN,
                onClick = { onPage(p) },
                modifier = Modifier.focusRequester(requesters.getValue(p))
                    .stopAtEnds(first = i == 0, last = i == rows.lastIndex)
                    // Droite ouvre le réglage, comme OK.
                    .onPreviewKeyEvent { e -> if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionRight) { onPage(p); true } else false },
            )
        }
    }
    LaunchedEffect(page) { if (page == PanelPage.MAIN) { delay(32); runCatching { requesters.getValue(lastRoot).requestFocus() } } }
}

@Composable
private fun OptRow(title: String, value: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val bg = when {
        focused -> MovixColors.Text
        selected -> Color.White.copy(alpha = 0.1f)
        else -> Color.Transparent
    }
    Row(
        modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(10.dp)).background(bg)
            .clickable(interactionSource = source, indication = null, onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MovixType.Button.copy(color = if (focused) MovixColors.Ink else MovixColors.Text))
        Spacer(Modifier.weight(1f))
        Text(
            value, maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = MovixType.Button.copy(fontSize = 13.sp, color = if (focused) Color(0xFF444444) else MovixColors.Muted),
            modifier = Modifier.padding(start = 12.dp).weight(1f, fill = false),
        )
        Icon(MovixIcons.Chevron, if (focused) Color(0xFF444444) else MovixColors.Muted, 14)
    }
}

@Composable
private fun SubPanel(title: String, options: List<Option>, modifier: Modifier) {
    val selectedIndex = options.indexOfFirst { it.selected && it.enabled }.takeIf { it >= 0 } ?: options.indexOfFirst { it.enabled }.coerceAtLeast(0)
    val requester = remember(title) { FocusRequester() }
    val state = rememberLazyListState(initialFirstVisibleItemIndex = (selectedIndex - 3).coerceAtLeast(0))
    Column(modifier.fillMaxHeight().padding(top = 28.dp)) {
        Text(title, style = MovixType.Panel, modifier = Modifier.padding(start = 22.dp, bottom = 10.dp))
        LazyColumn(state = state, contentPadding = PaddingValues(start = 22.dp, end = 22.dp, bottom = 28.dp)) {
            itemsIndexed(options, key = { i, o -> "$i:${o.title}" }) { i, o ->
                Column {
                    o.group?.let { Text(it, style = MovixType.Kicker.copy(fontSize = 11.5.sp, color = MovixColors.Dim), modifier = Modifier.padding(start = 12.dp, top = 14.dp, bottom = 6.dp)) }
                    SourceRow(
                        o,
                        (if (i == selectedIndex) Modifier.focusRequester(requester) else Modifier)
                            .stopAtEnds(first = i == 0, last = i == options.lastIndex),
                    )
                }
            }
        }
    }
    LaunchedEffect(title) { delay(48); runCatching { requester.requestFocus() } }
}

@Composable
private fun SourceRow(o: Option, modifier: Modifier) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val bg = when {
        focused -> MovixColors.Text
        o.selected -> Color.White.copy(alpha = 0.08f)
        else -> Color.Transparent
    }
    val fg = when {
        focused -> MovixColors.Ink
        o.enabled -> MovixColors.Text
        else -> MovixColors.Dim
    }
    Column(
        modifier.fillMaxWidth().padding(bottom = 4.dp).clip(RoundedCornerShape(10.dp)).background(bg)
            .clickable(interactionSource = source, indication = null, enabled = true, onClick = { if (o.enabled) o.onClick() })
            .padding(horizontal = 12.dp, vertical = 9.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(o.title, style = MovixType.Button.copy(color = fg), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = !o.vip))
            if (o.vip) {
                Text(
                    stringResource(R.string.player_vip),
                    style = MovixType.Badge.copy(fontSize = 10.sp, color = if (focused) MovixColors.Gold else MovixColors.Ink),
                    modifier = Modifier.background(if (focused) MovixColors.Ink else MovixColors.Gold, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 1.dp),
                )
                Spacer(Modifier.weight(1f))
            }
            if (o.selected) Icon(MovixIcons.Check, MovixColors.Red, 16)
        }
        o.subtitle?.let {
            Text(it, style = MovixType.CardSub.copy(fontSize = 11.5.sp, color = if (focused) Color(0xFF555555) else MovixColors.Muted), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp))
        }
    }
}

@Composable
private fun Icon(icon: ImageVector, tint: Color, size: Int) {
    Image(rememberVectorPainter(icon), null, Modifier.size(size.dp), colorFilter = ColorFilter.tint(tint))
}

/** « fr » → « Français » dans la langue de l'appli. */
private fun langName(code: String, context: android.content.Context): String {
    val ui = context.resources.configuration.locales[0]
    return Locale(code).getDisplayLanguage(ui).replaceFirstChar { it.titlecase(ui) }
}

/** Langues des sous-titres proposés (source, flux, Shegu/OpenSubtitles), avec leur nombre. */
private fun subtitleLangs(c: PlayerController): Map<String, Int> =
    (c.current?.subtitles.orEmpty().map { it.lang.substringBefore('-').lowercase() } +
        c.embeddedTextTracks.mapNotNull { it.language } +
        c.searchedSubtitles.map { it.lang }).groupingBy { it }.eachCount()

private fun options(
    c: PlayerController,
    page: PanelPage,
    context: android.content.Context,
    onClose: () -> Unit,
    onPage: (PanelPage) -> Unit,
    style: SubtitleStyle,
): List<Option> = when (page) {
    PanelPage.MAIN -> emptyList()
    PanelPage.SOURCE -> {
        val server = context.getString(R.string.player_group_server)
        val device = context.getString(R.string.player_group_device)
        // Serveur Movix : flux résolus par le serveur. Extraction sur la télé :
        // lecteurs déjà extraits (lançables tout de suite) puis ceux à extraire.
        val serverSources = c.sources.filter { !it.extracted }
        val deviceList = c.sources.filter { it.extracted } +
            c.deviceSources.filter { d -> c.sources.none { it.id == d.id } }.take(30)
        serverSources.mapIndexed { i, s ->
            Option(
                s.label, sourceSubtitle(s, context.getString(R.string.player_native)), selected = s.id == c.current?.id,
                // Badge VIP seulement avec une clé VIP, et pas sur ce qui se lit sans (SwiftFlux, KissKH, fichiers).
                vip = c.isVip && s.provider != Provider.SWIFTFLUX && s.provider != Provider.KISSKH && (s.provider != Provider.LINKS || s.embedUrl != null),
                group = if (i == 0) server else null,
                onClick = { c.selectSource(s); onClose() },
            )
        } + deviceList.mapIndexed { i, s ->
            val note = if (c.extractingId == s.id) context.getString(R.string.player_extracting_short) else context.getString(R.string.player_device_soon)
            Option(
                s.label, sourceSubtitle(s, note), selected = s.id == c.current?.id, group = if (i == 0) device else null,
                onClick = { c.selectSource(s); if (s.playable) onClose() },
            )
        } + c.webSources.take(20).mapIndexed { i, s ->
            Option(
                s.label, sourceSubtitle(s, context.getString(R.string.player_web_note)),
                group = if (i == 0) context.getString(R.string.player_group_web) else null,
                onClick = { onClose(); c.openWeb(s) },
            )
        }
    }
    PanelPage.QUALITY -> listOf(Option(context.getString(R.string.player_auto), selected = c.selectedVideo == null, onClick = { c.selectVideo(null) })) +
        c.videoTracks.map { t -> Option(t.label, selected = c.selectedVideo == t, onClick = { c.selectVideo(t) }) }
    PanelPage.AUDIO -> c.audioTracks.ifEmpty { null }?.map { t -> Option(t.display(context, audioFallback(c)), selected = c.selectedAudio == t, onClick = { c.selectAudio(t) }) }
        ?: listOf(Option(context.getString(R.string.player_auto), selected = true))
    PanelPage.SUBTITLES -> buildList {
        val lang = c.subtitleLang
        fun keep(code: String?) = lang == null || code?.substringBefore('-')?.lowercase() == lang
        add(Option(context.getString(R.string.player_off), selected = c.subtitle == SubtitleChoice.Off, onClick = { c.chooseSubtitle(SubtitleChoice.Off) }))
        // Menus déroulants : langue (toutes par défaut) et traduction.
        add(Option(
            context.getString(R.string.player_subtitle_lang), lang?.let { langName(it, context) } ?: context.getString(R.string.player_lang_all),
            onClick = { onPage(PanelPage.SUBTITLE_LANG) },
        ))
        add(Option(
            context.getString(R.string.player_translate), c.translateTo?.let { langName(it, context) } ?: context.getString(R.string.player_off),
            onClick = { onPage(PanelPage.SUBTITLE_TRANSLATE) },
        ))
        c.current?.subtitles?.filter { keep(it.lang) }?.forEach { t ->
            add(Option(t.label, t.format.uppercase(), selected = (c.subtitle as? SubtitleChoice.External)?.track == t, onClick = { c.chooseSubtitle(SubtitleChoice.External(t)) }))
        }
        c.embeddedTextTracks.filter { lang == null || it.language == lang }.forEach { t ->
            add(Option(t.display(context), selected = (c.subtitle as? SubtitleChoice.Embedded)?.option == t, onClick = { c.chooseSubtitle(SubtitleChoice.Embedded(t)) }))
        }
        // Shegu et OpenSubtitles : français et anglais d'abord, 80 au plus (le site pagine par 60).
        c.searchedSubtitles.filter { keep(it.lang) }.take(80).forEachIndexed { i, t ->
            add(Option(
                langName(t.lang, context), listOfNotNull(t.source, t.label).joinToString(" · "),
                selected = (c.subtitle as? SubtitleChoice.External)?.track == t,
                group = if (i == 0) context.getString(R.string.player_group_searched_subs) else null,
                onClick = { c.chooseSubtitle(SubtitleChoice.External(t)) },
            ))
        }
    }
    PanelPage.SUBTITLE_LANG -> {
        val counts = subtitleLangs(c)
        val first = listOf("fr", "en").filter { it in counts }
        val rest = (counts.keys - first.toSet()).sortedBy { langName(it, context) }
        listOf(Option(context.getString(R.string.player_lang_all), counts.values.sum().toString(), selected = c.subtitleLang == null,
            onClick = { c.subtitleLang = null; onPage(PanelPage.SUBTITLES) })) +
            (first + rest).map { code ->
                Option(langName(code, context), counts[code].toString(), selected = c.subtitleLang == code,
                    onClick = { c.subtitleLang = code; onPage(PanelPage.SUBTITLES) })
            }
    }
    PanelPage.SUBTITLE_TRANSLATE ->
        listOf(Option(context.getString(R.string.player_off), selected = c.translateTo == null, onClick = { c.setTranslation(null); onPage(PanelPage.SUBTITLES) })) +
            com.movix.tv.data.subs.SubtitleTranslator.TARGETS.map { code ->
                Option(langName(code, context), selected = c.translateTo == code, onClick = { c.setTranslation(code); onPage(PanelPage.SUBTITLES) })
            }
    PanelPage.OFFSET -> OFFSETS.map { v -> Option(offsetLabel(v), selected = c.subtitleOffsetMs == v, onClick = { c.changeOffset(v - c.subtitleOffsetMs) }) }
    PanelPage.SPEED -> SPEEDS.map { v -> Option(speedLabel(v, context), selected = c.speed == v, onClick = { c.changeSpeed(v) }) }
    PanelPage.FORMAT -> VideoFormat.entries.map { f -> Option(context.getString(formatLabel(f)), selected = c.format == f, onClick = { c.changeFormat(f) }) }
    // Style : chaque choix s'applique tout de suite aux sous-titres affichés derrière le panneau.
    PanelPage.SUBTITLE_STYLE -> listOf(
        Option(context.getString(R.string.player_st_size), percentLabel(style.size, context), onClick = { onPage(PanelPage.STYLE_SIZE) }),
        Option(context.getString(R.string.player_st_color), colorLabel(style.color, context), onClick = { onPage(PanelPage.STYLE_COLOR) }),
        Option(context.getString(R.string.subs_font), context.getString(subtitleFontLabel(style.font)), onClick = { onPage(PanelPage.STYLE_FONT) }),
        Option(context.getString(R.string.player_st_background), backgroundLabel(style.background, context), onClick = { onPage(PanelPage.STYLE_BACKGROUND) }),
        Option(context.getString(R.string.player_st_position), positionLabel(style.position, context), onClick = { onPage(PanelPage.STYLE_POSITION) }),
        Option(context.getString(R.string.player_st_outline), outlineLabel(style.outline, context), onClick = { onPage(PanelPage.STYLE_OUTLINE) }),
    )
    PanelPage.STYLE_SIZE -> STYLE_SIZES.map { v -> Option(percentLabel(v, context), selected = style.size == v, onClick = { c.setSubtitleStyle(style.copy(size = v)) }) }
    PanelPage.STYLE_COLOR -> SubtitleStyle.COLORS.keys.map { k -> Option(colorLabel(k, context), selected = style.color == k, onClick = { c.setSubtitleStyle(style.copy(color = k)) }) }
    PanelPage.STYLE_FONT -> SubtitleStyle.FONTS.map { f -> Option(context.getString(subtitleFontLabel(f)), selected = style.font == f, onClick = { c.setSubtitleStyle(style.copy(font = f)) }) }
    PanelPage.STYLE_BACKGROUND -> STYLE_BACKGROUNDS.map { v -> Option(backgroundLabel(v, context), selected = style.background == v, onClick = { c.setSubtitleStyle(style.copy(background = v)) }) }
    PanelPage.STYLE_POSITION -> listOf("bottom", "raised").map { p -> Option(positionLabel(p, context), selected = style.position == p, onClick = { c.setSubtitleStyle(style.copy(position = p)) }) }
    PanelPage.STYLE_OUTLINE -> listOf(false, true).map { o -> Option(outlineLabel(o, context), selected = style.outline == o, onClick = { c.setSubtitleStyle(style.copy(outline = o)) }) }
}

private val STYLE_SIZES = listOf(75, 100, 125, 150, 200)
private val STYLE_BACKGROUNDS = listOf(0, 25, 45, 75)

private fun percentLabel(v: Int, context: android.content.Context): String = context.getString(R.string.player_st_percent, v)

private fun colorLabel(id: String, context: android.content.Context): String = context.getString(
    when (id) {
        "yellow" -> R.string.player_st_yellow
        "cyan" -> R.string.player_st_cyan
        "green" -> R.string.player_st_green
        else -> R.string.player_st_white
    },
)

private fun backgroundLabel(v: Int, context: android.content.Context): String =
    if (v <= 0) context.getString(R.string.player_st_no_background) else percentLabel(v, context)

private fun positionLabel(p: String, context: android.content.Context): String =
    context.getString(if (p == "raised") R.string.player_st_raised else R.string.player_st_bottom)

private fun outlineLabel(on: Boolean, context: android.content.Context): String =
    context.getString(if (on) R.string.player_st_outline_on else R.string.player_st_outline_off)

/** « Multi, HD, VF, lecture native » : le groupe du site d'abord (le site range ses lecteurs par groupe). */
private fun sourceSubtitle(s: PlaybackSource, tail: String): String =
    listOfNotNull(s.provider.label.takeUnless { s.extracted }, s.quality?.takeIf { it.isNotBlank() }, s.language.label, tail).distinct().joinToString(", ")

private fun subtitleLabel(c: PlayerController, context: android.content.Context): String = when (val s = c.subtitle) {
    SubtitleChoice.Off -> context.getString(R.string.player_off)
    is SubtitleChoice.External -> s.track.label
    is SubtitleChoice.Embedded -> s.option.display(context)
}

/**
 * Nom d'une piste : celui du flux, sinon sa langue dans la langue de l'appli
 * (« Français », « English »), sinon [fallback] (langue de la source, quand le
 * flux n'a qu'une piste), sinon « Piste n ».
 */
private fun TrackOption.display(context: android.content.Context, fallback: Lang? = null): String {
    if (label.isNotEmpty()) return label
    val ui = context.resources.configuration.locales[0]
    language?.let { return Locale(it).getDisplayLanguage(ui).replaceFirstChar { c -> c.titlecase(ui) } }
    return when (fallback) {
        Lang.VF -> Locale.FRENCH.getDisplayLanguage(ui).replaceFirstChar { c -> c.titlecase(ui) }
        Lang.VO, Lang.VOSTFR -> context.getString(R.string.player_audio_original)
        else -> context.getString(R.string.player_track_n, number)
    }
}

/** Langue de la source pour nommer une piste audio sans langue, seulement si elle est seule. */
private fun audioFallback(c: PlayerController): Lang? = c.current?.language?.takeIf { c.audioTracks.size == 1 }

/** 1 500 → « +1,5 s » ; 0 → « 0,0 s » (virgule française). */
internal fun offsetLabel(ms: Long): String {
    val v = String.format(Locale.FRANCE, "%.1f s", ms / 1000.0)
    return if (ms > 0) "+$v" else v
}

private fun speedLabel(v: Float, context: android.content.Context): String =
    if (v == 1f) context.getString(R.string.player_normal) else String.format(Locale.FRANCE, "×%s", if (v % 1f == 0f) v.toInt().toString() else v.toString().replace('.', ','))

private fun formatLabel(f: VideoFormat): Int = when (f) {
    VideoFormat.FIT -> R.string.player_format_fit
    VideoFormat.FILL -> R.string.player_format_fill
    VideoFormat.STRETCH -> R.string.player_format_stretch
}
