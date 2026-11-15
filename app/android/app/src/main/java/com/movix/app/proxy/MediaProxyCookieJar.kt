package com.movix.app.proxy

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * Cookies des hébergeurs, en mémoire, partagés par les clients OkHttp du
 * proxy média (lecture et relais Cast).
 *
 * Depuis le 2026-10-27, le master Vidzy pose `vz_pe` (Fsvid : `fsv_pe`) et le
 * CDN sert sa fausse variante de 177 octets à toute requête qui ne le renvoie
 * pas. Un navigateur le renvoie seul ; OkHttp n'a pas de stockage par défaut.
 * Rien n'est écrit sur disque : les cookies meurent avec le processus.
 */
internal object MediaProxyCookieJar : CookieJar {
    private const val MAX_COOKIES = 256
    private val cookies = ArrayList<Cookie>()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) {
            this.cookies.removeAll {
                it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path
            }
            this.cookies.add(cookie)
        }
        while (this.cookies.size > MAX_COOKIES) this.cookies.removeAt(0)
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        cookies.removeAll { it.expiresAt < now }
        return cookies.filter { it.matches(url) }
    }
}
