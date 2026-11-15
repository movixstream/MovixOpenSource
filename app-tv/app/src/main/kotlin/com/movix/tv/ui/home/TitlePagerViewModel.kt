package com.movix.tv.ui.home

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.movix.tv.data.tmdb.CatalogRepository
import com.movix.tv.data.tmdb.RowSpec
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Grille affichée et la session ([TitlePagerViewModel.open]) à laquelle elle appartient. */
@Immutable
data class TitleGrid(val session: String? = null, val titles: PagedTitles = PagedTitles()) {
    /** Titres de [expected], jamais ceux de la grille précédente (le temps que l'état suive). */
    fun titlesFor(expected: String): PagedTitles = if (session == expected) titles else PagedTitles(loading = true)
}

/**
 * Grille paginée d'une rangée (« Voir tout ») ou d'un genre. Un seul ViewModel
 * par usage, réutilisé d'une ouverture à l'autre : la mémoire ne garde qu'une
 * grille à la fois. Les pages passent toutes par [CatalogRepository.page].
 */
class TitlePagerViewModel(private val catalog: CatalogRepository) : ViewModel() {
    private val _state = MutableStateFlow(TitleGrid())
    val state: StateFlow<TitleGrid> = _state.asStateFlow()

    private var session: String? = null
    private var spec: RowSpec? = null
    private var job: Job? = null
    // Dernière carte focalisée : une page reçue alors que le focus est déjà près
    // de la fin enchaîne sur la suivante.
    private var lastFocus = 0
    // Pages de suite sans titre nouveau (TMDB qui répète) : l'enchaînement s'arrête.
    private var stalePages = 0

    private val titles: PagedTitles get() = _state.value.titles

    /**
     * Montre [spec] sous la clé [session]. Même session (retour d'une fiche) : rien
     * ne bouge. Nouvelle session : la grille repart de la page 1.
     */
    fun open(session: String, spec: RowSpec) {
        if (session == this.session) return
        job?.cancel()
        this.session = session
        this.spec = spec
        lastFocus = 0
        stalePages = 0
        _state.value = TitleGrid(session)
        load()
    }

    fun onFocus(index: Int) {
        lastFocus = index
        if (titles.wantsMore(index)) load()
    }

    /** « Réessayer » : la page en échec est redemandée, les titres affichés restent. */
    fun retry() {
        if (titles.failed) load()
    }

    private fun load() {
        val spec = spec ?: return
        val before = titles
        if (!before.canLoad) return
        val page = before.nextPage
        val current = session
        _state.value = TitleGrid(current, before.loadingPage())
        job = viewModelScope.launch {
            val found = try {
                catalog.page(spec, page)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                android.util.Log.w("MovixGrid", "${spec.id} page $page : $e")
                null
            }
            // Autre grille ouverte entre-temps : cette réponse ne la concerne pas.
            if (session != current) return@launch
            val after = if (found == null) titles.failed(page) else titles.received(page, found)
            stalePages = if (after.items.size > before.items.size) 0 else stalePages + 1
            _state.value = TitleGrid(current, after)
            if (stalePages < MAX_STALE_PAGES && after.wantsMore(lastFocus)) load()
        }
    }

    private companion object {
        const val MAX_STALE_PAGES = 3
    }
}
