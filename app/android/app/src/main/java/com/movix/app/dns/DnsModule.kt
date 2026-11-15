package com.movix.app.dns

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.*

/**
 * Module React Native pour contrôler le service VPN DNS.
 */
class DnsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val VPN_REQUEST_CODE = 1001
        private const val START_TIMEOUT_MS = 5_000L
    }

    private var vpnPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = "DnsModule"

    @ReactMethod
    fun enable(primaryDns: String, secondaryDns: String, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Pas d'activité disponible")
            return
        }

        DnsVpnService.primaryDns = primaryDns
        DnsVpnService.secondaryDns = secondaryDns

        val vpnIntent = VpnService.prepare(activity)
        if (vpnIntent != null) {
            // Besoin de la permission VPN de l'utilisateur
            vpnPromise = promise
            activity.startActivityForResult(vpnIntent, VPN_REQUEST_CODE)
        } else {
            // Permission déjà accordée
            startVpnService(primaryDns, secondaryDns)
            resolveWhenActive(promise)
        }
    }

    /**
     * Ne répond qu'une fois le tunnel monté : l'app attend ce moment pour
     * charger Movix, sinon le changement de réseau coupe ses premières requêtes.
     */
    private fun resolveWhenActive(promise: Promise) {
        val handler = Handler(Looper.getMainLooper())
        val deadline = SystemClock.uptimeMillis() + START_TIMEOUT_MS
        handler.post(object : Runnable {
            override fun run() {
                when {
                    DnsVpnService.isActive -> promise.resolve(true)
                    SystemClock.uptimeMillis() >= deadline ->
                        promise.reject("VPN_START_FAILED", "Le VPN DNS n'a pas démarré")
                    else -> handler.postDelayed(this, 100)
                }
            }
        })
    }

    @ReactMethod
    fun disable(promise: Promise) {
        try {
            val intent = Intent(reactContext, DnsVpnService::class.java)
            intent.action = ACTION_STOP
            reactContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("DISABLE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun isEnabled(promise: Promise) {
        promise.resolve(DnsVpnService.isActive)
    }

    private fun startVpnService(primaryDns: String, secondaryDns: String) {
        val intent = Intent(reactContext, DnsVpnService::class.java)
        intent.putExtra(EXTRA_PRIMARY_DNS, primaryDns)
        intent.putExtra(EXTRA_SECONDARY_DNS, secondaryDns)
        reactContext.startService(intent)
    }

    override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode == VPN_REQUEST_CODE) {
            if (resultCode == Activity.RESULT_OK) {
                startVpnService(DnsVpnService.primaryDns, DnsVpnService.secondaryDns)
                vpnPromise?.let { resolveWhenActive(it) }
            } else {
                vpnPromise?.reject("VPN_DENIED", "L'utilisateur a refusé la connexion VPN")
            }
            vpnPromise = null
        }
    }

    override fun onNewIntent(intent: Intent?) {}
}
