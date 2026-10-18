// Bande des cinq chiffres de l'historique : en cours, terminés, temps
// visionné, films vus, épisodes vus. Grille 3 + 2 sur téléphone, une ligne
// de cinq au-delà ; pulsation à la place des nombres pendant le chargement.
// « Visionné » montre en grand le temps réel passé dans le lecteur (comme
// Wrapped) et en petit la somme des positions, avec une bulle qui explique
// la différence.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { HistoryListResponse } from '@/services/historyService';
import { watchedFigures } from './historyFormat';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from './ui';

function WatchedTimeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-0 bg-gray-900 backdrop-blur-none">
        <DialogHeader>
          <DialogTitle>{t('profilePage.history.watchedInfo.title', 'Deux façons de compter')}</DialogTitle>
          <DialogDescription className="pt-2 text-[15px] leading-relaxed text-white/70">
            {t('profilePage.history.watchedInfo.tracked', 'Le grand chiffre est le temps réellement passé dans le lecteur.')}
          </DialogDescription>
        </DialogHeader>
        <p className="text-[15px] leading-relaxed text-white/80">
          {t('profilePage.history.watchedInfo.positions', 'Le petit additionne l’endroit où tu t’es arrêté dans chaque film et épisode : il grimpe quand tu avances dans la vidéo ou reprends ailleurs, et ne compte pas les revisionnages.')}
        </p>
        <div className="flex justify-end">
          <Button variant="light" onClick={() => onOpenChange(false)}>{t('profilePage.history.watchedInfo.ok', 'Compris')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function HistoryStats({ data }: { data: HistoryListResponse | null }) {
  const { t, i18n } = useTranslation();
  const [infoOpen, setInfoOpen] = useState(false);
  const watched = data ? watchedFigures(data.stats, i18n.language) : null;
  const stats = [
    { key: 'inProgress', label: t('profilePage.history.stats.inProgress', 'En cours'), value: data ? String(data.counts.inProgress) : null, accent: true },
    { key: 'finished', label: t('profilePage.history.stats.finished', 'Terminés'), value: data ? String(data.counts.finished) : null },
    { key: 'watched', label: t('profilePage.history.stats.watched', 'Visionné'), value: watched?.main ?? null },
    { key: 'movies', label: t('profilePage.history.stats.movies', 'Films vus'), value: data ? String(data.stats.moviesFinished) : null },
    { key: 'episodes', label: t('profilePage.history.stats.episodes', 'Épisodes vus'), value: data ? String(data.stats.episodesFinished) : null },
  ];
  return (
    <>
      <dl className="grid grid-cols-3 gap-y-4 rounded-xl bg-gray-900 px-2 py-4 sm:grid-cols-5 sm:px-0">
        {stats.map((stat, index) => (
          <div
            key={stat.key}
            className={`flex min-w-0 flex-col items-center gap-1 px-2 text-center ${index > 0 ? 'sm:border-l sm:border-white/[0.08]' : ''}`}
          >
            <dt className="order-2 truncate text-[13px] text-white/55">{stat.label}</dt>
            <dd className={`order-1 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl ${stat.accent ? 'text-red-400' : 'text-white'}`}>
              {/* Chargement : case du Skeleton partagé dans la hauteur de ligne du chiffre. */}
              {stat.value ?? <Skeleton inline width={44} className="!h-[0.8em] animate-skeleton-fade motion-reduce:animate-none" />}
            </dd>
            {stat.key === 'watched' && !data && (
              // Place de la ligne « … d'après tes positions », gardée pendant le chargement.
              <dd className="order-3 flex h-4 w-full items-center justify-center" aria-hidden="true">
                <Skeleton variant="text" width="70%" containerClassName="flex w-full justify-center" className="!h-[11px]" />
              </dd>
            )}
            {stat.key === 'watched' && watched?.fromPositions && (
              // Ligne secondaire : peut passer à la ligne sous le chiffre sur téléphone.
              <dd className="order-3 max-w-full text-[11px] leading-snug text-white/40">
                <span className="tabular-nums">
                  {t('profilePage.history.stats.fromPositions', { time: watched.fromPositions, defaultValue: '{{time}} d’après tes positions' })}
                </span>
                <button
                  type="button"
                  onClick={() => setInfoOpen(true)}
                  aria-haspopup="dialog"
                  aria-label={t('profilePage.history.watchedInfo.open', 'Comment ce temps est compté')}
                  title={t('profilePage.history.watchedInfo.open', 'Comment ce temps est compté')}
                  className="-my-2 ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full align-middle transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 [&_svg]:opacity-60 hover:[&_svg]:opacity-100"
                >
                  <Info className="h-3.5 w-3.5 text-white" aria-hidden="true" />
                </button>
              </dd>
            )}
          </div>
        ))}
      </dl>
      <WatchedTimeDialog open={infoOpen} onOpenChange={setInfoOpen} />
    </>
  );
}
