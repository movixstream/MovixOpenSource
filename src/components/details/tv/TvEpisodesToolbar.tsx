import type { ReactNode } from 'react';
import { ChevronsUpDown, LayoutGrid, List, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EpisodeListKind } from '@/utils/tvmazeEpisodes';
import { cn } from '@/lib/utils';
import { TvSegmented } from './TvSegmented';
import type { TvEpisodeView } from './types';

export interface TvEpisodesToolbarProps {
  /** Bascule « Liste des saisons : TMDB | Netflix », quand Netflix découpe la série autrement. */
  seasonLayout?: { netflix: boolean; onChange: (netflix: boolean) => void } | null;
  /** Bascule « Liste : TVmaze | TMDB », quand les deux bases ne comptent pas pareil. */
  episodeList?: {
    options: EpisodeListKind[];
    value: EpisodeListKind;
    onChange: (kind: EpisodeListKind) => void;
    /** Info-bulle (« Découpage TVmaze : 21 épisodes au lieu de 10 »). */
    hint?: string;
  } | null;
  /** Bascule « Mode anime | Mode standard » d'une série reconnue comme anime. */
  animeMode?: { active: boolean; loading: boolean; onToggle: () => void } | null;
  /** Vue des épisodes : grille, liste ou menu déroulant. */
  view?: { options: TvEpisodeView[]; value: TvEpisodeView; onChange: (view: TvEpisodeView) => void } | null;
  className?: string;
}

const VIEW_ICONS: Record<TvEpisodeView, LucideIcon> = { grid: LayoutGrid, list: List, dropdown: ChevronsUpDown };
const VIEW_LABELS: Record<TvEpisodeView, string> = {
  grid: 'details.viewGrid',
  list: 'details.viewList',
  dropdown: 'details.viewDropdown',
};
const LIST_LABELS: Record<EpisodeListKind, string> = {
  tmdb: 'details.episodeListTmdb',
  tvmaze: 'details.episodeListTvmaze',
  netflix: 'details.episodeListNetflix',
};

const Group = ({ label, hint, children }: { label?: string; hint?: string; children: ReactNode }) => (
  <div className="flex items-center gap-2.5 md:gap-3" title={hint}>
    {label && <span className={hint ? 'cursor-help' : undefined}>{label}</span>}
    {children}
  </div>
);

export interface TvEpisodeViewSwitchProps {
  options: TvEpisodeView[];
  value: TvEpisodeView;
  onChange: (view: TvEpisodeView) => void;
  className?: string;
}

/** Choix de la vue des épisodes : grille, liste ou menu déroulant, en icônes. */
export function TvEpisodeViewSwitch({ options, value, onChange, className }: TvEpisodeViewSwitchProps) {
  const { t } = useTranslation();
  if (options.length < 2) return null;
  return (
    <TvSegmented
      className={className}
      ariaLabel={t('details.episodesView')}
      value={value}
      onChange={onChange}
      options={options.map((option) => ({ value: option, label: t(VIEW_LABELS[option]), icon: VIEW_ICONS[option] }))}
    />
  );
}

/**
 * Barre d'outils des épisodes : source de la liste, mode anime, vue. Sous
 * 768 px elle ne porte pas la vue : la page pose `TvEpisodeViewSwitch` à côté
 * du résumé de la saison.
 */
export function TvEpisodesToolbar({ seasonLayout, episodeList, animeMode, view, className }: TvEpisodesToolbarProps) {
  const { t } = useTranslation();
  if (!seasonLayout && !episodeList && !animeMode && !view) return null;
  const onlyView = !seasonLayout && !episodeList && !animeMode;

  return (
    <div
      className={cn(
        'flex-wrap items-center justify-between gap-x-3 gap-y-2.5 text-[13px] text-white/60 md:justify-end md:gap-x-4',
        onlyView ? 'hidden md:flex' : 'flex',
        className,
      )}
    >
      {seasonLayout && (
        <Group label={t('details.seasonLayout')}>
          <TvSegmented
            ariaLabel={t('details.seasonLayout')}
            value={seasonLayout.netflix ? 'netflix' : 'tmdb'}
            onChange={(value) => seasonLayout.onChange(value === 'netflix')}
            options={[
              { value: 'tmdb', label: t(LIST_LABELS.tmdb) },
              { value: 'netflix', label: t(LIST_LABELS.netflix) },
            ]}
          />
        </Group>
      )}
      {episodeList && (
        <Group label={t('details.episodeListSource')} hint={episodeList.hint}>
          <TvSegmented
            ariaLabel={t('details.episodeListSource')}
            value={episodeList.value}
            onChange={episodeList.onChange}
            options={episodeList.options.map((kind) => ({ value: kind, label: t(LIST_LABELS[kind]) }))}
          />
        </Group>
      )}
      {animeMode && (
        <Group>
          <TvSegmented
            ariaLabel={t('details.animeModeLabel')}
            value={animeMode.active ? 'anime' : 'standard'}
            onChange={animeMode.onToggle}
            disabled={animeMode.loading}
            tone="accent"
            options={[
              { value: 'anime', label: t('details.animeModeLabel') },
              { value: 'standard', label: t('details.standardMode') },
            ]}
          />
        </Group>
      )}
      {view && <TvEpisodeViewSwitch {...view} className="hidden md:inline-flex" />}
    </div>
  );
}

export default TvEpisodesToolbar;
