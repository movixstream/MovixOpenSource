package com.movix.extract

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Analyse d'URL pour le polyfill `URL` : parties au format WHATWG
 * (`protocol` avec « : », `search` avec « ? », port vide s'il est par défaut).
 * http(s) passe par le parseur d'OkHttp ; les autres schémas (blob:, data:,
 * about:) sont rendus « opaques ». `null` si l'URL est invalide.
 */
object UrlParts {
    private val SCHEME = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):")

    fun parse(href: String, base: String?): String? {
        val input = href.trim()
        val scheme = SCHEME.find(input)?.groupValues?.get(1)?.lowercase()
        val url: HttpUrl? = when {
            scheme == "http" || scheme == "https" -> input.toHttpUrlOrNull()
            scheme != null -> return opaque(scheme, input.substring(scheme.length + 1))
            base != null -> base.trim().toHttpUrlOrNull()?.resolve(input)
            else -> null
        }
        url ?: return null
        val defaultPort = HttpUrl.defaultPort(url.scheme)
        return buildJsonObject {
            put("protocol", url.scheme + ":")
            put("username", url.encodedUsername)
            put("password", url.encodedPassword)
            put("hostname", url.host)
            put("port", if (url.port == defaultPort) "" else url.port.toString())
            put("pathname", url.encodedPath)
            put("search", url.encodedQuery?.let { "?$it" } ?: "")
            put("hash", url.encodedFragment?.let { "#$it" } ?: "")
        }.toString()
    }

    private fun opaque(scheme: String, rest: String): String {
        val hashAt = rest.indexOf('#')
        val beforeHash = if (hashAt >= 0) rest.substring(0, hashAt) else rest
        val queryAt = beforeHash.indexOf('?')
        return buildJsonObject {
            put("protocol", "$scheme:")
            put("username", "")
            put("password", "")
            put("hostname", "")
            put("port", "")
            put("pathname", if (queryAt >= 0) beforeHash.substring(0, queryAt) else beforeHash)
            put("search", if (queryAt >= 0) beforeHash.substring(queryAt) else "")
            put("hash", if (hashAt >= 0) rest.substring(hashAt) else "")
            put("opaque", true)
        }.toString()
    }
}
