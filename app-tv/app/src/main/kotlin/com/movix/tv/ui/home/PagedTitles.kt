package com.movix.tv.ui.home

import androidx.compose.runtime.Immutable
import com.movix.tv.data.tmdb.MediaItem

/**
 * État d'une grille paginée (« Voir tout », grille d'un genre). Logique pure :
 * le ViewModel ne fait qu'appeler TMDB entre [loadingPage] et [received] ou [failed].
 *
 * @property nextPage page TMDB à demander ensuite (1 au départ) ; reste la même après un échec.
 * @property ended page vide reçue, ou dernière page de TMDB atteinte : plus rien à demander.
 * @property hiddenRun pages de suite entièrement masquées par la restriction d'âge du profil.
 * @property hiddenByAge titres masqués par la restriction d'âge depuis la page 1.
 */
@Immutable
data class PagedTitles(
    val items: List<MediaItem> = emptyList(),
    val nextPage: Int = 1,
    val loading: Boolean = false,
    val failed: Boolean = false,
    val ended: Boolean = false,
    val hiddenRun: Int = 0,
    val hiddenByAge: Int = 0,
) {
    /** Une page peut partir : rien en cours, fin non atteinte (vrai aussi après un échec, pour « Réessayer »). */
    val canLoad: Boolean get() = !loading && !ended

    /** Liste finie et vide parce que le profil masque tout : « Rien pour ce profil ici ». */
    val onlyHidden: Boolean get() = ended && items.isEmpty() && hiddenByAge > 0

    /**
     * Focus sur la carte [index] : la page suivante est-elle à demander ? Seulement
     * à moins de [ahead] cartes de la fin, et jamais après un échec : déplacer le
     * focus ne doit pas relancer en boucle une requête qui échoue.
     */
    fun wantsMore(index: Int, ahead: Int = PREFETCH): Boolean =
        canLoad && !failed && index >= items.size - ahead

    fun loadingPage(): PagedTitles = if (!canLoad) this else copy(loading = true, failed = false)

    /**
     * Page [page] reçue. Une réponse inattendue (en double, autre page) est ignorée.
     * [hidden] : titres de la page masqués par la restriction d'âge. Une page
     * vide à cause d'eux n'est pas la fin du catalogue, mais au-delà de
     * [MAX_HIDDEN_PAGES] pages masquées de suite, la liste s'arrête.
     */
    fun received(page: Int, found: List<MediaItem>, hidden: Int = 0): PagedTitles {
        if (!loading || page != nextPage) return this
        // TMDB retrie à chaque appel : une page peut répéter des titres de la précédente.
        val seen = items.mapTo(HashSet(items.size + found.size)) { it.key }
        val fresh = found.filter { seen.add(it.key) }
        val run = if (found.isEmpty() && hidden > 0) hiddenRun + 1 else 0
        return copy(
            items = if (fresh.isEmpty()) items else items + fresh,
            nextPage = page + 1,
            loading = false,
            failed = false,
            ended = (found.isEmpty() && hidden == 0) || page >= MAX_PAGE || run >= MAX_HIDDEN_PAGES,
            hiddenRun = run,
            hiddenByAge = hiddenByAge + hidden,
        )
    }

    /** Échec de la page [page] : les titres affichés restent, la même page sera redemandée. */
    fun failed(page: Int): PagedTitles {
        if (!loading || page != nextPage) return this
        return copy(loading = false, failed = true)
    }

    companion object {
        /** TMDB refuse toute page au-delà de la 500e (HTTP 422). */
        const val MAX_PAGE = 500
        /** Trois lignes de sept affiches : la page suivante arrive avant qu'on l'atteigne. */
        const val PREFETCH = 21
        /** Pages entièrement masquées de suite (profil enfant) avant de s'arrêter : une centaine de titres vérifiés. */
        const val MAX_HIDDEN_PAGES = 5
    }
}
