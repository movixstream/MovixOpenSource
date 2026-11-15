// Onglet « Historique » : tout ce que le profil a ouvert ou marqué « Déjà vu »,
// lu sur le serveur (GET /api/history/list). En haut les chiffres, puis trois
// statuts (en cours, terminés, non démarrés), une ligne par titre et la
// pagination. Un clic sur une ligne relance le lecteur, comme le panneau
// « Reprendre ». Un film vu dans un lecteur web affiche « ≈ 47 % · estimé ».
//
// Focus clavier : changer de page le pose sur la liste (le bouton pressé peut
// devenir inactif) ; quand la liste et un message d'échec se remplacent, il
// suit sur la nouvelle vue au lieu de tomber sur <body>.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, CloudOff, EyeOff, History, Hourglass, LogIn, ServerOff } from 'lucide-react';
import { getTmdbLanguage } from '@/i18n';
import { useAgeRestrictedContent } from '@/hooks/useAgeRestrictedContent';
import {
  deleteTitleHistory,
  fetchHistoryList,
  isHistoryDisabled,
  type HistoryListFailure,
  type HistoryListItem,
  type HistoryListResponse,
  type HistoryStatus,
} from '@/services/historyService';
import DeleteTitleDialog from './DeleteTitleDialog';
import { EstimateInfoDialog } from './EstimateInfo';
import HistoryRow, { HistoryRowsSkeleton } from './HistoryRow';
import HistoryStats from './HistoryStats';
import HistoryStatusSwitch from './HistoryStatusSwitch';
import { historyRowKey, pageCount } from './historyFormat';
import { fetchTmdb } from './storage';
import { Button, EmptyState } from './ui';
import {
  applyValues,
  markEpisodes,
  markTitle,
  optimisticUpdate,
  revertOptimistic,
  seasonEpisodes,
  titleCleanup,
  unmarkTitle,
  type EpisodeRef,
  type MarkAction,
  type MarkEffect,
  type StorageChange,
} from './watchMarks';

const PAGE_SIZE = 10;
// Relecture après une marque si la synchro ne prévient pas avant.
const REFETCH_FALLBACK_MS = 3000;
// Événement de synchro trop proche de la marque : il vient d'un envoi parti avant elle.
const SYNC_IGNORE_MS = 1200;
// Import pas fini : une seule relance automatique, le temps qu'il se termine.
const AUTO_RETRY_MS = 4000;
const LIST_ID = 'profile-history-list';
const statusTabId = (status: HistoryStatus) => `profile-history-${status}`;
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black';

type Row = HistoryListItem & { id: number; media_type: 'movie' | 'tv' };
type View = 'list' | 'failure';

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function hasSession(): boolean {
  try {
    return Boolean(localStorage.getItem('auth_token') && localStorage.getItem('selected_profile_id'));
  } catch {
    return false;
  }
}

