package com.movix.tv

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.allowRgb565
import coil3.request.bitmapConfig
import coil3.request.crossfade

class MovixApp : Application(), SingletonImageLoader.Factory {
    lateinit var container: AppContainer
        private set

    /** Appareil à peu de mémoire (Fire TV Stick Lite…) : caches réduits, pas de fondu. */
    val lowRam: Boolean by lazy {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        am.isLowRamDevice || am.memoryClass <= 192
    }

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.vip.start()
        android.util.Log.i("MovixPerf", "application créée (lowRam=$lowRam)")
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { container.http })) }
            .memoryCache {
                MemoryCache.Builder().maxSizePercent(context, if (lowRam) 0.10 else 0.18).build()
            }
            .diskCache {
                DiskCache.Builder().directory(cacheDir.resolve("images")).maxSizeBytes(120L * 1024 * 1024).build()
            }
            // Affiches opaques : 2 octets par pixel au lieu de 4.
            .bitmapConfig(Bitmap.Config.RGB_565)
            .allowRgb565(true)
            .crossfade(if (lowRam) 0 else 160)
            .build()
}

val Context.container: AppContainer get() = (applicationContext as MovixApp).container
