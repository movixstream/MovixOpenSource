package com.movix.tv.data.age

import com.movix.tv.data.account.LinkedProfile
import com.movix.tv.data.tmdb.TmdbRating
import com.movix.tv.data.tmdb.TmdbReleaseCountry
import java.util.Locale

/**
 * Restriction d'âge des profils enfant, mêmes règles que le site
 * (`src/utils/certificationUtils.ts` et `src/utils/contentAgeFilter.ts`).
 *
 * Restriction d'un profil : 0 = aucune, sinon 7, 12, 16 ou 18 (âge maximal
 * des titres montrés). Âge d'un titre : celui de sa classification TMDB,
 * `null` quand TMDB n'en a aucune que l'on sache lire.
 */
object AgeRules {
    /** Valeur de restriction illisible (ni nombre ni nombre écrit) : la plus stricte du site, jamais « aucune ». */
    const val UNREADABLE_LIMIT = 7

    /** Classifications « tous publics » (âge 0). */
    private val ALL_AGES = setOf("TP", "TP+", "G", "PG", "TV-Y", "TV-G", "TV-PG", "U", "0", "T", "ALL", "L", "AA", "A", "ATP")

    private val AGES: Map<String, Int> = mapOf(
        "6" to 6, "6+" to 6,
        "7" to 7, "TV-Y7" to 7,
        "10" to 10,
        "12" to 12, "12A" to 12, "PG12" to 12, "IIB" to 12,
        "PG-13" to 13, "R13" to 13, "R-13" to 13, "+13" to 13,
        "14" to 14, "14A" to 14, "14+" to 14, "TV-14" to 14,
        "15" to 15, "MA 15+" to 15, "M" to 15, "R15+" to 15, "K15" to 15, "B" to 15, "B-15" to 15,
        "16" to 16, "+16" to 16, "NC16" to 16, "K-16" to 16, "N-16" to 16, "16+" to 16,
        "R" to 17, "TV-MA" to 17, "NC-17" to 17,
        "18" to 18, "18+" to 18, "18A" to 18, "R18+" to 18, "M18" to 18, "III" to 18, "R-18" to 18, "18SG" to 18, "N-18" to 18, "C" to 18, "D" to 18,
        "19" to 19, "21+" to 21,
    )

    /** Pays lus en premier, dans cet ordre ; les autres suivent dans l'ordre de TMDB. */
    private val MOVIE_COUNTRIES = listOf("FR", "US", "GB", "CA")
    private val TV_COUNTRIES = listOf("FR", "US", "GB", "CA", "JP")

    /** Âge d'une classification (« 12 », « pg-13 », « TV-MA »…) ; `null` : vide ou inconnue. */
    fun certificationAge(certification: String?): Int? {
        val c = certification?.trim()?.uppercase(Locale.ROOT)?.takeIf { it.isNotEmpty() } ?: return null
        if (c in ALL_AGES) return 0
        return AGES[c]
    }

    /**
     * Film (`/movie/{id}/release_dates`) : premier pays dont la classification
     * se lit, France d'abord. Dans un pays, la sortie en salle (types 2 et 3)
     * passe avant les autres sorties classées.
     */
    fun movieAge(countries: List<TmdbReleaseCountry>): Int? {
        for (country in ordered(countries, MOVIE_COUNTRIES) { it.country }) {
            val dates = country.dates
            val preferred = dates.firstOrNull { (it.type == 3 || it.type == 2) && it.certification.isNotBlank() }
                ?: dates.firstOrNull { it.certification.isNotBlank() }
            certificationAge(preferred?.certification)?.let { return it }
        }
        return null
    }

    /** Série (`/tv/{id}/content_ratings`) : premier pays dont la classification se lit, France d'abord. */
    fun tvAge(ratings: List<TmdbRating>): Int? {
        for (rating in ordered(ratings, TV_COUNTRIES) { it.country }) {
            certificationAge(rating.rating)?.let { return it }
        }
        return null
    }

    /**
     * Le titre d'âge [age] est-il visible pour la restriction [limit] ? Sans
     * restriction, tout. Titre sans classification vérifiée : caché pour un
     * profil mineur, visible seulement à 18 ans. Sinon : âge ≤ restriction.
     */
    fun allows(limit: Int, age: Int?): Boolean {
        if (limit <= 0) return true
        if (age == null) return limit >= 18
        return age <= limit
    }

    /** Restriction d'un profil de `GET /api/profiles` : champ absent ou ≤ 0 = aucune (le site lit `ageRestriction || 0`). */
    fun profileLimit(value: Int?): Int = value?.takeIf { it > 0 } ?: 0

    /** Restriction du profil [profileId] d'après [profiles] ; `null` s'il n'y figure pas. */
    fun limitOf(profileId: String, profiles: List<LinkedProfile>): Int? =
        profiles.firstOrNull { it.id == profileId }?.let { profileLimit(it.ageRestriction) }

    // ------------------------------------------------ Mode enfant réglé sur la télé

    /**
     * Limites proposées sur la télé : désactivé (0), puis 7+, 12+ et 16+. Le
     * serveur n'accepte que 0, 7, 12, 16 et 18 (toute autre valeur y devient 0).
     * 18+ ne masque rien de plus que « désactivé » : il n'est pas proposé.
     */
    val CHOICES: List<Int> = listOf(0, 7, 12, 16)

    /** [CHOICES], plus la restriction [current] si elle a été posée ailleurs (18+ sur le site) : elle reste affichée comme choisie. */
    fun choicesFor(current: Int?): List<Int> =
        if (current == null || current <= 0 || current in CHOICES) CHOICES else (CHOICES + current).sorted()

    /**
     * Mode enfant gardé sur la télé (sans compte relié) : absent ou « 0 » =
     * désactivé. Une valeur abîmée ne vaut jamais « désactivé » : elle prend la
     * limite la plus stricte.
     */
    fun storedLimit(raw: String?): Int {
        val text = raw?.trim().orEmpty()
        if (text.isEmpty()) return 0
        return text.toIntOrNull()?.takeIf { it == 0 || it == 7 || it == 12 || it == 16 || it == 18 } ?: UNREADABLE_LIMIT
    }

    // Nom, avatar et nombre des profils : `data/account/ProfileRules.kt`.

    private inline fun <T> ordered(all: List<T>, preferred: List<String>, country: (T) -> String): List<T> =
        preferred.mapNotNull { code -> all.firstOrNull { country(it) == code } } + all.filter { country(it) !in preferred }
}
