package com.movix.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import com.movix.tv.ui.theme.LocalLowRam
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.foundation.focusGroup
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.withFrameNanos
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.movix.tv.container
import com.movix.tv.data.local.TvKeys
import com.movix.tv.data.local.UiKeys
import com.movix.tv.data.local.UiPrefs
import com.movix.tv.data.movix.PlayRequest
import com.movix.tv.ui.account.LinkScreen
import com.movix.tv.ui.components.Rail
import com.movix.tv.ui.components.firstVisibleSection
import com.movix.tv.ui.components.railHiddenSections
import com.movix.tv.ui.profiles.ProfilePickerScreen
import kotlinx.coroutines.launch
import com.movix.tv.ui.details.DetailsScreen
import com.movix.tv.ui.home.BrowseScreen
import com.movix.tv.ui.home.WatchlistScreen
import com.movix.tv.ui.nav.Navigator
import com.movix.tv.ui.nav.Route
import com.movix.tv.ui.nav.Section
import com.movix.tv.ui.player.PlayTarget
import com.movix.tv.ui.player.PlayerScreen
import com.movix.tv.ui.search.SearchScreen
import com.movix.tv.ui.settings.SettingsScreen
import com.movix.tv.ui.theme.MovixColors

/**
 * Racine : rail à gauche pour les sections, écran plein pour la fiche et le lecteur.
 *
 * Retour : ferme la fiche ; sur une section, renvoie d'abord le focus au rail ;
 * depuis le rail, quitte l'appli. Le lecteur gère son propre Retour.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun MovixRoot(onExit: () -> Unit) {
    val nav = remember { Navigator() }
    val railRequester = remember { FocusRequester() }
    val contentRequester = remember { FocusRequester() }
    var railFocused by remember { mutableStateOf(false) }
    val saveable = rememberSaveableStateHolder()
    val container = LocalContext.current.container
    val values by container.store.values.collectAsStateWithLifecycle()
    // Entrées du menu de gauche cachées dans les réglages (lues en direct).
    val railHidden = railHiddenSections(values)

    // « Qui regarde ? » : au lancement (compte à plusieurs profils) ou depuis
    // Réglages › Compte. Rien n'est affiché avant de savoir s'il faut le montrer.
    var started by remember { mutableStateOf(false) }
    var picker by remember { mutableStateOf<ProfilePickerFrom?>(null) }
    var refocusContent by remember { mutableIntStateOf(0) }
    val closePicker = {
        if (picker == ProfilePickerFrom.SETTINGS) refocusContent++
        picker = null
    }

    BackHandler {
        when {
            nav.pop() -> Unit
            !railFocused -> runCatching { railRequester.requestFocus() }
            else -> onExit()
        }
    }

    // Passage d'un écran à l'autre : fondu court, l'écran qui arrive monte d'un
    // léger zoom. Toutes les sections partagent une clé : changer de section ne
    // recrée pas le rail (il perdrait le focus). Mode léger : fondu seul.
    val lowRam = LocalLowRam.current
    if (!started) {
        Box(Modifier.fillMaxSize().background(MovixColors.Ink))
    } else if (picker != null) {
        ProfilePickerScreen(onDone = closePicker, onBack = closePicker)
    } else AnimatedContent(
        targetState = nav.current,
        contentKey = { r ->
            when (r) {
                is Route.Main -> "main"
                is Route.Details -> "details:${r.type}:${r.id}"
                is Route.Player -> "player"
                Route.Link -> "link"
            }
        },
        transitionSpec = {
            val enter = fadeIn(tween(if (lowRam) 160 else 220, delayMillis = 40)) +
                (if (lowRam) EnterTransition.None else scaleIn(tween(260, easing = FastOutSlowInEasing), initialScale = 0.965f))
            enter togetherWith fadeOut(tween(if (lowRam) 100 else 140))
        },
        modifier = Modifier.fillMaxSize().background(MovixColors.Ink),
        label = "screen",
    ) { route ->
        Box(Modifier.fillMaxSize().background(MovixColors.Ink)) {
        when (route) {
            is Route.Main -> {
                // Groupe de la page : requestFocus y rend la carte quittée, sinon la première.
                val contentModifier = Modifier.fillMaxSize().focusRequester(contentRequester).focusRestorer().focusGroup()
                val enterContent = { runCatching { contentRequester.requestFocus() }; Unit }
                saveable.SaveableStateProvider(route.section.name) {
                    when (route.section) {
                        Section.SEARCH -> SearchScreen(onOpen = { nav.push(Route.Details(it.type, it.id, it)) }, modifier = contentModifier.padding(start = 60.dp))
                        Section.SETTINGS -> SettingsScreen(
                            onLinkAccount = { nav.push(Route.Link) },
                            modifier = contentModifier.padding(start = 60.dp),
                            onSwitchProfile = { picker = ProfilePickerFrom.SETTINGS },
                        )
                        Section.WATCHLIST -> WatchlistScreen(onOpen = { nav.push(Route.Details(it.type, it.id, it)) }, onEmptyBack = { railRequester.requestFocus() }, modifier = contentModifier.padding(start = 60.dp))
                        else -> BrowseScreen(
                            section = route.section,
                            onOpen = { nav.push(Route.Details(it.type, it.id, it)) },
                            onOpenSettings = { nav.select(Section.SETTINGS) },
                            onResume = { e ->
                                nav.push(Route.Player(PlayTarget(PlayRequest(e.type, e.id, e.season, e.episode), e.meta?.title.orEmpty(), e.meta?.backdropPath)))
                            },
                            modifier = contentModifier,
                        )
                    }
                }
                Rail(
                    current = route.section,
                    // Section déjà ouverte : OK descend dans la page au lieu de ne rien faire.
                    onSelect = { if (it == route.section) enterContent() else nav.select(it) },
                    focusRequester = railRequester,
                    onFocusChanged = { railFocused = it },
                    onEnterContent = enterContent,
                    hidden = railHidden,
                )
            }
            is Route.Details -> saveable.SaveableStateProvider("details:${route.type}:${route.id}") {
                DetailsScreen(
                    type = route.type, id = route.id, preview = route.preview,
                    onPlay = { nav.push(Route.Player(it)) },
                    modifier = Modifier.fillMaxSize(),
                    onOpen = { nav.push(Route.Details(it.type, it.id, it)) },
                )
            }
            is Route.Player -> PlayerScreen(
                target = route.target,
                onExit = { nav.pop() },
                onOpenSettings = { nav.select(Section.SETTINGS) },
            )
            Route.Link -> LinkScreen(
                onLinked = { nav.pop() },
                onUseVipKey = { nav.select(Section.SETTINGS) },
                onLater = { nav.pop() },
            )
        }
        }
    }

    // Premier lancement sans compte : l'écran de connexion est proposé une fois.
    LaunchedEffect(Unit) {
        container.accounts.restore()
        val saved = container.store.snapshot()
        // Accueil caché dans les réglages : on ouvre la première entrée visible.
        val first = firstVisibleSection(railHiddenSections(saved))
        if (first != Section.HOME) nav.select(first)
        if (container.accounts.current == null && saved[TvKeys.LINK_PROMPTED] == null) {
            container.store.writeAll(mapOf(TvKeys.LINK_PROMPTED to "1"))
            nav.push(Route.Link)
        }
        if (container.accounts.current != null && UiPrefs.flag(saved, UiKeys.PROFILE_PROMPT)) {
            // Profils gardés sur la télé : l'écran s'ouvre sans attendre le réseau.
            // Sans liste encore (première fois), elle est seulement rapatriée :
            // l'écran viendra au prochain lancement plutôt qu'en pleine navigation.
            if (container.accounts.cachedProfiles().size > 1) {
                picker = ProfilePickerFrom.LAUNCH
            } else {
                launch { runCatching { container.accounts.profiles() } }
            }
        }
        started = true
    }

    // Retour de « Qui regarde ? » ouvert depuis les réglages : le focus revient dans la page.
    LaunchedEffect(refocusContent) {
        if (refocusContent == 0) return@LaunchedEffect
        repeat(2) { withFrameNanos { } }
        runCatching { contentRequester.requestFocus() }
    }
}

/** D'où vient « Qui regarde ? ». */
private enum class ProfilePickerFrom { LAUNCH, SETTINGS }
