package com.movix.tv.ui.nav

import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateListOf
import com.movix.tv.data.tmdb.MediaItem
import com.movix.tv.data.tmdb.MediaType
import com.movix.tv.ui.player.PlayTarget

/** Sections du rail. */
enum class Section { SEARCH, HOME, MOVIES, SERIES, ANIME, WATCHLIST, SETTINGS }

sealed interface Route {
    data class Main(val section: Section) : Route
    /** `preview` : ce qu'on sait déjà du titre, affiché tout de suite pendant le chargement de la fiche. */
    data class Details(val type: MediaType, val id: Int, val preview: MediaItem? = null) : Route
    /** Acteur ouvert depuis une fiche : nom et photo déjà connus, montrés pendant le chargement. */
    data class Person(val id: Int, val name: String, val profilePath: String? = null) : Route
    /**
     * « Voir tout » d'une rangée du registre (`rowId`). `openedAt` distingue deux
     * ouvertures : chacune repart du début, le retour d'une fiche garde la même.
     */
    data class Collection(val rowId: String, val openedAt: Long = System.nanoTime()) : Route
    data class Player(val target: PlayTarget) : Route
    /** Liaison au compte (code à 5 caractères). */
    data object Link : Route
}

/**
 * Pile de routes maison (pas de navigation-compose) : le focus de retour est
 * géré par chaque écran, et l'APK reste petit.
 */
@Stable
class Navigator {
    private val stack = mutableStateListOf<Route>(Route.Main(Section.HOME))

    val current: Route get() = stack.last()
    val depth: Int get() = stack.size
    /** Écran juste sous l'écran courant (`null` à la racine). */
    val previous: Route? get() = stack.getOrNull(stack.lastIndex - 1)

    fun push(route: Route) {
        if (stack.last() != route) stack.add(route)
    }

    /** Change de section sans empiler : le rail remplace l'écran principal. */
    fun select(section: Section) {
        stack.clear()
        stack.add(Route.Main(section))
    }

    /** `false` s'il n'y a plus rien à dépiler (l'appelant décide de quitter). */
    fun pop(): Boolean {
        if (stack.size <= 1) return false
        stack.removeAt(stack.lastIndex)
        return true
    }
}
