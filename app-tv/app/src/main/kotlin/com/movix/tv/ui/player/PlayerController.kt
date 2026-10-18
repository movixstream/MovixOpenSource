package com.movix.tv.ui.player

import android.util.Log
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.text.CueGroup
import androidx.media3.exoplayer.ExoPlaybackException
import androidx.media3.exoplayer.ExoPlayer
import com.movix.tv.AppContainer
import com.movix.tv.data.local.Library
import com.movix.tv.data.local.SubtitleStyle
import com.movix.tv.data.local.TvKeys
import com.movix.tv.data.local.UiKeys
import com.movix.tv.data.local.UiPrefs
import com.movix.tv.data.local.WatchMeta
import com.movix.tv.data.movix.Lang
import com.movix.tv.data.movix.PlayRequest
import com.movix.tv.data.movix.PlaybackSource
import com.movix.tv.data.movix.SourceSelector
import com.movix.tv.data.movix.StreamKind
import com.movix.tv.data.movix.SubtitleTrack
import com.movix.tv.data.tmdb.Episode
import com.movix.tv.data.tmdb.MediaType
import com.movix.tv.player.Codecs
import com.movix.tv.player.SubtitleCue
import com.movix.tv.player.qualityLabel
import com.movix.tv.player.Subtitles
import com.movix.extract.Extraction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import okhttp3.Request

/** Ce que le lecteur ouvre : la demande de sources et de quoi titrer l'écran. */
@Immutable
data class PlayTarget(val request: PlayRequest, val title: String, val backdropPath: String?)

enum class PlayerPhase { LOADING, NEED_VIP, NO_SOURCE, PLAYING }

enum class VideoFormat { FIT, FILL, STRETCH }

@Immutable
data class TrackOption(
    val label: String,
    val groupIndex: Int,
    val trackIndex: Int,
    val height: Int = 0,
    val number: Int = 0,
    /** Code de langue normalisé (« fr », « en »), `null` si le flux n'en donne pas. */
    val language: String? = null,
)

/** Types de passage de `api/segments` (Main API, `mediaSegments/constants.js`). */
enum class SegmentKind(
    /** Couleur sur la barre de progression, celle du site (`DEFAULT_SEGMENT_COLORS`, skipSegmentPrefs.ts). */
    val color: Long,
) {
    INTRO(0xFFFBBF24),
    RECAP(0xFF38BDF8),
    OUTRO(0xFFA78BFA),
    CREDITS(0xFFE879F9),
    PREVIEW(0xFF34D399);

    /** Générique de fin (outro ou crédits) : mène à l'épisode suivant. */
    val isEnd: Boolean get() = this == OUTRO || this == CREDITS

    companion object {
        fun of(type: String): SegmentKind? = when (type) {
            "intro" -> INTRO
            "recap" -> RECAP
            "outro" -> OUTRO
            "credits" -> CREDITS
            "preview" -> PREVIEW
            else -> null
        }
    }
}

@Immutable
data class Segment(val kind: SegmentKind, val range: LongRange)

/** Sous-titres choisis : aucun, un fichier externe de la source, ou une piste du flux. */
sealed interface SubtitleChoice {
    data object Off : SubtitleChoice
    data class External(val track: SubtitleTrack) : SubtitleChoice
    data class Embedded(val option: TrackOption) : SubtitleChoice
}

/**
 * Image ou son que l'appareil ne sait pas décoder sur la source en cours
 * (H.265, Dolby Digital Plus, DTS…). [video] / [audio] : noms affichés.
 */
@Immutable
data class FormatIssue(val video: String?, val audio: String?)

/**
 * État et commandes du lecteur. Un `ExoPlayer` par écran, libéré par
 * [release]. Toutes les méthodes s'appellent sur le fil principal.
 */
