package com.movix.tv.data.tmdb

import androidx.compose.runtime.Immutable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ---------- Réponse TMDB de /person/{id} (seuls les champs lus sont déclarés) ----------

@Serializable
data class TmdbPerson(
    val id: Int,
    val name: String = "",
    val biography: String? = null,
    @SerialName("profile_path") val profilePath: String? = null,
    val birthday: String? = null,
    val deathday: String? = null,
    @SerialName("place_of_birth") val placeOfBirth: String? = null,
    @SerialName("combined_credits") val combinedCredits: TmdbCombinedCredits? = null,
    val translations: TmdbPersonTranslations? = null,
)

@Serializable
data class TmdbCombinedCredits(val cast: List<TmdbPersonCredit> = emptyList())

/** Un rôle de la personne : film ou série, avec son personnage. */
@Serializable
data class TmdbPersonCredit(
    val id: Int,
    @SerialName("media_type") val mediaType: String? = null,
    val title: String? = null,
    val name: String? = null,
    @SerialName("poster_path") val posterPath: String? = null,
    @SerialName("backdrop_path") val backdropPath: String? = null,
    val overview: String? = null,
    @SerialName("vote_average") val voteAverage: Double? = null,
    @SerialName("vote_count") val voteCount: Int? = null,
    val popularity: Double? = null,
    @SerialName("release_date") val releaseDate: String? = null,
    @SerialName("first_air_date") val firstAirDate: String? = null,
    val adult: Boolean? = null,
    @SerialName("genre_ids") val genreIds: List<Int>? = null,
    val character: String? = null,
    @SerialName("episode_count") val episodeCount: Int? = null,
    val order: Int? = null,
)

@Serializable
data class TmdbPersonTranslations(val translations: List<TmdbPersonTranslation> = emptyList())

@Serializable
data class TmdbPersonTranslation(
    @SerialName("iso_639_1") val language: String = "",
    val data: TmdbPersonTranslationData? = null,
)

@Serializable
data class TmdbPersonTranslationData(val biography: String? = null)

// ---------- Modèle de l'appli ----------

/** Écran « personne » : qui elle est, et les films et séries où elle joue. */
@Immutable
data class PersonPage(
    val id: Int,
    val name: String,
    val profilePath: String?,
    val biography: String,
    val birthYear: String?,
    val deathYear: String?,
    val placeOfBirth: String?,
    val movies: List<PersonCredit>,
    val series: List<PersonCredit>,
)

/** Un titre de la filmographie et le personnage joué (sans « (voice) »). */
@Immutable
data class PersonCredit(val item: MediaItem, val character: String?)

fun TmdbPerson.toPersonPage(): PersonPage {
    // Un titre revient une fois par crédit (personnage, saison…) : on le garde
    // une fois, avec son premier vrai personnage et son plus grand nombre d'épisodes.
    val roles = combinedCredits?.cast.orEmpty()
        .mapNotNull { it.toRole(name) }
        .groupBy { it.item.key }.values
        .map { same ->
            same.first().copy(
                character = same.firstNotNullOfOrNull { it.character },
                votes = same.maxOf { it.votes },
                episodes = same.mapNotNull { it.episodes }.maxOrNull(),
            )
        }
    val known = compareByDescending<Role> { it.votes }.thenByDescending { it.popularity }
    return PersonPage(
        id = id,
        name = name,
        profilePath = profilePath,
        // Biographie souvent absente en français : l'anglais, déjà reçu, la remplace.
        biography = biography?.trim().takeUnless { it.isNullOrEmpty() }
            ?: translations?.translations.orEmpty().firstOrNull { it.language == "en" }?.data?.biography?.trim().orEmpty(),
        birthYear = birthday.year(),
        deathYear = deathday.year(),
        placeOfBirth = placeOfBirth?.trim()?.takeIf { it.isNotEmpty() },
        // Les plus connus d'abord (votes TMDB, plus stables que la popularité du moment).
        movies = roles.filter { it.item.type == MediaType.MOVIE }.sortedWith(known).map { it.credit() },
        // Séries : les rôles récurrents avant les passages d'un épisode, même dans une série célèbre.
        series = roles.filter { it.item.type == MediaType.TV }
            .sortedWith(compareBy<Role> { it.isGuest }.then(known)).map { it.credit() },
    )
}

