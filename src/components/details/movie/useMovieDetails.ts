import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import type { Media } from '@/components/EmblaCarousel';
import { getTmdbLanguage } from '@/i18n';
import { isLikelyAnime } from '@/utils/animeSignals';
import { rememberMedia } from '@/utils/mediaSearchIndex';
import { parseMovieReleases } from '@/utils/movieRelease';
import { normalizeAlternateTitles, normalizeKeywords, type AlternateTitle } from '@/utils/tmdbMetadata';
import {
  groupDetailsCrew,
  type DetailsCastMember, type DetailsGroupedCrewMember,
} from '../credits';
import type { DetailsCertifications } from '../certification';
import type { DetailsTmdbImage } from '../DetailsImagesGallery';
import { useDetailCharacters } from '../useDetailCharacters';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

export interface MovieExtended {
  title: string;
  overview: string;
  poster_path: string;
  release_date: string;
  vote_average: number;
  genres: { id: number; name: string }[];
  runtime: number;
  backdrop_path?: string;
  production_companies?: { id: number; name: string; logo_path: string | null }[];
  production_countries?: { iso_3166_1: string; name: string }[];
  spoken_languages?: { iso_639_1: string; name: string }[];
  belongs_to_collection?: {
    id: number;
    name: string;
    poster_path: string | null;
    backdrop_path: string | null;
  } | null;
  budget?: number;
  revenue?: number;
  status?: string;
  tagline?: string;
  vote_count?: number;
  original_language?: string;
  original_title?: string;
  /** Arrivent par `append_to_response`, d'où les deux formes propres à TMDB. */
  keywords?: { keywords?: Array<{ id: number; name: string }> };
  alternative_titles?: { titles?: Array<{ iso_3166_1?: string; title?: string; type?: string }> };
}

/** Film recommandé par TMDB, tel que la rangée « Films similaires » le lit. */
export type RecommendedMovie = Pick<Media, 'id' | 'title' | 'poster_path' | 'backdrop_path' | 'overview' | 'vote_average' | 'release_date'>;

/** Sorties d'un pays dans la réponse TMDB `/release_dates`. */
interface TmdbReleaseRegion {
  iso_3166_1: string;
  release_dates?: Array<{ type: number; certification: string }>;
}

/** Classification française (sortie en salle), à défaut américaine. */
function pickMovieCertifications(regions: TmdbReleaseRegion[]): DetailsCertifications {
  const certifications: DetailsCertifications = {};
  const fr = regions.find((region) => region.iso_3166_1 === 'FR');
  // Sortie en salle, ou en salle limitée.
  const frTheatrical = fr?.release_dates?.find((release) => release.type === 3 || release.type === 2);
  if (frTheatrical?.certification) certifications['FR'] = frTheatrical.certification;
  if (!certifications['FR']) {
    const us = regions.find((region) => region.iso_3166_1 === 'US');
    const usRated = us?.release_dates?.find((release) => release.certification !== '');
    if (usRated?.certification) certifications['US'] = usRated.certification;
  }
  return certifications;
}

/**
 * Données TMDB de la fiche film : la fiche, le générique, les dates de sortie
 * et classifications, l'image de fond la plus grande, les films similaires et
 * les personnages. Alimente aussi le catalogue local de recherche.
 */
