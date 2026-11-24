import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import HeroSlider from '../components/HeroSlider';
import EmblaCarousel from '../components/EmblaCarousel';
import CatalogSkeleton from '../components/skeletons/CatalogSkeleton';
import EmblaCarouselGenres from '../components/EmblaCarouselGenres';
import LazySection from '../components/LazySection';
import TelegramPromotion from '../components/TelegramPromotion';
import { useWrappedTracker } from '../hooks/useWrappedTracker';
import { getTmdbLanguage } from '../i18n';
import { getNumericAge } from '../utils/certificationUtils';
import { resolveTmdbKeywordId } from '../utils/tmdbKeywords';
import {
  fetchAnimeCatalogue,
  fetchAnimeHome,
  type AnimeCatalogueItem,
  type AnimeHomePayload,
  type AnimeHomeShow,
} from '../services/animeSamaService';
import { genreSearchHref } from '@/utils/genreSearchLink';
import { pickGenrePosters } from '@/utils/genreTiles';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
const IMMEDIATE_LOAD_COUNT = 2;
const DATA_CACHE_TTL_MS = 15 * 60 * 1000;
const MATURE_ANIME_AGE_THRESHOLD = 17;
const CONTENT_RATING_REGION_PRIORITY = ['FR', 'US', 'JP', 'GB', 'CA'] as const;
const CONTENT_RATING_CACHE_PREFIX = 'movix_anime_content_rating_';
const CONTENT_RATING_CONCURRENCY = 12;
// Rangées tirées du catalogue de la source anime : œuvres demandées au
// catalogue, puis œuvres gardées une fois triées par popularité.
const SITE_ROW_FETCH_LIMIT = 40;
const SITE_ROW_SIZE = 15;
const SITE_ROW_MIN_ITEMS = 5;

type AnimeShow = AnimeHomeShow;

interface Category {
  id: string;
  title: string;
  items: AnimeShow[];
}

const ANIME_GENRE_CONFIG = [
  { id: 16, labelKey: 'genres.id_16', route: genreSearchHref('anime', 16), discoverGenres: '16' },
  { id: 10759, labelKey: 'genres.id_10759', route: genreSearchHref('anime', 10759), discoverGenres: '16,10759' },
  { id: 10765, labelKey: 'genres.id_10765', route: genreSearchHref('anime', 10765), discoverGenres: '16,10765' },
  { id: 35, labelKey: 'genres.id_35', route: genreSearchHref('anime', 35), discoverGenres: '16,35' },
  { id: 18, labelKey: 'genres.id_18', route: genreSearchHref('anime', 18), discoverGenres: '16,18' },
  { id: 9648, labelKey: 'genres.id_9648', route: genreSearchHref('anime', 9648), discoverGenres: '16,9648' },
  { id: 10751, labelKey: 'genres.id_10751', route: genreSearchHref('anime', 10751), discoverGenres: '16,10751' },
  { id: 10762, labelKey: 'genres.id_10762', route: genreSearchHref('anime', 10762), discoverGenres: '16,10762' },
] as const;

const CATEGORY_PRIORITY = [10759, 10765, 35, 18, 9648, 10751, 10762];

const pageStyles = `
@keyframes fadeInTitle {
  0% { opacity: 0; transform: translateY(10px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes expandWidth {
  0% { width: 0; }
  100% { width: 40px; }
}

.section-title {
  font-size: 1.5rem;
  font-weight: 700;
  position: relative;
  background: linear-gradient(90deg, #ffffff, #e2e2e2);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0px 2px 4px rgba(0, 0, 0, 0.3);
  letter-spacing: 0.5px;
  padding-bottom: 0.5rem;
  text-transform: uppercase;
  display: inline-block;
  animation: fadeInTitle 0.8s ease-out forwards;
  transition: all 0.3s ease;
}

.section-title:hover {
  background: linear-gradient(90deg, #ff3333, #ff9999);
  -webkit-background-clip: text;
  background-clip: text;
  transform: translateY(-2px);
  text-shadow: 0px 4px 8px rgba(255, 51, 51, 0.4);
}

.section-title::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 40px;
  height: 3px;
  background: linear-gradient(90deg, #f11 0%, #f66 100%);
  border-radius: 3px;
  animation: expandWidth 0.6s ease-out forwards 0.3s;
  transform-origin: left;
  transition: all 0.3s ease;
}

.section-title:hover::after {
  width: 100%;
  background: linear-gradient(90deg, #ff3333, #ff9999);
}
`;

