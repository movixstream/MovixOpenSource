package com.movix.tv.ui.profiles

import android.graphics.Matrix
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListPrefetchStrategy
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.layout.LazyLayoutCacheWindow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import com.movix.tv.R
import com.movix.tv.data.account.AvatarCatalog
import com.movix.tv.data.account.AvatarCategory
import com.movix.tv.ui.components.TabPill
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Diamètre d'une case de la grille, anneau compris ; l'image est en retrait de [ImageInset]. */
private val TileSize = 76.dp
private val ImageInset = 5.dp
private val TileGap = 12.dp

/** Zoom d'une case au focus, et son enfoncement tant que OK est tenu. */
private const val FOCUS_ZOOM = 1.15f
private const val PRESS_SINK = 0.07f

/** Repos sur une pastille avant que ses rangées remplacent les précédentes. */
private const val GROUP_SETTLE_MS = 140L

/** Hauteur gardée prête au-dessus et au-dessous de l'écran : une rangée (≈ 120 dp). */
private val RowsKeptReady = 130.dp

/** Rangées d'une plateforme dont les vignettes sont décodées dès que sa pastille a le focus. */
private const val WARM_ROWS = 6

/**
 * Numéro d'une case dans la grille affichée : rangée × [TILE_ID_STEP] + rang.
 * Pas son chemin : un même avatar peut figurer dans deux séries, et les deux
 * cases s'allumeraient ensemble.
 */
private const val TILE_ID_STEP = 100_000
private const val NO_TILE = -1

/**
 * Nombre de cases qui tiennent dans la largeur de l'écran, avec une marge :
 * celles d'une rangée qui sont composées avec elle, et dont les vignettes sont
 * décodées d'avance.
 */
@Composable
internal fun rememberAvatarsPerRow(): Int = (LocalConfiguration.current.screenWidthDp / (TileSize + TileGap).value).toInt() + 2

/**
 * Prépare l'ouverture du choix d'avatar pendant que l'éditeur du profil est à
 * l'écran : le catalogue est construit hors du fil principal, et les vignettes
 * du premier écran (autour de l'avatar [current]) sont décodées. Le choix
 * s'ouvre alors déjà rempli.
 */
internal suspend fun prepareAvatarPicker(store: AvatarThumbStore, current: String?, perRow: Int) {
    val firstScreen = withContext(Dispatchers.Default) {
        val spot = AvatarCatalog.locate(current)
        AvatarCatalog.groups[spot?.group ?: 0].categories
            .drop(spot?.category ?: 0)
            .take(WARM_ROWS)
            .flatMapIndexed { row, category ->
                // La rangée de l'avatar choisi s'ouvre trois cases avant lui.
                val first = if (row == 0) ((spot?.index ?: 0) - 3).coerceAtLeast(0) else 0
                category.avatars.drop(first).take(perRow)
            }
    }
    store.warm(firstScreen)
}

