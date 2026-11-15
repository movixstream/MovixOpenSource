package com.movix.tv.ui.search

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.utf16CodePoint
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.local.TvKeys
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.TmdbImage
import com.movix.tv.ui.components.MovixIcons
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.components.PosterCard
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class SearchStatus { IDLE, LOADING, DONE, FAILED }

/** Dictée de Google sur Android TV / Google TV. */
private const val GOOGLE_TV_VOICE = "com.google.android.katniss"

/**
 * Recherche façon YouTube : clavier à l'écran à gauche (lettres, accents,
 * chiffres et symboles, micro), résultats à droite avec des titres proposés
 * au-dessus. Champ vide : les recherches récentes. Un clavier Bluetooth ou les
 * chiffres de la télécommande tapent aussi directement.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SearchScreen(onOpen: (MediaItem) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val container = context.container
    var query by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableStateOf(KeyPage.LETTERS) }
    var results by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    // Titres assez connus pour les titres proposés (IMDb, TMDB bien voté).
    var known by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    // Résultats masqués par la restriction d'âge du profil (message adapté si rien ne reste).
    var hidden by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf(SearchStatus.IDLE) }
    val firstKey = remember { FocusRequester() }
    val resultFocus = remember { FocusRequester() }
    val gridState = rememberLazyGridState()
    var keyboardFocused by remember { mutableStateOf(false) }
    var resultsFocused by remember { mutableStateOf(false) }
    // Dernière touche = frappe au clavier physique (pour savoir que faire d'Entrée).
    var typing by remember { mutableStateOf(false) }
    // Après un titre proposé, une recherche récente, la dictée ou le retour d'une
    // fiche, le focus saute sur un résultat dès qu'il arrive, sauf si l'on a
    // bougé entre-temps.
    var focusResults by remember { mutableStateOf(false) }
    // Carte ouverte : au retour de sa fiche, le focus y revient.
    var openedKey by rememberSaveable { mutableStateOf<String?>(null) }
    // Retour d'une fiche : la recherche gardée repart sans attendre l'anti-rebond.
    var skipDebounce by remember { mutableStateOf(query.isNotEmpty()) }
    val focusIndex = results.indexOfFirst { it.key == openedKey }.coerceAtLeast(0)

    // Un élément qui a le focus et disparaît laisse l'écran sans focus : avant de
    // remplacer la colonne de droite, le focus attend sur le clavier, puis saute
    // sur le premier nouveau résultat.
    val parkFocus = {
        if (resultsFocused) {
            focusResults = true
            runCatching { firstKey.requestFocus() }
        }
    }
    LaunchedEffect(query) {
        val q = SearchInput.searchable(query)
        if (q == null) {
            parkFocus()
            results = emptyList()
            known = emptyList()
            status = SearchStatus.IDLE
            return@LaunchedEffect
        }
        if (skipDebounce) skipDebounce = false else delay(350) // anti-rebond : une requête par pause de frappe
        status = SearchStatus.LOADING
        val found = try {
            container.catalog.search(q)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
        if (found?.items != results) parkFocus()
        results = found?.items.orEmpty()
        known = found?.known.orEmpty()
        hidden = found?.hidden ?: 0
        status = if (found == null) SearchStatus.FAILED else SearchStatus.DONE
    }
    // Nouveaux résultats : la grille repart du haut (sauf saut de focus, qui place la grille lui-même).
    LaunchedEffect(results) { if (!focusResults && results.isNotEmpty()) gridState.scrollToItem(0) }
    LaunchedEffect(results, status) {
        if (!focusResults || status == SearchStatus.LOADING) return@LaunchedEffect
        focusResults = false
        if (results.isEmpty()) {
            openedKey = null
            runCatching { firstKey.requestFocus() }
            return@LaunchedEffect
        }
        gridState.scrollToItem(focusIndex)
        // La carte visée n'est parfois composée qu'une ou deux images plus tard.
        var tries = 0
        while (!resultsFocused && tries++ < 10) {
            withFrameNanos { }
            runCatching { resultFocus.requestFocus() }
        }
        openedKey = null
    }

    val values by container.store.values.collectAsStateWithLifecycle()
    val recent = remember(values[TvKeys.SEARCH_RECENT]) { SearchInput.decodeRecent(values[TvKeys.SEARCH_RECENT]) }
    // Portée de l'appli : ouvrir un résultat quitte l'écran, l'écriture doit finir.
    // writeAll et non set : clé propre à la télé, la synchro n'a pas à la voir.
    val saveRecent = { list: List<String> ->
        container.appScope.launch { container.store.writeAll(mapOf(TvKeys.SEARCH_RECENT to SearchInput.encodeRecent(list))) }
        Unit
    }

    // Titre proposé, recherche récente ou dictée : la recherche part et le focus
    // ira sur le premier résultat. L'élément choisi disparaît avec sa liste :
    // en attendant, le focus attend sur le clavier.
    val pick = { text: String ->
        val q = SearchInput.fromVoice(text)
        if (q == query && status == SearchStatus.DONE && results.isNotEmpty()) {
            runCatching { resultFocus.requestFocus() }
        } else {
            query = q
            focusResults = true
            runCatching { firstKey.requestFocus() }
        }
        Unit
    }

    // Dictée par l'appli de reconnaissance vocale de la télé (Google sur
    // Android TV). Absente, sur Fire TV par exemple : pas de touche micro.
    // L'appli est choisie d'avance (Google en priorité) : sans ça, Android
    // demande laquelle utiliser quand il y en a deux.
    val voicePrompt = stringResource(R.string.search_voice_prompt)
    val voiceIntent = remember(voicePrompt) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, context.resources.configuration.locales[0].toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_PROMPT, voicePrompt)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        val handlers = runCatching {
            context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        }.getOrDefault(emptyList())
        val best = handlers.firstOrNull { it.activityInfo.packageName == GOOGLE_TV_VOICE } ?: handlers.firstOrNull()
        best?.let { intent.setClassName(it.activityInfo.packageName, it.activityInfo.name) }
    }
    val voiceLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val spoken = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (r.resultCode == Activity.RESULT_OK && !spoken.isNullOrBlank()) pick(spoken)
    }
    // Une appli de dictée qui refuse de s'ouvrir ne doit pas faire planter la recherche.
    val startVoice: (() -> Unit)? = voiceIntent?.let { intent -> { runCatching { voiceLauncher.launch(intent) } } }

    Row(
        modifier
            .padding(top = 40.dp, start = 24.dp)
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                focusResults = false
                val code = e.utf16CodePoint
                // Frappe au clavier physique : le focus revient sur le clavier à
                // l'écran, la colonne de droite va changer sous lui.
                val toKeyboard = {
                    typing = true
                    if (!keyboardFocused) runCatching { firstKey.requestFocus() }
                }
                when {
                    e.key == Key.Search && startVoice != null -> { startVoice(); true }
                    e.key == Key.Backspace -> { query = SearchInput.delete(query); toKeyboard(); true }
                    // Entrée juste après une frappe au clavier : aux résultats, sans
                    // cliquer la touche à l'écran. Certaines télécommandes envoient
                    // Entrée pour OK : elles ne tapent jamais de lettre, OK reste un clic.
                    (e.key == Key.Enter || e.key == Key.NumPadEnter) && typing -> {
                        if (results.isNotEmpty()) runCatching { resultFocus.requestFocus() }
                        true
                    }
                    code > 0 && !Character.isISOControl(code) && Character.isBmpCodePoint(code) -> {
                        query = SearchInput.type(query, code.toChar().lowercase())
                        toKeyboard()
                        true
                    }
                    else -> { typing = false; false }
                }
            },
    ) {
        SearchKeyboard(
            query = query,
            page = page,
            onPage = { page = it },
            onQuery = { query = it },
            onVoice = startVoice,
            firstKey = firstKey,
            modifier = Modifier.width(300.dp).onFocusChanged { keyboardFocused = it.hasFocus },
        )
        Spacer(Modifier.width(36.dp))
        Box(Modifier.fillMaxHeight().weight(1f).onFocusChanged { resultsFocused = it.hasFocus }) {
            if (SearchInput.searchable(query) == null) {
                RecentSearches(
                    recent = recent,
                    voice = startVoice != null,
                    onPick = pick,
                    onClear = {
                        runCatching { firstKey.requestFocus() }
                        saveRecent(emptyList())
                    },
                )
            } else {
                val suggestions = remember(known, query) { SearchInput.suggestions(query, known.map { it.title }) }
                Column(Modifier.fillMaxSize()) {
                    if (suggestions.isNotEmpty()) {
                        // Une seule ligne fixe, sans défilement : un titre qui ne
                        // tient pas est laissé de côté. (Une LazyRow gardait sa
                        // position d'une liste à l'autre et s'affichait décalée.)
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            maxLines = 1,
                            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 48.dp, bottom = 6.dp),
                        ) {
                            suggestions.forEach { title ->
                                key(title) {
                                    PillButton(title, onClick = { pick(title) }, icon = MovixIcons.Search, modifier = Modifier.widthIn(max = 300.dp))
                                }
                            }
                        }
                    }
                    val message = when {
                        status == SearchStatus.FAILED -> stringResource(R.string.error_body)
                        status == SearchStatus.DONE && results.isEmpty() && hidden > 0 -> stringResource(R.string.age_search_empty, query.trim())
                        status == SearchStatus.DONE && results.isEmpty() -> stringResource(R.string.search_empty, query.trim())
                        status != SearchStatus.DONE && results.isEmpty() -> stringResource(R.string.search_loading)
                        else -> null
                    }
                    if (message != null) {
                        Text(message, style = MovixType.Body, modifier = Modifier.padding(start = 12.dp, top = 12.dp))
                    }
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(92.dp),
                        state = gridState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(top = 14.dp, bottom = 60.dp, start = 12.dp, end = 48.dp),
                        horizontalArrangement = Arrangement.spacedBy(22.dp),
                        verticalArrangement = Arrangement.spacedBy(26.dp),
                    ) {
                        itemsIndexed(results, key = { _, it -> it.key }) { i, item ->
                            PosterCard(
                                TmdbImage.poster(item.posterPath),
                                onClick = {
                                    saveRecent(SearchInput.pushRecent(recent, query))
                                    openedKey = item.key
                                    onOpen(item)
                                },
                                onFocused = {},
                                modifier = if (i == focusIndex) Modifier.focusRequester(resultFocus) else Modifier,
                            )
                        }
                    }
                }
            }
        }
    }
    LaunchedEffect(Unit) {
        // Retour d'une fiche : le focus attend sur le clavier, puis rejoint la carte ouverte.
        if (openedKey != null && SearchInput.searchable(query) != null) focusResults = true
        delay(32)
        if (!resultsFocused) runCatching { firstKey.requestFocus() }
    }
}

/** Champ vide : les dernières recherches ouvertes, sinon une aide d'une ligne. */
@Composable
private fun RecentSearches(recent: List<String>, voice: Boolean, onPick: (String) -> Unit, onClear: () -> Unit) {
    Column(Modifier.padding(start = 12.dp, top = 4.dp)) {
        if (recent.isEmpty()) {
            Text(
                stringResource(if (voice) R.string.search_start_voice else R.string.search_start),
                style = MovixType.Body.copy(color = MovixColors.Muted),
                modifier = Modifier.widthIn(max = 420.dp),
            )
            return@Column
        }
        Text(stringResource(R.string.search_recent), style = MovixType.Row)
        Spacer(Modifier.height(14.dp))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            recent.forEach { q ->
                PillButton(q, onClick = { onPick(q) }, icon = MovixIcons.History, modifier = Modifier.widthIn(max = 360.dp))
            }
            Spacer(Modifier.height(4.dp))
            PillButton(stringResource(R.string.search_recent_clear), onClick = onClear, icon = MovixIcons.Delete)
        }
    }
}
