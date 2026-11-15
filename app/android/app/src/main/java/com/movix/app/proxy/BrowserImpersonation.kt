package com.movix.app.proxy

import java.net.URI
import java.util.Locale

/**
 * Identité de navigateur que le proxy média présente aux hébergeurs qui trient
 * les clients sur leur empreinte (Fsvid/Vidzy). Elle doit être cohérente de
 * bout en bout : la signature TLS et HTTP/2 vient du profil curl-impersonate
 * [TARGET], les en-têtes ci-dessous sont ceux que ce même Chrome envoie pour
 * le XHR de son lecteur HLS, dans son ordre.
 *
 * Mesuré le 2026-10-30 : leur CDN sert un faux master de 177 octets à tout
 * ClientHello qui ne propose pas X25519MLKEM768 (OkHttp, curl simple) et à
 * tout Accept-Encoding autre que celui de Chrome (Cronet). Seul un vrai profil
 * de navigateur coche les deux cases, comme curl_cffi côté relais Python.
 *
 * Pour suivre un Chrome plus récent : changer [TARGET], [USER_AGENT] et
 * [SEC_CH_UA] ensemble, en reprenant les valeurs que le profil émet
 * (`curl-impersonate --impersonate <cible> https://tls.peet.ws/api/all`).
 */
internal object BrowserImpersonation {
    const val TARGET = "chrome152"
    const val USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
    const val SEC_CH_UA =
        "\"Chromium\";v=\"152\", \"Not?A_Brand\";v=\"24\", \"Google Chrome\";v=\"152\""
    const val SEC_CH_UA_PLATFORM = "\"Windows\""
    const val ACCEPT_ENCODING = "gzip, deflate, br, zstd"
    private const val DEFAULT_ACCEPT_LANGUAGE = "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"

    // Page qui héberge le lecteur, selon le domaine du CDN. Le navigateur envoie
    // son origine en Origin et en Referer (strict-origin-when-cross-origin).
    private val playerOrigins = listOf(
        "fsvid.lol" to "https://fsvid.lol",
        "vidzy.cc" to "https://vidzy.cc",
        "vidzy.org" to "https://vidzy.org",
    )

    fun playerOriginFor(host: String): String? {
        val normalized = host.lowercase(Locale.US).trimEnd('.')
        return playerOrigins.firstOrNull { (suffix, _) ->
            normalized == suffix || normalized.endsWith(".$suffix")
        }?.second
    }

    /**
     * En-têtes du XHR, sous forme de lignes `nom: valeur` pour libcurl. Le pont
     * JS ne fournit que la langue ; l'identité (User-Agent, indices client)
     * reste celle du profil TLS, sinon le CDN verrait deux navigateurs.
     */
    fun xhrHeaders(
        url: URI,
        bridgeHeaders: Map<String, String>,
        localHeaders: Map<String, String>,
        cookie: String?,
    ): List<String> {
        val host = requireNotNull(url.host) { "Missing upstream host" }
            .lowercase(Locale.US)
            .trimEnd('.')
        val bridge = MediaProxyPolicy.sanitizeRequestHeaders(bridgeHeaders)
        val local = MediaProxyPolicy.sanitizeLocalRequestHeaders(localHeaders)
        val origin = playerOriginFor(host) ?: bridge["Origin"]?.let(::originOf)

        val lines = ArrayList<String>(16)
        lines += "sec-ch-ua-platform: $SEC_CH_UA_PLATFORM"
        lines += "user-agent: $USER_AGENT"
        lines += "sec-ch-ua: $SEC_CH_UA"
        lines += "sec-ch-ua-mobile: ?0"
        lines += "accept: */*"
        if (origin != null && origin != "https://$host") lines += "origin: $origin"
        lines += "sec-fetch-site: ${fetchSite(origin, host)}"
        lines += "sec-fetch-mode: cors"
        lines += "sec-fetch-dest: empty"
        if (origin != null) lines += "referer: $origin/"
        lines += "accept-encoding: $ACCEPT_ENCODING"
        lines += "accept-language: ${bridge["Accept-Language"] ?: DEFAULT_ACCEPT_LANGUAGE}"
        if (!cookie.isNullOrEmpty()) lines += "cookie: $cookie"
        // Posés par le lecteur lui-même (plage d'octets, validation de cache).
        for (name in listOf("Range", "If-None-Match", "If-Modified-Since")) {
            local[name]?.let { lines += "${name.lowercase(Locale.US)}: $it" }
        }
        lines += "priority: u=1, i"
        return lines
    }

    private fun originOf(raw: String): String? = runCatching {
        val uri = URI(raw)
        val scheme = uri.scheme?.lowercase(Locale.US)
        val host = uri.host?.lowercase(Locale.US)
        if (scheme != "https" || host.isNullOrEmpty()) null else "https://$host"
    }.getOrNull()

    private fun fetchSite(origin: String?, host: String): String {
        val originHost = origin?.let { runCatching { URI(it).host }.getOrNull() }
            ?.lowercase(Locale.US)
            ?: return "cross-site"
        return when {
            originHost == host -> "same-origin"
            registrableDomain(originHost) == registrableDomain(host) -> "same-site"
            else -> "cross-site"
        }
    }

    // Suffisant pour les domaines visés ici (pas de suffixe public à deux niveaux).
    private fun registrableDomain(host: String): String =
        host.split('.').takeLast(2).joinToString(".")
}
