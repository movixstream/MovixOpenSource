package com.movix.tv.ui.search

import java.text.Normalizer
import java.util.Locale
import kotlinx.serialization.json.Json

/**
 * Pages du clavier à l'écran, comme sur YouTube : 6 × 6 touches chacune, pour
 * qu'une touche garde sa place quand on change de page.
 */
enum class KeyPage(val label: String, chars: String) {
    LETTERS("abc", "abcdefghijklmnopqrstuvwxyzéèêàçùôî'-"),
    ACCENTS("àéç", "àâäáãåéèêëíìîïóòôöõúùûüÿçñœæßø'-:.,&"),
    SYMBOLS("123 &?", "1234567890.,'-:!?&()/+=%\"«»;_*@#€\$°~");

    val keys: List<String> = chars.map { it.toString() }

    companion object {
        const val COLUMNS = 6
    }
}

/** Règles de saisie de la recherche, sans Compose : testées à part. */
object SearchInput {
    const val MAX_LENGTH = 80
    const val MIN_QUERY = 2
    const val MAX_RECENT = 8
    const val MAX_SUGGESTIONS = 4

    /** Ajoute une touche ; l'espace n'est jamais en tête ni doublé. Plein : rien ne change. */
    fun type(query: String, text: String): String = when {
        query.length >= MAX_LENGTH -> query
        text == " " -> if (query.isEmpty() || query.endsWith(" ")) query else query + " "
        else -> (query + text).take(MAX_LENGTH)
    }

    fun delete(query: String): String = query.dropLast(1)

    /** Texte dicté : espaces réduits, longueur bornée. */
    fun fromVoice(text: String): String = collapse(text).take(MAX_LENGTH)

    /** La recherche part dès 2 caractères utiles. */
    fun searchable(query: String): String? = collapse(query).takeIf { it.length >= MIN_QUERY }

    /**
     * Forme de comparaison : minuscules sans accents ni espaces superflus,
     * pour que « Amélie » et « amelie » ne fassent qu'une entrée.
     */
    fun fold(text: String): String =
        Normalizer.normalize(collapse(text).lowercase(Locale.ROOT), Normalizer.Form.NFD).replace(MARKS, "")

    /** Recherche ouverte en tête de l'historique, sans doublon. */
    fun pushRecent(recent: List<String>, query: String): List<String> {
        val q = searchable(query)?.take(MAX_LENGTH) ?: return recent
        val key = fold(q)
        return (listOf(q) + recent.filterNot { fold(it) == key }).take(MAX_RECENT)
    }

    /**
     * Titres proposés au-dessus des résultats, pris parmi les titres connus
     * (les plus connus d'abord) : seulement ceux qui complètent vraiment le
     * texte tapé (chaque mot tapé commence un mot du titre, dans l'ordre).
     * IMDb propose aussi des titres sans rapport en français (« inter » →
     * « Entretien avec un vampire ») : ils restent dans la grille, pas ici. Le
     * titre qui commence par le texte passe devant ; sinon l'ordre reçu est gardé.
     */
    fun suggestions(query: String, titles: List<String>): List<String> {
        val q = fold(query)
        val tokens = words(q)
        if (tokens.isEmpty()) return emptyList()
        return titles.map(::collapse)
            .filter { it.isNotEmpty() }
            .distinctBy(::fold)
            .filter { fold(it) != q && completes(tokens, words(fold(it))) }
            .sortedBy { if (fold(it).startsWith(q)) 0 else 1 }
            .take(MAX_SUGGESTIONS)
    }

    /** Chaque mot tapé est le début d'un mot du titre, dans le même ordre. */
    private fun completes(tokens: List<String>, titleWords: List<String>): Boolean {
        var i = 0
        for (t in tokens) {
            while (i < titleWords.size && !titleWords[i].startsWith(t)) i++
            if (i == titleWords.size) return false
            i++
        }
        return true
    }

    private fun words(folded: String): List<String> = folded.split(WORD_BREAK).filter { it.isNotEmpty() }

    fun decodeRecent(raw: String?): List<String> =
        raw?.let { runCatching { Json.decodeFromString<List<String>>(it) }.getOrNull() }.orEmpty()

    fun encodeRecent(recent: List<String>): String? =
        recent.takeIf { it.isNotEmpty() }?.let { Json.encodeToString(it) }

    private fun collapse(text: String): String = text.trim().replace(SPACES, " ")

    private val SPACES = Regex("\\s+")
    private val MARKS = Regex("\\p{Mn}+")
    private val WORD_BREAK = Regex("[^\\p{L}\\p{N}]+")
}