/**
 * Choix de l'avatar, comme le sélecteur du site : une pastille par plateforme
 * (Crunchyroll, Disney+…, Classiques), puis une rangée par série.
 *
 * Écran tenu fluide sur une box lente (4 cœurs à 1,2 GHz, peu de mémoire) :
 * - les images sont les vignettes embarquées ([AvatarThumbStore]) : ni réseau,
 *   ni décodage d'images de 800 px ;
 * - une case est un seul élément, dessiné à la main ; l'animation du focus et
 *   de l'appui est partagée par toute la grille ([TileGlow]) ;
 * - la rangée suivante est composée d'avance, avec toutes ses cases visibles ;
 * - en passant d'une pastille à l'autre, les rangées ne sont refaites qu'une
 *   fois le focus posé.
 *
 * À l'ouverture, la plateforme et la série de l'avatar [current] sont montrées
 * et il prend le focus. OK sur une case appelle [onPick] ; Retour est géré par
 * l'écran qui l'ouvre (l'avatar ne change pas).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun AvatarPicker(current: String?, siteHost: String?, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    val groups = AvatarCatalog.groups
    val spot = remember(current) { AvatarCatalog.locate(current) }
    // Pastille choisie : elle suit le focus. [shown] : plateforme dont les rangées sont à l'écran.
    var group by remember { mutableIntStateOf(spot?.group ?: 0) }
    var shown by remember { mutableIntStateOf(spot?.group ?: 0) }
    // Le focus doit entrer dans les rangées : à l'ouverture, puis sur Bas quand elles n'ont pas encore suivi la pastille.
    var enterRows by remember { mutableStateOf(true) }
    val pillRequester = remember { FocusRequester() }
    // Case qui prend alors le focus : l'avatar choisi, sinon le premier de la plateforme.
    val targetRequester = remember { FocusRequester() }
    val classics = stringResource(R.string.profiles_avatar_classics)
    val store = rememberAvatarThumbs()
    val scope = rememberCoroutineScope()
    val glow = remember { TileGlow(scope) }
    val perRow = rememberAvatarsPerRow()

    LaunchedEffect(group) {
        if (group == shown) return@LaunchedEffect
        // Le temps de repos sert à décoder le premier écran de la plateforme.
        store.warm(groups[group].categories.take(WARM_ROWS).flatMap { it.avatars.take(perRow) })
        delay(GROUP_SETTLE_MS)
        shown = group
    }

    Column(modifier.fillMaxSize().padding(start = 56.dp, top = 36.dp)) {
        Text(stringResource(R.string.profiles_avatar_title), style = MovixType.Title)
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.profiles_avatar_body), style = MovixType.Body)
        Spacer(Modifier.height(14.dp))
        // En remontant des rangées, le focus retrouve la plateforme ouverte. La plateforme suit le focus.
        Row(
            Modifier
                .focusRestorer(pillRequester)
                .focusGroup()
                // Bas avant que les rangées aient suivi la pastille : elles sont affichées d'abord,
                // puis le focus y entre. Sinon il entrerait dans les rangées qui s'en vont.
                .onPreviewKeyEvent { event ->
                    if (event.key != Key.DirectionDown || group == shown) return@onPreviewKeyEvent false
                    if (event.type == KeyEventType.KeyDown) {
                        shown = group
                        enterRows = true
                    }
                    true
                },
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            groups.forEachIndexed { i, g ->
                Box(if (i == group) Modifier.focusRequester(pillRequester) else Modifier) {
                    TabPill(
                        if (g.name == AvatarCatalog.CLASSICS) classics else g.name,
                        i == group,
                        onClick = {
                            group = i
                            shown = i
                        },
                        onFocused = { group = i },
                    )
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        // Une composition par plateforme : ses rangées repartent du haut.
        key(shown) {
            val categories = groups[shown].categories
            val here = spot?.takeIf { it.group == shown }
            val listState = rememberLazyListState(
                // La rangée du dessous est déjà composée quand le focus y descend, celle du dessus quand il remonte.
                cacheWindow = remember { LazyLayoutCacheWindow(ahead = RowsKeptReady, behind = RowsKeptReady) },
                initialFirstVisibleItemIndex = here?.category ?: 0,
            )
            LazyColumn(
                Modifier
                    .fillMaxSize()
                    // OK ne peut viser que la case au focus : un seul suivi de l'appui pour toute la grille.
                    .onPreviewKeyEvent { event ->
                        if (event.key == Key.DirectionCenter || event.key == Key.Enter || event.key == Key.NumPadEnter) {
                            glow.onPress(event.type == KeyEventType.KeyDown)
                        }
                        false
                    },
                state = listState,
                contentPadding = PaddingValues(bottom = 48.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                itemsIndexed(categories, key = { _, c -> c.name }, contentType = { _, _ -> "row" }) { c, category ->
                    val target = c == (here?.category ?: 0)
                    AvatarRow(
                        row = c,
                        category = category,
                        current = current,
                        siteHost = siteHost,
                        targetIndex = if (target) here?.index ?: 0 else -1,
                        targetRequester = if (target) targetRequester else null,
                        perRow = perRow,
                        store = store,
                        glow = glow,
                        onPick = onPick,
                    )
                }
            }
        }
    }

    LaunchedEffect(shown, enterRows) {
        if (!enterRows) return@LaunchedEffect
        // La rangée visée est posée en une ou deux images.
        repeat(10) {
            withFrameNanos { }
            if (targetRequester.tryFocus()) {
                enterRows = false
                return@LaunchedEffect
            }
        }
        enterRows = false
        pillRequester.tryFocus()
    }
}

/** Une série : son nom, puis ses avatars en rangée (Gauche/Droite). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AvatarRow(
    row: Int,
    category: AvatarCategory,
    current: String?,
    siteHost: String?,
    targetIndex: Int,
    targetRequester: FocusRequester?,
    perRow: Int,
    store: AvatarThumbStore,
    glow: TileGlow,
    onPick: (String) -> Unit,
) {
    Column {
        Text(category.name, style = MovixType.Row, modifier = Modifier.padding(start = 10.dp, bottom = 4.dp))
        val rowState = rememberLazyListState(
            // L'avatar choisi arrive à l'écran sans défiler depuis le début de la série.
            initialFirstVisibleItemIndex = (targetIndex - 3).coerceAtLeast(0),
            // Rangée composée d'avance par la liste : ses cases visibles le sont avec elle, pas à son arrivée à l'écran.
            prefetchStrategy = remember(perRow) { LazyListPrefetchStrategy(nestedPrefetchItemCount = perRow) },
        )
        LazyRow(
            // En revenant dans la rangée, le focus retrouve la case quittée.
            Modifier.fillMaxWidth().focusRestorer(),
            state = rowState,
            contentPadding = PaddingValues(start = 10.dp, end = 48.dp, top = 6.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(TileGap),
        ) {
            itemsIndexed(category.avatars, contentType = { _, _ -> "avatar" }) { i, path ->
                AvatarTile(
                    id = row * TILE_ID_STEP + i,
                    path = path,
                    selected = path == current,
                    siteHost = siteHost,
                    store = store,
                    glow = glow,
                    onPick = onPick,
                    modifier = if (i == targetIndex && targetRequester != null) Modifier.focusRequester(targetRequester) else Modifier,
                )
            }
        }
    }
}

/**
 * Case ronde d'un avatar : anneau d'accent et zoom au focus, anneau clair et
 * coche s'il est l'avatar choisi.
 *
 * Un seul élément : fond, vignette et anneaux sont dessinés ensemble, et le
 * focus ne se lit qu'au dessin ([glow]). Passer d'une case à l'autre, ou
 * recevoir une vignette, ne recompose rien.
 */