const uniqueById = (items: AnimeShow[]) =>
  items.filter((item, index, self) => index === self.findIndex((candidate) => candidate.id === item.id));

const isValidAnimeShow = (show: AnimeShow) =>
  Boolean(show?.id && show?.name && show?.poster_path && show?.overview?.trim());

const getAnimeReleaseTimestamp = (show: AnimeShow) => {
  if (!show.first_air_date) {
    return 0;
  }

  const timestamp = new Date(show.first_air_date).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const compareAnimeTitles = (left: AnimeShow, right: AnimeShow) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });

const compareAnimeByPopularity = (left: AnimeShow, right: AnimeShow) => {
  const popularityDiff = (right.popularity ?? 0) - (left.popularity ?? 0);
  if (popularityDiff !== 0) {
    return popularityDiff;
  }

  const voteCountDiff = (right.vote_count ?? 0) - (left.vote_count ?? 0);
  if (voteCountDiff !== 0) {
    return voteCountDiff;
  }

  const ratingDiff = (right.vote_average ?? 0) - (left.vote_average ?? 0);
  if (ratingDiff !== 0) {
    return ratingDiff;
  }

  return compareAnimeTitles(left, right);
};

const compareAnimeByRecent = (left: AnimeShow, right: AnimeShow) => {
  const dateDiff = getAnimeReleaseTimestamp(right) - getAnimeReleaseTimestamp(left);
  if (dateDiff !== 0) {
    return dateDiff;
  }

  return compareAnimeByPopularity(left, right);
};

const buildAnimeDiscoverParams = (
  language: string,
  keywordId: number | null,
  overrides: Record<string, string | number | boolean> = {},
) => ({
  api_key: TMDB_API_KEY,
  language,
  include_adult: false,
  with_genres: '16',
  sort_by: 'popularity.desc',
  'vote_count.gte': 25,
  ...(keywordId ? { with_keywords: String(keywordId) } : {}),
  ...overrides,
});

const getPreferredContentCertification = (contentRatings: Array<{ iso_3166_1?: string; rating?: string }>) => {
  for (const region of CONTENT_RATING_REGION_PRIORITY) {
    const match = contentRatings.find((item) => item.iso_3166_1 === region && item.rating);
    if (match?.rating) {
      return match.rating;
    }
  }

  const fallback = contentRatings.find((item) => item.rating);
  return fallback?.rating || '';
};

const getCachedContentAge = (showId: number) => {
  try {
    const cachedValue = sessionStorage.getItem(`${CONTENT_RATING_CACHE_PREFIX}${showId}`);
    if (!cachedValue) {
      return null;
    }

    const parsedValue = JSON.parse(cachedValue) as { age?: number };
    return typeof parsedValue.age === 'number' ? parsedValue.age : null;
  } catch {
    return null;
  }
};

const setCachedContentAge = (showId: number, age: number) => {
  try {
    sessionStorage.setItem(`${CONTENT_RATING_CACHE_PREFIX}${showId}`, JSON.stringify({ age }));
  } catch {
    // Ignore cache write failures.
  }
};

