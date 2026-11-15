package com.movix.tv.ui.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchInputTest {
    @Test
    fun `chaque page a 36 touches distinctes d'un caractère`() {
        KeyPage.entries.forEach { page ->
            assertEquals(page.name, 36, page.keys.size)
            assertEquals(page.name, 36, page.keys.toSet().size)
            assertTrue(page.name, page.keys.all { it.length == 1 })
            assertEquals(page.name, 0, page.keys.size % KeyPage.COLUMNS)
        }
        assertTrue(KeyPage.SYMBOLS.keys.contains("$"))
        assertTrue(KeyPage.LETTERS.keys.containsAll(listOf("é", "è", "à", "ç", "'", "-")))
        assertTrue(KeyPage.SYMBOLS.keys.containsAll((0..9).map { it.toString() }))
    }

    @Test
    fun `l'espace n'est ni en tête ni doublé`() {
        assertEquals("", SearchInput.type("", " "))
        assertEquals("star ", SearchInput.type("star", " "))
        assertEquals("star ", SearchInput.type("star ", " "))
        assertEquals("star w", SearchInput.type("star ", "w"))
    }

    @Test
    fun `la saisie est bornée et l'effacement retire un caractère`() {
        val long = "a".repeat(SearchInput.MAX_LENGTH)
        assertEquals(long, SearchInput.type(long, "b"))
        assertEquals(long, SearchInput.type(long, " "))
        // Un titre trop long choisi dans la liste est coupé une fois, puis plus rien ne s'efface.
        val picked = SearchInput.fromVoice("x".repeat(120))
        assertEquals(SearchInput.MAX_LENGTH, picked.length)
        assertEquals(picked, SearchInput.type(picked, "y"))
        assertEquals("ab", SearchInput.delete("abc"))
        assertEquals("", SearchInput.delete(""))
    }

    @Test
    fun `la recherche part à deux caractères utiles`() {
        assertNull(SearchInput.searchable(" a "))
        assertEquals("l'été", SearchInput.searchable("  l'été  "))
        assertEquals("star wars", SearchInput.searchable("star   wars"))
    }

    @Test
    fun `la dictée est nettoyée`() {
        assertEquals("Breaking Bad", SearchInput.fromVoice("  Breaking   Bad "))
    }

    @Test
    fun `l'historique met la dernière recherche en tête sans doublon d'accents ou de casse`() {
        var recent = emptyList<String>()
        recent = SearchInput.pushRecent(recent, "amelie")
        recent = SearchInput.pushRecent(recent, "dune")
        recent = SearchInput.pushRecent(recent, "Amélie ")
        assertEquals(listOf("Amélie", "dune"), recent)
        assertEquals(recent, SearchInput.pushRecent(recent, "a"))
        val full = (1..20).fold(emptyList<String>()) { acc, i -> SearchInput.pushRecent(acc, "film $i") }
        assertEquals(SearchInput.MAX_RECENT, full.size)
        assertEquals("film 20", full.first())
    }

    @Test
    fun `l'historique survit à l'aller-retour JSON et ignore une valeur abîmée`() {
        val recent = listOf("L'Été meurtrier", "Fast & Furious", "« Ça »")
        assertEquals(recent, SearchInput.decodeRecent(SearchInput.encodeRecent(recent)))
        assertNull(SearchInput.encodeRecent(emptyList()))
        assertEquals(emptyList<String>(), SearchInput.decodeRecent("{pas du json"))
        assertEquals(emptyList<String>(), SearchInput.decodeRecent(null))
    }

    @Test
    fun `les titres proposés complètent le texte tapé et écartent ceux sans rapport`() {
        val titles = listOf("Le Seigneur des anneaux", "El Camino : un film Breaking Bad", "Breaking Bad", "breaking bad", "Bad Boys")
        // Le titre qui commence par le texte passe devant ; ceux sans rapport sont écartés.
        assertEquals(listOf("Breaking Bad", "El Camino : un film Breaking Bad"), SearchInput.suggestions("bre", titles))
        assertEquals(listOf("El Camino : un film Breaking Bad"), SearchInput.suggestions("Breaking Bad", titles))
        // Mots dans l'ordre, accents et ponctuation ignorés.
        assertEquals(listOf("Spider-Man : No Way Home"), SearchInput.suggestions("spider m", listOf("Spider-Man : No Way Home", "Man of Steel")))
        assertEquals(listOf("L'Été meurtrier"), SearchInput.suggestions("l'ete", listOf("L'Été meurtrier", "Été 85")))
        assertEquals(emptyList<String>(), SearchInput.suggestions("bad breaking", listOf("Breaking Bad")))
        assertEquals(SearchInput.MAX_SUGGESTIONS, SearchInput.suggestions("titre", (1..10).map { "Titre $it" }).size)
    }
}
