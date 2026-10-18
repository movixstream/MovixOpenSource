// Onglet « Mes alertes » : épisodes à venir pour lesquels l'utilisateur veut
// être prévenu. Les données viennent d'AlertService (localStorage).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Calendar, Clock, Pencil, Trash2 } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import CustomDropdown from '@/components/CustomDropdown';
import { AlertService } from '@/services/alertService';
import type { EpisodeAlert, NotifyBeforeDays } from '@/types/alerts';
import { Button, EmptyState, IconButton } from './ui';

type AirStatus = 'passed' | 'today' | 'soon' | 'upcoming';

const STATUS_PILL: Record<AirStatus, string> = {
  today: 'bg-red-600 text-white',
  soon: 'bg-white text-black',
  upcoming: 'bg-white/10 text-white/80',
  passed: 'bg-white/5 text-white/45',
};

const NOTIFY_CHOICES: NotifyBeforeDays[] = [0, 1, 2, 3, 4, 5, 6, 7];
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

function loadSortedAlerts(): EpisodeAlert[] {
  return Object.values(AlertService.getAllAlerts()).sort(
    (a, b) => new Date(a.airDate).getTime() - new Date(b.airDate).getTime(),
  );
}

interface AlertsTabProps {
  onCountChange?: (count: number) => void;
}

export default function AlertsTab({ onCountChange }: AlertsTabProps) {
  const { t, i18n } = useTranslation();
  // Lues au montage : elles ont pu changer depuis une page série.
  const [alerts, setAlerts] = useState<EpisodeAlert[]>(() => loadSortedAlerts());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<NotifyBeforeDays>(1);

  useEffect(() => {
    onCountChange?.(alerts.length);
  }, [alerts.length, onCountChange]);

  const getNotificationText = useCallback(
    (days: NotifyBeforeDays) =>
      days === 0 ? t('profilePage.notifications.sameDay') : t('profilePage.notifications.daysBefore', { count: days }),
    [t],
  );

  const notifyOptions = useMemo(
    () => NOTIFY_CHOICES.map((days) => ({ value: String(days), label: getNotificationText(days) })),
    [getNotificationText],
  );

  /** Écart en jours calendaires (et non en tranches de 24 h depuis maintenant). */
  const describeAirDate = (dateString: string): { text: string; status: AirStatus; daysText: string } => {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return { text: dateString, status: 'upcoming', daysText: '' };
    }
    const diffDays = Math.round((startOfDay(date) - startOfDay(new Date())) / DAY_MS);
    const text = date.toLocaleDateString(i18n.language, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    if (diffDays < 0) return { text, status: 'passed', daysText: t('profilePage.dates.alreadyReleased') };
    if (diffDays === 0) return { text, status: 'today', daysText: t('profilePage.dates.today') };
    if (diffDays === 1) return { text, status: 'soon', daysText: t('profilePage.dates.tomorrow') };
    return { text, status: 'upcoming', daysText: t('profilePage.dates.inDays', { count: diffDays }) };
  };

  const startEdit = (alert: EpisodeAlert) => {
    setEditingId(alert.id);
    setSelectedDays(alert.notifyBeforeDays);
  };

  const saveEdit = (alert: EpisodeAlert) => {
    if (AlertService.updateAlert(alert.showId, alert.season, alert.episode, selectedDays)) {
      setAlerts((prev) => prev.map((item) => (item.id === alert.id ? { ...item, notifyBeforeDays: selectedDays } : item)));
      setEditingId(null);
    }
  };

  const deleteAlert = (alertId: string) => {
    if (AlertService.removeAlert(alertId)) {
      setAlerts((prev) => prev.filter((item) => item.id !== alertId));
      if (editingId === alertId) setEditingId(null);
    }
  };

  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={<Bell aria-hidden="true" />}
        title={t('profilePage.alerts.noAlerts')}
        description={t('profilePage.emptyStates.noAlertsDesc')}
        action={{ label: t('profilePage.alerts.browseSeries'), to: '/tv-shows' }}
      />
    );
  }

  return (
    <ul className="space-y-2">
      {alerts.map((alert) => {
        const air = describeAirDate(alert.airDate);
        const isEditing = editingId === alert.id;

        return (
          <li key={alert.id} className="rounded-xl bg-gray-900 p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                {/* Série et épisode */}
                <div className="min-w-0">
                  <Link
                    to={`/tv/${alert.showId}`}
                    className="text-base font-semibold text-white transition-colors hover:text-red-400 focus-visible:outline-none focus-visible:underline"
                  >
                    {alert.showName}
                  </Link>
                  <p className="mt-0.5 text-[15px] text-white/60 tabular-nums">
                    {t('profilePage.alerts.seasonEpisodeLine', {
                      season: alert.season,
                      episode: alert.episode,
                      defaultValue: 'Saison {{season}}, épisode {{episode}}',
                    })}
                    {alert.episodeName ? ` – ${alert.episodeName}` : ''}
                  </p>
                </div>

                {/* Date de sortie et statut */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-white/60">
                  <span className="inline-flex items-center gap-2">
                    <Calendar className="h-4 w-4 shrink-0 text-white opacity-45" aria-hidden="true" />
                    <span>
                      {t('profilePage.alerts.releasesOn')}{' '}
                      <span className="text-white/85 tabular-nums">{air.text}</span>
                    </span>
                  </span>
                  {air.daysText && (
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums ${STATUS_PILL[air.status]}`}>
                      {air.daysText}
                    </span>
                  )}
                </div>

                {/* Réglage du rappel */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[15px] text-white/60">
                  <Clock className="h-4 w-4 shrink-0 text-white opacity-45" aria-hidden="true" />
                  <span>{t('profilePage.alerts.alertLabelSpaced', 'Alerte :')}</span>
                  {isEditing ? (
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                      <CustomDropdown
                        options={notifyOptions}
                        value={String(selectedDays)}
                        onChange={(value) => setSelectedDays(Number(value) as NotifyBeforeDays)}
                        className="min-w-[160px]"
                        position="bottom"
                      />
                      <Button variant="primary" size="sm" onClick={() => saveEdit(alert)}>
                        {t('profilePage.alerts.save')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                        {t('profilePage.alerts.cancel')}
                      </Button>
                    </div>
                  ) : (
                    <span className="font-medium text-white">{getNotificationText(alert.notifyBeforeDays)}</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              {!isEditing && (
                <div className="flex shrink-0 gap-2">
                  <IconButton tone="light" label={t('profilePage.alerts.editAlert')} onClick={() => startEdit(alert)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    tone="light"
                    label={t('profilePage.alerts.deleteAlert')}
                    onClick={() => deleteAlert(alert.id)}
                    className="hover:!bg-red-600 hover:!text-white"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
