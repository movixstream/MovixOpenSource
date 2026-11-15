package com.movix.tv.ui.profiles

import android.content.Context
import android.content.res.AssetManager
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import com.movix.tv.MovixApp
import com.movix.tv.data.account.AvatarThumbs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext

/**
 * Vignettes des avatars ([AvatarThumbs]) prêtes à dessiner : lues dans l'appli
 * et décodées hors du fil principal, puis gardées dans leur propre réserve
 * (elles ne chassent pas les affiches de celle du chargeur d'images).
 *
 * Une vignette déjà décodée est rendue tout de suite ([peek]) : une case qui
 * revient à l'écran n'attend rien. Tout s'appelle depuis le fil principal.
 */
internal class AvatarThumbStore(private val assets: AssetManager, maxBytes: Int) {
    private val cache = object : LruCache<String, ImageBitmap>(maxBytes) {
        override fun sizeOf(key: String, value: ImageBitmap): Int = value.width * value.height * 4
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    // Deux décodages à la fois : le reste des cœurs va au dessin et au défilement.
    private val decoder = Dispatchers.IO.limitedParallelism(2)
    private val loading = HashMap<String, Deferred<ImageBitmap?>>()

    /** Avatars sans vignette dans l'appli (catalogue plus récent que les vignettes, avatar hors catalogue). */
    private val missing = HashSet<String>()

    /** Vignette de l'avatar [path] (chemin du site) si elle est déjà décodée. */
    fun peek(path: String): ImageBitmap? = cache.get(path)

    /** Vignette de l'avatar [path], décodée au besoin ; `null` si l'appli n'en a pas. */
    suspend fun load(path: String): ImageBitmap? = peek(path) ?: task(path)?.await()

    /** Décode d'avance les vignettes de [paths], dans l'ordre, sans attendre. */
    fun warm(paths: List<String>) {
        for (path in paths) if (peek(path) == null) task(path)?.start()
    }

    /** L'éditeur de profil se ferme : la réserve ne garde que les dernières vignettes (les visages des profils). */
    fun trim() = cache.trimToSize(KEEP_BYTES)

    /** Décodage en cours ou à lancer de [path] : un seul par avatar, mené au bout même si l'écran qui l'attend s'en va. */
    private fun task(path: String): Deferred<ImageBitmap?>? {
        if (path in missing) return null
        return loading.getOrPut(path) {
            scope.async(start = CoroutineStart.LAZY) {
                val image = withContext(decoder) { decode(path) }
                loading.remove(path)
                if (image != null) cache.put(path, image) else missing += path
                image
            }
        }
    }

    private fun decode(path: String): ImageBitmap? = try {
        assets.open("${AvatarThumbs.DIR}/${AvatarThumbs.fileName(path)}").use { BitmapFactory.decodeStream(it) }?.asImageBitmap()
    } catch (_: Exception) {
        // Vignette absente ou illisible : l'écran retombe sur l'image du site.
        null
    } catch (_: OutOfMemoryError) {
        null
    }

    companion object {
        /** Une vignette décodée : 144 × 144 points sur 4 octets. */
        private const val THUMB_BYTES = 144 * 144 * 4
        private const val KEEP_BYTES = 12 * THUMB_BYTES

        @Volatile
        private var instance: AvatarThumbStore? = null

        fun of(context: Context): AvatarThumbStore = instance ?: synchronized(this) {
            instance ?: run {
                val app = context.applicationContext
                // Un écran du choix d'avatar montre une soixantaine de cases, plus les rangées gardées prêtes.
                val thumbs = if ((app as? MovixApp)?.lowRam == true) 96 else 192
                AvatarThumbStore(app.assets, thumbs * THUMB_BYTES).also { instance = it }
            }
        }
    }
}

/** Réserve de vignettes de l'appli. */
@Composable
internal fun rememberAvatarThumbs(): AvatarThumbStore {
    val context = LocalContext.current
    return remember(context) { AvatarThumbStore.of(context) }
}
