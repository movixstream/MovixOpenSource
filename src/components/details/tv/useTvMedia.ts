import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { getTmdbLanguage } from '@/i18n';
import type { DetailsImageSet, DetailsTmdbImage } from '../DetailsImagesGallery';
import { sortDetailsVideos, type DetailsVideo } from '../videos';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

/**
 * Images de la série et bande-annonce. La réponse qui donne l'image du haut
 * (le plus grand arrière-plan) sert aussi la galerie « Vidéos et images ».
 */
export function useTvImagesAndTrailer(id: string | null) {
  const [images, setImages] = useState<DetailsImageSet | null>(null);
  const [loadingImages, setLoadingImages] = useState(Boolean(id));
  const [bestBackdrop, setBestBackdrop] = useState<DetailsTmdbImage | null>(null);
  const [trailer, setTrailer] = useState<DetailsVideo | null>(null);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const imagesResponse = await axios.get<DetailsImageSet>(`https://api.themoviedb.org/3/tv/${id}/images`, {
          params: { api_key: TMDB_API_KEY },
        });
        setImages(imagesResponse.data);
        setLoadingImages(false);
        const backdrops = imagesResponse.data.backdrops;
        if (backdrops && backdrops.length > 0) {
          // Copie triée : la galerie garde l'ordre de TMDB.
          setBestBackdrop([...backdrops].sort((a, b) => b.width - a.width)[0]);
        }

        // Bande-annonce dans la langue du site, à défaut en anglais.
        const url = `https://api.themoviedb.org/3/tv/${id}/videos`;
        const localized = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() } });
        let found: DetailsVideo | undefined = sortDetailsVideos<DetailsVideo>(localized.data.results).find((video) => video.type === 'Trailer');
        if (!found) {
          const en = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'en-US' } });
          found = sortDetailsVideos<DetailsVideo>(en.data.results).find((video) => video.type === 'Trailer');
        }
        setTrailer(found ?? null);
      } catch (error) {
        console.error('Error fetching backdrop and trailer:', error);
        setTrailer(null);
        setLoadingImages(false);
      }
    };
    void load();
  }, [id]);

  return { images, loadingImages, bestBackdrop, trailer };
}

/**
 * Vues « toutes langues » des vidéos : celles de la série, et celles de
 * chaque saison. `autoSeasons` : saisons sans vidéo dans la langue du site,
 * dont la vue toutes langues est ouverte d'office.
 */
export function useTvMultiLangVideos(id: string | null, autoSeasons: Record<number, DetailsVideo[]>) {
  const [videos, setVideos] = useState<DetailsVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [seasonVideos, setSeasonVideos] = useState<Record<number, DetailsVideo[]>>({});
  const [seasonLoading, setSeasonLoading] = useState<Record<number, boolean>>({});
  const [seasonShown, setSeasonShown] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const seasons = Object.keys(autoSeasons);
    if (seasons.length === 0) return;
    setSeasonVideos((previous) => ({ ...previous, ...autoSeasons }));
    setSeasonShown((previous) => ({ ...previous, ...Object.fromEntries(seasons.map((season) => [season, true])) }));
  }, [autoSeasons]);

  const toggle = useCallback(() => {
    if (!show && id) {
      setLoading(true);
      axios.get(`https://api.themoviedb.org/3/tv/${id}/videos`, { params: { api_key: TMDB_API_KEY } })
        .then((response) => setVideos(response.data.results || []))
        .catch((error) => {
          console.error('Error fetching multi-language videos:', error);
          setVideos([]);
        })
        .finally(() => setLoading(false));
    }
    setShow(!show);
  }, [id, show]);

  const toggleSeason = useCallback((season: number) => {
    if (!seasonShown[season] && id) {
      setSeasonLoading((previous) => ({ ...previous, [season]: true }));
      axios.get(`https://api.themoviedb.org/3/tv/${id}/season/${season}/videos`, { params: { api_key: TMDB_API_KEY } })
        .then((response) => setSeasonVideos((previous) => ({ ...previous, [season]: response.data.results || [] })))
        .catch((error) => {
          console.error(`Error fetching multi-language videos for season ${season}:`, error);
          setSeasonVideos((previous) => ({ ...previous, [season]: [] }));
        })
        .finally(() => setSeasonLoading((previous) => ({ ...previous, [season]: false })));
    }
    setSeasonShown((previous) => ({ ...previous, [season]: !previous[season] }));
  }, [id, seasonShown]);

  return { videos, loading, show, toggle, seasonVideos, seasonLoading, seasonShown, toggleSeason };
}
