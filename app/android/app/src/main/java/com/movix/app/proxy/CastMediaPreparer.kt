package com.movix.app.proxy

import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.URI
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

internal data class CastPreparedTextTrack(
    val url: String? = null,
    val language: String? = null,
    val name: String? = null,
    val contentType: String = "text/vtt",
    val headers: Map<String, String> = emptyMap(),
    val active: Boolean = false,
    val inlineVtt: String? = null,
)

internal data class CastPreparedSource(
    val url: String,
    val headers: Map<String, String>,
    val contentType: String? = null,
    val tracks: List<CastPreparedTextTrack> = emptyList(),
)

internal data class PreparedCastTextTrack(
    val lanUrl: String,
    val language: String?,
    val name: String?,
    val contentType: String,
    val active: Boolean = false,
)

internal data class PreparedCastMedia(
    val sessionId: String,
    val lanContentUrl: String,
    val profile: CastMediaProfile,
    val textTracks: List<PreparedCastTextTrack> = emptyList(),
)

internal class CastMediaPreparationException(
    val errorCode: String,
) : IllegalStateException(errorCode)

internal class CastMediaPreparer(
    private val upstream: MediaProxyUpstream,
    private val sessionStore: MediaProxySessionStore,
    private val access: MediaProxySessionAccess,
    private val port: Int,
    private val validateUrl: (String) -> URI =
        MediaProxyPolicy::validateHttpsUrlSyntax,
    private val executor: Executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "MovixCastMediaPreparer").apply { isDaemon = true }
    },
) : Closeable {
    init {
        require(access.mode == MediaProxyMode.CAST_LAN) {
            "Cast LAN access required"
        }
        require(port in 1..65_535) { "Invalid Cast proxy port" }
    }

    fun prepareAsync(
        source: CastPreparedSource,
        callback: (Result<PreparedCastMedia>) -> Unit,
    ) {
        executor.execute {
            callback(runCatching { prepare(source) })
        }
    }

    fun prepare(source: CastPreparedSource): PreparedCastMedia {
        val sourceUrl = validateUrl(source.url).toString()
        val headers = MediaProxyPolicy.sanitizeRequestHeaders(source.headers)
        val entry = inspectEntry(sourceUrl, headers, source.contentType)
        val registration = sessionStore.createCast(
            upstreamUrl = sourceUrl,
            method = "GET",
            headers = headers,
            port = port,
            access = access,
            profile = entry.profile,
            preparedResponse = entry.preparedEntry.takeUnless {
                entry.wrapDirectMediaPlaylist
            },
        )

        if (entry.restoredMaster != null) {
            val mediaPlaylist = requireNotNull(entry.preparedEntry)
            val mediaAlias = sessionStore.registerResourceAlias(
                sessionId = registration.sessionId,
                upstreamUrl = sourceUrl,
                port = port,
                preparedResponse = mediaPlaylist,
            )
            sessionStore.setPersistentPreparedResponse(
                sessionId = registration.sessionId,
                resourceId = registration.resourceId,
                preparedResponse = localizeRestoredMaster(
                    entry.restoredMaster.response,
                    setOf(sourceUrl, mediaPlaylist.finalUrl),
                    mediaAlias.localUrl,
                ),
            )
        } else if (entry.wrapDirectMediaPlaylist) {
            val mediaPlaylist = requireNotNull(entry.preparedEntry)
            val mediaAlias = sessionStore.registerResourceAlias(
                sessionId = registration.sessionId,
                upstreamUrl = sourceUrl,
                port = port,
                preparedResponse = mediaPlaylist,
            )
            val audioAlias = entry.companionAudio?.let { audio ->
                sessionStore.registerResourceAlias(
                    sessionId = registration.sessionId,
                    upstreamUrl = audio.url,
                    port = port,
                    preparedResponse = audio.response,
                )
            }
            sessionStore.setPersistentPreparedResponse(
                sessionId = registration.sessionId,
                resourceId = registration.resourceId,
                preparedResponse = wrapDirectMediaPlaylist(
                    mediaAlias.localUrl,
                    sourceUrl,
                    entry.masterCodecs,
                    audioAlias?.localUrl,
                ),
            )
        }

        entry.representative?.let { representative ->
            sessionStore.registerResource(
                sessionId = registration.sessionId,
                upstreamUrl = representative.url,
                port = port,
                preparedResponse = representative.response,
            )
        }

        val preparedTracks = source.tracks.map { track ->
            prepareTextTrack(
                registration.sessionId,
                track,
            )
        }
        return PreparedCastMedia(
            sessionId = registration.sessionId,
            lanContentUrl = registration.localUrl,
            profile = entry.profile,
            textTracks = preparedTracks,
        )
    }

    private data class Representative(
        val url: String,
        val response: MediaProxyPreparedResponse,
    )

    private data class InspectedEntry(
        val profile: CastMediaProfile,
        val preparedEntry: MediaProxyPreparedResponse?,
        val representative: Representative?,
        val wrapDirectMediaPlaylist: Boolean = false,
        val masterCodecs: String? = null,
        val companionAudio: Representative? = null,
        val restoredMaster: Representative? = null,
    )

    private fun inspectEntry(
        url: String,
        headers: Map<String, String>,
        hintedContentType: String?,
    ): InspectedEntry {
        val hintedHls = isHlsType(hintedContentType) ||
            runCatching { URI(url).path.lowercase(Locale.US).endsWith(".m3u8") }
                .getOrDefault(false)
        if (!hintedHls) {
            val head = execute(url, "HEAD", headers)
            head.use {
                if (head.statusCode == 405 || head.statusCode == 501) {
                    return inspectBoundedGet(url, headers, rangeProbe = true)
                }
                requireSuccess(head)
                val contentType = header(head.headers, "Content-Type") ?: hintedContentType
                CastMediaProfile.progressive(contentType)?.let { profile ->
                    return InspectedEntry(profile, null, null)
                }
                if (!isHlsType(contentType)) {
                    return inspectBoundedGet(url, headers, rangeProbe = true)
                }
            }
        }
        return inspectBoundedGet(url, headers, rangeProbe = false)
    }

    private fun inspectBoundedGet(
        url: String,
        headers: Map<String, String>,
        rangeProbe: Boolean,
    ): InspectedEntry {
        val requestHeaders = if (rangeProbe) {
            headers + ("Range" to "bytes=0-${MAX_MANIFEST_BYTES - 1}")
        } else {
            headers
        }
        val response = execute(url, "GET", requestHeaders)
        response.use {
            requireSuccess(response)
            val bytes = readBounded(response, MAX_MANIFEST_BYTES)
            val contentType = header(response.headers, "Content-Type")
            val directProfile = CastMediaProfile.detect(contentType, bytes)
            if (directProfile != null && directProfile.hlsSegmentFormat == null) {
                return InspectedEntry(directProfile, null, null)
            }
            require(looksLikeHls(contentType, bytes)) {
                throw CastMediaPreparationException("MOVIX_RELAY_UNSUPPORTED_MEDIA")
            }
            val representativeUrl = findRepresentativePlaylist(bytes, response.finalUrl)
            if (representativeUrl == null) {
                val profile = detectHlsProfile(
                    contentType,
                    bytes,
                    response.finalUrl,
                    headers,
                )
                    ?: throw CastMediaPreparationException(
                        "MOVIX_RELAY_UNSUPPORTED_HLS_TRANSPORT",
                    )
                val masterCodecs = if (profile.hlsSegmentFormat == "fmp4") {
                    probeFmp4Codecs(bytes, response.finalUrl, headers)
                } else {
                    null
                }
                if (profile.hlsSegmentFormat == "fmp4") {
                    warmUpSeekCombinedFmp4Segment(bytes, response.finalUrl, headers)
                }
                return InspectedEntry(
                    profile,
                    response.toPrepared(bytes),
                    null,
                    wrapDirectMediaPlaylist = true,
                    masterCodecs = masterCodecs,
                    companionAudio = if (profile.hlsSegmentFormat == "fmp4") {
                        findSeekStreamingCompanionAudio(response.finalUrl, headers)
                    } else {
                        null
                    },
                    restoredMaster = findSeekStreamingMaster(
                        discoveryMediaPlaylistUrl = response.finalUrl,
                        mediaPlaylistUrls = setOf(url, response.finalUrl),
                        headers = headers,
                    ),
                )
            }

            val representativeResponse = execute(representativeUrl, "GET", headers)
            representativeResponse.use {
                requireSuccess(representativeResponse)
                val representativeBytes =
                    readBounded(representativeResponse, MAX_MANIFEST_BYTES)
                val profile = detectHlsProfile(
                    header(representativeResponse.headers, "Content-Type"),
                    representativeBytes,
                    representativeResponse.finalUrl,
                    headers,
                ) ?: throw CastMediaPreparationException(
                    "MOVIX_RELAY_UNSUPPORTED_HLS_TRANSPORT",
                )
                require(profile.hlsSegmentFormat != null) {
                    throw CastMediaPreparationException(
                        "MOVIX_RELAY_UNSUPPORTED_HLS_TRANSPORT",
                    )
                }
                return InspectedEntry(
                    profile = profile,
                    preparedEntry = response.toPrepared(bytes),
                    representative = Representative(
                        representativeUrl,
                        representativeResponse.toPrepared(representativeBytes),
                    ),
                )
            }
        }
    }

    private fun detectHlsProfile(
        contentType: String?,
        playlistBytes: ByteArray,
        playlistUrl: String,
        headers: Map<String, String>,
    ): CastMediaProfile? {
        CastMediaProfile.detect(contentType, playlistBytes)?.let { return it }
        val segmentUrl = findFirstMediaSegment(playlistBytes, playlistUrl) ?: return null
        val probeHeaders = headers + (
            "Range" to "bytes=0-${PngWrappedMpegTs.MAX_PROBE_BYTES - 1}"
        )
        val segmentResponse = execute(segmentUrl, "GET", probeHeaders)
        segmentResponse.use {
            requireSuccess(segmentResponse)
            val prefix = readPrefix(segmentResponse, PngWrappedMpegTs.MAX_PROBE_BYTES)
            val segmentContentType = header(segmentResponse.headers, "Content-Type")
                ?.substringBefore(';')
                ?.trim()
                ?.lowercase(Locale.US)
            return when {
                PngWrappedMpegTs.payloadOffset(prefix) != null ->
                    CastMediaProfile.hlsTs(requiresPngTsUnwrap = true)
                // Segments MPEG-TS bruts servis sous une extension trompeuse
                // (.jpg, .html, sans extension…) : on se fie aux octets de synchro.
                isPlainMpegTsStart(prefix) ||
                    segmentContentType in setOf("video/mp2t", "video/mp2ts") ->
                    CastMediaProfile.hlsTs()
                isIsoBmffFragmentStart(prefix, prefix.size) ||
                    segmentContentType in setOf("video/mp4", "audio/mp4", "application/mp4") ->
                    CastMediaProfile.hlsFmp4()
                else -> null
            }
        }
    }

    private fun prepareTextTrack(
        sessionId: String,
        track: CastPreparedTextTrack,
    ): PreparedCastTextTrack {
        track.inlineVtt?.let { inlineVtt ->
            if (track.url != null) {
                throw CastMediaPreparationException("MOVIX_RELAY_INVALID_TEXT_TRACK")
            }
            return prepareInlineTextTrack(sessionId, track, inlineVtt)
        }
        val trackUrl = validateUrl(
            track.url ?: throw CastMediaPreparationException("MOVIX_RELAY_INVALID_TEXT_TRACK"),
        ).toString()
        val trackHeaders = MediaProxyPolicy.sanitizeRequestHeaders(track.headers)
        val response = execute(trackUrl, "GET", trackHeaders)
        response.use {
            requireSuccess(response)
            val bytes = readBounded(response, MAX_TEXT_TRACK_BYTES)
            val detectedType = header(response.headers, "Content-Type")
                ?.substringBefore(';')
                ?.trim()
                ?.lowercase(Locale.US)
            val contentType = when {
                detectedType == "text/vtt" -> "text/vtt"
                track.contentType.equals("text/vtt", ignoreCase = true) -> "text/vtt"
                trackUrl.substringBefore('?').endsWith(".vtt", ignoreCase = true) -> "text/vtt"
                else -> throw CastMediaPreparationException(
                    "MOVIX_RELAY_UNSUPPORTED_TEXT_TRACK",
                )
            }
            val local = sessionStore.registerResource(
                sessionId = sessionId,
                upstreamUrl = trackUrl,
                port = port,
                preparedResponse = response.toPrepared(bytes),
                headers = trackHeaders,
            )
            return PreparedCastTextTrack(
                lanUrl = local.localUrl,
                language = track.language?.take(35),
                name = track.name?.take(80),
                contentType = contentType,
                active = track.active,
            )
        }
    }

    private fun prepareInlineTextTrack(
        sessionId: String,
        track: CastPreparedTextTrack,
        input: String,
    ): PreparedCastTextTrack {
        val normalized = input.removePrefix("\uFEFF").replace("\r\n", "\n").replace('\r', '\n')
        val bytes = normalized.toByteArray(Charsets.UTF_8)
        if (
            bytes.isEmpty() ||
            bytes.size > MAX_TEXT_TRACK_BYTES ||
            normalized.indexOf('\u0000') >= 0 ||
            !normalized.startsWith("WEBVTT") ||
            !INLINE_VTT_CUE.containsMatchIn(normalized)
        ) {
            throw CastMediaPreparationException("MOVIX_RELAY_INVALID_TEXT_TRACK")
        }
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .take(16)
            .joinToString("") { "%02x".format(it) }
        val syntheticUrl = "https://inline.movix.invalid/$digest.vtt"
        val preparedResponse = MediaProxyPreparedResponse(
            200,
            "OK",
            mapOf(
                "Content-Type" to "text/vtt; charset=utf-8",
                "Access-Control-Allow-Origin" to "*",
                "Cache-Control" to "no-store",
            ),
            bytes,
            syntheticUrl,
        )
        val registration = sessionStore.registerResource(
            sessionId = sessionId,
            upstreamUrl = syntheticUrl,
            port = port,
            preparedResponse = preparedResponse,
            headers = emptyMap(),
        )
        sessionStore.setPersistentPreparedResponse(
            sessionId,
            registration.resourceId,
            preparedResponse,
        )
        return PreparedCastTextTrack(
            lanUrl = registration.localUrl,
            language = track.language?.take(35),
            name = track.name?.take(80),
            contentType = "text/vtt",
            active = track.active,
        )
    }

    private fun execute(
        url: String,
        method: String,
        headers: Map<String, String>,
    ): MediaProxyUpstreamResponse {
        validateUrl(url)
        Log.i("MovixCastDiag", "request method=$method url=$url")
        headers.forEach { (name, value) ->
            Log.i("MovixCastDiag", "request_header name=$name value=$value")
        }
        val response = upstream.execute(
            MediaProxyTarget(url, method, headers),
            emptyMap(),
        )
        val path = runCatching { URI(url).path.lowercase(Locale.US) }.getOrNull()
        val kind = when {
            path?.endsWith(".m3u8") == true -> "playlist"
            path?.endsWith(".m4s") == true -> "m4s"
            path?.endsWith(".ts") == true -> "ts"
            path?.endsWith(".image") == true -> "image"
            method == "HEAD" -> "head_other"
            else -> "other"
        }
        Log.i(
            "MovixCastDiag",
            "upstream method=$method kind=$kind status=${response.statusCode} " +
                "type=${header(response.headers, "Content-Type")?.substringBefore(';') ?: "none"} " +
                "finalUrl=${response.finalUrl}",
        )
        response.headers.forEach { (name, value) ->
            Log.i("MovixCastDiag", "response_header name=$name value=$value")
        }
        return response
    }

    private fun requireSuccess(response: MediaProxyUpstreamResponse) {
        if (response.statusCode !in 200..299) {
            throw CastMediaPreparationException("MOVIX_RELAY_UPSTREAM_ERROR")
        }
    }

    private fun readBounded(
        response: MediaProxyUpstreamResponse,
        limit: Int,
    ): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0
        while (true) {
            val count = response.body.read(buffer)
            if (count == -1) break
            total += count
            if (total > limit) {
                throw CastMediaPreparationException("MOVIX_RELAY_RESPONSE_TOO_LARGE")
            }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun MediaProxyUpstreamResponse.toPrepared(
        bytes: ByteArray,
    ): MediaProxyPreparedResponse = MediaProxyPreparedResponse(
        statusCode,
        statusMessage,
        headers,
        bytes,
        finalUrl,
    )

    private fun findRepresentativePlaylist(
        bytes: ByteArray,
        baseUrl: String,
    ): String? {
        val lines = bytes.toString(Charsets.UTF_8).lineSequence().toList()
        for (index in lines.indices) {
            if (!lines[index].trimStart().startsWith("#EXT-X-STREAM-INF:", true)) continue
            val candidate = lines.drop(index + 1)
                .firstOrNull { it.isNotBlank() && !it.trimStart().startsWith("#") }
                ?.trim()
                ?: continue
            return validateUrl(URI(baseUrl).resolve(candidate).toString()).toString()
        }
        return null
    }

    private fun findFirstMediaSegment(bytes: ByteArray, baseUrl: String): String? {
        var expectsSegment = false
        for (rawLine in bytes.toString(Charsets.UTF_8).lineSequence()) {
            val line = rawLine.trim()
            if (line.startsWith("#EXTINF:", ignoreCase = true)) {
                expectsSegment = true
                continue
            }
            if (expectsSegment && line.isNotEmpty() && !line.startsWith("#")) {
                return validateUrl(URI(baseUrl).resolve(line).toString()).toString()
            }
        }
        return null
    }

    private fun wrapDirectMediaPlaylist(
        localMediaPlaylistUrl: String,
        finalUrl: String,
        codecs: String?,
        localAudioPlaylistUrl: String?,
    ): MediaProxyPreparedResponse {
        val body = buildString {
            append("#EXTM3U\n")
            append("#EXT-X-VERSION:6\n")
            if (localAudioPlaylistUrl != null) {
                append(
                    "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio0\"," +
                        "NAME=\"Français\",LANGUAGE=\"fr\"," +
                        "AUTOSELECT=YES,DEFAULT=YES,URI=\"",
                )
                append(localAudioPlaylistUrl)
                append("\"\n")
            }
            append("#EXT-X-STREAM-INF:")
            append(masterVariantAttributes(codecs))
            if (codecs != null) append(",CODECS=\"").append(codecs).append('"')
            if (localAudioPlaylistUrl != null) append(",AUDIO=\"audio0\"")
            append('\n')
            append(localMediaPlaylistUrl)
            append('\n')
        }.toByteArray(Charsets.UTF_8)
        return MediaProxyPreparedResponse(
            statusCode = 200,
            statusMessage = "OK",
            headers = mapOf(
                "Content-Type" to CastMediaProfile.CANONICAL_HLS_MIME,
                "Content-Length" to body.size.toString(),
                "Cache-Control" to "no-store",
            ),
            body = body,
            finalUrl = finalUrl,
        )
    }

    private fun findSeekStreamingCompanionAudio(
        videoPlaylistUrl: String,
        headers: Map<String, String>,
    ): Representative? {
        val query = videoPlaylistUrl.indexOf('?').takeIf { it >= 0 }
        val pathPart = if (query == null) videoPlaylistUrl else videoPlaylistUrl.take(query)
        if (!SEEK_VIDEO_PLAYLIST.containsMatchIn(pathPart)) {
            return null
        }
        val audioUrl = validateUrl(
            SEEK_VIDEO_PLAYLIST.replace(pathPart, "index-f1-a1.m3u8") +
                if (query == null) "" else videoPlaylistUrl.substring(query),
        ).toString()
        return runCatching {
            val response = execute(audioUrl, "GET", headers)
            response.use {
                requireSuccess(response)
                val bytes = readBounded(response, MAX_MANIFEST_BYTES)
                val profile = CastMediaProfile.detect(
                    header(response.headers, "Content-Type"),
                    bytes,
                )
                if (profile?.hlsSegmentFormat != "fmp4") return@runCatching null
                Representative(audioUrl, response.toPrepared(bytes))
            }
        }.getOrNull()
    }

    private fun findSeekStreamingMaster(
        discoveryMediaPlaylistUrl: String,
        mediaPlaylistUrls: Set<String>,
        headers: Map<String, String>,
    ): Representative? {
        val uri = runCatching { URI(discoveryMediaPlaylistUrl) }.getOrNull() ?: return null
        val fileName = uri.path.substringAfterLast('/')
        if (!SEEK_MEDIA_PLAYLIST.matches(fileName)) return null
        val queryIndex = discoveryMediaPlaylistUrl.indexOf('?').takeIf { it >= 0 }
        val pathPart = if (queryIndex == null) {
            discoveryMediaPlaylistUrl
        } else {
            discoveryMediaPlaylistUrl.take(queryIndex)
        }
        val directory = pathPart.substringBeforeLast('/', missingDelimiterValue = "")
        if (directory.isEmpty()) return null
        val query = if (queryIndex == null) {
            ""
        } else {
            discoveryMediaPlaylistUrl.substring(queryIndex)
        }
        for (candidateName in listOf("master.m3u8", "index.m3u8")) {
            val candidateUrl = validateUrl("$directory/$candidateName$query").toString()
            val master = runCatching {
                val response = execute(candidateUrl, "GET", headers)
                response.use {
                    requireSuccess(response)
                    val bytes = readBounded(response, MAX_MANIFEST_BYTES)
                    val text = bytes.toString(Charsets.UTF_8)
                    if (!text.lineSequence().any {
                        it.trimStart().startsWith("#EXT-X-STREAM-INF:", ignoreCase = true)
                    }) {
                        return@runCatching null
                    }
                    if (!masterReferencesAnyMediaPlaylist(
                            bytes,
                            response.finalUrl,
                            mediaPlaylistUrls,
                        )
                    ) {
                        return@runCatching null
                    }
                    Representative(candidateUrl, response.toPrepared(bytes))
                }
            }.getOrNull()
            if (master != null) {
                return master
            }
        }
        return null
    }

    private fun masterReferencesAnyMediaPlaylist(
        masterBytes: ByteArray,
        masterUrl: String,
        mediaPlaylistUrls: Set<String>,
    ): Boolean {
        val normalizedMediaUrls = mediaPlaylistUrls.mapNotNullTo(mutableSetOf()) { url ->
            runCatching { validateUrl(url).toString() }.getOrNull()
        }
        var expectsVariant = false
        for (rawLine in masterBytes.toString(Charsets.UTF_8).lineSequence()) {
            val line = rawLine.trim()
            if (line.startsWith("#EXT-X-STREAM-INF:", ignoreCase = true)) {
                expectsVariant = true
                continue
            }
            if (!expectsVariant || line.isEmpty() || line.startsWith('#')) continue
            val resolved = runCatching {
                validateUrl(URI(masterUrl).resolve(line).toString()).toString()
            }.getOrNull()
            if (resolved in normalizedMediaUrls) return true
            expectsVariant = false
        }
        return false
    }

    private fun localizeRestoredMaster(
        master: MediaProxyPreparedResponse,
        mediaUrls: Set<String>,
        localMediaUrl: String,
    ): MediaProxyPreparedResponse {
        val rewritten = MediaProxyPolicy.rewritePlaylist(
            playlist = master.body.toString(Charsets.UTF_8),
            baseUrl = master.finalUrl,
            wrapDirectSubtitles = false,
        ) { discoveredUrl ->
            if (discoveredUrl in mediaUrls) localMediaUrl else discoveredUrl
        }.toByteArray(Charsets.UTF_8)
        val headers = master.headers
            .filterKeys { !it.equals("Content-Length", ignoreCase = true) }
            .toMutableMap()
        headers["Content-Length"] = rewritten.size.toString()
        return MediaProxyPreparedResponse(
            statusCode = master.statusCode,
            statusMessage = master.statusMessage,
            headers = headers,
            body = rewritten,
            finalUrl = master.finalUrl,
        )
    }

    private fun masterVariantAttributes(codecs: String?): String = when {
        codecs?.contains("avc1.64001f", ignoreCase = true) == true ->
            "PROGRAM-ID=1,BANDWIDTH=1133273," +
                "RESOLUTION=1280x720,FRAME-RATE=24.000"
        codecs?.contains("avc1.640028", ignoreCase = true) == true ->
            "PROGRAM-ID=1,BANDWIDTH=2168244," +
                "RESOLUTION=1920x1080,FRAME-RATE=24.000"
        else -> "BANDWIDTH=2000000"
    }

    private fun probeFmp4Codecs(
        playlistBytes: ByteArray,
        playlistUrl: String,
        headers: Map<String, String>,
    ): String? {
        val initUrl = findInitializationSegment(playlistBytes, playlistUrl) ?: return null
        return runCatching {
            val response = execute(
                initUrl,
                "GET",
                headers + ("Range" to "bytes=0-${MAX_INIT_PROBE_BYTES - 1}"),
            )
            response.use {
                requireSuccess(response)
                Fmp4CodecProbe.detect(readPrefix(response, MAX_INIT_PROBE_BYTES))
            }
        }.getOrNull()
    }

    private fun warmUpSeekCombinedFmp4Segment(
        playlistBytes: ByteArray,
        playlistUrl: String,
        headers: Map<String, String>,
    ) {
        val fileName = runCatching { URI(playlistUrl).path.substringAfterLast('/') }
            .getOrNull() ?: return
        if (!SEEK_COMBINED_MEDIA_PLAYLIST.matches(fileName)) return
        val segmentUrl = findFirstMediaSegment(playlistBytes, playlistUrl) ?: return
        runCatching {
            val response = execute(
                segmentUrl,
                "GET",
                headers + ("Range" to "bytes=0-${MAX_SEGMENT_WARMUP_BYTES - 1}"),
            )
            response.use {
                requireSuccess(response)
                readPrefix(response, MAX_SEGMENT_WARMUP_BYTES)
            }
        }
    }

    private fun findInitializationSegment(bytes: ByteArray, baseUrl: String): String? {
        val mapLine = bytes.toString(Charsets.UTF_8).lineSequence().firstOrNull {
            it.trimStart().startsWith("#EXT-X-MAP:", ignoreCase = true)
        } ?: return null
        val rawUri = HLS_URI_ATTRIBUTE.find(mapLine)?.groupValues?.get(1) ?: return null
        return validateUrl(URI(baseUrl).resolve(rawUri).toString()).toString()
    }

    private fun readPrefix(
        response: MediaProxyUpstreamResponse,
        limit: Int,
    ): ByteArray {
        val output = ByteArrayOutputStream(limit)
        val buffer = ByteArray(minOf(DEFAULT_BUFFER_SIZE, limit))
        while (output.size() < limit) {
            val count = response.body.read(
                buffer,
                0,
                minOf(buffer.size, limit - output.size()),
            )
            if (count == -1) break
            if (count > 0) output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun isPlainMpegTsStart(prefix: ByteArray): Boolean {
        val packet = PngWrappedMpegTs.TS_PACKET_BYTES
        if (prefix.size < packet * PngWrappedMpegTs.REQUIRED_TS_PACKETS) return false
        return (0 until PngWrappedMpegTs.REQUIRED_TS_PACKETS).all {
            (prefix[it * packet].toInt() and 0xff) == 0x47
        }
    }

    private fun looksLikeHls(contentType: String?, bytes: ByteArray): Boolean {
        return isHlsType(contentType) ||
            bytes.toString(Charsets.UTF_8)
                .removePrefix("\uFEFF")
                .trimStart()
                .startsWith("#EXTM3U")
    }

    private fun isHlsType(contentType: String?): Boolean {
        return contentType?.lowercase(Locale.US)?.contains("mpegurl") == true
    }

    private fun header(headers: Map<String, String>, name: String): String? {
        return headers.entries.firstOrNull {
            it.key.equals(name, ignoreCase = true)
        }?.value
    }

    override fun close() {
        (executor as? ExecutorService)?.shutdownNow()
    }

    companion object {
        private val INLINE_VTT_CUE = Regex(
            "(?m)^\\s*\\d{2,}:\\d{2}:\\d{2}\\.\\d{3}\\s+-->\\s+\\d{2,}:\\d{2}:\\d{2}\\.\\d{3}(?:\\s|$)",
        )
        private const val MAX_MANIFEST_BYTES = 512 * 1024
        private const val MAX_TEXT_TRACK_BYTES = 2 * 1024 * 1024
        private const val MAX_INIT_PROBE_BYTES = 256 * 1024
        private const val MAX_SEGMENT_WARMUP_BYTES = 64 * 1024
        private val HLS_URI_ATTRIBUTE = Regex(
            """URI\s*=\s*\"([^\"]+)\"""",
            RegexOption.IGNORE_CASE,
        )
        private val SEEK_VIDEO_PLAYLIST = Regex(
            "index-f[0-9]+-v[0-9]+\\.m3u8$",
            RegexOption.IGNORE_CASE,
        )
        private val SEEK_COMBINED_MEDIA_PLAYLIST = Regex(
            "index-f[0-9]+-v[0-9]+-a[0-9]+\\.m3u8",
            RegexOption.IGNORE_CASE,
        )
        private val SEEK_MEDIA_PLAYLIST = Regex(
            "index-f[0-9]+-v[0-9]+(?:-a[0-9]+)?\\.m3u8",
            RegexOption.IGNORE_CASE,
        )
    }
}
