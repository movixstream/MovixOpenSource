// Une ligne de l'historique : affiche, titre, type, épisode, avancement et
// date. Le titre est un lien « étiré » (son ::after couvre toute la ligne) :
// la ligne reste cliquable partout sans mettre de bouton dans un lien, et le
// bouton « estimé » passe au-dessus. Plus le squelette de la liste.

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, Play, Tv } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { Skeleton } from '@/components/ui/Skeleton';
import { encodeId } from '@/utils/idEncoder';
import type { HistoryListItem } from '@/services/historyService';
import { EstimatedProgressButton } from './EstimateInfo';
import { episodeCode, episodeProgress, historyRowKey, isLastPlayedDate, progressMeta, watchPath } from './historyFormat';
import HistoryRowActions from './HistoryRowActions';
import { posterUrl } from './storage';
import { rowActions, type MarkAction } from './watchMarks';

function Poster({ item }: { item: HistoryListItem }) {
  const [failed, setFailed] = useState(false);
  const src = posterUrl(item.posterPath, 154);
  return (
    <span className="relative block aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-md bg-white/[0.06] sm:w-14">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-white opacity-40 [&>svg]:h-5 [&>svg]:w-5">
          {item.mediaType === 'tv' ? <Tv /> : <Film />}
        </span>
      )}
    </span>
  );
}

interface HistoryRowProps {
  item: HistoryListItem;
  dateFormat: (iso: string) => string | null;
  /** Ouvre l'explication de « ≈ 47 % · estimé » (une seule bulle par liste). */
  onExplainEstimate: () => void;
  /** Action du menu « ⋯ » (marquer comme vu, retirer de « Vu »). */
  onMark: (item: HistoryListItem, action: MarkAction) => void;
  /** « Supprimer de l'historique » (ouvre la confirmation). */
  onDelete: (item: HistoryListItem) => void;
}

export default function HistoryRow({ item, dateFormat, onExplainEstimate, onMark, onDelete }: HistoryRowProps) {
  const { t, i18n } = useTranslation();
  const isTv = item.mediaType === 'tv';
  const title = item.title || t('profilePage.history.untitled', 'Titre inconnu');
  const code = isTv ? episodeCode(item.season, item.episode) : null;
  const date = dateFormat(item.lastWatchedAt);
  const watchedMark = <span>{t('profilePage.history.watchedMark', 'Vu')}</span>;

  // Série ou animé : avancement de l'épisode affiché, « 54 % » ou « ≈ 54 % · estimé ».
  const current = episodeProgress(item);
  let episodePart: ReactNode = null;
  if (current?.estimated) {
    episodePart = <EstimatedProgressButton percent={current.percent} onClick={onExplainEstimate} className="relative z-10 tabular-nums" />;
  } else if (current) {
    episodePart = (
      <span className="tabular-nums">
        {t('profilePage.history.episodePercent', { percent: current.percent, defaultValue: '{{percent}} %' })}
      </span>
    );
  }

  // Série TMDB : épisodes vus sur le total ; animé : nombre seul ; film : temps.
  const meta = progressMeta(item, i18n.language);
  let progress: ReactNode = null;
  if (meta.kind === 'watched') {
    progress = watchedMark;
  } else if (meta.kind === 'episodes') {
    // Avec le pourcentage de l'épisode juste avant, celui de la série serait ambigu : « 3/33 épisodes ».
    progress = (
      <span className="tabular-nums">
        {current
          ? t('profilePage.history.episodesOfShort', { count: meta.total, watched: meta.watched, defaultValue: '{{watched}}/{{count}} épisodes' })
          : t('profilePage.history.episodesOf', { count: meta.total, watched: meta.watched, percent: meta.percent, defaultValue: '{{watched}}/{{count}} épisodes ({{percent}} %)' })}
      </span>
    );
  } else if (meta.kind === 'count') {
    progress = (
      <span className="tabular-nums">
        {t('profilePage.history.episodesSeen', { count: meta.watched, defaultValue: '{{count}} épisodes vus' })}
      </span>
    );
  } else if (meta.kind === 'estimated') {
    // Au-dessus du lien étiré : ce bouton garde son propre clic.
    progress = <EstimatedProgressButton percent={meta.percent} onClick={onExplainEstimate} className="relative z-10 tabular-nums" />;
  } else if (meta.kind === 'progress') {
    progress = <span className="tabular-nums">{meta.text}</span>;
  }

  return (
    <li className="group relative flex items-center gap-3 py-3 pl-3 pr-1.5 transition-colors duration-150 hover:bg-white/[0.04] has-[a:focus-visible]:bg-white/[0.06] sm:gap-4 sm:pl-4 sm:pr-2">
      <Poster item={item} />
      <div className="min-w-0 flex-1">
        <Link
          to={watchPath(item, encodeId)}
          title={title}
          className={`block truncate text-[15px] font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-white/70 ${item.title ? 'text-white' : 'text-white/60'}`}
        >
          {title}
        </Link>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-white/60">
          <span className="inline-flex items-center gap-1.5">
            {isTv
              ? <Tv className="h-3.5 w-3.5 text-white opacity-60" aria-hidden="true" />
              : <Film className="h-3.5 w-3.5 text-white opacity-60" aria-hidden="true" />}
            {isTv ? t('profilePage.media.series') : t('profilePage.media.movie')}
          </span>
          {code && (
            <>
              <span aria-hidden="true" className="text-white/25">·</span>
              <span className="font-semibold tabular-nums text-red-400">{code}</span>
            </>
          )}
          {episodePart && (
            <>
              <span aria-hidden="true" className="text-white/25">·</span>
              {episodePart}
            </>
          )}
          {progress && (
            <>
              <span aria-hidden="true" className="text-white/25">·</span>
              {progress}
            </>
          )}
        </p>
        {date && (
          <p className="mt-0.5 text-xs text-white/40">
            <time dateTime={item.lastWatchedAt}>
              {isLastPlayedDate(item)
                ? t('profilePage.history.lastWatched', { date, defaultValue: 'Dernière lecture · {{date}}' })
                : date}
            </time>
          </p>
        )}
      </div>
      <Play
        className="hidden h-4 w-4 shrink-0 fill-current text-white opacity-0 transition-opacity duration-150 group-hover:opacity-70 group-has-[a:focus-visible]:opacity-70 sm:block"
        aria-hidden="true"
      />
      <HistoryRowActions
        rowKey={historyRowKey(item)}
        title={title}
        actions={rowActions(item)}
        onAction={(action) => onMark(item, action)}
        onDelete={() => onDelete(item)}
      />
    </li>
  );
}

