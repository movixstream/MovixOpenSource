package com.movix.tv.data.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log
import androidx.core.content.IntentCompat
import com.movix.tv.container

/**
 * Retour de la session [PackageInstaller]. `STATUS_PENDING_USER_ACTION` :
 * le système fournit l'écran de confirmation, ouvert ici ; c'est l'utilisateur
 * qui valide (ou annule) l'installation.
 */
class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
            if (confirm != null) {
                try {
                    context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    return
                } catch (e: Exception) {
                    Log.w("MovixUpdate", "écran de confirmation impossible à ouvrir", e)
                }
            }
            context.container.updates.onInstallResult(PackageInstaller.STATUS_FAILURE_BLOCKED, message)
            return
        }
        context.container.updates.onInstallResult(status, message)
    }

    companion object {
        const val ACTION = "com.movix.tv.UPDATE_INSTALL_STATUS"
    }
}
