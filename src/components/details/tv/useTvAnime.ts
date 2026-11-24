import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { fetchAnimeByTmdb } from '@/services/animeSamaService';
import { collectTmdbNames, pickBestAnimeMatch, type AnimeSamaCandidate } from '@/utils/animeMatcher';
import {
  getAnimeMatcherForId, getSearchNameForId, searchWithFallback, shouldDefaultAnimeModeToOff,
} from '@/utils/searchUtils';
import type { AnimeData, TVShow } from './tvData';

const MAIN_API = import.meta.env.VITE_MAIN_API;

/** Œuvre Anime-Sama retenue, sans ses saisons vides. */
const withoutEmptySeasons = (anime: AnimeSamaCandidate): AnimeData => ({
  ...(anime as AnimeData),
  seasons: (anime as AnimeData).seasons.filter((season) => season?.episodes?.length > 0),
});

/**
 * Mode anime de la fiche série : l'œuvre Anime-Sama qui correspond à la série
 * et ses saisons, à la place de celles de TMDB. Activé d'office quand la
 * série a le profil d'un anime et qu'une œuvre est trouvée.
 */
export function useTvAnime({ id, tvShow, looksLikeAnime, englishName, alternativeTitles }: {
  id: string | null;
  tvShow: TVShow | null;
  looksLikeAnime: boolean;
  englishName: string | null;
  alternativeTitles: Array<{ iso_3166_1?: string; title?: string }>;
}) {
  const [animeMode, setAnimeMode] = useState(false);
  const [animeData, setAnimeData] = useState<AnimeData | null>(null);
  const [loadingAnimeData, setLoadingAnimeData] = useState(false);

  const loadAnimeData = useCallback(async (): Promise<AnimeData | null> => {
    if (!tvShow?.name) return null;
    setLoadingAnimeData(true);
    try {
      const searchName = getSearchNameForId(tvShow.id || '', tvShow.name);
      const searchFunction = async (term: string): Promise<AnimeSamaCandidate[]> => {
        const response = await axios.get(`${MAIN_API}/anime/search/${encodeURIComponent(term)}?includeSeasons=true&includeEpisodes=true`);
        return response.data || [];
      };

      // D'abord l'œuvre que la fiche d'anime-sama relie à cet ID TMDB : aucun
      // nom à comparer. Les œuvres réglées à la main (getAnimeMatcherForId) et
      // celles sans fiche liée gardent la recherche par nom.
      const specialMatcher = getAnimeMatcherForId(tvShow.id || '');
      const linkedResults = specialMatcher
        ? []
        : (await fetchAnimeByTmdb<AnimeSamaCandidate>('tv', tvShow.id))
          .filter((anime) => Array.isArray(anime.seasons) && anime.seasons.length > 0);
      const results = linkedResults.length > 0
        ? linkedResults
        : await searchWithFallback(searchFunction, searchName, 'TVDetails');

      let bestMatch: AnimeSamaCandidate | null = null;
      if (linkedResults.length > 0) {
        // Trouvée par son ID TMDB : rien à départager.
        bestMatch = linkedResults[0];
      } else if (specialMatcher) {
        bestMatch = results.find((anime) => specialMatcher({ name: anime.name || '', seasons: anime.seasons })) || null;
      } else if (results.length > 0) {
        // Chaque candidat est comparé à tous les noms TMDB (titre localisé,
        // titre anglais, original_name, alternative_titles FR/US/GB/JP).
        const tmdbNames = collectTmdbNames(
          { name: tvShow.name, original_name: tvShow.original_name },
          englishName ? { name: englishName } : null,
          alternativeTitles,
        );
        // Toujours inclure le nom de recherche (cas spéciaux réglés à la main).
        if (searchName && !tmdbNames.includes(searchName)) tmdbNames.push(searchName);
        const { match, score, reason } = pickBestAnimeMatch(results, tmdbNames);
        console.log(match ? `[anime-match] ${reason} score=${score.toFixed(3)} -> ${match.name}` : `[anime-match] ${reason}`);
        bestMatch = match;
      }

      const found = bestMatch && Array.isArray(bestMatch.seasons) && bestMatch.seasons.length > 0
        ? withoutEmptySeasons(bestMatch)
        : null;
      setAnimeData(found);
      return found;
    } catch (error) {
      console.error('Error loading anime data:', error);
      setAnimeData(null);
      return null;
    } finally {
      setLoadingAnimeData(false);
    }
  }, [tvShow, englishName, alternativeTitles]);

  // Profil d'anime : on cherche l'œuvre et on passe en mode anime, sauf pour
  // les séries réglées pour démarrer en mode standard.
  useEffect(() => {
    if (!looksLikeAnime) return;
    let cancelled = false;
    void loadAnimeData().then((found) => {
      if (cancelled) return;
      setAnimeMode(Boolean(found?.seasons?.length) && !shouldDefaultAnimeModeToOff(id || ''));
    });
    return () => { cancelled = true; };
  }, [id, looksLikeAnime, loadAnimeData]);

  /** Active le mode anime (en cherchant l'œuvre au besoin) ; rend `false` si aucune n'est trouvée. */
  const enableAnimeMode = async (): Promise<boolean> => {
    const resolved = animeData || await loadAnimeData();
    if (!resolved?.seasons?.length) return false;
    setAnimeMode(true);
    return true;
  };

  return { animeMode, setAnimeMode, animeData, loadingAnimeData, enableAnimeMode };
}
