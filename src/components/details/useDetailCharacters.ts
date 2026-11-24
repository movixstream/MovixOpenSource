import { useEffect, useState } from 'react';
import { loadDetailCharacters, type DetailCharacters } from '@/services/detailCharacters';

type DetailCast = Parameters<typeof loadDetailCharacters>[0]['cast'];

interface CharacterSource {
  /** `false` tant que la fiche n'est pas chargée : rien n'est demandé. */
  ready: boolean;
  looksLikeAnime: boolean;
  /** Titres proposés à AniList, du plus prometteur au moins. */
  anilistTitles: Array<string | null | undefined>;
  cast: DetailCast;
}

/**
 * Les personnages de la fiche. AniList est tentée quand l'œuvre a le profil
 * d'un anime — elle rend les personnages eux-mêmes, là où TMDB ne rend que
 * des comédiens — et le générique TMDB prend le relais sinon, ou si AniList
 * ne connaît pas l'œuvre.
 *
 * Le bloc Personnages n'existe que pour ce qu'AniList apporte (`hasCharactersTab`) :
 * sur une œuvre qu'elle ne connaît pas, la Distribution dit déjà la même chose
 * dans l'autre sens. Les cartes restent construites : elles nourrissent le
 * catalogue de recherche (voir `utils/mediaSearchIndex.ts`).
 */
export function useDetailCharacters({ ready, looksLikeAnime, anilistTitles, cast }: CharacterSource) {
  const [characters, setCharacters] = useState<DetailCharacters | null>(null);
  const [loading, setLoading] = useState(false);
  // Les titres arrivent dans un tableau neuf à chaque rendu : la recherche ne
  // repart que si leur texte change.
  const titlesKey = JSON.stringify(anilistTitles.filter((title): title is string => Boolean(title)));

  useEffect(() => {
    if (!ready) return;
    let stale = false;
    setLoading(true);

    void loadDetailCharacters({
      looksLikeAnime,
      anilistTitles: JSON.parse(titlesKey) as string[],
      cast,
    })
      .then((result) => { if (!stale) setCharacters(result); })
      .catch(() => { if (!stale) setCharacters(null); })
      .finally(() => { if (!stale) setLoading(false); });

    return () => { stale = true; };
  }, [ready, looksLikeAnime, titlesKey, cast]);

  const hasCharactersTab = characters?.source === 'anilist' && characters.total > 0;
  return { characters, charactersLoading: loading, hasCharactersTab };
}
