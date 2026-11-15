// Onglet « Sessions » : appareils connectés au compte (OAuth et BIP39 seulement).
// Onglet caché, accessible par lien direct (?tab=sessions).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { LogOut, Monitor, Smartphone, Tablet, Tv } from 'lucide-react';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { broadcastAuthChange, clearStoredAuthSession, getResolvedAccountContext } from '@/utils/accountAuth';
import {
  getSessionBrowserLabel,
  normalizeSessionDeviceInfo,
  type SessionDeviceInfo,
  type SessionDeviceType,
} from '@/utils/sessionDevice';
import { Button, EmptyState, Spinner } from './ui';

const API_URL = import.meta.env.VITE_MAIN_API;

interface UserSession {
  id: string;
  userId: string;
  createdAt: string;
  accessedAt: string;
  userAgent: string;
  deviceInfo?: SessionDeviceInfo;
}

const isUnauthorized = (error: unknown) => axios.isAxiosError(error) && error.response?.status === 401;

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` });

/** Seuls les comptes Discord, Google (oauth) et BIP39 ont des sessions serveur. */
function hasServerSessions(): boolean {
  const account = getResolvedAccountContext();
  return Boolean(account.userType && account.userId && ['oauth', 'bip39'].includes(account.userType));
}

/** Déconnexion locale complète, comme les autres chemins de sortie du site. */
function logoutEverywhere(clearSessionStorage: boolean) {
  try {
    clearStoredAuthSession();
    broadcastAuthChange();
  } catch { /* rien à faire */ }
  if (clearSessionStorage) {
    try { sessionStorage.clear(); } catch { /* rien à faire */ }
  }
  window.location.href = '/';
}

function DeviceIcon({ type }: { type: SessionDeviceType }) {
  const className = 'h-5 w-5';
  if (type === 'mobile') return <Smartphone className={className} aria-hidden="true" />;
  if (type === 'tablet') return <Tablet className={className} aria-hidden="true" />;
  if (type === 'tv') return <Tv className={className} aria-hidden="true" />;
  return <Monitor className={className} aria-hidden="true" />;
}

export default function SessionsTab() {
  const { t, i18n } = useTranslation();
  const available = useMemo(() => hasServerSessions(), []);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(available);
  const [pending, setPending] = useState<UserSession | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!hasServerSessions()) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/api/sessions`, { headers: authHeaders() });
      const items: UserSession[] = Array.isArray(response.data?.data?.items) ? response.data.data.items : [];
      setSessions(items);
      // L'identifiant local sert à repérer « Session actuelle ».
      setCurrentSessionId(localStorage.getItem('session_id'));
    } catch (error) {
      if (isUnauthorized(error)) {
        logoutEverywhere(true);
        return;
      }
      console.error('Erreur lors du chargement des sessions :', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const deleteSession = async (sessionId: string) => {
    if (!hasServerSessions()) return;
    setDeleting(true);
    try {
      const response = await axios.post(`${API_URL}/api/sessions/delete`, { sessionId }, { headers: authHeaders() });
      if (response.data?.success) {
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
        // Fermer la session en cours revient à se déconnecter.
        if (sessionId === currentSessionId) logoutEverywhere(false);
      }
    } catch (error) {
      if (isUnauthorized(error)) {
        logoutEverywhere(true);
        return;
      }
      console.error('Erreur lors de la suppression de la session :', error);
    } finally {
      setDeleting(false);
      setPending(null);
    }
  };

  const formatRelative = (dateString: string) => {
    const date = new Date(dateString);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('profilePage.sessions.justNow');
    if (diffMins < 60) return t('profilePage.sessions.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('profilePage.sessions.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('profilePage.sessions.daysAgo', { count: diffDays });
    return date.toLocaleDateString(i18n.language);
  };

  const deviceLabel = (session: UserSession) =>
    getSessionBrowserLabel(
      normalizeSessionDeviceInfo(session.deviceInfo),
      t('profilePage.sessions.browser'),
      t('settings.sessionDeviceTypes.tv'),
    );

  if (!available) {
    return (
      <EmptyState
        icon={<Monitor aria-hidden="true" />}
        title={t('profilePage.sessions_ui.notAvailable')}
        description={t('profilePage.sessions_ui.notAvailableDesc')}
      />
    );
  }

  if (loading) return <Spinner />;

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<Monitor aria-hidden="true" />}
        title={t('profilePage.sessions_ui.noActiveSessions')}
        description={t('profilePage.sessions_ui.noActiveSessionsDesc')}
      />
    );
  }

  // La session en cours d'abord, puis la plus récemment utilisée.
  const ordered = [...sessions].sort((a, b) => {
    if (a.id === currentSessionId) return -1;
    if (b.id === currentSessionId) return 1;
    return new Date(b.accessedAt).getTime() - new Date(a.accessedAt).getTime();
  });

  return (
    <>
      <ul className="space-y-2">
        {ordered.map((session) => {
          const isCurrent = session.id === currentSessionId;
          const device = normalizeSessionDeviceInfo(session.deviceInfo);
          const details = [device.operatingSystem, t(`settings.sessionDeviceTypes.${device.deviceType}`)]
            .filter(Boolean)
            .join(' · ');
          const created = new Date(session.createdAt);

          return (
            <li key={session.id} className="rounded-xl bg-gray-900 p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                      isCurrent ? 'bg-red-600/15 text-red-400' : 'bg-white/[0.06] text-white [&_svg]:opacity-70'
                    }`}
                  >
                    <DeviceIcon type={device.deviceType} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 break-words text-base font-semibold text-white">{deviceLabel(session)}</h3>
                      {isCurrent && (
                        <span className="inline-flex items-center rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-medium text-white">
                          {t('profilePage.sessions.currentSession')}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5 text-[15px] text-white/60">
                      {details && <p>{details}</p>}
                      <p className="tabular-nums">
                        {t('profilePage.sessions.createdOn', {
                          date: created.toLocaleDateString(i18n.language),
                          time: created.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }),
                        })}
                      </p>
                      <p className="tabular-nums">
                        {t('profilePage.sessions.lastActivitySpaced', {
                          time: formatRelative(session.accessedAt),
                          defaultValue: 'Dernière activité : {{time}}',
                        })}
                      </p>
                    </div>
                  </div>
                </div>

                {!isCurrent && (
                  <Button
                    variant="danger"
                    size="sm"
                    className="self-start sm:self-center"
                    onClick={() => setPending(session)}
                    aria-label={t('profilePage.sessions.disconnectSession')}
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {t('profilePage.sessions.disconnect', 'Déconnecter')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        isOpen={pending !== null}
        title={t('profilePage.sessions.confirmTitle', 'Déconnecter cette session ?')}
        message={t('profilePage.sessions.confirmMessage', {
          device: pending ? deviceLabel(pending) : '',
          defaultValue: 'L’appareil « {{device}} » devra se reconnecter pour accéder à votre compte.',
        })}
        confirmLabel={t('profilePage.sessions.disconnect', 'Déconnecter')}
        cancelLabel={t('profilePage.alerts.cancel')}
        variant="destructive"
        busy={deleting}
        onConfirm={() => {
          if (pending) void deleteSession(pending.id);
        }}
        onCancel={() => {
          if (!deleting) setPending(null);
        }}
      />
    </>
  );
}
