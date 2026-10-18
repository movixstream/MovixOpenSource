package com.movix.tv.ui.home

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.movix.tv.AppContainer
import com.movix.tv.data.account.HistoryApi
import com.movix.tv.data.account.SessionRevokedException
import com.movix.tv.data.account.toContinueEntry
import com.movix.tv.data.local.ContinueEntry
import com.movix.tv.data.local.Library
import com.movix.tv.data.tmdb.CatalogRepository
import com.movix.tv.data.tmdb.CatalogRow
import com.movix.tv.data.tmdb.MissingTmdbKeyException
import com.movix.tv.data.tmdb.RowSpec
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit

@Immutable
sealed interface BrowseStatus {
    data object Loading : BrowseStatus
    data object NoKey : BrowseStatus
    data object Error : BrowseStatus
    data object Ready : BrowseStatus
}

@Immutable
data class BrowseState(val status: BrowseStatus = BrowseStatus.Loading, val rows: List<CatalogRow> = emptyList())

/**
 * Une page de rangées (accueil, films, séries, animés). Palier 1 d'abord pour
 * remplir le premier écran vite, palier 2 ensuite ; l'assemblage (doublons,
 * rangées trop courtes) est refait à chaque palier dans l'ordre d'affichage.
 */
class BrowseViewModel(private val container: AppContainer, private var specs: List<RowSpec>, withContinue: Boolean) : ViewModel() {
    private val _state = MutableStateFlow(BrowseState())
    val state: StateFlow<BrowseState> = _state.asStateFlow()

    /** Rangée « Reprendre » lue sur le serveur pour un profil ; `null` : repli sur la rangée locale. */
    private data class ServerRow(val profileId: String, val entries: List<ContinueEntry>)

    /** Rangée affichée et son origine (celle du serveur n'a pas besoin de TMDB). */
    private data class ContinueSource(val entries: List<ContinueEntry>, val fromServer: Boolean)

    private val serverRow = MutableStateFlow<ServerRow?>(null)

    private val continueSource: StateFlow<ContinueSource> =
        if (!withContinue) MutableStateFlow(ContinueSource(emptyList(), false))
        else combine(container.store.values, serverRow, container.accounts.state) { values, server, account ->
            // Compte lié et réponse du serveur pour ce profil : la rangée du serveur,
            // corrigée par les positions locales plus récentes.
            // Sinon (invité, routes absentes, jamais de réponse) : la rangée locale.
            if (account != null && server != null && server.profileId == account.profileId) ContinueSource(Library.overlayLocal(server.entries, values), true)
            else ContinueSource(Library.continueWatching(values), false)
        }.stateIn(viewModelScope, SharingStarted.Eagerly, ContinueSource(emptyList(), false))

    val continueRow: StateFlow<List<ContinueEntry>> =
        continueSource.map { it.entries }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    // Rafraîchissements de la rangée du serveur : délai demandé (ms), au plus un
    // appel toutes les 30 s ; les demandes reçues entre-temps n'en font qu'une.
    private val refreshRequests = Channel<Long>(Channel.CONFLATED)
    private var lastFetchAt = 0L
    // Page affichée (premier plan, pas sous le lecteur ou une fiche) ; une
    // écriture locale faite pendant qu'elle est cachée est relue à son retour.
    private var visible = false
    private var changedWhileHidden = false

    // Rangées déjà chargées : un changement de rangées (réglage de l'accueil)
    // ne charge que les nouvelles.
    private val fetched = HashMap<String, Result<List<com.movix.tv.data.tmdb.MediaItem>>>()
    private var job: Job? = null

    // Titres demandés à TMDB pour « Reprendre » (une fois par entrée et par séance).
    private val enriching = HashSet<String>()
    private val metaLock = kotlinx.coroutines.sync.Mutex()
    // Rangée locale sans limite : 4 fiches demandées à TMDB à la fois au plus,
    // pas des centaines d'appels lancés d'un coup.
    private val enrichPermits = Semaphore(ENRICH_CONCURRENCY)

    init {
        load()
        // Entrées venues du site (liste `continueWatching`, ids seuls) ou sans
        // fiche connue : titre, image et nom d'épisode demandés à TMDB, comme
        // le fait le site, puis gardés dans WATCH_META.
        // Rangée du serveur : déjà remplie, rien à demander à TMDB.
        if (withContinue) viewModelScope.launch {
            // Fiche absente ou incomplète (sans titre ni image : écrite autrefois par une reprise sans titre).
            continueSource.collect { source ->
                if (source.fromServer) return@collect
                source.entries.filter { (it.meta == null || it.meta.title.isBlank() || it.meta.backdropPath == null || it.meta.overview == null) && enriching.add(it.key) }.forEach { enrich(it) }
            }
        }
        if (withContinue) {
            viewModelScope.launch {
                for (delayMs in refreshRequests) {
                    val wait = maxOf(delayMs, lastFetchAt + REFRESH_MIN_MS - android.os.SystemClock.elapsedRealtime())
                    if (wait > 0) delay(wait)
                    lastFetchAt = android.os.SystemClock.elapsedRealtime()
                    fetchServerRow()
                }
            }
            // Compte lié, profil changé ou déconnexion : relecture tout de suite.
            viewModelScope.launch {
                container.accounts.state.map { it?.profileId }.distinctUntilChanged().collect {
                    // La rangée de l'ancien profil (ou du compte déconnecté) ne sert plus.
                    serverRow.value = null
                    lastFetchAt = 0L
                    refreshRequests.trySend(0L)
                }
            }
            // Écriture locale (position, titre ouvert, synchro) : relecture après
            // l'envoi de la synchro (5 s après la dernière écriture).
            viewModelScope.launch {
                container.store.values.drop(1).collect {
                    if (visible) refreshRequests.trySend(SYNC_SETTLE_MS) else changedWhileHidden = true
                }
            }
        }
    }