const getAnimeContentAge = async (showId: number) => {
  const cachedAge = getCachedContentAge(showId);
  if (cachedAge !== null) {
    return cachedAge;
  }

  try {
    const response = await axios.get(`https://api.themoviedb.org/3/tv/${showId}/content_ratings`, {
      params: {
        api_key: TMDB_API_KEY,
      },
    });

    const contentRatings = Array.isArray(response.data?.results) ? response.data.results : [];
    const certification = getPreferredContentCertification(contentRatings);
    const age = certification ? getNumericAge(certification) : 0;
    setCachedContentAge(showId, age);
    return age;
  } catch {
    setCachedContentAge(showId, 0);
    return 0;
  }
};

const filterMatureAnime = async (items: AnimeShow[]) => {
  const results: AnimeShow[] = [];

  for (let index = 0; index < items.length; index += CONTENT_RATING_CONCURRENCY) {
    const chunk = items.slice(index, index + CONTENT_RATING_CONCURRENCY);
    const ages = await Promise.all(chunk.map((item) => getAnimeContentAge(item.id)));

    chunk.forEach((item, chunkIndex) => {
      if (ages[chunkIndex] < MATURE_ANIME_AGE_THRESHOLD) {
        results.push(item);
      }
    });
  }

  return results;
};

interface SiteShows {
  /** En cours de diffusion, lisibles sur le site. */
  airing: AnimeShow[];
  /** Récents, doublés en français. */
  dubbed: AnimeShow[];
}

const NO_SITE_SHOWS: SiteShows = { airing: [], dubbed: [] };

interface TmdbTvDetails {
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  first_air_date?: string;
  genres?: Array<{ id: number }>;
  content_ratings?: { results?: Array<{ iso_3166_1?: string; rating?: string }> };
}

/**
 * Fiche TMDB d'une œuvre du catalogue. Le catalogue dit ce qui est lisible sur
 * le site ; TMDB donne le titre traduit, l'affiche, le synopsis et la
 * classification d'âge. `null` pour une œuvre réservée aux adultes, sans
 * affiche, ou que TMDB ne rend pas.
 */
const fetchSiteShow = async (showId: number, language: string): Promise<AnimeShow | null> => {
  try {
    const { data } = await axios.get<TmdbTvDetails>(`https://api.themoviedb.org/3/tv/${showId}`, {
      params: { api_key: TMDB_API_KEY, language, append_to_response: 'content_ratings' },
    });
    const certification = getPreferredContentCertification(data.content_ratings?.results ?? []);
    const age = certification ? getNumericAge(certification) : 0;
    setCachedContentAge(showId, age);
    if (age >= MATURE_ANIME_AGE_THRESHOLD || !data.name || !data.poster_path) {
      return null;
    }

    return {
      id: showId,
      name: data.name,
      overview: data.overview ?? '',
      poster_path: data.poster_path,
      backdrop_path: data.backdrop_path ?? '',
      vote_average: data.vote_average ?? 0,
      vote_count: data.vote_count,
      popularity: data.popularity,
      first_air_date: data.first_air_date ?? '',
      genre_ids: (data.genres ?? []).map((genre) => genre.id),
      media_type: 'tv',
    };
  } catch {
    return null;
  }
};

/**
 * Rangées du catalogue de la source anime (index tenu par le Main API) : tout
 * ce qui s'y trouve a des épisodes lisibles sur le site. Rangées vides si
 * l'index ne répond pas : la page s'affiche alors sans elles.
 */
const loadSiteShows = async (language: string): Promise<SiteShows> => {
  const [airing, dubbed] = await Promise.all([
    fetchAnimeCatalogue({ type: 'tv', linked: true, status: 'ongoing', sort: 'recent', limit: SITE_ROW_FETCH_LIMIT }),
    fetchAnimeCatalogue({ type: 'tv', linked: true, lang: 'vf', sort: 'recent', limit: SITE_ROW_FETCH_LIMIT }),
  ]);

  const idsOf = (items: AnimeCatalogueItem[]) =>
    items.flatMap((item) => (item.tmdb?.type === 'tv' ? [item.tmdb.id] : []));
  const ids = [...new Set([...idsOf(airing.items), ...idsOf(dubbed.items)])];

  const shows = new Map<number, AnimeShow>();
  for (let index = 0; index < ids.length; index += CONTENT_RATING_CONCURRENCY) {
    const chunk = ids.slice(index, index + CONTENT_RATING_CONCURRENCY);
    const fetched = await Promise.all(chunk.map((showId) => fetchSiteShow(showId, language)));
    fetched.forEach((show) => {
      if (show) {
        shows.set(show.id, show);
      }
    });
  }

  const rowOf = (items: AnimeCatalogueItem[]) =>
    [...new Set(idsOf(items))]
      .flatMap((showId) => shows.get(showId) ?? [])
      .sort(compareAnimeByPopularity)
      .slice(0, SITE_ROW_SIZE);

  return { airing: rowOf(airing.items), dubbed: rowOf(dubbed.items) };
};