@Composable
private fun AvatarTile(
    id: Int,
    path: String,
    selected: Boolean,
    siteHost: String?,
    store: AvatarThumbStore,
    glow: TileGlow,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Vignette déjà décodée : dessinée dès la première image, sans rien lancer.
    val ready = store.peek(path)
    val thumb = remember(path) { mutableStateOf(ready) }
    var missing by remember(path) { mutableStateOf(false) }
    if (ready == null && !missing) {
        LaunchedEffect(path) {
            val loaded = store.load(path)
            if (loaded != null) thumb.value = loaded else missing = true
        }
    }
    Box(
        modifier
            .size(TileSize)
            .graphicsLayer {
                val scale = glow.scale(id)
                scaleX = scale
                scaleY = scale
            }
            .onFocusChanged { glow.onFocus(id, it.isFocused) }
            .clickable(interactionSource = null, indication = null) { onPick(path) }
            .drawWithCache {
                val outer = size.minDimension / 2f
                val radius = outer - ImageInset.toPx()
                val brush = thumb.value?.let { thumbBrush(it, radius, Offset(size.width / 2f, size.height / 2f)) }
                val chosenRing = Stroke(2.dp.toPx())
                val focusRing = Stroke(3.dp.toPx())
                onDrawBehind {
                    drawCircle(MovixColors.Panel, radius)
                    if (brush != null) drawCircle(brush, radius)
                    val focus = glow.focus(id).coerceIn(0f, 1f)
                    if (selected && focus < 1f) drawCircle(MovixColors.Text, outer - chosenRing.width / 2f, style = chosenRing)
                    if (focus > 0f) drawCircle(MovixColors.Red, outer - focusRing.width / 2f, alpha = focus, style = focusRing)
                }
            },
    ) {
        // Pas de vignette dans l'appli (catalogue plus récent qu'elles) : l'image du site, comme avant.
        if (missing) {
            val url = avatarUrl(path, siteHost)
            if (url != null) {
                AsyncImage(
                    model = rememberAvatarRequest(url, TileSize - ImageInset * 2, grid = true),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.padding(ImageInset).fillMaxSize().clip(CircleShape),
                )
            }
        }
        if (selected) CheckBadge(Modifier.align(Alignment.BottomEnd))
    }
}

