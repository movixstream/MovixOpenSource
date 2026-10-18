package com.movix.tv.data.tmdb

/** Type de média TMDB ; `path` est le segment d'URL (`/movie/…`, `/tv/…`). */
enum class MediaType(val path: String) { MOVIE("movie"), TV("tv") }

/** Gabarit de carte d'une rangée. Par défaut, l'affiche. */
enum class RowLayout { POSTER, STILL, RANK }

/**
 * Rangée TMDB. `params` est une fonction : les dates « récents » se recalculent à chaque chargement.
 *
 * @property fallbackType type supposé des résultats quand TMDB ne renvoie pas `media_type`.
 * @property tier 1 = affiché au premier écran, 2 = chargé après le premier rendu.
 * @property limit tronque la rangée à ce nombre de titres. Un Top 10 qui en montre vingt
 *   n'est plus un Top 10.
 * @property dedupe `false` exempte la rangée du dédoublonnage. Nécessaire à un classement :
 *   retirer le n° 3 parce qu'il figure dans la sélection juste au-dessus décalerait tous les
 *   rangs suivants. Les titres de la rangée sont néanmoins enregistrés comme vus, pour les
 *   rangées qui suivent.
 * @property collection ouvre une page de collection paginée et fait apparaître la carte
 *   « Voir plus » en fin de rangée. Volontairement absent des instantanés (tendances,
 *   sélection, Top 10) et des rangées génériques : réservée aux rangées qui portent une vraie
 *   collection, elle devient une information.
 */
data class RowSpec(
    val id: String,
    val title: String,
    val path: String,
    val fallbackType: MediaType,
    val tier: Int,
    val params: () -> Map<String, String> = { emptyMap() },
    val layout: RowLayout = RowLayout.POSTER,
    val limit: Int? = null,
    val dedupe: Boolean = true,
    val collection: Boolean = false,
)
