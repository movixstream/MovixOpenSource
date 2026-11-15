package com.movix.tv.ui.home

import android.graphics.Bitmap
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import coil3.SingletonImageLoader
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.request.bitmapConfig
import coil3.toBitmap
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.local.UiPrefs
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.RowRegistry
import com.movix.tv.data.tmdb.TmdbImage
import com.movix.tv.ui.theme.LocalLowRam
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import java.util.concurrent.atomic.AtomicInteger

/**
 * Lecture vidéo en cours : l'écran de veille ne s'affiche jamais par-dessus.
 * Le lecteur (ou le lecteur web) appelle [begin] en s'ouvrant et [end] en se
 * fermant, par exemple :
 * `DisposableEffect(Unit) { PlaybackActivity.begin(); onDispose { PlaybackActivity.end() } }`.
 *
 * Sans cet appel, l'écran de veille se retient quand même tant qu'une vue
 * garde l'écran allumé (`keepScreenOn`, posé par le lecteur et la bande-annonce)
 * ou qu'une page web (lecteur web) est affichée.
 */
object PlaybackActivity {
    private val count = AtomicInteger()
    fun begin() { count.incrementAndGet() }
    fun end() { count.updateAndGet { (it - 1).coerceAtLeast(0) } }
    val active: Boolean get() = count.get() > 0
}

/**
 * Écran de veille : minuteur d'inactivité et touches. [MainActivity] passe
 * chaque touche par [onKey] avant de la distribuer.
 */
object Screensaver {
    /** Dernière touche reçue (`elapsedRealtime`). */
    @Volatile
    private var lastInput = SystemClock.elapsedRealtime()
    // Touche qui a fermé l'écran de veille : son relâchement est avalé aussi.
    private var swallowKeyCode = KeyEvent.KEYCODE_UNKNOWN

    internal var visible by mutableStateOf(false)
        private set

    /** Remet le minuteur à zéro (retour au premier plan, mouvement de souris…). */
    fun touch() { lastInput = SystemClock.elapsedRealtime() }

    internal val idleMs: Long get() = SystemClock.elapsedRealtime() - lastInput

    internal fun show() { visible = true }

    /** Ferme l'écran de veille sans avaler de touche (appli passée en fond). */
    fun dismiss() { visible = false; touch() }

    /**
     * À appeler pour chaque touche. Vrai = touche consommée : elle a fermé
     * l'écran de veille et ne doit rien déclencher d'autre.
     */
    fun onKey(event: KeyEvent): Boolean {
        touch()
        if (visible) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                visible = false
                swallowKeyCode = event.keyCode
            }
            return true
        }
        if (event.keyCode == swallowKeyCode && swallowKeyCode != KeyEvent.KEYCODE_UNKNOWN) {
            // Appui long : les répétitions puis le relâchement restent avalés.
            if (event.action == KeyEvent.ACTION_UP) swallowKeyCode = KeyEvent.KEYCODE_UNKNOWN
            return true
        }
        return false
    }
}

private const val SLIDE_MS = 8_000L
private const val FADE_MS = 1_200
private const val CHECK_EVERY_MS = 15_000L

/** Une vue garde l'écran allumé (lecteur, bande-annonce) ou une page web est affichée. */
private fun View.busy(): Boolean {
    if (!isShown) return false
    if (keepScreenOn || this is android.webkit.WebView) return true
    if (this is ViewGroup) for (i in 0 until childCount) if (getChildAt(i).busy()) return true
    return false
}

/**
 * Hôte de l'écran de veille, par-dessus tout le reste. Après N minutes sans
 * touche (réglage, 0 = coupé), hors lecture vidéo et appli au premier plan.
 */
@Composable
fun ScreensaverHost() {
    val context = LocalContext.current
    val values by context.container.store.values.collectAsStateWithLifecycle()
    val minutes = UiPrefs.screensaverMinutes(values)
    val view = LocalView.current
    val lifeState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val resumed = lifeState.isAtLeast(Lifecycle.State.RESUMED)

    LaunchedEffect(minutes, resumed) {
        if (minutes <= 0 || !resumed) return@LaunchedEffect
        val timeout = minutes * 60_000L
        while (isActive) {
            val wait = timeout - Screensaver.idleMs
            if (wait > 0) { delay(wait.coerceAtMost(CHECK_EVERY_MS)); continue }
            if (PlaybackActivity.active || view.rootView.busy()) {
                // Vidéo en cours : on repart de zéro à chaque vérification.
                Screensaver.touch()
                continue
            }
            Screensaver.show()
            snapshotFlow { Screensaver.visible }.first { !it }
        }
    }

    AnimatedVisibility(
        visible = Screensaver.visible,
        enter = fadeIn(tween(800)),
        exit = fadeOut(tween(250)),
    ) {
        ScreensaverContent()
    }
}

@Immutable
private class Slide(val n: Int, val title: String, val image: ImageBitmap)

