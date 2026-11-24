import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { TMDB_API_KEY } from '@/config/config';
import { getTmdbLanguage } from '@/i18n';
import { mergePersonCredits, type PersonCredit, type PersonCreditInput } from './personCredits';

/** Fiche TMDB d'une personne (`/person/:id`), avec ce que la page lit. */
export interface PersonProfile {
  id: number;
  name: string;
  profile_path: string | null;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  known_for_department: string | null;
  /** 0 inconnu, 1 femme, 2 homme, 3 non binaire. */
  gender: number;
  also_known_as: string[];
  imdb_id: string | null;
}

export interface PersonExternalIds {
  imdb_id?: string | null;
  instagram_id?: string | null;
  twitter_id?: string | null;
  facebook_id?: string | null;
  tiktok_id?: string | null;
}

export interface PersonDetailsState {
  person: PersonProfile | null;
  /** Vrai quand la biographie vient de l'anglais, faute de traduction. */
  biographyInEnglish: boolean;
  credits: PersonCredit[];
  externalIds: PersonExternalIds;
  loading: boolean;
  /** `notFound` : identifiant inconnu de TMDB ; `failed` : réseau ou serveur. */
  error: 'notFound' | 'failed' | null;
}

interface PersonResponse extends PersonProfile {
  combined_credits?: { cast?: PersonCreditInput[]; crew?: PersonCreditInput[] };
  external_ids?: PersonExternalIds;
}

const EMPTY: PersonDetailsState = {
  person: null, biographyInEnglish: false, credits: [], externalIds: {}, loading: true, error: null,
};

/**
 * Fiche, filmographie et liens d'une personne, en une requête
 * (`append_to_response`). Comme les fiches film et série : sans biographie
 * dans la langue du site, le texte anglais de TMDB.
 */
export function usePersonDetails(rawId: string | undefined): PersonDetailsState {
  const id = rawId && /^\d+$/.test(rawId) ? Number(rawId) : null;
  const [state, setState] = useState<PersonDetailsState & { id: number | null }>({ ...EMPTY, id });

  useEffect(() => {
    if (id === null) {
      setState({ ...EMPTY, id, loading: false, error: 'notFound' });
      return;
    }
    let cancelled = false;
    // Autre personne (lien depuis « Connu pour ») : rien de la précédente.
    setState({ ...EMPTY, id });
    const language = getTmdbLanguage();
    const load = async () => {
      try {
        const { data } = await axios.get<PersonResponse>(`https://api.themoviedb.org/3/person/${id}`, {
          params: { api_key: TMDB_API_KEY, language, append_to_response: 'combined_credits,external_ids' },
        });
        let biography = data.biography?.trim() ?? '';
        let biographyInEnglish = false;
        if (!biography && !language.startsWith('en')) {
          try {
            const en = await axios.get<PersonProfile>(`https://api.themoviedb.org/3/person/${id}`, {
              params: { api_key: TMDB_API_KEY, language: 'en-US' },
            });
            biography = en.data?.biography?.trim() ?? '';
            biographyInEnglish = biography !== '';
          } catch { /* la biographie reste vide */ }
        }
        if (cancelled) return;
        setState({
          id,
          person: {
            id: data.id,
            name: data.name,
            profile_path: data.profile_path ?? null,
            biography,
            birthday: data.birthday ?? null,
            deathday: data.deathday ?? null,
            place_of_birth: data.place_of_birth ?? null,
            known_for_department: data.known_for_department ?? null,
            gender: Number.isInteger(data.gender) ? data.gender : 0,
            also_known_as: Array.isArray(data.also_known_as) ? data.also_known_as : [],
            imdb_id: data.imdb_id ?? null,
          },
          biographyInEnglish,
          credits: mergePersonCredits(data.combined_credits?.cast, data.combined_credits?.crew),
          externalIds: data.external_ids ?? {},
          loading: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        console.error('Error fetching person data:', error);
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        setState({ ...EMPTY, id, loading: false, error: status === 404 ? 'notFound' : 'failed' });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [id]);

  // Pendant le rendu qui suit un changement d'identifiant : l'état de chargement, jamais l'ancienne fiche.
  return useMemo(() => (state.id === id ? state : { ...EMPTY, id }), [state, id]);
}