@Stable
class PlayerController(
    private val container: AppContainer,
    private val scope: CoroutineScope,
    initial: PlayTarget,
) {
    val player: ExoPlayer = container.playerEngine.newPlayer()

    var target by mutableStateOf(initial); private set
    var phase by mutableStateOf(PlayerPhase.LOADING); private set
    var episodeTitle by mutableStateOf<String?>(null); private set
    var sources by mutableStateOf<List<PlaybackSource>>(emptyList()); private set
    var deviceSources by mutableStateOf<List<PlaybackSource>>(emptyList()); private set
    /** Lecteurs embed à ouvrir dans le lecteur web (souris virtuelle). */
    var webSources by mutableStateOf<List<PlaybackSource>>(emptyList()); private set
    /** Lecteur web ouvert par-dessus le lecteur natif, ou `null`. */
    var webSource by mutableStateOf<PlaybackSource?>(null); private set
    var current by mutableStateOf<PlaybackSource?>(null); private set
    /** Message passager (source en panne…), effacé après quelques secondes. */
    var notice by mutableStateOf<Int?>(null); private set
    /** Format illisible ici : la lecture est en pause et l'écran propose de changer de lecteur. */
    var formatIssue by mutableStateOf<FormatIssue?>(null); private set

    var isPlaying by mutableStateOf(false); private set
    var buffering by mutableStateOf(true); private set
    var positionMs by mutableLongStateOf(0L); private set
    var durationMs by mutableLongStateOf(0L); private set
    var bufferedMs by mutableLongStateOf(0L); private set
    var videoAspect by mutableFloatStateOf(16f / 9f); private set
    var videoHeight by mutableIntStateOf(0); private set
    /** « 1080p » : calculé sur la largeur aussi (un 1920×872 n'est pas du « 872p »). */
    var qualityText by mutableStateOf<String?>(null); private set

    var videoTracks by mutableStateOf<List<TrackOption>>(emptyList()); private set
    var audioTracks by mutableStateOf<List<TrackOption>>(emptyList()); private set
    var embeddedTextTracks by mutableStateOf<List<TrackOption>>(emptyList()); private set
    /** Sous-titres Shegu et OpenSubtitles du titre (langue de l'appli d'abord). */
    var searchedSubtitles by mutableStateOf<List<SubtitleTrack>>(emptyList()); private set
    var selectedVideo by mutableStateOf<TrackOption?>(null); private set
    var selectedAudio by mutableStateOf<TrackOption?>(null); private set
    var subtitle by mutableStateOf<SubtitleChoice>(SubtitleChoice.Off); private set
    var subtitleText by mutableStateOf<String?>(null); private set
    /** Filtre de langue des sous-titres (« fr »…), `null` : toutes. */
    var subtitleLang by mutableStateOf<String?>(null)
    /** Langue vers laquelle les sous-titres sont traduits, `null` : pas de traduction. */
    var translateTo by mutableStateOf<String?>(null); private set
    /** Texte source → traduction, rempli au fil de la traduction. */
    private val translations = androidx.compose.runtime.mutableStateMapOf<String, String>()
    private val pendingTranslations = HashSet<String>()
    private var translateJob: Job? = null
    /** Clé VIP active : les lecteurs réservés aux VIP portent alors leur badge. */
    val isVip: Boolean get() = container.vip.activeKey != null
    /** Sous-titre affiché : sa traduction quand elle est prête, sinon l'original. */
    val shownSubtitle: String? get() = subtitleText?.let { translations[it] ?: it }
    var subtitleOffsetMs by mutableLongStateOf(0L); private set
    var speed by mutableFloatStateOf(1f); private set
    var format by mutableStateOf(VideoFormat.FIT); private set

    /** Intro à passer (ms), début du générique de fin (ms), épisode suivant. */
    var intro by mutableStateOf<LongRange?>(null); private set
    var outroStartMs by mutableStateOf<Long?>(null); private set
    /** Passages connus (route `api/segments`, comme le lecteur du site). */
    var segments by mutableStateOf<List<Segment>>(emptyList()); private set
    var next by mutableStateOf<Pair<Int, Int>?>(null); private set
    /** Fiche TMDB de l'épisode suivant (titre, image) pour la carte de fin et le bouton. */
    var nextEpisode by mutableStateOf<Episode?>(null); private set
    /** Saisons de la série (panneau Épisodes). */
    var seasonNumbers by mutableStateOf<List<Int>>(emptyList()); private set
    /** Épisodes par saison, gardés pour toute la séance (même série). */
    private val seasonEpisodes = androidx.compose.runtime.mutableStateMapOf<Int, List<Episode>>()

    /** « Vous regardez toujours ? » affiché : lecture en pause, l'épisode suivant attend. */
    var stillWatching by mutableStateOf(false); private set
    /** Épisodes lancés d'affilée sans aucune touche de télécommande. */
    private var autoChained = 0

    /** Texte de l'écran d'attente : recherche des sources, puis extraction sur la télé. */
    var loadingText by mutableIntStateOf(com.movix.tv.R.string.player_loading); private set
    /** Lecteur en cours d'extraction sur la télé (panneau Source). */
    var extractingId by mutableStateOf<String?>(null); private set

    /** Extractions de cette séance, par lien embed (succès comme échecs). */
    private val extracted = HashMap<String, Extraction>()
    private val inFlight = HashMap<String, kotlinx.coroutines.Deferred<Extraction>>()
    private var deviceJob: Job? = null
    private var extractAllJob: Job? = null

    private var externalCues: List<SubtitleCue> = emptyList()
    private var embeddedCueText: String? = null
    private val failed = HashSet<String>()
    private var kindRetried = false
    private var loadJob: Job? = null
    private var startWatch: Job? = null
    private var subsJob: Job? = null
    private var noticeJob: Job? = null
    private var segmentsRequested = false
    private var metaWritten = false
    private var pendingStartMs = 0L

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(playing: Boolean) {
            isPlaying = playing
            if (!playing) saveProgress()
        }

        override fun onPlaybackStateChanged(state: Int) {
            buffering = state == Player.STATE_BUFFERING || state == Player.STATE_IDLE
            if (state == Player.STATE_READY) {
                startWatch?.cancel()
                durationMs = player.duration.coerceAtLeast(0)
                onReady()
            }
            if (state == Player.STATE_ENDED) {
                saveProgress(ended = true)
                if (next != null && UiPrefs.flag(container.store.values.value, UiKeys.AUTOPLAY_NEXT)) autoAdvance()
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            Log.w("MovixPlayer", "erreur ${error.errorCodeName} sur ${current?.label}", error)
            val parsing = error.errorCode in PARSING_ERRORS
            val s = current ?: return
            if (error.errorCode in DECODER_ERRORS) {
                // Pas de bascule automatique : on dit pourquoi et on laisse choisir.
                val format = (error as? ExoPlaybackException)?.rendererFormat
                val name = Codecs.displayName(format?.sampleMimeType, format?.codecs)
                val video = format?.sampleMimeType?.let(Codecs::isVideo) ?: (error.errorCode != PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED)
                startWatch?.cancel()
                reportFormatIssue(if (video) FormatIssue(name, null) else FormatIssue(null, name))
                return
            }
            if (parsing && !kindRetried) {
                // Les URL du relais n'ont pas d'extension : on a peut-être pris
                // un fichier MP4 pour du HLS, ou l'inverse. Un essai avec l'autre type.
                kindRetried = true
                val flipped = s.copy(kind = if (s.kind == StreamKind.HLS) StreamKind.FILE else StreamKind.HLS)
                current = flipped
                prepare(flipped, player.currentPosition.coerceAtLeast(pendingStartMs))
                return
            }
            failOver()
        }

        override fun onTracksChanged(tracks: Tracks) = readTracks(tracks)

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            if (videoSize.width > 0 && videoSize.height > 0) {
                videoAspect = videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height
                videoHeight = videoSize.height
                qualityText = qualityLabel(videoSize.width, videoSize.height)
            }
        }

        override fun onCues(cueGroup: CueGroup) {
            embeddedCueText = cueGroup.cues.mapNotNull { it.text?.toString() }.joinToString("\n").ifBlank { null }
            if (subtitle is SubtitleChoice.Embedded) {
                subtitleText = embeddedCueText
                // Piste du flux : on n'en connaît que la réplique en cours, traduite à la volée.
                embeddedCueText?.let(::translateLive)
            }
        }
    }

    init {
        player.addListener(listener)
        // Pistes de texte du flux coupées par défaut : seules les choisies s'affichent.
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
        scope.launch { tick() }
        load()
    }

    private val progressKey: String
        get() = with(target.request) {
            if (isTv) Library.episodeProgressKey(tmdbId, season ?: 1, episode ?: 1) else Library.movieProgressKey(tmdbId)
        }

    // ---------- chargement ----------

    private fun load() {
        loadJob?.cancel()
        deviceJob?.cancel()
        extractAllJob?.cancel()
        phase = PlayerPhase.LOADING
        loadingText = com.movix.tv.R.string.player_loading
        extracted.clear(); inFlight.values.forEach { it.cancel() }; inFlight.clear(); extractingId = null
        sources = emptyList(); deviceSources = emptyList(); webSources = emptyList(); webSource = null; current = null
        searchedSubtitles = emptyList()
        failed.clear(); intro = null; outroStartMs = null; segments = emptyList(); next = null; nextEpisode = null; episodeTitle = null
        segmentsRequested = false; metaWritten = false; formatIssue = null; stillWatching = false
        chooseSubtitle(SubtitleChoice.Off)
        player.stop()
        loadJob = scope.launch {
            launch { loadMeta() }
            // Ouvert sans titre (reprise d'une entrée venue du site) : on le complète.
            if (target.title.isBlank() || target.backdropPath == null) launch {
                val d = runCatching { container.catalog.details(target.request.type, target.request.tmdbId) }.getOrNull() ?: return@launch
                target = target.copy(title = target.title.ifBlank { d.item.title }, backdropPath = target.backdropPath ?: d.item.backdropPath)
            }
            // Cronet se charge pendant que les routes répondent.
            launch(Dispatchers.IO) { container.playerEngine.cronet }
            var req = target.request
            if (!req.isTv && req.imdbId == null) {
                val imdb = withTimeoutOrNull(4_000) {
                    runCatching { container.catalog.details(MediaType.MOVIE, req.tmdbId).imdbId }.getOrNull()
                }
                req = req.copy(imdbId = imdb)
            }
            launch { loadSearchedSubtitles(req) }
            val vipKey = container.vip.activeKey
            // Sans VIP, l'extraction sur la télé est probable : le moteur se
            // prépare (≈ 0,2 s) pendant que les routes répondent.
            if (vipKey == null) launch(Dispatchers.Default) { runCatching { container.extractor.warmUp() } }
            // SwiftFlux : route ouverte aux télés, sans compte.
            val swiftflux: (suspend (Int) -> Pair<String, String?>?)? = container.swiftflux.let { client ->
                val s = if (req.isTv) req.season ?: 1 else null
                val e = if (req.isTv) req.episode ?: 1 else null
                { index -> client.resolve(req.tmdbId, s, e, index)?.let { it.url to it.quality } }
            }
            val all = container.sources.load(req, vipKey, swiftflux = swiftflux)
            val ranked = SourceSelector.playable(all)
            // Seuls les liens que le userscript sait extraire sont proposés sur
            // la télé (les autres échouaient en « Unknown embed type ») ; leur
            // hébergeur est celui qu'il reconnaît. Le reste passe au lecteur web.
            val device = SourceSelector.deviceOnly(all)
            val types = runCatching { container.extractor.embedTypes(device.mapNotNull { it.embedUrl }) }.getOrDefault(emptyMap())
            deviceSources = if (types.isEmpty()) device else device.mapNotNull { s ->
                types[s.embedUrl]?.let { type -> s.copy(host = type, label = com.movix.tv.data.movix.SourceParsers.extractedLabel(type, s.language)) }
            }
            webSources = SourceSelector.webCandidates(all)
            // Le serveur n'annonce souvent que « HD » : on lit les playlists
            // pour ne pas démarrer en 360p quand une source 720p+ existe.
            // L'ordre obtenu sert aussi aux bascules en cas de panne.
            // Les codecs aussi : H.265 ou son Dolby/DTS sans décodeur passent en dernier.
            val variants = container.streamProbe.variants(SourceSelector.probeCandidates(ranked, req.isTv))
            val ratings = withContext(Dispatchers.Default) {
                variants.mapNotNull { (id, v) -> SourceSelector.rate(v, container.codecSupport::supports)?.let { id to it } }.toMap()
            }
            sources = SourceSelector.byQuality(ranked, ratings)
            val first = SourceSelector.pick(sources, req.isTv)
            Log.i("MovixPlayer", "sources lues ${ratings.size} : " + sources.take(8).joinToString { s ->
                val r = ratings[s.id]
                "${s.label}=${r?.height ?: SourceSelector.declaredHeight(s) ?: "?"}" + (r?.unsupported?.takeIf { it.isNotEmpty() }?.let { " (illisible : $it)" } ?: "")
            })
            val saved = Library.progress(container.store.values.value, progressKey)
            val start = saved?.takeIf { !Library.isFinished(it) }?.let { (it.position * 1000).toLong() } ?: 0L
            if (first == null) {
                // Rien de jouable côté serveur : extraction sur la télé.
                val ok = playFromDevice(start)
                extractAllInBackground()
                if (ok) return@launch
                phase = if (vipKey == null) PlayerPhase.NEED_VIP else PlayerPhase.NO_SOURCE
                return@launch
            }
            phase = PlayerPhase.PLAYING
            play(first, start)
            extractAllInBackground()
        }
    }

    /**
     * Extrait tous les lecteurs extractibles pendant la lecture, deux à la
     * fois : ceux qui marchent rejoignent la liste (lançables tout de suite),
     * ceux qui échouent disparaissent de « Extraction sur la télé ».
     */
    private fun extractAllInBackground() {
        extractAllJob?.cancel()
        val todo = SourceSelector.deviceCandidates(deviceSources).filter { s -> sources.none { it.id == s.id } }
        if (todo.isEmpty()) return
        extractAllJob = scope.launch {
            val permits = kotlinx.coroutines.sync.Semaphore(2)
            todo.map { s ->
                launch {
                    permits.acquire()
                    try {
                        val e = extract(s)
                        if (e.ok) {
                            val playable = toPlayable(s, e)
                            if (sources.none { it.id == playable.id }) sources = sources + playable
                        } else {
                            deviceSources = deviceSources.filterNot { it.id == s.id }
                        }
                    } finally {
                        permits.release()
                    }
                }
            }
        }
    }

    /** Shegu et OpenSubtitles en parallèle ; une série cherche d'abord son id IMDb. */
    private suspend fun loadSearchedSubtitles(req: PlayRequest) {
        val imdb = req.imdbId ?: if (req.isTv) withTimeoutOrNull(4_000) {
            runCatching { container.catalog.details(MediaType.TV, req.tmdbId).imdbId }.getOrNull()
        } else null
        searchedSubtitles = container.externalSubtitles.search(
            req.tmdbId, imdb, if (req.isTv) req.season ?: 1 else null, if (req.isTv) req.episode ?: 1 else null, container.uiLanguage(),
        )
        Log.i("MovixSubs", "${searchedSubtitles.size} sous-titres Shegu/OpenSubtitles")
    }

    /** Titre de l'épisode, épisode suivant et saisons (série seulement). */
    private suspend fun loadMeta() {
        val req = target.request
        if (!req.isTv) return
        val s = req.season ?: 1
        val e = req.episode ?: 1
        val episodes = episodesOf(s)
        episodeTitle = episodes.firstOrNull { it.number == e }?.title?.takeIf { it.isNotBlank() }
        val hasNextHere = episodes.any { it.number == e + 1 }
        if (hasNextHere) next = s to e + 1
        if (seasonNumbers.isEmpty()) {
            seasonNumbers = runCatching { container.catalog.details(MediaType.TV, req.tmdbId).seasonNumbers }.getOrDefault(emptyList())
        }
        if (!hasNextHere) next = seasonNumbers.firstOrNull { it > s }?.let { it to 1 }
        nextEpisode = next?.let { (ns, ne) -> episodesOf(ns).firstOrNull { it.number == ne } }
    }

    /** Épisodes de la saison [season] (TMDB), mis en cache ; liste vide en cas d'échec (non gardée). */
    suspend fun episodesOf(season: Int): List<Episode> {
        seasonEpisodes[season]?.let { return it }
        val list = runCatching { container.catalog.episodes(target.request.tmdbId, season) }.getOrNull() ?: return emptyList()
        seasonEpisodes[season] = list
        return list
    }

    /** Épisodes déjà chargés de [season], `null` sinon (lu par l'écran, se met à jour seul). */
    fun cachedEpisodes(season: Int): List<Episode>? = seasonEpisodes[season]

    private fun play(source: PlaybackSource, startMs: Long) {
        current = source
        kindRetried = false
        formatIssue = null
        prepare(source, startMs)
        // Premier sous-titre français d'office pour une VOSTFR.
        val fr = source.subtitles.firstOrNull { it.lang.startsWith("fr") } ?: source.subtitles.firstOrNull { it.isDefault }
        chooseSubtitle(if (fr != null && (source.language == Lang.VOSTFR || fr.isDefault)) SubtitleChoice.External(fr) else SubtitleChoice.Off)
    }

    private fun prepare(source: PlaybackSource, startMs: Long) {
        pendingStartMs = startMs
        player.setMediaSource(container.playerEngine.mediaSource(source.streamUrl!!, source.kind, source.headers), startMs)
        player.prepare()
        player.playWhenReady = true
        player.setPlaybackSpeed(speed)
        startWatch?.cancel()
        // 45 s sans démarrer : source suivante (même règle que le lecteur du site).
        startWatch = scope.launch {
            delay(45_000)
            if (player.playbackState != Player.STATE_READY) failOver()
        }
    }

    private fun failOver() {
        val s = current ?: return
        failed += s.id
        val position = player.currentPosition.takeIf { it > 0 } ?: pendingStartMs
        val nextSource = sources.firstOrNull { it.id !in failed }
        showNotice(com.movix.tv.R.string.player_source_failed)
        if (nextSource != null) {
            play(nextSource, position)
            return
        }
        // Sources du serveur épuisées : on passe aux lecteurs à extraire sur la télé.
        if (deviceJob?.isActive == true) return
        player.stop()
        deviceJob = scope.launch {
            if (!playFromDevice(position)) phase = PlayerPhase.NO_SOURCE
        }
    }

    // ---------- extraction sur la télé ----------

    /**
     * Extrait les lecteurs embed sur la télé, trois à la fois, dans l'ordre de
     * [SourceSelector.deviceCandidates], et lance le premier qui marche.
     * `false` si aucun n'a donné de flux.
     */
    private suspend fun playFromDevice(startMs: Long): Boolean {
        val candidates = SourceSelector.deviceCandidates(deviceSources)
            .filter { it.id !in failed }
        if (candidates.isEmpty()) return false
        loadingText = com.movix.tv.R.string.player_extracting
        for (batch in candidates.chunked(3)) {
            // Les extractions continuent en arrière-plan après le choix : leurs
            // résultats (en cache) servent aux bascules suivantes.
            val jobs = batch.map { s -> scope.async { extract(s) } }
            val index = firstGoodInRankOrder(jobs)
            batch.forEachIndexed { i, s -> if (jobs[i].isCompleted && !jobs[i].getCompleted().ok) failed += s.id }
            if (index != null) {
                val playable = toPlayable(batch[index], jobs[index].getCompleted())
                sources = sources.filterNot { it.id == playable.id } + playable
                phase = PlayerPhase.PLAYING
                play(playable, startMs)
                return true
            }
        }
        return false
    }

    /**
     * Rang du meilleur lecteur extrait, sans attendre les lents : dès qu'un
     * lecteur réussit, ceux mieux classés encore en cours ont [graceMs] pour
     * finir. `null` si tous ont échoué.
     */
    private suspend fun firstGoodInRankOrder(jobs: List<kotlinx.coroutines.Deferred<Extraction>>, graceMs: Long = 800): Int? {
        var firstSuccessAt = 0L
        while (true) {
            val ok = jobs.indices.firstOrNull { jobs[it].isCompleted && jobs[it].getCompleted().ok }
            if (ok != null) {
                if (firstSuccessAt == 0L) firstSuccessAt = System.currentTimeMillis()
                val betterPending = (0 until ok).any { !jobs[it].isCompleted }
                if (!betterPending || System.currentTimeMillis() - firstSuccessAt >= graceMs) return ok
            } else if (jobs.all { it.isCompleted }) {
                return null
            }
            delay(40)
        }
    }

    private suspend fun extract(source: PlaybackSource): Extraction {
        val embed = source.embedUrl ?: return Extraction("", null, error = "no_embed")
        extracted[embed]?.let { return it }
        // Déjà en cours (premier lancement et extraction de fond) : on attend la même.
        inFlight[embed]?.let { return it.await() }
        val job = scope.async {
            val result = runCatching { container.extractor.extract(embed) }.getOrElse { Extraction(embed, null, error = it.toString()) }
            Log.i("MovixExtract", "${source.host ?: "?"} ${if (result.ok) "ok" else "échec (${result.error})"} en ${result.elapsedMs} ms")
            extracted[embed] = result
            inFlight.remove(embed)
            result
        }
        inFlight[embed] = job
        return job.await()
    }

    private fun toPlayable(source: PlaybackSource, e: Extraction): PlaybackSource = source.copy(
        streamUrl = e.url,
        headers = e.headers,
        kind = if (e.isHls == false) StreamKind.FILE else StreamKind.HLS,
        subtitles = source.subtitles + e.subtitles.map { SubtitleTrack(it.url, it.label, it.lang, it.format, it.isDefault) },
        extracted = true,
    )

    private fun onReady() {
        if (!metaWritten) {
            metaWritten = true
            container.appScope.launch {
                // Reprise depuis une entrée sans fiche : titre et image demandés à TMDB,
                // sinon la rangée « Reprendre » garderait une carte vide.
                val req0 = target.request
                val details = if (target.title.isBlank() || target.backdropPath == null) {
                    runCatching { container.catalog.details(req0.type, req0.tmdbId) }.getOrNull()
                } else null
                val title = target.title.ifBlank { details?.item?.title.orEmpty() }
                val backdrop = target.backdropPath ?: details?.item?.backdropPath
                val values = container.store.values.value
                // Résumé, note et année déjà trouvés par l'accueil : gardés.
                val known = Library.watchMeta(values)[progressKey]
                val meta = (known ?: WatchMeta(title)).copy(
                    title = title, backdropPath = backdrop ?: known?.backdropPath, episodeName = episodeTitle ?: known?.episodeName,
                )
                container.store.set(TvKeys.WATCH_META, Library.putWatchMeta(values, progressKey, meta))
                // Même liste « Reprendre » que le site (synchronisée) : le titre et
                // l'épisode ouverts sur la télé y remontent en tête.
                val req = target.request
                container.store.set(
                    Library.CONTINUE_KEY,
                    Library.touchContinue(container.store.values.value, req.type, req.tmdbId, req.season, req.episode),
                )
            }
        }
        if (!segmentsRequested && durationMs > 0) {
            segmentsRequested = true
            scope.launch { loadSegments() }
        }
    }

    private suspend fun loadSegments() {
        val req = target.request
        val body = withContext(Dispatchers.IO) {
            runCatching {
                container.movix.segments(if (req.isTv) "tv" else "movie", req.tmdbId, (durationMs / 1000).toInt(), req.season, req.episode)
            }.getOrNull()
        } ?: return
        val root = runCatching { container.json.parseToJsonElement(body) }.getOrNull() as? JsonObject ?: return
        val segs = (root["segments"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
        fun num(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.doubleOrNull
        val found = ArrayList<Segment>()
        for (seg in segs) {
            val type = (seg["type"] as? JsonPrimitive)?.content ?: continue
            val start = num(seg, "start") ?: continue
            val end = num(seg, "end") ?: continue
            if (end <= start) continue
            val range = (start * 1000).toLong() until (end * 1000).toLong()
            when (type) {
                "intro", "recap" -> if (intro == null) intro = range
                "outro", "credits" -> if (outroStartMs == null) outroStartMs = range.first
            }
            SegmentKind.of(type)?.let { found += Segment(it, range) }
        }
        segments = found.sortedBy { it.range.first }
    }

    /** Passage en cours à proposer de sauter (intro, récap, générique, aperçu), ou `null`. */
    val activeSegment: Segment?
        get() = segments.firstOrNull { positionMs in it.range && it.range.last - positionMs > 1_000 }

    /**
     * Fin d'épisode façon Netflix : générique de fin annoncé, ou à défaut les
     * 25 dernières secondes, quand un épisode suivant existe.
     */
    val nearEnd: Boolean
        get() {
            if (next == null || durationMs <= 0 || durationMs - positionMs <= 1_000) return false
            val outro = outroStartMs ?: segments.firstOrNull { it.kind.isEnd }?.range?.first
            return if (outro != null) positionMs >= outro else durationMs - positionMs <= 25_000
        }

    /** Saute le passage en cours ; un générique qui va jusqu'au bout ferme le film ou lance la suite. */
    fun skipSegment(onEnd: () -> Unit) {
        val s = activeSegment ?: return
        val to = s.range.last + 1
        if (s.kind.isEnd && durationMs > 0 && durationMs - to < 5_000) {
            if (next != null) playNext() else onEnd()
            return
        }
        player.seekTo(to)
        positionMs = to
    }

    // ---------- boucle : position, sous-titres, sauvegarde ----------

    private suspend fun tick() {
        var n = 0
        while (scope.isActive) {
            if (phase == PlayerPhase.PLAYING) {
                positionMs = player.currentPosition.coerceAtLeast(0)
                bufferedMs = player.bufferedPosition.coerceAtLeast(0)
                if (player.duration > 0) durationMs = player.duration
                if (subtitle is SubtitleChoice.External) {
                    val t = Subtitles.textAt(externalCues, positionMs - subtitleOffsetMs)
                    if (t != subtitleText) { subtitleText = t; t?.let(::translateLive) }
                }
                // Toutes les 10 s pendant la lecture.
                if (++n % 40 == 0 && isPlaying) saveProgress()
            }
            delay(250)
        }
    }

    fun saveProgress(ended: Boolean = false) {
        if (phase != PlayerPhase.PLAYING) return
        val dur = (player.duration.takeIf { it > 0 } ?: return) / 1000.0
        val pos = if (ended) dur else player.currentPosition / 1000.0
        val key = progressKey
        val req = target.request
        // Portée de l'appli : l'écriture finit même quand l'écran se ferme.
        container.appScope.launch {
            val values = container.store.values.value
            Library.progressOnStop(pos, dur)?.let { container.store.set(key, it) }
            if (req.isTv && pos / dur >= Library.FINISHED_RATIO) {
                container.store.set(Library.watchedEpisodesKey(req.tmdbId), Library.markWatched(values, req.tmdbId, req.season ?: 1, req.episode ?: 1))
            }
        }
    }

    // ---------- commandes ----------

    fun togglePlay() {
        if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
        player.playWhenReady = !player.playWhenReady
    }

    fun seekBy(deltaMs: Long) {
        val dur = player.duration.takeIf { it > 0 } ?: Long.MAX_VALUE
        val to = (player.currentPosition + deltaMs).coerceIn(0, dur)
        player.seekTo(to)
        positionMs = to
    }

    fun skipIntro() {
        intro?.let { player.seekTo(it.last + 1); positionMs = it.last + 1 }
    }

    fun selectSource(source: PlaybackSource) {
        if (source.id == current?.id) return
        val position = player.currentPosition.coerceAtLeast(0)
        if (source.playable) {
            failed.remove(source.id)
            play(source, position)
            return
        }
        // Lecteur à extraire : on garde la vidéo en cours tant que l'extraction n'a pas abouti.
        if (source.embedUrl == null || extractingId != null) return
        extractingId = source.id
        scope.launch {
            extracted.remove(source.embedUrl)
            val e = extract(source)
            extractingId = null
            if (!e.ok) {
                showNotice(com.movix.tv.R.string.player_extract_failed)
                return@launch
            }
            val playable = toPlayable(source, e)
            sources = sources.filterNot { it.id == playable.id } + playable
            failed.remove(playable.id)
            phase = PlayerPhase.PLAYING
            play(playable, position)
        }
    }

    /** Ouvre [source] dans le lecteur web ; le lecteur natif se met en pause (sa position est gardée). */
    fun openWeb(source: PlaybackSource) {
        if (source.embedUrl == null) return
        saveProgress()
        player.playWhenReady = false
        startWatch?.cancel()
        webSource = source
    }

    fun closeWeb() {
        webSource = null
    }

    /** « Autre lecteur » : le lecteur web suivant de la liste, ou retour au lecteur s'il n'y en a plus. */
    fun nextWeb() {
        val list = webSources
        val i = list.indexOfFirst { it.embedUrl == webSource?.embedUrl }
        val next = list.getOrNull(i + 1)
        if (next != null) {
            webSource = next
        } else {
            webSource = null
            showNotice(com.movix.tv.R.string.player_web_none_left)
        }
    }

    fun playNext() {
        val (s, e) = next ?: return
        playEpisode(s, e)
    }

    /** Lance l'épisode [episode] de la saison [season] (panneau Épisodes, épisode suivant). */
    fun playEpisode(season: Int, episode: Int) {
        val req = target.request
        if ((req.season ?: 1) == season && (req.episode ?: 1) == episode) return
        saveProgress()
        target = target.copy(request = req.copy(season = season, episode = episode))
        load()
    }

    /**
     * Épisode suivant lancé sans touche (compte à rebours, fin d'épisode).
     * Après [STILL_WATCHING_AFTER] d'affilée, on met en pause et on demande
     * « Vous regardez toujours ? » au lieu de lancer le suivant.
     */
    fun autoAdvance() {
        if (next == null || stillWatching) return
        if (autoChained >= STILL_WATCHING_AFTER) {
            player.playWhenReady = false
            stillWatching = true
            return
        }
        autoChained++
        playNext()
    }

    /** Touche de télécommande : le compteur d'épisodes enchaînés repart à zéro. */
    fun userActivity() {
        autoChained = 0
    }

    /** « Continuer » : lance l'épisode suivant. */
    fun continueWatching() {
        stillWatching = false
        autoChained = 0
        playNext()
    }

    /** Retour sur « Vous regardez toujours ? » : on reste en pause sur cet épisode. */
    fun dismissStillWatching() {
        stillWatching = false
    }

    /** Écrit le style des sous-titres choisi dans le panneau (appliqué en direct). */
    fun setSubtitleStyle(style: SubtitleStyle) {
        container.appScope.launch { container.store.set(UiKeys.SUBTITLE_STYLE, UiPrefs.encode(style)) }
    }

    fun selectVideo(option: TrackOption?) {
        selectedVideo = option
        val params = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_VIDEO)
        if (option != null) {
            val group = player.currentTracks.groups.getOrNull(option.groupIndex) ?: return
            params.addOverride(TrackSelectionOverride(group.mediaTrackGroup, option.trackIndex))
        }
        player.trackSelectionParameters = params.build()
    }

    fun selectAudio(option: TrackOption) {
        val group = player.currentTracks.groups.getOrNull(option.groupIndex) ?: return
        selectedAudio = option
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            .addOverride(TrackSelectionOverride(group.mediaTrackGroup, option.trackIndex))
            .build()
    }

    fun chooseSubtitle(choice: SubtitleChoice) {
        subtitle = choice
        subtitleText = null
        subsJob?.cancel()
        externalCues = emptyList()
        val params = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT)
        when (choice) {
            SubtitleChoice.Off, is SubtitleChoice.External -> params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            is SubtitleChoice.Embedded -> {
                params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                player.currentTracks.groups.getOrNull(choice.option.groupIndex)?.let {
                    params.addOverride(TrackSelectionOverride(it.mediaTrackGroup, choice.option.trackIndex))
                }
            }
        }
        player.trackSelectionParameters = params.build()
        if (choice is SubtitleChoice.External) {
            subsJob = scope.launch {
                // gzip (OpenSubtitles), UTF-16, UTF-8 ou Windows-1252 : voir ExternalSubtitles.decode.
                val raw = withContext(Dispatchers.IO) {
                    runCatching {
                        val req = Request.Builder().url(choice.track.url).header("User-Agent", com.movix.tv.data.subs.ExternalSubtitles.USER_AGENT).build()
                        container.http.newCall(req).execute().use { if (it.isSuccessful) com.movix.tv.data.subs.ExternalSubtitles.decode(it.body.bytes()) else null }
                    }.getOrNull()
                } ?: return@launch
                externalCues = withContext(Dispatchers.Default) { Subtitles.parse(raw) }
                if (translateTo != null) translateAll()
            }
        }
    }

    // ---------- traduction des sous-titres ----------

    /** Traduit les sous-titres vers [lang] (« fr »…), ou coupe la traduction avec `null`. */
    fun setTranslation(lang: String?) {
        translateTo = lang
        translateJob?.cancel()
        translations.clear(); pendingTranslations.clear()
        if (lang == null) return
        translateAll()
        subtitleText?.let(::translateLive)
    }

    /**
     * Fichier externe : toutes les répliques, par paquets de 60 en partant de
     * la position de lecture (l'écran a vite sa traduction), puis le début.
     */
    private fun translateAll() {
        val lang = translateTo ?: return
        val cues = externalCues.takeIf { subtitle is SubtitleChoice.External && it.isNotEmpty() } ?: return
        translateJob?.cancel()
        translateJob = scope.launch {
            val at = cues.indexOfFirst { it.endMs >= positionMs - subtitleOffsetMs }.coerceAtLeast(0)
            val ordered = cues.drop(at) + cues.take(at)
            for (chunk in ordered.map { it.text }.distinct().filter { it !in translations }.chunked(60)) {
                val done = container.subtitleTranslator.translate(chunk, lang)
                if (translateTo != lang) return@launch
                translations.putAll(done)
            }
        }
    }

    /** Réplique affichée pas encore traduite : demandée seule, tout de suite. */
    private fun translateLive(text: String) {
        val lang = translateTo ?: return
        if (text in translations || !pendingTranslations.add(text)) return
        scope.launch {
            val done = container.subtitleTranslator.translate(listOf(text), lang)
            if (translateTo == lang) translations.putAll(done)
            pendingTranslations.remove(text)
        }
    }

    fun changeOffset(deltaMs: Long) {
        subtitleOffsetMs = (subtitleOffsetMs + deltaMs).coerceIn(-10_000, 10_000)
    }

    fun changeSpeed(value: Float) {
        speed = value
        player.playbackParameters = PlaybackParameters(value)
    }

    fun changeFormat(value: VideoFormat) {
        format = value
    }

    private fun readTracks(tracks: Tracks) {
        val video = ArrayList<TrackOption>()
        val audio = ArrayList<TrackOption>()
        val text = ArrayList<TrackOption>()
        tracks.groups.forEachIndexed { gi, group ->
            for (ti in 0 until group.length) {
                if (!group.isTrackSupported(ti)) continue
                val f = group.getTrackFormat(ti)
                when (group.type) {
                    C.TRACK_TYPE_VIDEO -> if (f.height > 0) video += TrackOption(qualityLabel(f.width, f.height) ?: "${f.height}p", gi, ti, f.height)
                    C.TRACK_TYPE_AUDIO -> audio += TrackOption(trackName(f.label), gi, ti, number = audio.size + 1, language = languageCode(f.language))
                    C.TRACK_TYPE_TEXT -> {
                        // Sans déclaration CLOSED-CAPTIONS dans la playlist, Media3 ajoute
                        // d'office une piste CEA-608 vide (sans nom ni langue) : on la cache.
                        val cc = f.sampleMimeType == androidx.media3.common.MimeTypes.APPLICATION_CEA608 ||
                            f.sampleMimeType == androidx.media3.common.MimeTypes.APPLICATION_CEA708
                        if (!cc || !f.label.isNullOrBlank() || languageCode(f.language) != null) {
                            text += TrackOption(trackName(f.label), gi, ti, number = text.size + 1, language = languageCode(f.language))
                        }
                    }
                }
                if (group.type == C.TRACK_TYPE_AUDIO && group.isTrackSelected(ti) && selectedAudio == null) {
                    selectedAudio = audio.last()
                }
            }
        }
        videoTracks = video.sortedByDescending { it.height }.distinctBy { it.height }
        audioTracks = audio
        embeddedTextTracks = text
        checkFormats(tracks)
    }

    /**
     * Image ou son présents dans le flux mais sans aucune piste décodable
     * ici : Media3 lirait alors sans image ou sans son, sans erreur.
     */
    private fun checkFormats(tracks: Tracks) {
        if (tracks.groups.isEmpty() || formatIssue != null) return
        fun unsupported(type: Int): String? {
            val groups = tracks.groups.filter { it.type == type && it.length > 0 }
            if (groups.isEmpty() || groups.any { g -> (0 until g.length).any(g::isTrackSupported) }) return null
            val f = groups.first().getTrackFormat(0)
            return Codecs.displayName(f.sampleMimeType, f.codecs)
        }
        val video = unsupported(C.TRACK_TYPE_VIDEO)
        val audio = unsupported(C.TRACK_TYPE_AUDIO)
        if (video != null || audio != null) reportFormatIssue(FormatIssue(video, audio))
    }

    private fun reportFormatIssue(issue: FormatIssue) {
        Log.w("MovixPlayer", "format illisible sur ${current?.label} : $issue")
        formatIssue = issue
        player.playWhenReady = false
    }

    /** « Fermer » : on reste sur ce lecteur (sans son, par exemple) et la lecture reprend. */
    fun dismissFormatIssue() {
        formatIssue = null
        if (player.playbackState != Player.STATE_IDLE) player.playWhenReady = true
    }

    /**
     * Nom donné par le flux, sauf s'il n'est qu'un code de langue (« fre »,
     * « eng ») ou un « Track 1 » générique : l'écran nomme alors la langue,
     * traduite dans la langue de l'appli.
     */
    private fun trackName(label: String?): String {
        val l = label?.trim().orEmpty()
        if (l.isEmpty() || GENERIC_TRACK.matches(l)) return ""
        return if (languageCode(l) != null && l.length <= 3) "" else l
    }

    /** « fre », « fra », « fr-FR » → « fr » ; `null` pour « und » ou un code inconnu. */
    private fun languageCode(raw: String?): String? {
        val code = androidx.media3.common.util.Util.normalizeLanguageCode(raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null)
            ?.substringBefore('-')?.lowercase() ?: return null
        if (code == "und" || code == "mul" || code == "zxx") return null
        return code.takeIf { it.length in 2..3 && java.util.Locale(it).getDisplayLanguage(java.util.Locale.ENGLISH) != it }
    }

    private fun showNotice(res: Int) {
        notice = res
        noticeJob?.cancel()
        noticeJob = scope.launch { delay(4_000); notice = null }
    }

    fun release() {
        saveProgress()
        startWatch?.cancel()
        loadJob?.cancel()
        extractAllJob?.cancel()
        player.removeListener(listener)
        player.release()
    }

    private companion object {
        /** Épisodes enchaînés seuls avant « Vous regardez toujours ? ». */
        const val STILL_WATCHING_AFTER = 3
        val GENERIC_TRACK = Regex("""(?i)(track|piste|audio|sound|son|subtitle|sous-titres?)\s*#?\d*|\d+""")
        val PARSING_ERRORS = setOf(
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED,
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED,
        )
        val DECODER_ERRORS = setOf(
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
        )
    }
}