/** [image] recadrée au centre pour remplir le disque de rayon [radius] autour de [center] : aucune découpe au dessin. */
private fun thumbBrush(image: ImageBitmap, radius: Float, center: Offset): ShaderBrush {
    val scale = radius * 2f / minOf(image.width, image.height)
    val shader = ImageShader(image)
    shader.setLocalMatrix(
        Matrix().apply {
            setScale(scale, scale)
            postTranslate(center.x - image.width * scale / 2f, center.y - image.height * scale / 2f)
        },
    )
    return ShaderBrush(shader)
}

/**
 * Focus et appui des cases de la grille, animés une fois pour toutes : une
 * seule case a le focus, une seule le quitte, et OK ne vise que la première.
 * Chaque case lit sa part au dessin ([focus], [scale]) ; aucune ne porte
 * d'animation ni d'écoute à elle.
 *
 * Mêmes courbes que les cartes (`focusProgress`, `pressProgress`) : ressort
 * court à l'arrivée du focus, fondu de 100 ms à son départ.
 */
@Stable
private class TileGlow(private val scope: CoroutineScope) {
    private var focused by mutableIntStateOf(NO_TILE)
    private var leaving by mutableIntStateOf(NO_TILE)
    private var enter by mutableFloatStateOf(0f)
    private var leave by mutableFloatStateOf(0f)
    private var press by mutableFloatStateOf(0f)
    private var enterJob: Job? = null
    private var leaveJob: Job? = null
    private var pressJob: Job? = null
    private var pressed = false

    /** Avancement du focus de la case [tile] : 0 sans focus, 1 au focus (le ressort dépasse un peu 1). */
    fun focus(tile: Int): Float = when (tile) {
        focused -> enter
        leaving -> leave
        else -> 0f
    }

    /** Échelle de la case [tile] : zoom du focus, moins l'enfoncement de l'appui. */
    fun scale(tile: Int): Float {
        val zoom = 1f + (FOCUS_ZOOM - 1f) * focus(tile).coerceIn(0f, 1f)
        return if (tile == focused) zoom * (1f - PRESS_SINK * press) else zoom
    }

    fun onFocus(tile: Int, has: Boolean) {
        if (has) {
            if (tile == focused) return
            if (focused != NO_TILE) release(focused)
            if (leaving == tile) leaving = NO_TILE
            focused = tile
            enter = 0f
            enterJob?.cancel()
            enterJob = scope.launch {
                animate(0f, 1f, animationSpec = spring(dampingRatio = 0.5f, stiffness = 700f)) { value, _ -> enter = value }
            }
        } else if (tile == focused) {
            release(tile)
            focused = NO_TILE
        }
    }

    /** OK enfoncé ([down]) ou relâché, sur la case au focus. */
    fun onPress(down: Boolean) {
        if (down == pressed) return
        pressed = down
        val from = press
        pressJob?.cancel()
        pressJob = scope.launch {
            animate(
                from,
                if (down) 1f else 0f,
                animationSpec = if (down) tween(70) else spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessMediumLow),
            ) { value, _ -> press = value }
        }
    }

    /** La case [tile] perd le focus : elle garde son avancement et le fond en 100 ms. */
    private fun release(tile: Int) {
        val from = enter.coerceIn(0f, 1f)
        leaving = tile
        leave = from
        leaveJob?.cancel()
        leaveJob = scope.launch { animate(from, 0f, animationSpec = tween(100)) { value, _ -> leave = value } }
        pressJob?.cancel()
        pressed = false
        press = 0f
    }
}
