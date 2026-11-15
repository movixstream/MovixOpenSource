package com.movix.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.movix.tv.ui.MovixRoot
import com.movix.tv.ui.home.Screensaver
import com.movix.tv.ui.home.ScreensaverHost
import com.movix.tv.ui.theme.MovixTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val wakeFilter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_DREAMING_STOPPED)
        }
        ContextCompat.registerReceiver(this, wakeReceiver, wakeFilter, ContextCompat.RECEIVER_NOT_EXPORTED)
        // Essais hors release : `am start -n com.movix.tv/.MainActivity --es debug_embed <url>`
        // ouvre directement le lecteur web (souris + bloqueur) sur cette page.
        val debugEmbed = intent?.getStringExtra("debug_embed")?.takeIf { BuildConfig.BUILD_TYPE != "release" && it.startsWith("https://") }
        setContent {
            MovixTheme(lowRam = (application as MovixApp).lowRam) {
                Box(Modifier.fillMaxSize()) {
                    if (debugEmbed != null) com.movix.tv.ui.embed.EmbedView(debugEmbed, container.embedFilter, onClose = ::finish)
                    else MovixRoot(onExit = ::finish)
                    // Écran de veille par-dessus tout, jamais focalisé : les touches
                    // passent par dispatchKeyEvent.
                    ScreensaverHost()
                }
            }
        }
    }

    // Écran rallumé ou fin de l'économiseur du système : la télé n'appelle pas
    // toujours onStart au réveil (appli restée au premier plan pendant la veille).
    private val wakeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            Screensaver.touch()
            container.onWake()
        }
    }

    override fun onDestroy() {
        unregisterReceiver(wakeReceiver)
        super.onDestroy()
    }

    // Toute touche remet le minuteur de l'écran de veille à zéro ; celle qui
    // le ferme est avalée (elle ne déclenche rien dessous).
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (Screensaver.onKey(event)) return true
        return super.dispatchKeyEvent(event)
    }

    override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
        Screensaver.touch()
        return super.dispatchGenericMotionEvent(ev)
    }

    // Synchro avec le site : tirage au retour au premier plan, envoi en partant.
    override fun onStart() {
        super.onStart()
        Screensaver.touch()
        container.sync.onForeground()
    }

    override fun onStop() {
        Screensaver.dismiss()
        container.sync.onBackground()
        // Âges des titres (profils enfant) écrits tout de suite : l'appli peut être tuée en fond.
        container.appScope.launch { container.ages.save() }
        super.onStop()
    }
}