export default function HistoryTab() {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<HistoryStatus>('in_progress');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryListResponse | null>(null);
  const [failure, setFailure] = useState<HistoryListFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  // Vue affichée et vue à focaliser après le prochain rendu (voir l'en-tête).
  const viewRef = useRef<View>('list');
  const focusAfterRender = useRef<View | null>(null);
  const autoRetried = useRef(false);
  const disabled = isHistoryDisabled();
  const signedIn = hasSession();
  const language = getTmdbLanguage();

  useEffect(() => {
    if (disabled || !signedIn) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchHistoryList({ status, page, pageSize: PAGE_SIZE, language }).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data.items.length === 0) {
        const last = pageCount(result.data.total, PAGE_SIZE);
        if (page > last) {
          // Page vidée entre-temps (titres passés dans un autre statut) : on
          // va sur la dernière page, sans afficher de liste vide trompeuse.
          setPage(last);
          return;
        }
      }
      const nextView: View = result.ok ? 'list' : 'failure';
      if (nextView !== viewRef.current && rootRef.current?.contains(document.activeElement)) {
        focusAfterRender.current = nextView;
      }
      viewRef.current = nextView;
      setLoading(false);
      if (result.ok) {
        setFailure(null);
        setData(result.data);
      } else {
        setFailure(result.reason);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status, page, language, reloadKey, disabled, signedIn]);

  // L'élément focalisé vient de disparaître (liste ↔ message) : le focus suit.
  useEffect(() => {
    const target = focusAfterRender.current;
    if (!target) return;
    focusAfterRender.current = null;
    (target === 'list' ? listRef.current : failureRef.current)?.focus({ preventScroll: true });
  }, [failure, data]);

  // Import pas fini : une relance automatique après quelques secondes. Le
  // drapeau est posé quand elle part (StrictMode rejoue l'effet en dev).
  useEffect(() => {
    if (failure !== 'incomplete' || loading || autoRetried.current) return;
    const timer = window.setTimeout(() => {
      autoRetried.current = true;
      setReloadKey((key) => key + 1);
    }, AUTO_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [failure, loading]);

  const rows = useMemo<Row[]>(
    () => (data?.items ?? []).map((item) => ({ ...item, id: item.tmdbId, media_type: item.mediaType })),
    [data],
  );
  const { items: visible, isFiltering } = useAgeRestrictedContent(rows);

  const dateFormat = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const short = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' });
    const withYear = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
    return (iso: string) => {
      const time = Date.parse(iso);
      if (!Number.isFinite(time)) return null;
      const date = new Date(time);
      return (date.getFullYear() === thisYear ? short : withYear).format(date);
    };
  }, [i18n.language]);

  const changeStatus = useCallback((next: HistoryStatus) => {
    setStatus(next);
    setPage(1);
  }, []);

  const explainEstimate = useCallback(() => setEstimateOpen(true), []);

  // Après une marque : relecture du serveur quand la synchro a envoyé les
  // clés (`sync_storage_updated`), sinon au bout de quelques secondes. Un
  // événement dans les 1,2 s qui suivent vient d'une synchro déjà partie
  // avant la marque : il ramènerait la ligne retirée, on l'ignore.
  const refetchPending = useRef(false);
  const refetchScheduledAt = useRef(0);
  const refetchTimer = useRef<number | undefined>(undefined);
  const refetchNow = useCallback(() => {
    if (!refetchPending.current) return;
    refetchPending.current = false;
    window.clearTimeout(refetchTimer.current);
    setReloadKey((key) => key + 1);
  }, []);
  const scheduleRefetch = useCallback(() => {
    refetchPending.current = true;
    refetchScheduledAt.current = Date.now();
    window.clearTimeout(refetchTimer.current);
    refetchTimer.current = window.setTimeout(refetchNow, REFETCH_FALLBACK_MS);
  }, [refetchNow]);
  useEffect(() => {
    const onSync = () => {
      if (Date.now() - refetchScheduledAt.current < SYNC_IGNORE_MS) return;
      refetchNow();
    };
    window.addEventListener('sync_storage_updated', onSync);
    return () => {
      window.removeEventListener('sync_storage_updated', onSync);
      window.clearTimeout(refetchTimer.current);
    };
  }, [refetchNow]);

  // Vue et lignes affichées, lues après l'attente d'une saison ou au clic sur
  // « Annuler » : on ne touche pas à une autre vue que celle de l'action.
  const viewKey = `${status}:${page}`;
  const viewKeyRef = useRef(viewKey);
  const dataRef = useRef(data);
  const visibleKeysRef = useRef<string[]>([]);
  useEffect(() => {
    viewKeyRef.current = viewKey;
    dataRef.current = data;
    visibleKeysRef.current = visible.map(historyRowKey);
  });

  // Ligne retirée par une marque : le focus passe au « ⋯ » de la ligne
  // suivante, sinon de la précédente, sinon sur la liste.
  const focusAfterMark = useRef<string | null>(null);
  useEffect(() => {
    const target = focusAfterMark.current;
    if (!target) return;
    focusAfterMark.current = null;
    const trigger = target === 'list'
      ? null
      : rootRef.current?.querySelector<HTMLElement>(`[data-history-actions="${target}"]`);
    (trigger ?? listRef.current)?.focus({ preventScroll: true });
  }, [data]);

  const markItem = useCallback(async (item: HistoryListItem, action: MarkAction) => {
    const actionView = viewKeyRef.current;
    const actionStatus = status;
    const original = item;
    const index = dataRef.current?.items.findIndex((entry) => historyRowKey(entry) === historyRowKey(item)) ?? -1;
    const saveError = t('profilePage.header.saveError', 'Impossible d’enregistrer pour l’instant. Réessaie dans un moment.');
    const now = new Date().toISOString();
    const title = { id: item.tmdbId, title: item.title ?? '', posterPath: item.posterPath };
    let change: StorageChange | null = null;
    let effect: MarkEffect | null = null;
    let toastId: string | number | undefined;

    if (action === 'markMovie' || action === 'markSeries') {
      change = markTitle(readLocal, item.mediaType, title, now);
      effect = { finished: true };
    } else if (action === 'unmark') {
      change = unmarkTitle(readLocal, item.mediaType, item.tmdbId);
    } else {
      let episodes: EpisodeRef[] = [];
      if (action === 'markEpisode' && item.season !== null && item.episode !== null) {
        episodes = [{ season: item.season, episode: item.episode }];
      } else if (action === 'markSeason' && item.season !== null) {
        // Liste des épisodes de la saison : peut prendre un moment.
        toastId = toast.loading(t('profilePage.history.actions.loadingSeason', 'Chargement des épisodes de la saison…'));
        episodes = seasonEpisodes(item.season, await fetchTmdb(`/tv/${item.tmdbId}/season/${item.season}`));
        if (episodes.length === 0) {
          toast.error(t('profilePage.history.actions.seasonError', 'Impossible de charger les épisodes de cette saison. Réessaie plus tard.'), { id: toastId });
          return;
        }
      }
      const result = markEpisodes(readLocal, item.tmdbId, episodes);
      change = result.change;
      effect = { episodesAdded: result.added };
    }

    if (!change) {
      toast(action === 'unmark'
        ? t('profilePage.history.actions.notMarked', 'Ce titre n’était pas dans « Vu ».')
        : t('profilePage.history.actions.already', 'Déjà marqué comme vu'), { id: toastId });
      return;
    }
    const applied = change;
    try {
      applyValues(localStorage, applied.after);
    } catch {
      toast.error(saveError, { id: toastId });
      return;
    }

    // Mise à jour immédiate, seulement si la vue n'a pas changé pendant l'attente.
    const markEffect = effect;
    const optimistic = markEffect !== null && viewKeyRef.current === actionView && index >= 0;
    if (optimistic && markEffect) {
      if ('finished' in markEffect && actionStatus !== 'finished') {
        const keys = visibleKeysRef.current;
        const position = keys.indexOf(historyRowKey(item));
        focusAfterMark.current = keys[position + 1] ?? keys[position - 1] ?? 'list';
      }
      setData((current) => (current ? optimisticUpdate(current, actionStatus, item, markEffect) : current));
    }
    scheduleRefetch();

    toast.success(action === 'unmark'
      ? t('profilePage.history.actions.unmarked', 'Retiré de « Vu »')
      : t('profilePage.history.actions.marked', 'Marqué comme vu'), {
      id: toastId,
      action: {
        label: t('profilePage.media.undo', 'Annuler'),
        onClick: () => {
          // Opération inverse sur le stockage du moment : les marques posées
          // depuis (autre action, passe automatique) restent.
          try {
            applyValues(localStorage, applied.undo(readLocal));
          } catch {
            toast.error(saveError);
            return;
          }
          if (optimistic && markEffect && viewKeyRef.current === actionView) {
            setData((current) => (current ? revertOptimistic(current, actionStatus, original, index, markEffect) : current));
          }
          scheduleRefetch();
        },
      },
    });
  }, [status, t, scheduleRefetch]);

  // « Supprimer de l'historique » : confirmation, appel serveur, puis
  // effacement des mêmes clés locales (sinon le navigateur les renverrait).
  // Définitif : pas d'« Annuler ».
  const [pendingDelete, setPendingDelete] = useState<HistoryListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Ligne visée par la dernière confirmation et issue, lues à la fermeture du dialogue.
  const deleteTarget = useRef<HistoryListItem | null>(null);
  const deleteSucceeded = useRef(false);

  const openDelete = (item: HistoryListItem) => {
    deleteTarget.current = item;
    deleteSucceeded.current = false;
    setPendingDelete(item);
  };

  const cancelDelete = () => {
    if (!deleting) setPendingDelete(null);
  };

  // Fermeture du dialogue (Radix) : ligne supprimée → le focus va à la ligne
  // voisine (effet focusAfterMark) ; sinon il revient sur le « ⋯ » de la
  // ligne, le menu qui a ouvert le dialogue n'existant plus.
  const handleDeleteCloseFocus = (event: Event) => {
    event.preventDefault();
    if (deleteSucceeded.current) return;
    const target = deleteTarget.current;
    const trigger = target
      ? rootRef.current?.querySelector<HTMLElement>(`[data-history-actions="${historyRowKey(target)}"]`)
      : null;
    (trigger ?? listRef.current)?.focus({ preventScroll: true });
  };

  const confirmDelete = async () => {
    const item = pendingDelete;
    if (!item || deleting) return;
    const actionView = viewKeyRef.current;
    const actionStatus = status;
    setDeleting(true);
    const ok = await deleteTitleHistory(item.mediaType, item.tmdbId);
    setDeleting(false);
    setPendingDelete(null);
    if (!ok) {
      toast.error(t('profilePage.history.delete.error', 'Impossible de supprimer ce titre pour l’instant. Réessaie dans un moment.'));
      return;
    }
    deleteSucceeded.current = true;
    try {
      applyValues(localStorage, titleCleanup(Object.keys(localStorage), readLocal, item.mediaType, item.tmdbId));
    } catch {
      // Stockage inaccessible : le serveur a déjà tout effacé, la relecture suit.
    }
    if (viewKeyRef.current === actionView) {
      const keys = visibleKeysRef.current;
      const position = keys.indexOf(historyRowKey(item));
      focusAfterMark.current = keys[position + 1] ?? keys[position - 1] ?? 'list';
      setData((current) => (current ? optimisticUpdate(current, actionStatus, item, { removed: true }) : current));
    }
    scheduleRefetch();
    toast.success(t('profilePage.history.delete.done', 'Supprimé de l’historique'));
  };

  const pages = data ? pageCount(data.total, PAGE_SIZE) : 1;

  const goToPage = (next: number) => {
    // Pendant un chargement les boutons restent focalisables (aria-disabled) : clic ignoré.
    if (loading || next < 1 || next > pages || next === page) return;
    setPage(next);
    const list = listRef.current;
    if (!list) return;
    // Le bouton pressé peut devenir inactif (première ou dernière page) : le
    // focus passe sur la liste au lieu de tomber sur <body>.
    list.focus({ preventScroll: true });
    // Le bouton est en bas de la liste : on remonte au début de la nouvelle page.
    if (list.getBoundingClientRect().top < 0) {
      list.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  };

  const retry = () => {
    if (!loading) setReloadKey((key) => key + 1);
  };

  if (disabled) {
    return (
      <EmptyState
        icon={<EyeOff />}
        title={t('profilePage.history.disabledTitle', 'Historique désactivé')}
        description={t('profilePage.history.disabledDesc', 'Tu as coupé l’historique dans les réglages : rien n’est enregistré pour ce profil.')}
        action={{ label: t('profilePage.history.openSettings', 'Ouvrir les réglages'), to: '/settings' }}
      />
    );
  }

  if (!signedIn) {
    return (
      <EmptyState
        icon={<LogIn />}
        title={t('profilePage.history.guestTitle', 'Connecte-toi pour garder ton historique')}
        description={t('profilePage.history.guestDesc', 'L’historique complet est enregistré sur ton compte, pour chaque profil. Il n’existe pas en mode invité.')}
        action={{ label: t('profilePage.auth.login'), to: '/create-account' }}
      />
    );
  }

  const retryAction = { label: t('profilePage.history.retry', 'Réessayer'), onClick: retry, pending: loading };
  const failures: Record<HistoryListFailure, { icon: ReactNode; title: string; description: string; action: { label: string; to?: string; onClick?: () => void; pending?: boolean } }> = {
    unauthenticated: {
      icon: <LogIn />,
      title: t('profilePage.history.sessionTitle', 'Session expirée'),
      description: t('profilePage.history.sessionDesc', 'Ta connexion a expiré ou ce profil n’est plus lié à ton compte. Reconnecte-toi pour retrouver ton historique.'),
      action: { label: t('profilePage.auth.login'), to: '/create-account' },
    },
    network: {
      icon: <CloudOff />,
      title: t('profilePage.history.networkTitle', 'Serveur injoignable'),
      description: t('profilePage.history.networkDesc', 'Le serveur ne répond pas. Vérifie ta connexion puis réessaie.'),
      action: retryAction,
    },
    unavailable: {
      icon: <ServerOff />,
      title: t('profilePage.history.unavailableTitle', 'Historique indisponible'),
      description: t('profilePage.history.unavailableDesc', 'L’historique ne peut pas être chargé pour le moment. Réessaie un peu plus tard.'),
      action: retryAction,
    },
    incomplete: {
      icon: <Hourglass />,
      title: t('profilePage.history.importingTitle', 'Import de ton historique en cours'),
      description: t('profilePage.history.importingDesc', 'On recopie ce que tu as regardé sur cet appareil. Ça prend quelques secondes.'),
      action: retryAction,
    },
  };

  const showSkeleton = !data || (isFiltering && visible.length === 0);
  const busy = loading || isFiltering;
  const emptyText: Record<HistoryStatus, { title: string; description: string }> = {
    in_progress: {
      title: t('profilePage.history.empty.inProgressTitle', 'Rien en cours'),
      description: t('profilePage.history.empty.inProgressDesc', 'Lance un film ou un épisode : il apparaîtra ici tant que tu ne l’as pas fini.'),
    },
    finished: {
      title: t('profilePage.history.empty.finishedTitle', 'Aucun titre terminé'),
      description: t('profilePage.history.empty.finishedDesc', 'Les films et séries que tu finis ou marques « Déjà vu » arrivent ici.'),
    },
    not_started: {
      title: t('profilePage.history.empty.notStartedTitle', 'Aucun titre en attente'),
      description: t('profilePage.history.empty.notStartedDesc', 'Les titres ouverts mais à peine commencés arrivent ici.'),
    },
  };

  return (
    <div ref={rootRef}>
      {failure ? (
        <div ref={failureRef} tabIndex={-1} className={`rounded-xl ${FOCUS_RING}`}>
          <EmptyState {...failures[failure]} />
        </div>
      ) : (
        <div className="space-y-5">
          <HistoryStats data={data} />
          <HistoryStatusSwitch
            active={status}
            counts={data?.counts ?? null}
            onChange={changeStatus}
            panelId={LIST_ID}
            tabId={statusTabId}
          />

          <div
            ref={listRef}
            id={LIST_ID}
            role="tabpanel"
            tabIndex={-1}
            aria-labelledby={statusTabId(status)}
            aria-busy={busy}
            className={`scroll-mt-24 rounded-xl ${FOCUS_RING}`}
          >
            {showSkeleton ? (
              <HistoryRowsSkeleton count={6} />
            ) : visible.length === 0 ? (
              busy ? <HistoryRowsSkeleton count={6} /> : <EmptyState icon={<History />} {...emptyText[status]} />
            ) : (
              <ul
                className={`divide-y divide-white/[0.06] overflow-hidden rounded-xl bg-gray-900 transition-opacity duration-150 ${busy ? 'opacity-60' : 'opacity-100'}`}
              >
                {visible.map((item) => (
                  <HistoryRow
                    key={`${item.mediaType}-${item.tmdbId}`}
                    item={item}
                    dateFormat={dateFormat}
                    onExplainEstimate={explainEstimate}
                    onMark={(target, action) => void markItem(target, action)}
                    onDelete={openDelete}
                  />
                ))}
              </ul>
            )}
          </div>

          {pages > 1 && (
            <nav className="flex items-center justify-between gap-3" aria-label={t('profilePage.history.pagination', 'Pages de l’historique')}>
              <Button size="sm" onClick={() => goToPage(page - 1)} disabled={page <= 1} aria-disabled={loading || undefined}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                {t('profilePage.history.previous', 'Précédent')}
              </Button>
              <span className="text-sm tabular-nums text-white/60" aria-live="polite">
                {t('profilePage.history.pageOf', { page, pages, defaultValue: '{{page}} / {{pages}}' })}
              </span>
              <Button size="sm" onClick={() => goToPage(page + 1)} disabled={page >= pages} aria-disabled={loading || undefined}>
                {t('profilePage.history.next', 'Suivant')}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </nav>
          )}
        </div>
      )}

      <EstimateInfoDialog open={estimateOpen} onOpenChange={setEstimateOpen} />
      <DeleteTitleDialog
        open={pendingDelete !== null}
        busy={deleting}
        title={pendingDelete?.title || deleteTarget.current?.title || t('profilePage.history.untitled', 'Titre inconnu')}
        onCancel={cancelDelete}
        onConfirm={() => void confirmDelete()}
        onCloseAutoFocus={handleDeleteCloseFocus}
      />
    </div>
  );
}
