import axios from 'axios';

export interface MediaColorExampleDetails {
  title: string;
  overview: string;
  vote_average: number;
  release_date: string;
}

const requests = new Map<string, Promise<MediaColorExampleDetails>>();

/** Share the same localized film details across algorithm previews. */
export function getMediaColorExampleDetails(id: number, language: string): Promise<MediaColorExampleDetails> {
  const key = `${id}:${language}`;
  const cached = requests.get(key);
  if (cached) return cached;

  const request = axios.get<MediaColorExampleDetails>(`https://api.themoviedb.org/3/movie/${id}`, {
    params: { api_key: import.meta.env.VITE_TMDB_API_KEY || '', language },
    timeout: 10000,
  }).then(({ data }) => ({
    title: data.title,
    overview: data.overview,
    vote_average: data.vote_average,
    release_date: data.release_date,
  })).catch((error: unknown) => {
    requests.delete(key);
    throw error;
  });

  requests.set(key, request);
  return request;
}