/**
 * Repli quand le serveur n'a pas la page (premier calcul en cours, panne) : le
 * navigateur interroge TMDB lui-même, comme le fait le serveur
 * (API/Mainapi/utils/animeHome.js). Les tuiles de genre reprennent les mêmes
 * listes que les rangées, sans nouvelle demande.
 */
const loadAnimeShowsFromTmdb = async (language: string) => {
  const animeKeywordId = await resolveTmdbKeywordId('anime', language);
  const requests: Array<{ genreId: number | null; params: ReturnType<typeof buildAnimeDiscoverParams> }> = [
    ...Array.from({ length: 3 }, (_, index) => ({
      genreId: index === 0 ? 16 : null,
      params: buildAnimeDiscoverParams(language, animeKeywordId, { page: index + 1 }),
    })),
    ...ANIME_GENRE_CONFIG.filter((genre) => genre.id !== 16).map((genre) => ({
      genreId: genre.id,
      params: buildAnimeDiscoverParams(language, animeKeywordId, { page: 1, with_genres: genre.discoverGenres }),
    })),
  ];

  const responses = await Promise.all(
    requests.map(({ params }) => axios.get('https://api.themoviedb.org/3/discover/tv', { params })),
  );
  const resultsOf = responses.map((response) =>
    (Array.isArray(response.data?.results) ? (response.data.results as AnimeShow[]) : [])
      .filter((show) => show?.id && show.poster_path)
      .map((show) => ({ ...show, media_type: 'tv' as const })),
  );

  const candidates = uniqueById(resultsOf.flat());
  const safeIds = new Set((await filterMatureAnime(candidates)).map((show) => show.id));
  const shows = candidates
    .filter((show) => isValidAnimeShow(show) && safeIds.has(show.id))
    .sort(compareAnimeByPopularity);

  const posters = pickGenrePosters(ANIME_GENRE_CONFIG.map((genre) =>
    (resultsOf[requests.findIndex((request) => request.genreId === genre.id)] ?? [])
      .filter((show) => safeIds.has(show.id)),
  ));
  const genrePosters = Object.fromEntries(ANIME_GENRE_CONFIG.map((genre, index) => [genre.id, posters[index]]));

  return { shows, genrePosters };
};

const readHomeCache = (key: string): AnimeHomePayload | null => {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || 'null') as (AnimeHomePayload & { at?: number }) | null;
    if (cached && Date.now() - Number(cached.at) < DATA_CACHE_TTL_MS
      && Array.isArray(cached.shows) && cached.shows.length > 0) {
      return cached;
    }
  } catch {
    // Cache illisible : on recharge.
  }
  return null;
};

const writeHomeCache = (key: string, home: AnimeHomePayload) => {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...home, at: Date.now() }));
  } catch {
    // Ignore cache write failures.
  }
};

