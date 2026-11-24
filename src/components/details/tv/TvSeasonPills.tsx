import { useTranslation } from 'react-i18next';
import { DetailsSelect } from '../DetailsSelect';
import type { TvSeasonOption } from './types';

export interface TvSeasonPillsProps {
  seasons: TvSeasonOption[];
  /** Numéro de la saison affichée. */
  selected: number | null;
  onSelect: (season: number) => void;
  /** Nom accessible du groupe (« Saisons »). */
  ariaLabel: string;
  className?: string;
}

/**
 * Choix de la saison : un menu déroulant à la largeur de son texte, nom et
 * pastille « N épisodes », quel que soit le nombre de saisons. Une seule
 * hauteur de ligne au-dessus des épisodes, même pour Pokémon ou One Piece,
 * et une recherche (« 22 » → Saison 22) quand la liste est longue.
 */
export function TvSeasonPills({ seasons, selected, onSelect, ariaLabel, className }: TvSeasonPillsProps) {
  const { t } = useTranslation();
  if (seasons.length === 0) return null;
  return (
    <DetailsSelect
      fit
      value={selected === null ? '' : String(selected)}
      options={seasons.map((season) => ({
        value: String(season.number),
        label: season.name,
        count: season.episodeCount,
        countLabel: season.episodeCountLabel,
      }))}
      onChange={(value) => onSelect(Number(value))}
      placeholder={ariaLabel}
      searchLabel={t('details.searchSeason')}
      emptyLabel={t('details.noSeasonFound')}
      searchThreshold={8}
      className={className}
      triggerClassName="h-11"
    />
  );
}

export default TvSeasonPills;