private data class Role(val item: MediaItem, val character: String?, val votes: Int, val popularity: Double, val episodes: Int?) {
    /** Un seul épisode : rôle invité. Nombre inconnu : on ne suppose rien. */
    val isGuest: Boolean get() = episodes != null && episodes < 2
    fun credit() = PersonCredit(item, character)
}

private fun TmdbPersonCredit.toRole(personName: String): Role? {
    val type = when (mediaType) {
        "movie" -> MediaType.MOVIE
        "tv" -> MediaType.TV
        else -> return null
    }
    if (adult == true || posterPath == null) return null
    val genres = genreIds
    if (genres != null && genres.any { it in NON_FICTION_GENRES }) return null
    // Série sans aucun genre : cérémonie ou émission spéciale (Oscars…), où
    // l'acteur « joue » son personnage le temps d'un sketch.
    if (type == MediaType.TV && genres != null && genres.isEmpty()) return null
    val date = listOf(releaseDate, firstAirDate).firstOrNull { !it.isNullOrBlank() }
    val votes = voteCount ?: 0
    // Projet seulement annoncé (« Untitled… ») : ni date ni vote.
    if (date == null && votes == 0) return null
    if (isNotARole(character, personName, order)) return null
    val label = (if (type == MediaType.MOVIE) title ?: name else name ?: title)?.takeIf { it.isNotBlank() } ?: return null
    val item = MediaItem(
        id = id,
        type = type,
        title = label,
        posterPath = posterPath,
        backdropPath = backdropPath,
        overview = overview.orEmpty(),
        rating = voteAverage?.takeIf { it > 0 },
        year = date.year(),
    )
    return Role(item, character?.replace(VOICE_MENTION, "")?.trim()?.takeIf { it.isNotEmpty() }, votes, popularity ?: 0.0, episodeCount)
}

private fun String?.year(): String? = this?.take(4)?.takeIf { it.length == 4 && it.all(Char::isDigit) }

/** Talk-shows, journaux, télé-réalité, documentaires : on y est soi-même, on n'y joue pas. */
private val NON_FICTION_GENRES = setOf(10767, 10763, 10764, 99)

// Mêmes règles que la carte des liens du site (src/services/cineGraph/build.ts).
private val SELF_ROLES = setOf(
    "self", "himself", "herself", "themselves", "themself", "myself", "yourself",
    "host", "co-host", "guest", "guest host", "presenter", "interviewee", "contestant",
    "lui-même", "elle-même", "eux-mêmes", "elles-mêmes", "soi-même",
    "présentateur", "présentatrice", "invité", "invitée",
)
private val NARRATOR_ROLES = setOf("narrator", "narration", "narrateur", "narratrice")
/** Apparitions qui ne sont pas un rôle : non créditées, images d'archives, caméos. */
private val NOT_A_ROLE = Regex("""uncredited|non crédité|archive footage|archival footage|archive sound|\(archive\)|images d'archives?|\bcameo\b""", RegexOption.IGNORE_CASE)
private val VOICE = Regex("""\b(?:voice|voix)\b""", RegexOption.IGNORE_CASE)
private val VOICE_MENTION = Regex("""\s*\((?:voice|voix)\)""", RegexOption.IGNORE_CASE)
private val PARENTHESES = Regex("""\([^)]*\)""")
private val SEGMENTS = Regex("""\s+[-–—]\s+|\s*[/:]\s*""")

/**
 * Vrai quand le « personnage » n'en est pas un : la personne joue son propre
 * rôle (Self, Lui-même, son propre nom), présente, raconte hors champ, ou
 * n'apparaît qu'en caméo non crédité ou en images d'archives.
 */
private fun isNotARole(character: String?, personName: String, order: Int?): Boolean {
    if (character.isNullOrBlank()) return false
    if (NOT_A_ROLE.containsMatchIn(character)) return true
    val name = personName.trim().lowercase()
    return character.lowercase().replace(PARENTHESES, " ").split(SEGMENTS)
        .map { it.trim() }.filter { it.isNotEmpty() }
        .any { segment ->
            segment in SELF_ROLES || (name.isNotEmpty() && segment == name) ||
                // Un narrateur hors champ ne joue pas… sauf le héros qui raconte
                // en tête d'affiche (le « Narrator » d'Edward Norton dans Fight Club).
                (segment in NARRATOR_ROLES && (VOICE.containsMatchIn(character) || order == null || order > 2))
        }
}