const Anime: React.FC = () => {
  const { t, i18n } = useTranslation();
  const tmdbLanguage = getTmdbLanguage();
  const [animeShows, setAnimeShows] = useState<AnimeShow[]>([]);
  const [featuredShows, setFeaturedShows] = useState<AnimeShow[]>([]);
  const [topContent, setTopContent] = useState<AnimeShow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [genreImages, setGenreImages] = useState<Record<number, string[] | undefined>>({});
  const [siteShows, setSiteShows] = useState<SiteShows>(NO_SITE_SHOWS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const homeCacheKey = `movix_anime_home_v1_${tmdbLanguage}`;

  useWrappedTracker({
    mode: 'page',
    pageData: { pageName: 'anime' },
  });

  const getGenreLabel = useCallback((genreId: number) => {
    return t(`genres.id_${genreId}`, { defaultValue: `Genre ${genreId}` });
  }, [t]);

  const genreItems = useMemo(() => {
    return ANIME_GENRE_CONFIG.map((genre) => ({
      id: genre.id,
      name: t(genre.labelKey),
      route: genre.route,
      posters: genreImages[genre.id],
    }));
  }, [genreImages, t]);

  const organizeContentByCategories = useCallback((items: AnimeShow[]) => {
    const filteredItems = uniqueById(items).filter(isValidAnimeShow);
    const genreMap: Record<number, AnimeShow[]> = {};

    filteredItems.forEach((item) => {
      item.genre_ids?.forEach((genreId) => {
        if (genreId === 16) {
          return;
        }

        if (!genreMap[genreId]) {
          genreMap[genreId] = [];
        }

        if (!genreMap[genreId].some((show) => show.id === item.id)) {
          genreMap[genreId].push(item);
        }
      });
    });

    const priorityMap = new Map(CATEGORY_PRIORITY.map((id, index) => [id, index]));
    const rawGenreCategories = Object.entries(genreMap)
      .map(([genreId, genreItems]) => {
        const sortedItems = [...genreItems].sort(compareAnimeByPopularity);
        const priorityIndex = priorityMap.get(Number(genreId));
        const priorityBoost = priorityIndex === undefined ? 0 : (CATEGORY_PRIORITY.length - priorityIndex) * 5;

        return {
          id: genreId,
          title: getGenreLabel(Number(genreId)),
          items: sortedItems.slice(0, 15),
          score: sortedItems.length + priorityBoost,
        };
      })
      .filter((category) => category.items.length >= 3)
      .sort((left, right) => right.score - left.score);

    const usedShowIds = new Set<number>();
    const genreCategories = rawGenreCategories
      .map(({ id, title, items }) => {
        const distinctItems = items
          .filter((item) => !usedShowIds.has(item.id))
          .slice(0, 15);

        distinctItems.forEach((item) => {
          usedShowIds.add(item.id);
        });

        return { id, title, items: distinctItems };
      })
      .filter((category) => category.items.length >= 4)
      .slice(0, 6)
      .map(({ id, title, items }) => ({ id, title, items }));

    const recentShows = filteredItems
      .filter((item) => Boolean(item.first_air_date))
      .sort(compareAnimeByRecent)
      .slice(0, 15);

    const nextCategories: Category[] = [];
    if (recentShows.length >= 5) {
      nextCategories.push({
        id: 'recent-anime',
        title: t('animePage.recentAnime'),
        items: recentShows,
      });
    }

    nextCategories.push(...genreCategories);
    setCategories(nextCategories);
  }, [getGenreLabel, t]);

  const applyShows = useCallback((shows: AnimeShow[]) => {
    setFeaturedShows(shows.filter((show) => show.backdrop_path && show.overview).slice(0, 8));
    setTopContent(shows.slice(0, 15));
    setAnimeShows(shows);
    organizeContentByCategories(shows);
  }, [organizeContentByCategories]);

  // Une seule demande au serveur, qui a déjà interrogé TMDB pour tout le monde.
  // S'il n'a pas encore la page, elle est construite ici depuis TMDB.
  useEffect(() => {
    let cancelled = false;

    const applyHome = (home: AnimeHomePayload) => {
      applyShows(home.shows);
      setGenreImages(home.genrePosters);
      setSiteShows(home.siteRows);
    };

    const load = async () => {
      setLoading(true);
      setError(null);

      const cached = readHomeCache(homeCacheKey);
      if (cached) {
        applyHome(cached);
        setLoading(false);
        return;
      }

      const home = await fetchAnimeHome(tmdbLanguage);
      if (cancelled) {
        return;
      }
      if (home) {
        applyHome(home);
        writeHomeCache(homeCacheKey, home);
        setLoading(false);
        return;
      }

      // Les rangées du catalogue n'attendent pas : la page s'affiche sans elles.
      const siteRowsTask = loadSiteShows(tmdbLanguage);
      try {
        const { shows, genrePosters } = await loadAnimeShowsFromTmdb(tmdbLanguage);
        if (cancelled) {
          return;
        }
        applyShows(shows);
        setGenreImages(genrePosters);
        setLoading(false);

        const siteRows = await siteRowsTask;
        if (cancelled) {
          return;
        }
        setSiteShows(siteRows);
        writeHomeCache(homeCacheKey, { language: tmdbLanguage, updatedAt: Date.now(), shows, genrePosters, siteRows });
      } catch (fetchError) {
        if (cancelled) {
          return;
        }
        console.error('Error fetching anime shows:', fetchError);
        setError(t('home.errorLoadingData'));
        setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [applyShows, homeCacheKey, t, tmdbLanguage]);

  const siteRows = useMemo<Category[]>(() => [
    { id: 'anime-airing-on-site', title: t('animePage.airingOnSite'), items: siteShows.airing },
    { id: 'anime-recent-dubbed', title: t('animePage.recentDubbed'), items: siteShows.dubbed },
  ].filter((row) => row.items.length >= SITE_ROW_MIN_ITEMS), [siteShows, t]);

  useEffect(() => {
    document.title = `${t('animePage.title')} - Movix`;
  }, [i18n.language, t]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="bg-red-600/10 text-red-600 px-6 py-4 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  if (loading && animeShows.length === 0) {
    return (
      <CatalogSkeleton variant="anime" />
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <style>{pageStyles}</style>

      <div className="relative w-full pt-16 md:pt-20 lg:pt-24">
        {featuredShows.length > 0 && (
          <HeroSlider
            items={featuredShows.map((show) => ({ ...show, media_type: 'tv' }))}
            promoPage="anime"
          />
        )}
      </div>

      <div className="w-full bg-black py-6 relative mt-8 z-[20] px-4 md:px-8">
        <EmblaCarouselGenres
          title={<span><span className="text-white mr-2">🧭</span><span>{t('genres.findByGenre')}</span></span>}
          items={genreItems}
        />
      </div>

      <div className="pb-12 -mt-4 relative z-[20]">
        {topContent.length > 0 && (
          <div className="px-4 md:px-8">
            <LazySection index={0} immediateLoadCount={IMMEDIATE_LOAD_COUNT}>
              <EmblaCarousel
                title={<span><span className="text-red-600 mr-2">🔥</span><span>{t('animePage.trending')}</span></span>}
                items={topContent.map((item) => ({
                  ...item,
                  media_type: 'tv',
                  poster_path: item.poster_path || '',
                  backdrop_path: item.backdrop_path || '',
                  overview: item.overview || '',
                }))}
                mediaType="anime-trending"
                showRanking={true}
              />
            </LazySection>
          </div>
        )}

        {[...siteRows, ...categories].map((category, index) => (
          <div key={`wrap-${category.id}`} className="px-4 md:px-8">
            <LazySection key={category.id} index={1 + index} immediateLoadCount={IMMEDIATE_LOAD_COUNT}>
              <EmblaCarousel
                title={category.title}
                items={category.items.map((item) => ({
                  ...item,
                  media_type: 'tv',
                  poster_path: item.poster_path || '',
                  backdrop_path: item.backdrop_path || '',
                  overview: item.overview || '',
                }))}
                mediaType={category.id}
              />
            </LazySection>
          </div>
        ))}

        <TelegramPromotion />
      </div>
    </div>
  );
};

export default Anime;
