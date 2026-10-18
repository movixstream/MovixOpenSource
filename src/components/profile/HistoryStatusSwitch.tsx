// Sélecteur de statut de l'historique (En cours / Terminés / Non démarrés).
// Sur téléphone, trois segments de même largeur qui tiennent dans 343 px
// (375 moins les marges) : libellé au-dessus, compteur en dessous, libellé
// qui passe à la ligne plutôt que d'être coupé. Dès `sm`, pilules en ligne.
// Clavier : flèches en boucle, Début et Fin (motif ARIA « tabs »).

import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';
import type { HistoryListResponse, HistoryStatus } from '@/services/historyService';
import { Skeleton } from '@/components/ui/Skeleton';
import { nextTabIndex } from './tabNavigation';

const STATUSES: HistoryStatus[] = ['in_progress', 'finished', 'not_started'];

interface HistoryStatusSwitchProps {
  active: HistoryStatus;
  counts: HistoryListResponse['counts'] | null;
  onChange: (status: HistoryStatus) => void;
  /** id de la liste contrôlée (aria-controls). */
  panelId: string;
  /** id de chaque onglet (la liste s'en sert pour aria-labelledby). */
  tabId: (status: HistoryStatus) => string;
}

export default function HistoryStatusSwitch({ active, counts, onChange, panelId, tabId }: HistoryStatusSwitchProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const labels: Record<HistoryStatus, string> = {
    in_progress: t('profilePage.history.status.inProgress', 'En cours'),
    finished: t('profilePage.history.status.finished', 'Terminés'),
    not_started: t('profilePage.history.status.notStarted', 'Non démarrés'),
  };
  const countOf: Record<HistoryStatus, number | undefined> = {
    in_progress: counts?.inProgress,
    finished: counts?.finished,
    not_started: counts?.notStarted,
  };

  const handleKeyDown = (event: KeyboardEvent, index: number) => {
    const next = nextTabIndex(event.key, index, STATUSES.length);
    if (next < 0) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    onChange(STATUSES[next]);
  };

  return (
    <div
      role="tablist"
      aria-label={t('profilePage.history.statusLabel', 'Statut')}
      className="grid w-full grid-cols-3 gap-1 rounded-2xl bg-gray-900 p-1 sm:inline-flex sm:w-auto sm:rounded-full"
    >
      {STATUSES.map((status, index) => {
        const selected = status === active;
        const count = countOf[status];
        return (
          <button
            key={status}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            id={tabId(status)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(status)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-[13px] font-medium leading-tight transition-[color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-9 sm:flex-row sm:gap-2 sm:rounded-full sm:px-4 sm:py-0 sm:text-sm ${selected ? 'text-white' : 'text-white/55 hover:text-white'}`}
          >
            {selected && (
              <motion.span
                layoutId="profile-history-status"
                transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }}
                className="absolute inset-0 rounded-xl bg-white/10 sm:rounded-full"
                aria-hidden="true"
              />
            )}
            <span className="relative max-w-full break-words text-center sm:whitespace-nowrap">{labels[status]}</span>
            {typeof count === 'number' ? (
              <span className={`relative min-w-[1.5rem] rounded-full px-1.5 text-center text-[11px] tabular-nums leading-4 sm:text-xs sm:leading-5 ${selected ? 'bg-red-600 text-white' : 'bg-white/[0.08] text-white/55'}`}>
                {count}
              </span>
            ) : (
              // Place du compteur gardée pendant le chargement (Skeleton partagé) : pas de saut à son arrivée.
              <Skeleton variant="pill" width={24} containerClassName="relative" className="!h-4 sm:!h-5" />
            )}
          </button>
        );
      })}
    </div>
  );
}
