package com.movix.tv.data.tmdb

import androidx.compose.runtime.Immutable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ---------- Réponses TMDB (seuls les champs lus sont déclarés) ----------

@Serializable
data class TmdbPage(
    val page: Int = 1,
    val results: List<TmdbItem> = emptyList(),
    @SerialName("total_pages") val totalPages: Int = 1,
)

@Serializable
data class TmdbItem(
    val id: Int,
    val title: String? = null,
    val name: String? = null,
    @SerialName("media_type") val mediaType: String? = null,
    @SerialName("poster_path") val posterPath: String? = null,
    @SerialName("backdrop_path") val backdropPath: String? = null,
    val overview: String? = null,
    @SerialName("vote_average") val voteAverage: Double? = null,
    @SerialName("release_date") val releaseDate: String? = null,
    @SerialName("first_air_date") val firstAirDate: String? = null,
)

@Serializable
data class TmdbNamed(val id: Int = 0, val name: String = "")

@Serializable
data class TmdbSeasonSummary(
    @SerialName("season_number") val seasonNumber: Int,
    val name: String? = null,
    @SerialName("episode_count") val episodeCount: Int = 0,
)

@Serializable
data class TmdbVideo(
    val key: String = "",
    val site: String = "",
    val type: String = "",
    val name: String = "",
    @SerialName("iso_639_1") val language: String? = null,
    val official: Boolean = false,
)

@Serializable
data class TmdbCast(
    val name: String = "",
    val character: String? = null,
    @SerialName("profile_path") val profilePath: String? = null,
    val order: Int = 999,
)

@Serializable
data class TmdbCredits(val cast: List<TmdbCast> = emptyList())

@Serializable
data class TmdbVideos(val results: List<TmdbVideo> = emptyList())

@Serializable
data class TmdbRating(@SerialName("iso_3166_1") val country: String = "", val rating: String = "")

@Serializable
data class TmdbRatings(val results: List<TmdbRating> = emptyList())

@Serializable
data class TmdbReleaseDate(val certification: String = "")

@Serializable
data class TmdbReleaseCountry(
    @SerialName("iso_3166_1") val country: String = "",
    @SerialName("release_dates") val dates: List<TmdbReleaseDate> = emptyList(),
)

@Serializable
data class TmdbReleaseDates(val results: List<TmdbReleaseCountry> = emptyList())

@Serializable
data class TmdbDetails(
    val id: Int,
    val title: String? = null,
    val name: String? = null,
    val overview: String? = null,
    @SerialName("poster_path") val posterPath: String? = null,
    @SerialName("backdrop_path") val backdropPath: String? = null,
    @SerialName("vote_average") val voteAverage: Double? = null,
    @SerialName("release_date") val releaseDate: String? = null,
    @SerialName("first_air_date") val firstAirDate: String? = null,
    val runtime: Int? = null,
    @SerialName("episode_run_time") val episodeRunTime: List<Int> = emptyList(),
    @SerialName("number_of_seasons") val numberOfSeasons: Int? = null,
    val genres: List<TmdbNamed> = emptyList(),
    val networks: List<TmdbNamed> = emptyList(),
    @SerialName("production_companies") val companies: List<TmdbNamed> = emptyList(),
    val seasons: List<TmdbSeasonSummary> = emptyList(),
    val videos: TmdbVideos? = null,
    @SerialName("content_ratings") val contentRatings: TmdbRatings? = null,
    @SerialName("release_dates") val releaseDates: TmdbReleaseDates? = null,
    @SerialName("external_ids") val externalIds: TmdbExternalIds? = null,
    val credits: TmdbCredits? = null,
    val recommendations: TmdbPage? = null,
    val similar: TmdbPage? = null,
)

@Serializable
data class TmdbExternalIds(@SerialName("imdb_id") val imdbId: String? = null)

@Serializable
data class TmdbEpisode(
    @SerialName("episode_number") val episodeNumber: Int,
    val name: String? = null,
    val overview: String? = null,
    @SerialName("still_path") val stillPath: String? = null,
    val runtime: Int? = null,
)

@Serializable
data class TmdbSeason(
    @SerialName("season_number") val seasonNumber: Int = 0,
    val episodes: List<TmdbEpisode> = emptyList(),
)

// ---------- Modèle de l'appli ----------

@Immutable
data class MediaItem(
    val id: Int,
    val type: MediaType,
    val title: String,
    val posterPath: String?,
    val backdropPath: String?,
    val overview: String,
    val rating: Double?,
    val year: String?,
) {
    /** Identifiant stable pour les `key` des listes : un film et une série peuvent partager un id TMDB. */
    val key: String get() = "${type.path}:$id"
}

