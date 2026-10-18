package com.movix.tv

import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import com.movix.tv.ui.MovixRoot
import com.movix.tv.ui.home.Screensaver
import com.movix.tv.ui.home.ScreensaverHost
import com.movix.tv.ui.theme.MovixTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        super.onStop()
    }
}
