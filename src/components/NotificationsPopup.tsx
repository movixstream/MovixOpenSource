import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, BellRing, Check, X, Trash2 } from 'lucide-react';
import * as apiNotificationService from '../services/apiNotificationService';
import { ApiNotification, Notification } from '../services/apiNotificationService';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isPushSupported, isSubscribed, subscribeToPush, hasDismissedPermanently, hasDismissedPushBanner, dismissPushBanner, dismissPushBannerPermanently, getPushPermission } from '../services/pushNotificationService';
import { HoverHighlight, HoverHighlightItem } from './ui/hover-highlight';
import { LiquidButton } from './ui/liquid-button';

/* ─── Contenu du menu des notifications ──────────────────────────────────────
   Le contenant vient de l'en-tête : sur ordinateur, le liquide qui coule de
   la cloche (LiquidDropdown, variante « panel » : la liste défile dans le
   menu) ; sur mobile, le panneau plein écran (LiquidSheet, variante
   « sheet » : tout défile avec le panneau). Plus de bleu : un point rouge
   marque les notifications non lues, les actions d'une ligne n'apparaissent
   qu'à son survol (toujours visibles au toucher). */

// Dernière liste affichée, gardée d'une ouverture à l'autre : le menu s'ouvre
// directement sur elle, puis la met à jour. Sans elle, le squelette laissait
// place à la liste en pleine ouverture du panneau (rendu de vingt lignes au
// milieu de l'animation, contenu qui saute).
interface ListCache {
  owner: string;
  notifications: Notification[];
  apiNotifications: ApiNotification[];
  hasMore: boolean;
  page: number;
}
let listCache: ListCache | null = null;
const readListCache = () => {
  const owner = apiNotificationService.getNotificationsOwnerKey();
  return owner && listCache?.owner === owner ? listCache : null;
};

// Bannière push : son état est connu de la dernière ouverture, elle ne
// s'insère plus au-dessus de la liste déjà affichée.
let pushBannerCache: boolean | null = null;

interface NotificationsPopupProps {
  onClose: () => void;
  onNotificationUpdate?: () => void;
  variant?: 'panel' | 'sheet';
}

// Petites actions d'une ligne et de l'en-tête : couleur pleine sur le bouton,
// opacité sur l'icône seule (une couleur translucide éclaircirait les
// croisements de ses tracés).
const ACTION_CLASS = 'group/action flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white outline-none transition-colors duration-150 hover:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-white/30';
const ACTION_ICON_CLASS = 'opacity-45 transition-opacity duration-150 group-hover/action:opacity-100';
const TEXT_BUTTON_CLASS = 'rounded-lg px-2 py-1.5 text-xs outline-none transition-colors duration-150 hover:bg-white/[0.06] focus-visible:ring-1 focus-visible:ring-white/30';

const NotificationAvatar: React.FC<{ src?: string | null; name?: string }> = ({ src, name }) => {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    // Même fond que le repli : pas de rond vide avant que l'image arrive.
    return <img src={src} alt="" width={36} height={36} decoding="async" className="h-9 w-9 shrink-0 rounded-full bg-white/[0.08] object-cover" onError={() => setFailed(true)} />;
  }
  return (
    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-sm font-medium text-white/80">
      {(name || '?').charAt(0).toUpperCase()}
    </span>
  );
};

