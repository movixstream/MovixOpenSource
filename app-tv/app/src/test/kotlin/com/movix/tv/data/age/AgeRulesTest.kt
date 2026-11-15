package com.movix.tv.data.age

import com.movix.tv.data.account.LinkedProfile
import com.movix.tv.data.tmdb.TmdbRating
import com.movix.tv.data.tmdb.TmdbReleaseCountry
import com.movix.tv.data.tmdb.TmdbReleaseDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Règles d'âge du site (`src/utils/certificationUtils.ts`, `src/utils/contentAgeFilter.ts`),
 * reprises sur la télé. Aucun test de bout en bout ne tourne sur une télé : une
 * erreur ici montrerait à un enfant un titre que le site lui cache.
 *
 * Défaillances visées :
 * - classification mal lue (casse, espaces, libellé étranger) → mauvais âge ;
 * - mauvais pays retenu (le site prend la France d'abord, puis US, GB, CA, JP pour les séries) ;
 * - sortie vidéo préférée à la sortie en salle dans un même pays ;
 * - titre sans classification montré à un profil mineur ;
 * - restriction absente ou nulle prise pour une restriction (ou l'inverse).
 */
class AgeRulesTest {

    @Test
    fun classificationsLuesCommeLeSite() {
        assertEquals(0, AgeRules.certificationAge("U"))
        assertEquals(0, AgeRules.certificationAge("TP"))
        assertEquals(0, AgeRules.certificationAge("PG"))
        assertEquals(0, AgeRules.certificationAge("TV-Y"))
        assertEquals(7, AgeRules.certificationAge("TV-Y7"))
        assertEquals(12, AgeRules.certificationAge("12"))
        assertEquals(13, AgeRules.certificationAge(" pg-13 "))
        assertEquals(15, AgeRules.certificationAge("MA 15+"))
        assertEquals(16, AgeRules.certificationAge("16"))
        assertEquals(17, AgeRules.certificationAge("tv-ma"))
        assertEquals(17, AgeRules.certificationAge("R"))
        assertEquals(18, AgeRules.certificationAge("18"))
        assertEquals(21, AgeRules.certificationAge("21+"))
    }

    @Test
    fun classificationVideOuInconnueNaPasDAge() {
        assertNull(AgeRules.certificationAge(null))
        assertNull(AgeRules.certificationAge(""))
        assertNull(AgeRules.certificationAge("   "))
        assertNull(AgeRules.certificationAge("NR"))
        assertNull(AgeRules.certificationAge("Unrated"))
    }

    @Test
    fun sansRestrictionToutPasse() {
        assertTrue(AgeRules.allows(0, null))
        assertTrue(AgeRules.allows(0, 18))
        assertTrue(AgeRules.allows(-1, 21))
    }

    @Test
    fun titreSansClassificationCachePourUnMineurVisibleA18() {
        assertFalse(AgeRules.allows(7, null))
        assertFalse(AgeRules.allows(12, null))
        assertFalse(AgeRules.allows(16, null))
        assertTrue(AgeRules.allows(18, null))
    }

    @Test
    fun ageAuPlusEgalALaRestriction() {
        assertTrue(AgeRules.allows(12, 0))
        assertTrue(AgeRules.allows(12, 12))
        assertFalse(AgeRules.allows(12, 13))
        assertTrue(AgeRules.allows(7, 6))
        assertFalse(AgeRules.allows(7, 10))
        assertTrue(AgeRules.allows(18, 18))
        assertFalse(AgeRules.allows(18, 19))
    }

    private fun country(code: String, vararg dates: Pair<String, Int>) =
        TmdbReleaseCountry(code, dates.map { (cert, type) -> TmdbReleaseDate(cert, type) })

    @Test
    fun filmLaFranceAvantLesEtatsUnis() {
        // Classé R (17) aux États-Unis mais 12 en France : le site retient 12.
        assertEquals(12, AgeRules.movieAge(listOf(country("US", "R" to 3), country("FR", "12" to 3))))
    }

    @Test
    fun filmSortieEnSalleAvantLaVideo() {
        assertEquals(12, AgeRules.movieAge(listOf(country("FR", "16" to 4, "12" to 3))))
        // Pas de classification en salle : n'importe quelle sortie classée.
        assertEquals(16, AgeRules.movieAge(listOf(country("FR", "" to 3, "16" to 4))))
    }

    @Test
    fun filmPaysSuivantQuandLaFranceNeClassePas() {
        assertEquals(13, AgeRules.movieAge(listOf(country("FR", "" to 3), country("US", "PG-13" to 3))))
        assertEquals(13, AgeRules.movieAge(listOf(country("FR", "NR" to 3), country("US", "PG-13" to 3))))
    }

    @Test
    fun filmOrdreDesPaysPreferesPuisLesAutres() {
        // GB passe avant CA, et les deux avant l'Allemagne, quel que soit l'ordre de TMDB.
        assertEquals(15, AgeRules.movieAge(listOf(country("DE", "16" to 3), country("CA", "14A" to 3), country("GB", "15" to 3))))
        // Seule une classification étrangère reconnue : elle compte.
        assertEquals(12, AgeRules.movieAge(listOf(country("DE", "12" to 3))))
    }

    @Test
    fun filmSansClassificationReconnue() {
        assertNull(AgeRules.movieAge(emptyList()))
        assertNull(AgeRules.movieAge(listOf(country("FR", "" to 3), country("US", "NR" to 3), country("XX", "?" to 1))))
    }

    @Test
    fun serieLaFranceDAbordPuisUsGbCaJp() {
        assertEquals(12, AgeRules.tvAge(listOf(TmdbRating("US", "TV-MA"), TmdbRating("FR", "12"))))
        assertEquals(14, AgeRules.tvAge(listOf(TmdbRating("FR", ""), TmdbRating("US", "TV-14"))))
        // Le Japon passe avant les autres pays pour une série.
        assertEquals(0, AgeRules.tvAge(listOf(TmdbRating("DE", "16"), TmdbRating("JP", "G"))))
        assertEquals(15, AgeRules.tvAge(listOf(TmdbRating("KR", "15"))))
        assertNull(AgeRules.tvAge(emptyList()))
        assertNull(AgeRules.tvAge(listOf(TmdbRating("US", "NR"))))
    }

    @Test
    fun restrictionDUnProfilDuServeur() {
        // Champ absent ou à 0 : aucune restriction (le site lit `ageRestriction || 0`).
        assertEquals(0, AgeRules.profileLimit(null))
        assertEquals(0, AgeRules.profileLimit(0))
        assertEquals(0, AgeRules.profileLimit(-4))
        assertEquals(12, AgeRules.profileLimit(12))
    }

    @Test
    fun restrictionDuProfilRetrouveeDansLaListe() {
        val list = listOf(LinkedProfile("a", "Parent"), LinkedProfile("b", "Léa", ageRestriction = 7))
        assertEquals(7, AgeRules.limitOf("b", list))
        assertEquals(0, AgeRules.limitOf("a", list))
        // Profil absent de la liste : la restriction reste inconnue.
        assertNull(AgeRules.limitOf("z", list))
    }
}
