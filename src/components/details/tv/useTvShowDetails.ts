import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { getTmdbLanguage } from '@/i18n';
import { isLikelyAnime, type TmdbKeywordsResponse } from '@/utils/animeSignals';
import { rememberMedia } from '@/utils/mediaSearchIndex';
import { shouldHideAnimeModeForId } from '@/utils/searchUtils';
import { normalizeAlternateTitles, normalizeKeywords } from '@/utils/tmdbMetadata';
import { groupDetailsCrew, type DetailsCastMember, type DetailsGroupedCrewMember } from '../credits';
import type { DetailsCertifications } from '../certification';
import type { DetailsVideo } from '../videos';
import { useDetailCharacters } from '../useDetailCharacters';
import { fetchTvShowData, type TVShow, type TvSeason } from './tvData';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

/** Distribution de toutes les saisons : nombre de personnes gardées. */
const MAX_AGGREGATE_CAST = 30;

type FullCast = Array<{ id: number; name: string; character?: string; profile_path?: string | null }>;

/**
 * Distribution de la série. `credits` ne porte que la distribution de la
 * dernière saison (2 noms pour Arcane) : celle de toutes les saisons la
 * remplace quand elle est plus complète, limitée aux premiers rôles.
 */
async function fetchTvCredits(id: string) {
  const response = await axios.get(
    `https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}&append_to_response=credits,aggregate_credits,videos,content_ratings,networks,external_ids&language=${getTmdbLanguage()}`
  );
  const seasonCast: DetailsCastMember[] = response.data.credits?.cast ?? [];
  const aggregateCast: DetailsCastMember[] = (
    (response.data.aggregate_credits?.cast ?? []) as Array<{
      id: number;
      name: string;
      profile_path?: string | null;
      roles?: Array<{ character?: string }>;
    }>
  ).slice(0, MAX_AGGREGATE_CAST).map((person) => ({
    id: person.id,
    name: person.name,
    character: person.roles?.[0]?.character ?? '',
    profile_path: person.profile_path ?? null,
  }));
  const cast = aggregateCast.length > seasonCast.length ? aggregateCast : seasonCast.length > 0 ? seasonCast : null;
  const crew = response.data.credits?.crew ? groupDetailsCrew(response.data.credits.crew) : null;
  return { cast, crew };
}

/**
 * Données TMDB de la fiche série : la fiche, ses saisons et leurs vidéos,
 * classifications, distribution, séries similaires et personnages. Alimente
 * aussi le catalogue local de recherche.
 */
