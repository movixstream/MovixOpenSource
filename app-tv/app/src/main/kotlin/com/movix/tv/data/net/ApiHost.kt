package com.movix.tv.data.net

import android.content.Context
import android.util.Log
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.CacheControl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException
import java.net.ConnectException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/**
 * Domaine actuel de la Main API, trouvé comme l'appli mobile
 * (app/src/services/addressResolver.ts) : rentry.co/movix donne un miroir,
 * son `address.json` la liste des domaines actifs, principal en tête.
 *
 * Les FAI bloquent les anciens domaines par DNS (Bouygues : tous sauf le
 * principal) : on garde le premier `api.<domaine>` qui répond vraiment en
 * HTTPS. Une page de blocage n'a pas de certificat valide, elle est écartée.
 */
class ApiHostResolver(context: Context, base: OkHttpClient, private val json: Json) {
    private val prefs = context.getSharedPreferences("movix_api_host", Context.MODE_PRIVATE)
    private val probe = base.newBuilder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .callTimeout(8, TimeUnit.SECONDS)
        .build()
    private val lock = Any()

    @Volatile private var host: String? = prefs.getString(KEY, null)

    /** Hôte à utiliser : celui gardé, sinon une recherche bloquante (premier lancement). */
    fun current(): String = host ?: synchronized(lock) { host ?: resolve(exclude = null) }

    /** [failed] ne répond plus : nouvelle recherche, une seule à la fois. */
    fun refresh(failed: String): String = synchronized(lock) {
        host?.takeIf { it != failed } ?: resolve(exclude = failed)
    }

    private fun resolve(exclude: String?): String {
        val domains = (activeDomains() + FALLBACK_DOMAINS).distinct()
        val chosen = domains.asSequence()
            .map { "api.$it" }
            .filter { it != exclude }
            .firstOrNull(::answers)
            ?: CANONICAL
        Log.i(TAG, "API : $chosen")
        host = chosen
        prefs.edit().putString(KEY, chosen).apply()
        return chosen
    }

    /** Domaines actifs d'après address.json, en passant par le miroir de rentry. */
    private fun activeDomains(): List<String> {
        val mirrors = (listOfNotNull(rentryMirror()) + RESOLVER_HOSTS).distinct()
        for (mirror in mirrors) {
            val body = fetch("https://$mirror/address.json") ?: continue
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: continue
            val list = buildList {
                urlOf(root["primary"] as? JsonObject)?.let(::add)
                runCatching { root["active"]!!.jsonArray }.getOrNull()?.forEach { urlOf(it as? JsonObject)?.let(::add) }
            }.mapNotNull { it.toHttpUrlOrNull()?.host?.removePrefix("www.") }
            if (list.isNotEmpty()) return list
        }
        return emptyList()
    }

    private fun urlOf(o: JsonObject?): String? = o?.get("url")?.jsonPrimitive?.contentOrNull

    /** Premier lien de la page rentry qui n'est pas rentry lui-même. */
    private fun rentryMirror(): String? {
        val html = fetch("https://rentry.co/movix") ?: return null
        val scope = Regex("<article\\b[^>]*>([\\s\\S]*?)</article>", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1) ?: html
        return Regex("href=[\"']https?://([^/\"'\\s?#]+)", RegexOption.IGNORE_CASE).findAll(scope)
            .map { it.groupValues[1].lowercase() }
            .firstOrNull { !it.endsWith("rentry.co") && it.contains('.') }
    }

    private fun answers(apiHost: String): Boolean = runCatching {
        probe.newCall(Request.Builder().url("https://$apiHost/").head().cacheControl(CacheControl.FORCE_NETWORK).build())
            .execute().use { true }
    }.getOrDefault(false)

    private fun fetch(url: String): String? = runCatching {
        probe.newCall(Request.Builder().url(url).cacheControl(CacheControl.FORCE_NETWORK).build()).execute().use {
            if (it.isSuccessful) it.body.string() else null
        }
    }.getOrNull()

    companion object {
        /** Hôte écrit dans le code (MovixApi) ; remplacé à la volée par l'intercepteur. */
        const val CANONICAL = "api.movix.men"
        private const val KEY = "host"
        private const val TAG = "MovixApiHost"
        private val RESOLVER_HOSTS = listOf("movix.online")
        // Si rentry et address.json sont injoignables : ordre de address.json au 2026-10-15.
        private val FALLBACK_DOMAINS = listOf("movix.dog", "movix.luxe", "movix.college", "movix.men", "movix.fun", "movix.cash")
    }
}

/**
 * Envoie les appels à `*.movix.men` (code de l'appli et userscript
 * d'extraction : api, proxiesembed) vers le domaine actuel ; un essai de plus
 * sur un autre domaine s'il ne répond plus.
 */
class ApiHostInterceptor(private val resolver: ApiHostResolver) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val sub = subdomainOf(request.url.host) ?: return chain.proceed(request)
        val api = resolver.current()
        try {
            return chain.proceed(request.onDomain(sub, api))
        } catch (e: IOException) {
            if (e !is UnknownHostException && e !is ConnectException && e !is SSLException) throw e
            val next = resolver.refresh(failed = api)
            if (next == api) throw e
            return chain.proceed(request.onDomain(sub, next))
        }
    }

    /** `api.movix.men` → `api` ; `null` pour un hôte d'un autre domaine. */
    private fun subdomainOf(host: String): String? =
        if (host.endsWith(".$CANONICAL_DOMAIN")) host.removeSuffix(".$CANONICAL_DOMAIN") else null

    private fun Request.onDomain(sub: String, apiHost: String): Request {
        val host = "$sub.${apiHost.removePrefix("api.")}"
        return if (url.host == host) this else newBuilder().url(url.newBuilder().host(host).build()).build()
    }

    private companion object {
        val CANONICAL_DOMAIN = ApiHostResolver.CANONICAL.removePrefix("api.")
    }
}
