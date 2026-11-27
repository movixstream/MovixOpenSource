package com.movix.tv.player

import android.net.Uri
import java.util.concurrent.ConcurrentHashMap

/**
 * Hôtes dont les adresses de lecture sont liées à l'IP qui les a obtenues
 * (Vodix : jeton du manifeste). Leurs requêtes doivent sortir par le même
 * client qu'à l'échange, OkHttp avec [com.movix.tv.data.net.Ipv4FirstDns] :
 * Cronet, qui préfère l'IPv6, se ferait refuser (403, vu sur la Bbox le
 * 2026-11-27). Rempli par [com.movix.tv.data.movix.VodixSources].
 */
object IpBoundHosts {
    private val hosts = ConcurrentHashMap.newKeySet<String>()

    fun add(host: String) {
        hosts.add(host.lowercase())
    }

    fun contains(host: String?): Boolean = host != null && host.lowercase() in hosts

    fun contains(uri: Uri): Boolean = contains(uri.host)
}
