// Grande image du dernier titre en cours, avec « Reprendre » qui lance le lecteur.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clapperboard, Play } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { backdropUrl } from './storage';
import { buttonClass } from './ui';
import type { ResumeItem } from './useResumeItem';

export default function ResumePanel({ item, loading }: { item: ResumeItem | null; loading: boolean }) {
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);

  if (loading) {
    return <div className="h-full min-h-[280px] animate-pulse rounded-2xl bg-gray-900" aria-hidden="true" />;
  }

  if (!item) {
    return (
      <section className="flex h-full min-h-[280px] flex-col justify-end gap-4 rounded-2xl bg-gray-900 p-6">
        <Clapperboard className="h-8 w-8 text-red-500" aria-hidden="true" />
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">{t('profilePage.resume.emptyTitle', 'Rien en cours')}</h2>
          <p className="mt-1 max-w-md text-[15px] leading-relaxed text-white/60">
            {t('profilePage.resume.emptyDesc', 'Lance un film ou un épisode : tu pourras le reprendre ici en un clic.')}
          </p>
        </div>
        <Link to="/" className={buttonClass('light', 'md', 'self-start')}>{t('profilePage.emptyStates.exploreCatalog')}</Link>
      </section>
    );
  }

  const image = backdropUrl(item.backdrop, 1280);
  const episodeLine = item.type === 'tv'
    ? t('profilePage.resume.episode', { season: item.season, episode: item.episode, defaultValue: 'Saison {{season}}, épisode {{episode}}' })
    : t('profilePage.media.movie');

  return (
    <section
      aria-label={t('profilePage.resume.label', 'Reprendre')}
      className="relative flex h-full min-h-[280px] flex-col justify-end overflow-hidden rounded-2xl bg-gray-900"
    >
      {image && !imageFailed && (
        <img
          src={image}
          alt=""
          onError={() => setImageFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* Voile neutre pour lire le texte sur la photo */}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />

      <div className="relative p-5 sm:p-6">
        <p className="text-sm text-white/70">{t('profilePage.resume.kicker', 'Tu en étais là')}</p>
        <h2 className="mt-1 line-clamp-2 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">{item.title}</h2>
        <p className="mt-1 text-[15px] text-white/75">{episodeLine}</p>

        {item.progress > 0 && (
          <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress)}>
            <div className="h-full rounded-full bg-red-600" style={{ width: `${item.progress}%` }} />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link to={item.watchPath} className={buttonClass('light', 'md')}>
            <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            {t('profilePage.resume.action', 'Reprendre')}
          </Link>
          <Link to={item.detailsPath} className={buttonClass('secondary', 'md')}>
            {t('profilePage.resume.details', 'Voir la fiche')}
          </Link>
          {item.remainingMinutes !== null && item.remainingMinutes > 0 && (
            <span className="text-sm tabular-nums text-white/70">
              {t('profilePage.resume.remaining', { count: item.remainingMinutes, defaultValue: 'Reste {{count}} min' })}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
