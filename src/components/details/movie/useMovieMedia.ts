import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { getTmdbLanguage } from '@/i18n';
import type { DetailsImageSet } from '../DetailsImagesGallery';
import { sortDetailsVideos, type DetailsVideo } from '../videos';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

export interface MovieCollection {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts: Array<{
    id: number;
    title: string;
    poster_path: string | null;
    release_date: string;
    vote_average: number;
    overview?: string;
  }>;
}

/**
 * Vidéos du film (dans la langue du site, à défaut en anglais) et bande-annonce.
 * Chargées dès l'arrivée : le bouton « Bande-annonce » en dépend.
 */
export function useMovieVideos(id: string | null) {
  const [videos, setVideos] = useState<DetailsVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [trailerVideoId, setTrailerVideoId] = useState<string | null>(null);
  // Toutes langues confondues, demandées à la première bascule.
  const [multiLangVideos, setMultiLangVideos] = useState<DetailsVideo[]>([]);
  const [loadingMultiLangVideos, setLoadingMultiLangVideos] = useState(false);
  const [showMultiLang, setShowMultiLang] = useState(false);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoadingVideos(true);
      try {
        const url = `https://api.themoviedb.org/3/movie/${id}/videos`;
        const response = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() } });
        let fetched: DetailsVideo[] = response.data.results;
        if (fetched.length === 0) {
          const en = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'en-US' } });
          fetched = en.data.results;
        }
        setVideos(fetched);
        // La bande-annonce officielle la plus nette et la plus récente.
        setTrailerVideoId(sortDetailsVideos(fetched).find((video) => video.type === 'Trailer')?.key ?? null);
      } catch (error) {
        console.error('Error fetching videos:', error);
        setTrailerVideoId(null);
      } finally {
        setLoadingVideos(false);
      }
    };
    void load();
  }, [id]);

  const toggleMultiLang = useCallback(() => {
    if (!showMultiLang && id) {
      setLoadingMultiLangVideos(true);
      axios.get(`https://api.themoviedb.org/3/movie/${id}/videos`, { params: { api_key: TMDB_API_KEY } })
        .then((response) => setMultiLangVideos(response.data.results || []))
        .catch((error) => {
          console.error('Error fetching multi-language videos:', error);
          setMultiLangVideos([]);
        })
        .finally(() => setLoadingMultiLangVideos(false));
    }
    setShowMultiLang(!showMultiLang);
  }, [id, showMultiLang]);

  return {
    videos, loadingVideos, trailerVideoId,
    multiLangVideos, loadingMultiLangVideos, showMultiLang, toggleMultiLang,
  };
}

/** Galerie d'images du film, chargée une fois à la demande. */
export function useMovieImages(id: string | null) {
  const [images, setImages] = useState<DetailsImageSet | null>(null);
  const [loadingImages, setLoadingImages] = useState(false);
  const requestedRef = useRef(false);

  const loadImages = useCallback(() => {
    if (!id || requestedRef.current) return;
    requestedRef.current = true;
    setLoadingImages(true);
    axios.get(`https://api.themoviedb.org/3/movie/${id}/images`, { params: { api_key: TMDB_API_KEY } })
      .then((response) => setImages(response.data))
      .catch((error) => {
        console.error('Error fetching movie images:', error);
        // Nouvel essai au prochain dépliage.
        requestedRef.current = false;
      })
      .finally(() => setLoadingImages(false));
  }, [id]);

  return { images, loadingImages, loadImages };
}

/** Films de la saga, avec le résumé de chacun, chargés quand `enabled` passe à vrai. */
export function useMovieCollection(collectionId: number | null, enabled: boolean) {
  const [collection, setCollection] = useState<MovieCollection | null>(null);
  const [loading, setLoading] = useState(false);
  // Saga introuvable : le bandeau garde son titre et son lien, sans affiches en attente.
  const [failed, setFailed] = useState(false);
  const requestedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || collectionId === null || requestedRef.current === collectionId) return;
    requestedRef.current = collectionId;
    const load = async () => {
      setLoading(true);
      try {
        const params = { api_key: TMDB_API_KEY, language: getTmdbLanguage() };
        const response = await axios.get<MovieCollection>(`https://api.themoviedb.org/3/collection/${collectionId}`, { params });
        const withDetails = { ...response.data };
        if (withDetails.parts && withDetails.parts.length > 0) {
          withDetails.parts = await Promise.all(withDetails.parts.map(async (part) => {
            try {
              const details = await axios.get(`https://api.themoviedb.org/3/movie/${part.id}`, { params });
              return { ...part, overview: details.data.overview };
            } catch (error) {
              console.error(`Error fetching details for movie ${part.id}:`, error);
              return part;
            }
          }));
        }
        setCollection(withDetails);
      } catch (error) {
        console.error('Error fetching collection:', error);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [enabled, collectionId]);

  return {
    parts: collection && collection.id === collectionId ? collection.parts : null,
    loading: loading || (collection === null && !failed),
  };
}