// Largeurs variées d'une ligne à l'autre : une liste réelle n'a pas des titres tous égaux.
const SKELETON_WIDTHS = [
  { title: '46%', meta: '62%', date: '22%' },
  { title: '34%', meta: '48%', date: '30%' },
  { title: '58%', meta: '70%', date: '18%' },
];

/**
 * Squelette de la liste, avec le composant Skeleton partagé (comme celui du
 * HeroSlider) et la géométrie exacte d'une ligne : mêmes marges, affiche 2:3
 * de même taille, une case par ligne de texte à la hauteur de sa ligne
 * (titre 15 px, méta 13 px, date 12 px), place du « ⋯ ». Rien ne bouge à
 * l'arrivée des données.
 */
export function HistoryRowsSkeleton({ count }: { count: number }) {
  return (
    <ul className="animate-skeleton-fade divide-y divide-white/[0.06] overflow-hidden rounded-xl bg-gray-900 motion-reduce:animate-none" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => {
        const widths = SKELETON_WIDTHS[index % SKELETON_WIDTHS.length];
        return (
          <li key={index} className="flex items-center gap-3 py-3 pl-3 pr-1.5 sm:gap-4 sm:pl-4 sm:pr-2">
            <span className="block w-12 shrink-0 sm:w-14">
              <Skeleton variant="poster" width="100%" className="!rounded-md" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex h-[22.5px] items-center text-[15px]">
                <Skeleton variant="text" width={widths.title} containerClassName="w-full" />
              </div>
              <div className="mt-1 flex h-[19.5px] items-center text-[13px]">
                <Skeleton variant="text" width={widths.meta} containerClassName="w-full" />
              </div>
              <div className="mt-0.5 flex h-4 items-center text-xs">
                <Skeleton variant="text" width={widths.date} containerClassName="w-full" />
              </div>
            </div>
            {/* Place de l'icône de lecture (dès sm) et du bouton « ⋯ » de 40 px. */}
            <span className="hidden h-4 w-4 shrink-0 sm:block" />
            <span className="flex h-10 w-10 shrink-0 items-center justify-center">
              <Skeleton variant="circle" width={20} height={20} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
