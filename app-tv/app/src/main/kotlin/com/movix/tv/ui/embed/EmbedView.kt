package com.movix.tv.ui.embed

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.adblock.AdblockEngine
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/** Ce que dit le bandeau quand aucune vidéo ne démarre. */
private enum class Stuck { NONE, NO_VIDEO, OLD_ENGINE }

/**
 * Lecteur web plein écran : la page [url] du lecteur embed, pilotée par la
 * souris virtuelle. Les touches restent dans Compose (focus sur la boîte) et
 * sont relayées à [EmbedLayout] ; Retour ferme l'écran ([onClose]).
 *
 * Si aucune vidéo ne démarre (15 s après un clic, ou erreurs de syntaxe d'une
 * WebView trop ancienne), un bandeau propose [onNext] (« Autre lecteur ») ou
 * de rester ; il prend alors les touches jusqu'au choix.
 */
@Composable
fun EmbedView(url: String, filter: EmbedFilter?, onClose: () -> Unit, onNext: (() -> Unit)? = null, referer: String? = null) {
    val context = LocalContext.current
    var stuck by remember(url) { mutableStateOf(Stuck.NONE) }
    val layout = remember(url) {
        EmbedLayout(context, filter).also { l ->
            l.onStuck = { old -> stuck = if (old) Stuck.OLD_ENGINE else Stuck.NO_VIDEO }
            l.onPlaying = { stuck = Stuck.NONE }
        }
    }
    DisposableEffect(layout) { onDispose { layout.destroy() } }
    // Pas d'écran de veille pendant le lecteur web.
    DisposableEffect(Unit) { com.movix.tv.ui.home.PlaybackActivity.begin(); onDispose { com.movix.tv.ui.home.PlaybackActivity.end() } }
    // Le bloqueur d'abord (≈ 0,3 s la première fois), sinon les premières pubs passeraient.
    LaunchedEffect(layout) {
        withTimeoutOrNull(4_000) { AdblockEngine.ready(context) }
        layout.load(url, referer)
    }
    val requester = remember { FocusRequester() }
    val bannerRequester = remember { FocusRequester() }
    var hint by remember { mutableStateOf(true) }
    LaunchedEffect(url) { delay(5_000); hint = false }

    fun stay() {
        stuck = Stuck.NONE
        layout.dismissStuck()
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(requester)
            .onPreviewKeyEvent { e ->
                val down = e.type == KeyEventType.KeyDown
                if (e.key == Key.Back || e.key == Key.Escape) {
                    if (!down) when {
                        stuck != Stuck.NONE -> stay()
                        !layout.handleBack() -> onClose()
                    }
                    return@onPreviewKeyEvent true
                }
                // Bandeau affiché : ses boutons ont le focus et reçoivent les touches.
                if (stuck != Stuck.NONE) return@onPreviewKeyEvent false
                if (down || e.type == KeyEventType.KeyUp) {
                    hint = false
                    layout.onKey(e.key.nativeKeyCode, down, e.nativeKeyEvent.repeatCount)
                } else false
            }
            .focusable(),
    ) {
        AndroidView(factory = { layout }, modifier = Modifier.fillMaxSize())
        AnimatedVisibility(hint && stuck == Stuck.NONE, enter = fadeIn(tween(200)), exit = fadeOut(tween(300)), modifier = Modifier.align(Alignment.TopCenter)) {
            Text(
                stringResource(R.string.embed_hint),
                style = MovixType.Button,
                modifier = Modifier.padding(top = 24.dp)
                    .background(MovixColors.Ink.copy(alpha = 0.85f), RoundedCornerShape(999.dp))
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        if (stuck != Stuck.NONE) {
            Column(
                Modifier.align(Alignment.BottomCenter).padding(bottom = 40.dp).width(620.dp)
                    .background(MovixColors.Panel.copy(alpha = 0.96f), RoundedCornerShape(14.dp))
                    .padding(horizontal = 24.dp, vertical = 20.dp),
            ) {
                Text(
                    stringResource(if (stuck == Stuck.OLD_ENGINE) R.string.embed_stuck_old_title else R.string.embed_stuck_title),
                    style = MovixType.Panel.copy(fontSize = 19.sp),
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    stringResource(if (stuck == Stuck.OLD_ENGINE) R.string.embed_stuck_old_body else R.string.embed_stuck_body),
                    style = MovixType.Body.copy(fontSize = 14.sp, lineHeight = 20.sp),
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (onNext != null) PillButton(stringResource(R.string.embed_next), onNext, Modifier.focusRequester(bannerRequester))
                    PillButton(
                        stringResource(R.string.embed_stay), ::stay,
                        if (onNext == null) Modifier.focusRequester(bannerRequester) else Modifier,
                    )
                }
            }
            LaunchedEffect(Unit) { delay(48); runCatching { bannerRequester.requestFocus() } }
        } else {
            LaunchedEffect(Unit) { delay(32); runCatching { requester.requestFocus() } }
        }
    }
}