const NotificationsPopup: React.FC<NotificationsPopupProps> = ({ onClose, onNotificationUpdate, variant = 'panel' }) => {
  const { t } = useTranslation();
  const [cached] = useState(readListCache);
  const [notifications, setNotifications] = useState<Notification[]>(() => cached?.notifications ?? []);
  const [apiNotifications, setApiNotifications] = useState<ApiNotification[]>(() => cached?.apiNotifications ?? []);
  const [loading, setLoading] = useState(!cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => cached?.page ?? 1);
  const [hasMore, setHasMore] = useState(() => cached?.hasMore ?? true);
  const [showPushBanner, setShowPushBannerState] = useState(() => pushBannerCache === true);
  const setShowPushBanner = useCallback((show: boolean) => {
    pushBannerCache = show;
    setShowPushBannerState(show);
  }, []);
  const [pushSubscribing, setPushSubscribing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const isPanel = variant === 'panel';

  // Vérifier si on doit afficher la bannière push
  useEffect(() => {
    if (!isPushSupported() || hasDismissedPermanently() || hasDismissedPushBanner() || getPushPermission() === 'denied') {
      setShowPushBanner(false);
      return;
    }
    isSubscribed().then((subscribed) => {
      if (!subscribed && getPushPermission() === 'granted') {
        // Permission déjà accordée mais subscription perdue (update SW) — re-souscrire silencieusement
        subscribeToPush().then(() => setShowPushBanner(false));
      } else {
        setShowPushBanner(!subscribed);
      }
    });
  }, [setShowPushBanner]);

  const handleEnablePush = async () => {
    setPushSubscribing(true);
    const success = await subscribeToPush();
    setPushSubscribing(false);
    if (success) {
      setShowPushBanner(false);
    }
  };

  const handleDismissPushLater = () => {
    dismissPushBanner();
    setShowPushBanner(false);
  };

  const handleDismissPushPermanently = () => {
    dismissPushBannerPermanently();
    setShowPushBanner(false);
  };

  useEffect(() => {
    // Avec la liste de la dernière ouverture déjà affichée, la mise à jour se
    // fait sans repasser par le squelette.
    const fetchNotifications = async () => {
      try {
        const { notifications: userNotifications, apiNotifications: apiNotifs, hasMore: more } = await apiNotificationService.getUserNotificationsWithApiData(1, 20);
        setNotifications(userNotifications);
        setApiNotifications(apiNotifs);
        setHasMore(more);
        setCurrentPage(1);
      } catch (error) {
        console.error('Error fetching notifications:', error);
      }

      setLoading(false);
    };

    fetchNotifications();

    // La fermeture lors du clic extérieur est gérée par le Header
    // Pas besoin de gérer ça ici pour éviter les conflits
  }, []);

  // La liste du moment devient celle de la prochaine ouverture.
  useEffect(() => {
    if (loading) return;
    const owner = apiNotificationService.getNotificationsOwnerKey();
    listCache = owner ? { owner, notifications, apiNotifications, hasMore, page: currentPage } : null;
  }, [loading, notifications, apiNotifications, hasMore, currentPage]);

  const loadMoreNotifications = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    setLoadingMore(true);
    const nextPage = currentPage + 1;

    try {
      const { notifications: newNotifications, apiNotifications: newApiNotifs, hasMore: more } = await apiNotificationService.getUserNotificationsWithApiData(nextPage, 20);

      setNotifications(prev => [...prev, ...newNotifications]);
      setApiNotifications(prev => [...prev, ...newApiNotifs]);
      setHasMore(more);
      setCurrentPage(nextPage);
    } catch (error) {
      console.error('Error loading more notifications:', error);
    }

    setLoadingMore(false);
  }, [loadingMore, hasMore, currentPage]);

  // La suite se charge quand le bas de la liste approche. Un repère observé
  // plutôt qu'un écouteur de défilement : sur ordinateur la liste défile dans
  // le menu, sur mobile avec tout le panneau.
  const loadMoreRef = useRef(loadMoreNotifications);
  loadMoreRef.current = loadMoreNotifications;
  const watchEnd = !loading && hasMore && notifications.length > 0;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!watchEnd || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreRef.current();
    }, {
      // Sur mobile, la liste défile dans la zone du panneau, pas dans la
      // fenêtre : sans elle, la marge de 160 px ne servait à rien.
      root: isPanel ? scrollRef.current : sentinel.closest<HTMLElement>('[data-lenis-prevent]'),
      rootMargin: '0px 0px 160px 0px',
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [watchEnd, isPanel]);

  const handleMarkAsRead = async (notification: Notification) => {
    const success = await apiNotificationService.markNotificationAsRead(notification.id);

    if (success) {
      // Mettre à jour l'état local pour les deux listes
      setNotifications(prevNotifications =>
        prevNotifications.map(n =>
          n.id === notification.id ? { ...n, read: true } : n
        )
      );
      setApiNotifications(prevApiNotifications =>
        prevApiNotifications.map(n =>
          n.id.toString() === notification.id ? { ...n, is_read: 1 } : n
        )
      );
      // Mettre à jour le compteur dans le Header
      if (onNotificationUpdate) {
        onNotificationUpdate();
      }
    }
  };

  const handleMarkAllAsRead = async () => {
    const success = await apiNotificationService.markAllNotificationsAsRead();

    if (success) {
      // Mettre à jour l'état local pour les deux listes
      setNotifications(prevNotifications =>
        prevNotifications.map(n => ({ ...n, read: true }))
      );
      setApiNotifications(prevApiNotifications =>
        prevApiNotifications.map(n => ({ ...n, is_read: 1 }))
      );
      // Mettre à jour le compteur dans le Header
      if (onNotificationUpdate) {
        onNotificationUpdate();
      }
    }
  };

  const handleNavigateToContent = async (notification: Notification) => {
    const apiNotif = apiNotifications.find(n => n.id.toString() === notification.id);

    if (apiNotif?.notification_type.startsWith('report')) {
      await handleMarkAsRead(notification);
      return;
    }

    // Marquer comme lu
    await handleMarkAsRead(notification);

    // Récupérer les détails du contenu depuis la notification API
    const contentDetails = apiNotificationService.getContentDetailsFromNotification(apiNotif);

    if (contentDetails) {
      // Naviguer vers la page du film ou de la série
      const { contentId, contentType } = contentDetails;
      const path = contentType === 'movie' ? `/movie/${contentId}` : `/tv/${contentId}`;

      // Ne pas fermer la popup, laisser l'utilisateur continuer à interagir
      // La popup se fermera automatiquement lors de la navigation (via l'effet dans Header.tsx)

      // Naviguer vers la page du contenu
      navigate(path);
    }
  };

  const handleDeleteNotification = async (notification: Notification, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const success = await apiNotificationService.deleteNotification(notification.id);

    if (success) {
      // Mettre à jour l'état local en supprimant la notification des deux listes
      setNotifications(prevNotifications =>
        prevNotifications.filter(n => n.id !== notification.id)
      );
      setApiNotifications(prevApiNotifications =>
        prevApiNotifications.filter(n => n.id.toString() !== notification.id)
      );
      // Mettre à jour le compteur dans le Header (si la notification était non lue, le compteur diminue)
      if (onNotificationUpdate) {
        onNotificationUpdate();
      }
    }
  };

  const formatNotificationDate = (date: Date) => {
    // Formatage relatif: aujourd'hui, hier, ou date complète
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date >= today) {
      return `${t('notifications.today')} ${format(date, 'HH:mm', { locale: fr })}`;
    } else if (date >= yesterday) {
      return `${t('notifications.yesterday')} ${format(date, 'HH:mm', { locale: fr })}`;
    } else {
      return format(date, 'dd/MM/yyyy HH:mm', { locale: fr });
    }
  };

  const getNotificationMessage = (notification: Notification) => {
    const name = <span className="font-medium text-white">{notification.fromUsername}</span>;
    const quote = <span className="italic text-white/70">"{notification.content}"</span>;
    switch (notification.type) {
      case 'reply':
        return <span>{name} {t('notifications.repliedToComment')}: {quote}</span>;
      case 'like':
      case 'reaction':
        return <span>{name} {t('notifications.likedComment')}</span>;
      case 'mention':
        return <span>{name} {t('notifications.mentionedYou')}</span>;
      case 'new_comment':
        return <span>{name} {t('notifications.newCommentOnFollowed')}: {quote}</span>;
      case 'report_resolved_deleted':
        return <span>{name} {t('notifications.reportResolvedWithDeletion')}</span>;
      case 'report_resolved':
        return <span>{name} {t('notifications.reportResolved')}</span>;
      case 'report_dismissed':
        return <span>{name} {t('notifications.reportDismissed')}</span>;
      default:
        return <span>{t('notifications.newNotification')}</span>;
    }
  };

  const renderRow = (notification: Notification) => (
    <div className={cn(
      'group flex items-start gap-3 rounded-xl px-3 py-3',
      !isPanel && '[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/[0.05]',
    )}>
      {/* Non lue : un point rouge, la couleur du site. */}
      <span aria-hidden="true" className={cn('mt-[15px] h-1.5 w-1.5 shrink-0 rounded-full', notification.read ? 'bg-transparent' : 'bg-red-500')} />
      <NotificationAvatar src={notification.fromAvatar} name={notification.fromUsername} />
      <button
        type="button"
        onClick={() => handleNavigateToContent(notification)}
        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-1 focus-visible:ring-white/25"
      >
        <span className={cn('block text-[13.5px] leading-snug', notification.read ? 'text-white/60' : 'text-white/90')}>
          {getNotificationMessage(notification)}
        </span>
        <span className="mt-1 block text-xs text-white/40">{formatNotificationDate(notification.createdAt)}</span>
      </button>
      {/* Avec une souris, les actions n'apparaissent qu'au survol de la
          ligne (ou au clavier) ; au toucher, elles restent visibles. */}
      <div className="-mr-1 flex shrink-0 items-center transition-opacity duration-150 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:opacity-100">
        {!notification.read && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleMarkAsRead(notification);
            }}
            className={ACTION_CLASS}
            aria-label={t('notifications.markAsRead')}
            title={t('notifications.markAsRead')}
          >
            <Check size={15} aria-hidden="true" className={ACTION_ICON_CLASS} />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => handleDeleteNotification(notification, e)}
          className={cn(ACTION_CLASS, 'hover:bg-red-500/10 hover:text-red-400')}
          aria-label={t('notifications.deleteNotification')}
          title={t('notifications.deleteNotification')}
        >
          <Trash2 size={15} aria-hidden="true" className={ACTION_ICON_CLASS} />
        </button>
      </div>
    </div>
  );

  const hasUnread = notifications.some(n => !n.read);

  return (
    <div data-notifications-content className={cn('flex flex-col', isPanel && 'max-h-[min(calc(100vh-6rem),40rem)]')}>
      <div data-sheet-item className={cn('flex items-center justify-between gap-2 pb-2 pt-3', isPanel ? 'pl-5 pr-3' : 'px-3')}>
        <h3 className="text-base font-semibold text-white">{t('notifications.title')}</h3>
        <div className="flex min-h-8 items-center gap-1">
          {hasUnread && (
            <button type="button" onClick={handleMarkAllAsRead} className={cn(TEXT_BUTTON_CLASS, 'text-white/55 hover:text-white')}>
              {t('notifications.markAllRead')}
            </button>
          )}
          {isPanel && (
            <button type="button" onClick={onClose} className={ACTION_CLASS} aria-label={t('common.close')} title={t('common.close')}>
              <X size={16} aria-hidden="true" className={ACTION_ICON_CLASS} />
            </button>
          )}
        </div>
      </div>

      {/* Bannière d'activation des notifications push */}
      {showPushBanner && (
        <div data-sheet-item className="mx-3 mb-2 flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3">
          <BellRing size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-white opacity-55" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-white">{t('notifications.pushBannerTitle')}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-white/50">{t('notifications.pushBannerDesc')}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1">
              <LiquidButton tone="light" size="sm" onClick={handleEnablePush} disabled={pushSubscribing}>
                {pushSubscribing ? t('common.loading') : t('notifications.enablePush')}
              </LiquidButton>
              <button type="button" onClick={handleDismissPushLater} className={cn(TEXT_BUTTON_CLASS, 'text-white/55 hover:text-white')}>
                {t('notifications.pushLater')}
              </button>
              <button type="button" onClick={handleDismissPushPermanently} className={cn(TEXT_BUTTON_CLASS, 'text-white/35 hover:text-white/70')}>
                {t('notifications.pushNever')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        data-lenis-prevent={isPanel ? '' : undefined}
        className={cn(isPanel ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2' : 'pb-2')}
      >
        {loading ? (
          // Squelette à la forme des lignes : la hauteur bouge peu à l'arrivée
          // de la liste, et le menu avec elle.
          <ul key="skeleton" data-sheet-item aria-hidden="true" className="px-1">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-start gap-3 px-3 py-3">
                <span className="mt-[15px] h-1.5 w-1.5 shrink-0" />
                <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                <span className="flex-1 space-y-2 pt-1">
                  <span className="block h-3 w-4/5 animate-pulse rounded bg-white/[0.06]" />
                  <span className="block h-2.5 w-1/3 animate-pulse rounded bg-white/[0.05]" />
                </span>
              </li>
            ))}
          </ul>
        ) : notifications.length > 0 ? (
          isPanel ? (
            // Au survol, un même fond glisse de ligne en ligne, comme dans
            // le menu Explorer.
            <HoverHighlight className="rounded-xl bg-white/[0.06]">
              <ul>
                {notifications.map(notification => (
                  <HoverHighlightItem key={notification.id} itemValue={notification.id}>
                    {renderRow(notification)}
                  </HoverHighlightItem>
                ))}
              </ul>
            </HoverHighlight>
          ) : (
            <ul key="list">
              {notifications.map(notification => (
                <li key={notification.id} data-sheet-item>
                  {renderRow(notification)}
                </li>
              ))}
            </ul>
          )
        ) : (
          <div data-sheet-item className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Bell size={28} aria-hidden="true" className="text-white opacity-20" />
            <p className="text-sm text-white/50">{t('notifications.noNotifications')}</p>
          </div>
        )}

        {/* La suite : chargée d'elle-même en approchant du bas, ou au clic. */}
        {!loading && notifications.length > 0 && (
          <div data-sheet-item className="px-3 pt-1">
            {hasMore ? (
              <>
                <div ref={sentinelRef} aria-hidden="true" className="h-px" />
                <button
                  type="button"
                  onClick={() => loadMoreNotifications()}
                  disabled={loadingMore}
                  className="w-full rounded-xl py-2.5 text-sm font-medium text-white/60 outline-none transition-colors duration-150 hover:bg-white/[0.05] hover:text-white focus-visible:ring-1 focus-visible:ring-white/25 disabled:cursor-default disabled:opacity-60"
                >
                  {loadingMore ? t('common.loading') : t('notifications.loadMore')}
                </button>
              </>
            ) : notifications.length >= 20 && (
              <p className="py-2 text-center text-xs text-white/35">{t('notifications.allLoaded')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPopup;
