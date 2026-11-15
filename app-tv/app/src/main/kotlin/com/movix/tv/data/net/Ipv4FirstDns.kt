package com.movix.tv.data.net

import okhttp3.Dns
import java.net.Inet4Address
import java.net.InetAddress

/**
 * Résolution système limitée à l'IPv4 quand l'hôte en a une ; l'IPv6 ne sert
 * que pour un hôte sans IPv4.
 *
 * Trier ne suffit pas : OkHttp remet l'IPv6 en tête (« happy eyeballs ») et ne
 * fait la course que sur la connexion TCP. Sur un réseau où l'IPv6 accepte la
 * connexion mais n'achemine rien (émulateur, box mal réglée), la poignée de
 * main TLS attendait alors tout le délai de lecture, 20 s, avant le repli IPv4.
 */
object Ipv4FirstDns : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
        val all = Dns.SYSTEM.lookup(hostname)
        val v4 = all.filterIsInstance<Inet4Address>()
        return v4.ifEmpty { all }
    }
}
