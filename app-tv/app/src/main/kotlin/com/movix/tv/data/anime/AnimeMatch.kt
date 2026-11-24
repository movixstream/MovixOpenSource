package com.movix.tv.data.anime

/** Épisode d'anime-sama retenu pour un épisode TMDB. */
data class AnimeTarget(val slug: String, val season: AnimeSeason, val episode: AnimeEpisode)

/**
 * Relie un épisode TMDB (saison, numéro) à un épisode d'anime-sama. Fonctions
 * pures.
 *
 * Les deux catalogues découpent rarement de la même façon : TMDB range
 * Jujutsu Kaisen en une saison de 59 épisodes, anime-sama en trois saisons
 * (24, 23, 12) ; One Piece compte 23 saisons sur TMDB et 12 sagas sur
 * anime-sama. La suite principale d'anime-sama (`saison1`, `saison2`,
 * `saison2-2`…, dans l'ordre du site) sert donc de référence :
 *
 * - autant de saisons des deux côtés : même saison, même rang (L'Attaque des
 *   Titans, My Hero Academia ; Demon Slayer en comptant son hors-série) ;
 * - sinon : numéro absolu de l'épisode sur TMDB, compté dans la suite
 *   principale (Jujutsu Kaisen, One Piece, Naruto, Bleach).
 *
 * Hors suite : films (`film`), OAV, versions Kai et hors-séries (`…hs`,
 * souvent « sans fillers »).
 */
object AnimeMatch {
    private val MAIN_SEASON = Regex("""^saison\d+(-\d+)?$""")
    private val MAIN_OR_SPECIAL = Regex("""^saison\d+(-\d+)?(hs)?$""")

    /** Saisons de la suite principale, dans l'ordre du site, sans les saisons vides. */
    fun mainSeasons(work: AnimeWork): List<AnimeSeason> =
        work.seasons.filter { MAIN_SEASON.matches(it.path.lowercase()) && it.episodes.isNotEmpty() }

    /**
     * Épisode d'anime-sama de l'épisode TMDB [season]/[episode]. [tmdbCounts] :
     * nombre d'épisodes de chaque saison TMDB (saison 0 exclue) ; vide s'il est
     * inconnu (seule la correspondance saison par saison reste possible).
     */
    fun episode(work: AnimeWork, tmdbCounts: Map<Int, Int>, season: Int, episode: Int): AnimeTarget? {
        val slug = work.slug?.takeIf { it.isNotBlank() } ?: return null
        if (season < 1 || episode < 1) return null
        val main = mainSeasons(work)
        if (main.isEmpty()) return null
        // Variante avec les hors-séries à leur place : Demon Slayer range l'arc
        // du train (7 épisodes, saison 2 sur TMDB) en `saison1hs`.
        val withSpecials = work.seasons.filter { MAIN_OR_SPECIAL.matches(it.path.lowercase()) && it.episodes.isNotEmpty() }
        val tmdbSeasons = tmdbCounts.filterKeys { it > 0 }
        val sameShape = when {
            tmdbSeasons.isEmpty() || tmdbSeasons.size == main.size -> main
            tmdbSeasons.size == withSpecials.size -> withSpecials
            else -> null
        }
        if (sameShape != null) {
            val s = sameShape.getOrNull(season - 1) ?: return null
            return s.episodes.getOrNull(episode - 1)?.let { AnimeTarget(slug, s, it) }
        }
        // Numéro absolu : épisodes des saisons TMDB d'avant, puis celui-ci.
        var left = tmdbSeasons.filterKeys { it < season }.values.sum() + episode
        for (s in main) {
            if (left <= s.episodes.size) return AnimeTarget(slug, s, s.episodes[left - 1])
            left -= s.episodes.size
        }
        return null
    }

    /**
     * Film : l'œuvre ne doit compter qu'un seul épisode (un film seul sur
     * anime-sama). Une œuvre à plusieurs films ou épisodes est ambiguë.
     */
    fun movie(work: AnimeWork): AnimeTarget? {
        val slug = work.slug?.takeIf { it.isNotBlank() } ?: return null
        val all = work.seasons.flatMap { s -> s.episodes.map { s to it } }
        val (s, e) = all.singleOrNull() ?: return null
        return AnimeTarget(slug, s, e)
    }
}