export function useMovieDetails(id: string | null) {
  const { t } = useTranslation();
  const [movie, setMovie] = useState<MovieExtended | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cast, setCast] = useState<DetailsCastMember[]>([]);
  // Le générique complet, pour la galerie de personnages : `cast` reste tronqué
  // à vingt pour la section Distribution, qui n'a pas la même vocation.
  const [fullCast, setFullCast] = useState<DetailsCastMember[]>([]);
  const [crew, setCrew] = useState<DetailsGroupedCrewMember[]>([]);
  const [alternateTitles, setAlternateTitles] = useState<AlternateTitle[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [releaseDates, setReleaseDates] = useState<{ id: string; data: unknown } | null>(null);
  const [certifications, setCertifications] = useState<DetailsCertifications>({});
  const [bestBackdrop, setBestBackdrop] = useState<DetailsTmdbImage | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendedMovie[]>([]);

  const movieReleases = useMemo(() => parseMovieReleases(
    releaseDates?.id === id ? releaseDates.data : null, movie?.release_date,
  ), [id, movie?.release_date, releaseDates]);

  // La fiche, puis le générique, puis les dates de sortie.
  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      try {
        const language = getTmdbLanguage();
        // `append_to_response` plutôt que deux requêtes de plus : mots-clés et
        // titres alternatifs voyagent avec la fiche, sans aller-retour en sus.
        const response = await axios.get(
          `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&language=${language}&append_to_response=keywords,alternative_titles`
        );
        // TMDB renvoie un résumé vide quand la traduction n'existe pas, alors
        // que son site affiche le texte anglais : on fait pareil.
        if (!response.data?.overview?.trim() && !language.startsWith('en')) {
          try {
            const en = await axios.get(`https://api.themoviedb.org/3/movie/${id}`, {
              params: { api_key: TMDB_API_KEY, language: 'en-US' },
            });
            if (en.data?.overview) response.data.overview = en.data.overview;
            if (!response.data.tagline && en.data?.tagline) response.data.tagline = en.data.tagline;
          } catch { /* le résumé reste vide */ }
        }
        setMovie(response.data);
        setKeywords(normalizeKeywords(response.data?.keywords, language));
        setAlternateTitles(normalizeAlternateTitles(response.data?.alternative_titles, [
          response.data?.title, response.data?.original_title,
        ]));

        const credits = await axios.get(
          `https://api.themoviedb.org/3/movie/${id}/credits?api_key=${TMDB_API_KEY}&language=${language}`
        );
        setCast(credits.data.cast.slice(0, 20));
        setFullCast(credits.data.cast || []);
        setCrew(groupDetailsCrew(credits.data.crew));

        const releases = await axios.get(
          `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_API_KEY}`
        );
        // La même réponse alimente les dates et les classifications.
        setReleaseDates({ id, data: releases.data });
        setCertifications(pickMovieCertifications(releases.data.results));
      } catch (fetchError) {
        console.error('Error fetching movie details:', fetchError);
        setError(t('details.movieLoadError'));
      } finally {
        setLoading(false);
      }
    };
    void load();
    // La page est remontée à chaque fiche : `t` ne relance rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Plus grande image de la galerie : image du haut quand TMDB n'a pas
  // d'arrière-plan principal.
  useEffect(() => {
    setBestBackdrop(null);
    if (!id) return;
    axios.get(`https://api.themoviedb.org/3/movie/${id}/images`, { params: { api_key: TMDB_API_KEY } })
      .then((response) => {
        const backdrops: DetailsTmdbImage[] | undefined = response.data.backdrops;
        if (backdrops && backdrops.length > 0) {
          setBestBackdrop([...backdrops].sort((a, b) => b.width - a.width)[0]);
        }
      })
      .catch((imagesError) => console.error('Error fetching movie images:', imagesError));
  }, [id]);

  // Films similaires, une fois la fiche arrivée.
  const movieLoaded = movie !== null;
  useEffect(() => {
    if (!id || !movieLoaded) return;
    axios.get(
      `https://api.themoviedb.org/3/movie/${id}/recommendations?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
    )
      .then((response) => setRecommendations(response.data.results.slice(0, 20)))
      .catch((recommendationsError) => console.error('Error fetching recommendations:', recommendationsError));
  }, [id, movieLoaded]);

  useEffect(() => {
    document.title = movie ? `${movie.title} - Movix` : 'Film - Movix';
  }, [movie]);

  // AniList est tentée quand le film a le profil d'un anime : un long-métrage
  // japonais animé y est mieux décrit que par un générique.
  const { characters, charactersLoading, hasCharactersTab } = useDetailCharacters({
    ready: movieLoaded,
    looksLikeAnime: movie ? isLikelyAnime(
      {
        original_language: movie.original_language,
        production_companies: movie.production_companies,
        genres: movie.genres,
      },
      { results: movie.keywords?.keywords ?? [] },
    ) : false,
    anilistTitles: [movie?.original_title, movie?.title],
    cast: fullCast,
  });

  /**
   * Ce que la fiche vient de récupérer alimente le catalogue local de
   * recherche. Titres alternatifs, mots-clés, thèmes et noms de personnages
   * sont exactement ce que `search/multi` ne sait pas trouver : les garder
   * rend la fiche retrouvable par ces mots-là (voir `utils/mediaSearchIndex`).
   */
  useEffect(() => {
    if (!movie || !id) return;
    rememberMedia({
      mediaType: 'movie',
      id: Number(id),
      title: movie.title,
      posterPath: movie.poster_path,
      backdropPath: movie.backdrop_path,
      date: movie.release_date,
      voteAverage: movie.vote_average,
      genreIds: movie.genres?.map((genre) => genre.id),
      overview: movie.overview,
      terms: [
        movie.original_title,
        ...alternateTitles.map((entry) => entry.title),
        ...keywords,
        ...(characters?.themes ?? []),
        ...(characters?.groups.flatMap((group) => group.characters.map((item) => item.name)) ?? []),
      ].filter((term): term is string => Boolean(term)),
    });
  }, [movie, id, alternateTitles, keywords, characters]);

  return {
    movie, loading, error, cast, crew, alternateTitles, keywords, movieReleases, certifications,
    bestBackdrop, recommendations, characters, charactersLoading, hasCharactersTab,
  };
}