@Composable
private fun ScreensaverContent() {
    val context = LocalContext.current
    val container = context.container
    val lowRam = LocalLowRam.current
    var items by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var slide by remember { mutableStateOf<Slide?>(null) }
    // Mode léger : fondu au noir entre deux images, une seule en mémoire.
    val lowRamAlpha = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        val specs = listOfNotNull(RowRegistry.find("tendances"), RowRegistry.find("films-selection"), RowRegistry.find("series-selection"))
        items = container.catalog.fetch(specs).values
            .flatMap { it.getOrNull().orEmpty() }
            .filter { it.backdropPath != null }
            .distinctBy { it.key }
            .shuffled()
    }

    LaunchedEffect(items) {
        if (items.isEmpty()) return@LaunchedEffect
        val loader = SingletonImageLoader.get(context)
        val metrics = context.resources.displayMetrics
        suspend fun load(k: Int): Slide? {
            val item = items[k % items.size]
            val request = ImageRequest.Builder(context)
                .data(TmdbImage.backdrop(item.backdropPath))
                .size(metrics.widthPixels.coerceAtMost(1280), metrics.heightPixels.coerceAtMost(720))
                .apply {
                    if (lowRam) {
                        // Hors du cache mémoire et en 16 bits : 1 Go de RAM.
                        memoryCachePolicy(CachePolicy.DISABLED)
                        bitmapConfig(Bitmap.Config.RGB_565)
                    }
                }
                .build()
            val bitmap = runCatching { loader.execute(request).image?.toBitmap() }.getOrNull() ?: return null
            return Slide(k, item.title, bitmap.asImageBitmap())
        }

        var k = 0
        var failures = 0
        var ready: Slide? = null
        while (isActive) {
            val next = ready ?: load(k)
            ready = null
            k++
            if (next == null) {
                // Pas d'images (réseau) : on réessaie plus tard, sans boucle folle.
                if (++failures >= items.size.coerceAtMost(5)) { failures = 0; delay(20_000) }
                continue
            }
            failures = 0
            if (lowRam) {
                slide = next
                lowRamAlpha.snapTo(0f)
                lowRamAlpha.animateTo(1f, tween(FADE_MS))
                delay(SLIDE_MS)
                lowRamAlpha.animateTo(0f, tween(FADE_MS))
                // Image libérée avant de charger la suivante.
                slide = null
            } else {
                slide = next
                // La suivante se charge pendant que celle-ci s'affiche.
                delay(FADE_MS.toLong())
                ready = load(k)
                delay(SLIDE_MS - FADE_MS)
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (lowRam) {
            slide?.let { s -> SlideImage(s, kenBurns = false, Modifier.fillMaxSize().graphicsLayer { alpha = lowRamAlpha.value }) }
        } else {
            Crossfade(targetState = slide, animationSpec = tween(FADE_MS), label = "screensaver") { s ->
                if (s != null) SlideImage(s, kenBurns = true, Modifier.fillMaxSize())
            }
        }
        // Lisibilité du titre et de l'heure.
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0f to Color.Black.copy(alpha = 0.45f),
                    0.22f to Color.Transparent,
                    0.62f to Color.Transparent,
                    1f to Color.Black.copy(alpha = 0.8f),
                ),
            ),
        )
        Clock(Modifier.align(Alignment.TopEnd).padding(top = 32.dp, end = 48.dp))
        val title = slide?.title
        if (title != null) {
            Column(
                Modifier.align(Alignment.BottomStart).padding(start = 56.dp, bottom = 44.dp).width(620.dp)
                    .graphicsLayer { alpha = if (lowRam) lowRamAlpha.value else 1f },
            ) {
                Text(title, style = MovixType.Hero, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        Image(
            painterResource(R.drawable.movix_wordmark),
            contentDescription = null,
            modifier = Modifier.align(Alignment.BottomEnd).padding(end = 48.dp, bottom = 48.dp).width(96.dp)
                .graphicsLayer { alpha = 0.55f },
        )
    }
}

@Composable
private fun SlideImage(s: Slide, kenBurns: Boolean, modifier: Modifier) {
    val scale = remember(s.n) { Animatable(1f) }
    if (kenBurns) {
        LaunchedEffect(s.n) { scale.animateTo(1.08f, tween((SLIDE_MS + 2 * FADE_MS).toInt(), easing = LinearEasing)) }
    }
    // Zoom vers un coin différent une image sur deux.
    val origin = if (s.n % 2 == 0) TransformOrigin(0.3f, 0.4f) else TransformOrigin(0.7f, 0.6f)
    Image(
        bitmap = s.image,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier.graphicsLayer {
            scaleX = scale.value
            scaleY = scale.value
            transformOrigin = origin
        },
    )
}

@Composable
private fun Clock(modifier: Modifier) {
    val context = LocalContext.current
    val format = remember { android.text.format.DateFormat.getTimeFormat(context) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            // Réveil au changement de minute.
            delay(60_000 - now % 60_000 + 50)
        }
    }
    Text(
        format.format(java.util.Date(now)),
        style = MovixType.Hero.copy(fontSize = 34.sp, color = MovixColors.Text),
        modifier = modifier,
    )
}