fun TmdbItem.toMediaItem(fallback: MediaType): MediaItem? {
    val type = when (mediaType) {
        "movie" -> MediaType.MOVIE
        "tv" -> MediaType.TV
        null -> fallback
        else -> return null // personnes, collections : pas des titres
    }
    val label = title ?: name ?: return null
    return MediaItem(
        id = id,
        type = type,
        title = label,
        posterPath = posterPath,
        backdropPath = backdropPath,
        overview = overview.orEmpty(),
        rating = voteAverage?.takeIf { it > 0 },
        year = (releaseDate ?: firstAirDate)?.take(4)?.takeIf { it.length == 4 },
    )
}

@Immutable
data class Episode(
    val number: Int,
    val title: String,
    val overview: String,
    val stillPath: String?,
    val runtime: Int?,
)

@Immutable
data class Details(
    val item: MediaItem,
    val genres: List<String>,
    val runtime: Int?,
    val seasonNumbers: List<Int>,
    val studio: String?,
    val certification: String?,
    val trailerKey: String?,
    /** Identifiant IMDb : la route Omega (`/api/imdb`) en a besoin. */
    val imdbId: String? = null,
    /** Rangées du bas de la fiche : titres similaires, distribution, vidéos YouTube. */
    val similar: List<MediaItem> = emptyList(),
    val cast: List<CastMember> = emptyList(),
    val videos: List<VideoClip> = emptyList(),
)

@Immutable
data class CastMember(val name: String, val character: String?, val profilePath: String?)

/** Vidéo YouTube de la fiche (bande-annonce, teaser, extrait…), lue dans l'appli. */
@Immutable
data class VideoClip(val key: String, val name: String, val type: String)

fun TmdbDetails.toDetails(type: MediaType): Details {
    val item = MediaItem(
        id = id,
        type = type,
        title = title ?: name ?: "",
        posterPath = posterPath,
        backdropPath = backdropPath,
        overview = overview.orEmpty(),
        rating = voteAverage?.takeIf { it > 0 },
        year = (releaseDate ?: firstAirDate)?.take(4)?.takeIf { it.length == 4 },
    )
    // La saison 0 (« épisodes spéciaux ») est masquée, comme sur le site.
    val seasons = seasons.map { it.seasonNumber }.filter { it > 0 }.distinct().sorted()
    val certification = when (type) {
        MediaType.TV -> contentRatings?.results?.firstOrNull { it.country == "FR" }?.rating
        MediaType.MOVIE -> releaseDates?.results?.firstOrNull { it.country == "FR" }
            ?.dates?.firstOrNull { it.certification.isNotBlank() }?.certification
    }?.takeIf { it.isNotBlank() }
    val trailer = videos?.results
        ?.filter { it.site == "YouTube" }
        ?.sortedByDescending { it.type == "Trailer" }
        ?.firstOrNull()?.key
    return Details(
        item = item,
        genres = genres.map { it.name }.filter { it.isNotBlank() },
        runtime = runtime ?: episodeRunTime.firstOrNull(),
        seasonNumbers = seasons,
        studio = (networks.firstOrNull() ?: companies.firstOrNull())?.name,
        certification = certification,
        trailerKey = trailer,
        imdbId = externalIds?.imdbId?.takeIf { it.startsWith("tt") },
        // Recommandations TMDB, sinon titres « similaires » ; sans le titre lui-même.
        similar = (recommendations?.results.orEmpty().ifEmpty { similar?.results.orEmpty() })
            .mapNotNull { it.toMediaItem(type) }.filter { it.id != id && it.posterPath != null }.take(20),
        cast = credits?.cast.orEmpty().sortedBy { it.order }.filter { it.name.isNotBlank() }.take(20)
            .map { CastMember(it.name, it.character?.takeIf { c -> c.isNotBlank() }, it.profilePath) },
        // Bandes-annonces d'abord, en français d'abord, puis teasers, extraits, coulisses.
        videos = videos?.results.orEmpty().filter { it.site == "YouTube" && it.key.isNotBlank() }
            .sortedWith(compareBy({ VIDEO_ORDER.indexOf(it.type).let { i -> if (i < 0) VIDEO_ORDER.size else i } }, { if (it.language == "fr") 0 else 1 }, { if (it.official) 0 else 1 }))
            .distinctBy { it.key }.take(12)
            .map { VideoClip(it.key, it.name, it.type) },
    )
}

private val VIDEO_ORDER = listOf("Trailer", "Teaser", "Clip", "Featurette", "Behind the Scenes", "Bloopers")

fun TmdbEpisode.toEpisode() = Episode(
    number = episodeNumber,
    title = name?.takeIf { it.isNotBlank() } ?: "",
    overview = overview.orEmpty(),
    stillPath = stillPath,
    runtime = runtime,
)

/** Tailles d'image TMDB : jamais `original` dans une liste (mémoire des petits appareils). */
object TmdbImage {
    private const val BASE = "https://image.tmdb.org/t/p/"
    fun poster(path: String?) = path?.let { "${BASE}w342$it" }
    fun landscape(path: String?) = path?.let { "${BASE}w500$it" }
    fun backdrop(path: String?) = path?.let { "${BASE}w1280$it" }
    fun still(path: String?) = path?.let { "${BASE}w300$it" }
}