    /**
     * La page passe au premier plan ([shown] vrai) ou disparaît (lecteur,
     * fiche, appli en fond). Au retour, la rangée du serveur est relue.
     */
    fun setVisible(shown: Boolean) {
        if (shown == visible) return
        visible = shown
        if (!shown) return
        val delayMs = if (changedWhileHidden) SYNC_SETTLE_MS else 0L
        changedWhileHidden = false
        refreshRequests.trySend(delayMs)
    }

    private suspend fun fetchServerRow() {
        val account = container.accounts.current ?: run { serverRow.value = null; return }
        try {
            val items = container.history.continueWatching(account.token, account.profileId, HistoryApi.tmdbLanguage(container.uiLanguage()))
            // Profil changé pendant l'appel : cette liste est celle de l'ancien.
            if (container.accounts.current?.profileId != account.profileId) return
            serverRow.value = ServerRow(account.profileId, items.mapNotNull { it.toContinueEntry() })
        } catch (e: SessionRevokedException) {
            serverRow.value = null
            container.accounts.logout(remote = false)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            // Serveur injoignable, routes pas encore déployées ou liste incomplète :
            // la dernière bonne rangée de ce profil reste, sinon la rangée locale.
            android.util.Log.w("MovixContinue", "rangée du serveur indisponible : ${e.message}")
        }
    }

    private fun enrich(e: ContinueEntry) = viewModelScope.launch {
        enrichPermits.withPermit { enrichNow(e) }
    }

    private suspend fun enrichNow(e: ContinueEntry) {
        val d = runCatching { container.catalog.details(e.type, e.id) }
            .onFailure { android.util.Log.w("MovixContinue", "fiche ${e.type.path} ${e.id} introuvable : $it") }
            .getOrNull() ?: return
        val episode = if (e.season != null && e.episode != null) {
            runCatching { container.catalog.episodes(e.id, e.season).firstOrNull { it.number == e.episode } }.getOrNull()
        } else null
        val meta = com.movix.tv.data.local.WatchMeta(
            title = d.item.title,
            backdropPath = d.item.backdropPath ?: d.item.posterPath,
            episodeName = episode?.title?.takeIf { it.isNotBlank() } ?: e.meta?.episodeName,
            // Résumé de l'épisode s'il existe, sinon celui de la série ou du film.
            overview = episode?.overview?.takeIf { it.isNotBlank() } ?: d.item.overview,
            rating = d.item.rating,
            year = d.item.year,
        )
        // Une écriture à la fois, relue sur disque : les fiches demandées en parallèle
        // s'écrasaient sinon les unes les autres (chacune partait de la même carte).
        metaLock.withLock {
            val current = container.store.snapshot()
            // Fiches des cartes affichées gardées : l'éviction prend d'abord les autres.
            val shown = continueRow.value.mapTo(HashSet()) { it.key }
            container.store.set(com.movix.tv.data.local.TvKeys.WATCH_META, Library.putWatchMeta(current, e.key, meta, shown))
        }
    }

    /** Nouvelles rangées à afficher (réglage de l'accueil) : rien ne bouge si ce sont les mêmes. */
    fun setSpecs(newSpecs: List<RowSpec>) {
        if (newSpecs.map { it.id } == specs.map { it.id }) return
        specs = newSpecs
        val ready = _state.value.status == BrowseStatus.Ready
        if (!ready || newSpecs.any { it.id !in fetched || fetched[it.id]?.isFailure == true }) {
            if (ready) refill() else load()
            return
        }
        val rows = CatalogRepository.assemble(specs, fetched)
        _state.value = if (rows.isEmpty()) BrowseState(BrowseStatus.Error) else BrowseState(BrowseStatus.Ready, rows)
    }

    /** Charge les rangées manquantes sans vider l'écran. */
    private fun refill() {
        job?.cancel()
        val wanted = specs
        job = viewModelScope.launch {
            val missing = wanted.filter { it.id !in fetched || fetched[it.id]?.isFailure == true }
            fetched += container.catalog.fetch(missing)
            val rows = CatalogRepository.assemble(wanted, fetched)
            if (rows.isNotEmpty()) _state.value = BrowseState(BrowseStatus.Ready, rows)
        }
    }

    fun load() {
        _state.value = BrowseState()
        fetched.clear()
        job?.cancel()
        val wanted = specs
        job = viewModelScope.launch {
            val t0 = android.os.SystemClock.elapsedRealtime()
            for (tier in wanted.map { it.tier }.distinct().sorted()) {
                fetched += container.catalog.fetch(wanted.filter { it.tier == tier })
                android.util.Log.i("MovixPerf", "palier $tier chargé en ${android.os.SystemClock.elapsedRealtime() - t0} ms")
                if (fetched.values.any { it.exceptionOrNull() is MissingTmdbKeyException }) {
                    _state.value = BrowseState(BrowseStatus.NoKey)
                    return@launch
                }
                val rows = CatalogRepository.assemble(wanted, fetched)
                if (rows.isNotEmpty()) _state.update { BrowseState(BrowseStatus.Ready, rows) }
            }
            if (_state.value.rows.isEmpty()) _state.value = BrowseState(BrowseStatus.Error)
        }
    }

    private companion object {
        /** Au plus un appel à `/api/history/continue` toutes les 30 s. */
        const val REFRESH_MIN_MS = 30_000L
        /** Délai laissé à la synchro pour envoyer une écriture locale avant la relecture. */
        const val SYNC_SETTLE_MS = 6_000L
        /** Fiches de « Reprendre » demandées à TMDB en même temps, au plus. */
        const val ENRICH_CONCURRENCY = 4
    }
}