export function useTvShowDetails(id: string | null) {
  const { t } = useTranslation();
  const [tvShow, setTVShow] = useState<TVShow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [certifications, setCertifications] = useState<DetailsCertifications>({});
  const [tmdbSeasonsDetails, setSeasonsDetails] = useState<Record<number, TvSeason>>({});
  const [videos, setVideos] = useState<DetailsVideo[]>([]);
  const [seasonVideos, setSeasonVideos] = useState<Record<number, DetailsVideo[]>>({});
  const [autoMultiLangVideos, setAutoMultiLangVideos] = useState<Record<number, DetailsVideo[]>>({});
  const [tmdbKeywords, setTmdbKeywords] = useState<TmdbKeywordsResponse | null>(null);
  const [tmdbAlternativeTitles, setTmdbAlternativeTitles] = useState<Array<{ iso_3166_1?: string; title?: string }>>([]);
  // Nom anglais : nourrit la recherche d'anime (original_name est souvent en japonais).
  const [tmdbEnglishName, setTmdbEnglishName] = useState<string | null>(null);
  // Générique complet, pour la galerie de personnages.
  const [fullCast, setFullCast] = useState<FullCast>([]);
  const [cast, setCast] = useState<DetailsCastMember[]>([]);
  const [crew, setCrew] = useState<DetailsGroupedCrewMember[]>([]);
  const [recommendations, setRecommendations] = useState<TVShow[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchTvShowData(id);
        setTVShow(data.show);
        setFullCast(data.show.credits?.cast ?? []);
        setTmdbKeywords(data.show.keywords ?? null);
        setTmdbAlternativeTitles(data.show.alternative_titles?.results || []);
        if (getTmdbLanguage() !== 'en-US') {
          axios.get(`https://api.themoviedb.org/3/tv/${id}`, { params: { api_key: TMDB_API_KEY, language: 'en-US' } })
            .then((response) => setTmdbEnglishName(response.data?.name ?? null))
            .catch(() => setTmdbEnglishName(null));
        } else {
          setTmdbEnglishName(data.show.name ?? null);
        }
        setCertifications(data.certifications);
        setVideos(data.videos);
        setSeasonsDetails(data.seasonsDetails);
        setSeasonVideos(data.seasonVideos);
        setAutoMultiLangVideos(data.seasonMultiLangVideos);
      } catch (fetchError) {
        console.error('Error fetching TV show details:', fetchError);
        setError(t('details.loadError'));
      } finally {
        setLoading(false);
      }
    };
    void load();
    // La page est remontée à chaque fiche : `t` ne relance rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetchTvCredits(id)
      .then(({ cast: nextCast, crew: nextCrew }) => {
        if (nextCast) setCast(nextCast);
        if (nextCrew) setCrew(nextCrew);
      })
      .catch((creditsError) => console.error('Error fetching TV show:', creditsError));
  }, [id]);

  // Séries similaires, une fois la fiche arrivée.
  const showLoaded = tvShow !== null;
  useEffect(() => {
    if (!id || !showLoaded) return;
    setLoadingSimilar(true);
    axios.get(`https://api.themoviedb.org/3/tv/${id}/recommendations?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`)
      .then((response) => setRecommendations((response.data.results || []).slice(0, 20)))
      .catch((recommendationsError) => console.error('Error fetching recommendations:', recommendationsError))
      .finally(() => setLoadingSimilar(false));
  }, [id, showLoaded]);

  useEffect(() => {
    document.title = tvShow ? `${tvShow.name} - Movix` : t('details.tvShowDefaultTitle');
  }, [tvShow, t]);

  // Scoring multi-signaux TMDB : origin_country, original_language, studio
  // japonais, mots-clés « anime »/« manga », genre Animation. Certaines
  // séries sont écartées à la main.
  const looksLikeAnime = Boolean(tvShow) && !shouldHideAnimeModeForId(id || '') && isLikelyAnime(tvShow, tmdbKeywords);

  // Les titres sont proposés à AniList du plus prometteur au moins : l'original
  // japonais, puis l'anglais, tous deux mieux indexés chez eux que le titre traduit.
  const { characters, charactersLoading, hasCharactersTab } = useDetailCharacters({
    ready: showLoaded,
    looksLikeAnime,
    anilistTitles: [tvShow?.original_name, tmdbEnglishName, tvShow?.name],
    cast: fullCast,
  });

  /** Mots-clés et titres alternatifs, mis à plat pour l'affichage. */
  const keywords = useMemo(() => normalizeKeywords(tmdbKeywords, getTmdbLanguage()), [tmdbKeywords]);
  const alternateTitles = useMemo(
    () => normalizeAlternateTitles({ results: tmdbAlternativeTitles }, [tvShow?.name, tvShow?.original_name, tmdbEnglishName]),
    [tmdbAlternativeTitles, tvShow?.name, tvShow?.original_name, tmdbEnglishName],
  );

  /**
   * Ce que la fiche vient de récupérer alimente le catalogue local de
   * recherche. Titres alternatifs, mots-clés, thèmes et noms de personnages
   * sont exactement ce que `search/multi` ne sait pas trouver : les garder
   * rend la fiche retrouvable par ces mots-là (voir `utils/mediaSearchIndex`).
   */
  useEffect(() => {
    if (!tvShow || !id) return;
    rememberMedia({
      mediaType: 'tv',
      id: Number(id),
      title: tvShow.name,
      posterPath: tvShow.poster_path,
      backdropPath: tvShow.backdrop_path,
      date: tvShow.first_air_date,
      voteAverage: tvShow.vote_average,
      genreIds: tvShow.genres?.map((genre) => genre.id),
      overview: tvShow.overview,
      terms: [
        tvShow.original_name,
        tmdbEnglishName,
        ...alternateTitles.map((entry) => entry.title),
        ...keywords,
        ...(characters?.themes ?? []),
        ...(characters?.groups.flatMap((group) => group.characters.map((item) => item.name)) ?? []),
      ].filter((term): term is string => Boolean(term)),
    });
  }, [tvShow, id, tmdbEnglishName, alternateTitles, keywords, characters]);

  return {
    tvShow, loading, error, certifications, tmdbSeasonsDetails, videos, seasonVideos, autoMultiLangVideos,
    tmdbEnglishName, tmdbAlternativeTitles, looksLikeAnime, cast, crew, recommendations, loadingSimilar,
    characters, charactersLoading, hasCharactersTab, keywords, alternateTitles,
  };
}
