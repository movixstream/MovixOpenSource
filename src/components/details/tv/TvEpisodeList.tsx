import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaColor } from '@/hooks/useMediaColor';
import { cn } from '@/lib/utils';
import { DetailsButton } from '../DetailsButton';
import { sectionNavTint } from '../sectionNavTint';
import { TvEpisodeCard, TvEpisodeRow } from './TvEpisodeCard';
import type { TvEpisodeItem } from './types';

export interface TvEpisodeListProps {
  /** `grid` : cartes à vignette. `list` : lignes (la seule vue sous 768 px). */
  view: 'grid' | 'list';
  episodes: TvEpisodeItem[];
  /** Résumés dépliés, par clé d'épisode. */
  expanded: Record<string, boolean>;
  onExpandedChange: (key: string, expanded: boolean) => void;
  onPlay: (episode: TvEpisodeItem) => void;
  onToggleWatched: (episode: TvEpisodeItem) => void;
  onToggleWatchlist: (episode: TvEpisodeItem) => void;
  /** Épisodes pas encore affichés : une longue saison se rend par tranches. */
  remaining?: number;
  onShowMore?: () => void;
  /** Grande image de la fiche : sa couleur teinte le survol des épisodes. */
  backdropUrl?: string | null;
  className?: string;
}

/**
 * Épisodes d'une saison, en grille ou en liste. Les colonnes de la grille
 * suivent le calcul de `tvEpisodeCardWidth` (`./sizes`) : changer l'un sans
 * l'autre fausse la taille des vignettes demandées.
 *
 * Survol teinté : crochets et plaque prennent la couleur de la grande image,
 * la même que le trait de la barre de sections (`sectionNavTint`), comme la
 * lueur d'ambiance de YouTube. Calculée une fois ici, passée aux épisodes par
 * deux variables CSS ; une image presque grise garde le blanc.
 */
export function TvEpisodeList({
  view, episodes, expanded, onExpandedChange, onPlay, onToggleWatched, onToggleWatchlist, remaining = 0, onShowMore, backdropUrl, className,
}: TvEpisodeListProps) {
  const { t } = useTranslation();
  const Entry = view === 'grid' ? TvEpisodeCard : TvEpisodeRow;
  const compact = episodes.length > 0 && episodes.every((episode) => episode.compact);
  // Mêmes arguments que `DetailsHero` : même calcul, partagé par le cache.
  const palette = useMediaColor('hero', backdropUrl ?? null, Boolean(backdropUrl), true);
  const hoverStyle = useMemo(() => {
    const tint = sectionNavTint(palette?.color);
    if (!tint) return undefined;
    // Plaque : le trait à 12 % d'opacité (suffixe hex `1f`).
    return { '--episode-bracket': tint.line, '--episode-plate': `${tint.line}1f` } as CSSProperties;
  }, [palette?.color]);

  return (
    <div className={className} style={hoverStyle}>
      {/* Cascade des épisodes quand la vue change (DetailsSwap pose `details-reveal`). */}
      <ul
        data-reveal-grid
        className={cn(
          view === 'grid' && (compact
            ? 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3'
            : 'grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-x-5 gap-y-[30px] min-[1700px]:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]'),
        )}
      >
        {episodes.map((episode) => (
          <Entry
            key={episode.key}
            episode={episode}
            expanded={expanded[episode.key]}
            onExpandedChange={(next) => onExpandedChange(episode.key, next)}
            onPlay={() => onPlay(episode)}
            onToggleWatched={() => onToggleWatched(episode)}
            onToggleWatchlist={() => onToggleWatchlist(episode)}
          />
        ))}
      </ul>
      {remaining > 0 && onShowMore && (
        <div className="mt-6 flex justify-center">
          <DetailsButton size="compact" onClick={onShowMore}>
            {t('details.showMoreEpisodes', { count: remaining })}
          </DetailsButton>
        </div>
      )}
    </div>
  );
}

export default TvEpisodeList;
