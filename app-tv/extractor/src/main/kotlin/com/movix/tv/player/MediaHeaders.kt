package com.movix.tv.player

/**
 * En-têtes de lecture par hôte : port fidèle de
 * `MovixTv-main/app/src/services/mediaProxyHeaders.ts` (`applyMediaProxyHeaderRules`).
 * Appliqué à **chaque** requête du lecteur (manifeste, segments, clés, CDN) :
 * les hébergeurs servent leurs segments depuis des domaines frères.
 */
object MediaHeaders {
    // Un vrai Chrome n'émet jamais Sec-Ch-Ua seul, et la version majeure de
    // l'User-Agent correspond à celle de Sec-Ch-Ua : sinon Fsvid sert son leurre.
    // Chrome 142 et non 140 : depuis le 2026-10-26, Fsvid/Vidzy servent un faux
    // master qui boucle sur lui-même à la chaîne exacte « Windows Chrome 140 ».
    const val SIGNED_USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
    const val SEC_CH_UA = "\"Chromium\";v=\"142\", \"Not=A?Brand\";v=\"24\", \"Google Chrome\";v=\"142\""
    const val SEC_CH_UA_MOBILE = "?0"
    const val SEC_CH_UA_PLATFORM = "\"Windows\""
    const val ACCEPT_LANGUAGE = "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
    // Fsvid/Vidzy servent un faux master à tout Accept-Encoding qui n'est pas
    // exactement celui de Chrome (mesuré le 2026-10-26), dont le « gzip » seul
    // d'OkHttp. Le CDN répond alors en gzip pour les playlists : Cronet le
    // décode seul, OkHttp passe par ManualGzipInterceptor.
    const val CHROME_ACCEPT_ENCODING = "gzip, deflate, br, zstd"
    private val MEDIA_PATH = Regex("""\.(?:m3u8|mpd|mp4|m4v|m4s|ts|aac|m4a|vtt|srt|key)$""", RegexOption.IGNORE_CASE)

    /** User-Agent de l'extraction Lulu/Veev/Vidara : leur jeton est lié à cette identité. */
    const val EXTRACTION_USER_AGENT = "Mozilla/5.0 Chrome/143.0.0.0"

    private val CLIENT_HINTS = listOf("Sec-Ch-Ua", "Sec-Ch-Ua-Mobile", "Sec-Ch-Ua-Platform")

    // Un suffixe qui commence par un point ne vaut que pour les sous-domaines.
    private val PROVIDER_ORIGINS: List<Pair<List<String>, String>> = listOf(
        listOf(
            "lulustream.com", "luluvdo.com", "luluvdoo.com", "luluvid.com", "lulu.st",
            "streamhihi.com", "cdn1.site", "d00ds.site", "732eg54de642sa.sbs", ".tnmr.org",
        ) to "https://lulustream.com",
        listOf("veev.to", "veev.pro", "poophq.com", "doods.to", ".veevcdn.co") to "https://veev.to",
        listOf("vidara.to", "vidara.so", ".s1q2105.com", ".97bf1.com") to "https://vidara.to",
    )

    private fun matchesHost(host: String, suffix: String): Boolean =
        if (suffix.startsWith('.')) host.endsWith(suffix) else host == suffix || host.endsWith(".$suffix")

    private fun providerOriginFor(host: String): String? =
        PROVIDER_ORIGINS.firstOrNull { (hosts, _) -> hosts.any { matchesHost(host, it) } }?.second

    /** Hôte d'une URL absolue, en minuscules, sans point final ; `null` si illisible. */
    fun hostnameOf(url: String): String? {
        val m = Regex("""^[a-z][a-z0-9+.-]*://([^/?#]*)""", RegexOption.IGNORE_CASE).find(url.trim()) ?: return null
        val authority = m.groupValues[1]
        val hostPort = authority.substring(authority.lastIndexOf('@') + 1)
        if (hostPort.startsWith('[')) {
            val end = hostPort.indexOf(']')
            return if (end < 0) null else hostPort.substring(0, end + 1).lowercase()
        }
        val host = hostPort.substringBefore(':')
        if (host.isEmpty()) return null
        return host.lowercase().trimEnd('.')
    }

    /**
     * En-têtes à envoyer pour [url], à partir de ceux de la source ([input]).
     * Les noms sont comparés sans casse ; la valeur posée garde le nom canonique.
     */
    fun apply(url: String, input: Map<String, String>): Map<String, String> {
        val headers = LinkedHashMap(input)
        val host = hostnameOf(url) ?: return headers
        val isFsvid = host == "fsvid.lol" || host.endsWith(".fsvid.lol")
        val isVidzy = host == "vidzy.org" || host.endsWith(".vidzy.org") || host == "vidzy.cc" || host.endsWith(".vidzy.cc")
        val providerOrigin = providerOriginFor(host)
        if (!isFsvid && !isVidzy && providerOrigin == null) return headers

        when {
            isFsvid -> {
                val origin = if (host == "fsvid.lol") "https://fs13.lol" else "https://fsvid.lol"
                headers.setCanonical("Origin", origin)
                headers.setCanonical("Referer", "$origin/")
            }
            isVidzy -> if (headers.getIgnoreCase("Referer") == null) headers.setCanonical("Referer", "https://vidzy.org/")
            else -> {
                headers.setCanonical("Origin", providerOrigin!!)
                headers.setCanonical("Referer", "$providerOrigin/")
            }
        }
        if (providerOrigin != null) {
            headers.setCanonical("User-Agent", EXTRACTION_USER_AGENT)
            headers.setCanonical("Accept-Language", ACCEPT_LANGUAGE)
            for (hint in CLIENT_HINTS) {
                val v = headers.getIgnoreCase(hint)
                if (!v.isNullOrEmpty()) headers.setCanonical(hint, v) else headers.removeIgnoreCase(hint)
            }
        } else {
            headers.setCanonical("Accept-Language", ACCEPT_LANGUAGE)
            headers.setCanonical("Sec-Ch-Ua", SEC_CH_UA)
            headers.setCanonical("Sec-Ch-Ua-Mobile", SEC_CH_UA_MOBILE)
            headers.setCanonical("Sec-Ch-Ua-Platform", SEC_CH_UA_PLATFORM)
            headers.setCanonical("User-Agent", SIGNED_USER_AGENT)
            // Médias seulement, comme dans l'app mobile : sur la page embed
            // (extraction), OkHttp ne décompresserait pas la réponse et le
            // userscript lirait des octets illisibles.
            if (MEDIA_PATH.containsMatchIn(url.substringBefore('#').substringBefore('?'))) {
                headers.setCanonical("Accept-Encoding", CHROME_ACCEPT_ENCODING)
            }
        }
        headers.setCanonical("Sec-Fetch-Site", "cross-site")
        headers.setCanonical("Sec-Fetch-Mode", "cors")
        headers.setCanonical("Sec-Fetch-Dest", "empty")
        return headers
    }

    private fun MutableMap<String, String>.getIgnoreCase(name: String): String? =
        entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value

    private fun MutableMap<String, String>.removeIgnoreCase(name: String) {
        keys.filter { it.equals(name, ignoreCase = true) }.forEach { remove(it) }
    }

    private fun MutableMap<String, String>.setCanonical(name: String, value: String) {
        removeIgnoreCase(name)
        put(name, value)
    }
}
