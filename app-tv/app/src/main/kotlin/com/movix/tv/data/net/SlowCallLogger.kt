package com.movix.tv.data.net

import android.util.Log
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.Handshake
import okhttp3.Protocol
import okhttp3.Response
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy

/**
 * Journal des étapes d'un appel réseau (DNS, connexion, TLS, réponse), écrit
 * seulement si l'appel dépasse 2 s : sert à comprendre un premier écran lent
 * sur un réseau donné, sans bruit dans le cas normal.
 */
class SlowCallLogger : EventListener() {
    private val start = System.nanoTime()
    private val steps = StringBuilder()

    private fun mark(name: String) {
        steps.append(name).append('@').append((System.nanoTime() - start) / 1_000_000).append("ms ")
    }

    override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) = mark("dns(${inetAddressList.size})")
    override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) = mark("connect:${inetSocketAddress.address.hostAddress}")
    override fun secureConnectEnd(call: Call, handshake: Handshake?) = mark("tls")
    override fun connectEnd(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: Protocol?) = mark("connected($protocol)")
    override fun connectFailed(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: Protocol?, ioe: IOException) = mark("connectFailed($ioe)")
    override fun connectionAcquired(call: Call, connection: okhttp3.Connection) = mark("acquired")
    override fun responseHeadersEnd(call: Call, response: Response) = mark("headers(${response.code})")
    override fun callFailed(call: Call, ioe: IOException) { mark("failed($ioe)"); flush(call) }
    override fun callEnd(call: Call) { mark("end"); flush(call) }

    private fun flush(call: Call) {
        if ((System.nanoTime() - start) / 1_000_000 > 2000) {
            Log.w("MovixNet", "${call.request().url.encodedPath} : $steps")
        }
    }

    companion object {
        val Factory = EventListener.Factory { SlowCallLogger() }
    }
}
