// Page profil (/profile) : la bibliothèque du profil actif.
//
// En haut, la carte de membre et le dernier titre en cours ; puis les
// chiffres de l'année ; puis les onglets À voir, Favoris, Déjà vu,
// Historique (qui a son propre « En cours »), Alertes et Listes. Les réglages du compte vivent dans /settings.
// La logique est rangée dans src/components/profile/.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, Film, Heart, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { useProfile } from '@/context/ProfileContext';
import { getResolvedAccountProvider } from '@/utils/accountAuth';
import { isUserAuthenticated, isUserVip } from '@/utils/authUtils';
import { AlertService } from '@/services/alertService';
import AvatarSelector from '@/components/AvatarSelector';
import FilterSystem, { type FilterItemType, type FilterOptions } from '@/components/FilterSystem';
import { useOptimizedFilter } from '@/hooks/useOptimizedFilter';
import MemberCard from '@/components/profile/MemberCard';
import ResumePanel from '@/components/profile/ResumePanel';
import ProfileTabs, { tabButtonId, tabPanelId, type ProfileTab } from '@/components/profile/ProfileTabs';
import LibraryGrid from '@/components/profile/LibraryGrid';
import AlertsTab from '@/components/profile/AlertsTab';
import HistoryTab from '@/components/profile/HistoryTab';
import SessionsTab from '@/components/profile/SessionsTab';
import CustomListsTab from '@/components/profile/CustomListsTab';
import { useCustomLists } from '@/components/profile/useCustomLists';
import { useProfileLibrary } from '@/components/profile/useProfileLibrary';
import { useResumeItem } from '@/components/profile/useResumeItem';
import { readJson } from '@/components/profile/storage';
import { EmptyState, Spinner } from '@/components/profile/ui';
import type { MainListType, ProfileTabId, WatchItem } from '@/components/profile/types';

const TAB_IDS: ProfileTabId[] = ['watchlist', 'favorites', 'watched', 'history', 'alerts', 'custom-lists', 'sessions'];
const FILTERABLE_TABS = new Set<ProfileTabId>(['watchlist', 'favorites', 'watched']);
const TYPE_ORDER: FilterItemType[] = ['all', 'movie', 'tv', 'collection', 'shared-list', 'live-tv'];

const parseTab = (search: string): ProfileTabId => {
  const value = new URLSearchParams(search).get('tab');
  // Ancien onglet « En cours » (liens et favoris) : l'historique s'ouvre sur son « En cours ».
  if (value === 'in-progress') return 'history';
  return TAB_IDS.includes(value as ProfileTabId) ? (value as ProfileTabId) : 'watchlist';
};

interface StoredUserProfile {
  username?: string;
  avatar?: string;
}

/** Nom et avatar du compte (repli des comptes à code d'accès, sans sous-profil). */
function readAccountProfile(): StoredUserProfile {
  const auth = readJson<{ userProfile?: StoredUserProfile } | null>('auth', null);
  if (auth?.userProfile?.username) return auth.userProfile;
  if (localStorage.getItem('discord_auth') === 'true') {
    const discord = readJson<{ username?: string; avatar?: string } | null>('discord_user', null);
    if (discord) return { username: discord.username, avatar: discord.avatar };
  }
  if (localStorage.getItem('google_auth') === 'true') {
    const google = readJson<{ name?: string; picture?: string } | null>('google_user', null);
    if (google) return { username: google.name, avatar: google.picture };
  }
  return auth?.userProfile ?? {};
}

/** Recopie nom ou avatar dans les copies locales lues par l'en-tête (jamais synchronisées). */
function writeAccountProfile(update: { username?: string; avatar?: string }) {
  const auth = readJson<Record<string, unknown> & { userProfile?: Record<string, unknown> }>('auth', {});
  localStorage.setItem('auth', JSON.stringify({
    ...auth,
    userProfile: { ...(auth.userProfile || {}), ...update, lastModified: new Date().toISOString() },
  }));
  if (localStorage.getItem('discord_auth') === 'true') {
    const discord = readJson<Record<string, unknown>>('discord_user', {});
    localStorage.setItem('discord_user', JSON.stringify({
      ...discord,
      ...(update.username !== undefined ? { username: update.username } : {}),
      ...(update.avatar !== undefined ? { avatar: update.avatar } : {}),
    }));
  }
  if (localStorage.getItem('google_auth') === 'true') {
    const google = readJson<Record<string, unknown>>('google_user', {});
    localStorage.setItem('google_user', JSON.stringify({
      ...google,
      ...(update.username !== undefined ? { name: update.username } : {}),
      ...(update.avatar !== undefined ? { picture: update.avatar } : {}),
    }));
  }
  // Prévient l'en-tête et les autres composants qui écoutent « storage ».
  window.dispatchEvent(new Event('storage'));
}

function readVipUntil(): string | null {
  const raw = localStorage.getItem('access_code_expires');
  if (!raw || raw === 'never') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : raw;
}

const Profile: React.FC = () => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { currentProfile, profiles, updateProfile } = useProfile();

  // L'onglet suit toujours l'URL : /profile sans ?tab revient sur « À voir ».
  const activeTab = parseTab(location.search);
  const [authenticated] = useState(isUserAuthenticated);
  const [account, setAccount] = useState<StoredUserProfile>(readAccountProfile);
  const [vip, setVip] = useState(() => ({ isVip: isUserVip(), until: readVipUntil() }));
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [alertCount, setAlertCount] = useState(() => Object.keys(AlertService.getAllAlerts()).length);

  const library = useProfileLibrary();
  const customLists = useCustomLists();
  const resume = useResumeItem();

  useEffect(() => {
    const refresh = () => {
      setAccount(readAccountProfile());
      setVip({ isVip: isUserVip(), until: readVipUntil() });
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('auth_changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('auth_changed', refresh);
    };
  }, []);

  // --- Filtres des grilles --------------------------------------------------
  const watchlistFilter = useOptimizedFilter({ items: library.watchlist });
  const favoritesFilter = useOptimizedFilter({ items: library.favorites });
  const watchedFilter = useOptimizedFilter({ items: library.watched });

  const filters = {
    watchlist: watchlistFilter,
    favorites: favoritesFilter,
    watched: watchedFilter,
  } as const;
  const activeFilter = FILTERABLE_TABS.has(activeTab) ? filters[activeTab as keyof typeof filters] : null;
  const activeSource = useMemo<WatchItem[]>(() => {
    if (activeTab === 'watchlist' || activeTab === 'favorites' || activeTab === 'watched') return library[activeTab];
    return [];
  }, [activeTab, library]);

  const availableTypes = useMemo(
    () => TYPE_ORDER.filter((type) => type === 'all' || activeSource.some((item) => item.type === type)),
    [activeSource],
  );

  const handleFiltersChange = useCallback((next: FilterOptions) => {
    activeFilter?.updateFilters(next);
    // activeFilter change avec l'onglet ; sa méthode est stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeFilter?.updateFilters]);

  // --- Actions --------------------------------------------------------------
  const changeTab = (id: ProfileTabId) => {
    navigate(`/profile?tab=${id}`);
  };

  const removeItem = (item: WatchItem, listType: MainListType) => {
    const undo = library.removeItem(item, listType);
    const title = item.type === 'collection' ? item.name || item.title : item.title;
    toast(t('profilePage.media.removed', { title, defaultValue: '« {{title}} » retiré' }), {
      action: { label: t('profilePage.media.undo', 'Annuler'), onClick: undo },
    });
  };

  const handleAvatarSelect = async (avatarUrl: string) => {
    setShowAvatarPicker(false);
    writeAccountProfile({ avatar: avatarUrl });
    setAccount((prev) => ({ ...prev, avatar: avatarUrl }));
    if (!currentProfile) return;
    try {
      await updateProfile(currentProfile.id, { avatar: avatarUrl });
    } catch {
      toast.error(t('profilePage.header.saveError', 'Impossible d’enregistrer pour l’instant. Réessaie dans un moment.'));
    }
  };

  const handleRename = async (name: string) => {
    writeAccountProfile({ username: name });
    setAccount((prev) => ({ ...prev, username: name }));
    if (!currentProfile) return;
    try {
      await updateProfile(currentProfile.id, { name });
    } catch {
      toast.error(t('profilePage.header.saveError', 'Impossible d’enregistrer pour l’instant. Réessaie dans un moment.'));
      throw new Error('rename failed');
    }
  };

  // --- Données de la carte ----------------------------------------------------
  const displayName = currentProfile?.name || account.username || t('profile.title');
  const displayAvatar = currentProfile?.avatar || account.avatar || '';
  const memberSince = useMemo(() => {
    const time = currentProfile?.createdAt ? Date.parse(currentProfile.createdAt) : NaN;
    if (!Number.isFinite(time)) return null;
    return new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(time);
  }, [currentProfile?.createdAt, i18n.language]);
  const vipUntilLabel = useMemo(() => {
    if (!vip.until) return null;
    return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(vip.until));
  }, [vip.until, i18n.language]);
  const providerLabel = useMemo(() => {
    const provider = getResolvedAccountProvider();
    if (provider === 'bip39') return t('profile.connectedWithSecretPhrase');
    if (provider === 'discord') return `${t('profile.connectedWith')} Discord`;
    if (provider === 'google') return `${t('profile.connectedWith')} Google`;
    return t('profile.connectedUser');
    // La méthode de connexion ne change pas sans rechargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, account]);

  const tabs: ProfileTab[] = [
    { id: 'watchlist', label: t('profilePage.tabs.watchlist'), count: library.watchlist.length },
    { id: 'favorites', label: t('profilePage.tabs.favorites'), count: library.favorites.length },
    { id: 'watched', label: t('profilePage.tabs.watched'), count: library.watched.length },
    { id: 'history', label: t('profilePage.tabs.history', 'Historique') },
    { id: 'alerts', label: t('profilePage.tabs.alerts'), count: alertCount },
    { id: 'custom-lists', label: t('profilePage.tabs.customLists'), count: customLists.lists.length },
  ];
  if (activeTab === 'sessions') {
    tabs.push({ id: 'sessions', label: t('profilePage.tabs.sessions', 'Appareils'), count: 0 });
  }

  // --- Contenu de l'onglet -----------------------------------------------------
  const emptyStates: Record<MainListType, { icon: React.ReactNode; title: string; description: string }> = {
    watchlist: { icon: <Film />, title: t('profilePage.emptyStates.watchlistEmpty'), description: t('profilePage.emptyStates.watchlistEmptyDesc') },
    favorites: { icon: <Heart />, title: t('profilePage.emptyStates.noFavorites'), description: t('profilePage.emptyStates.noFavoritesDesc') },
    watched: { icon: <Eye />, title: t('profilePage.emptyStates.historyEmpty'), description: t('profilePage.emptyStates.historyEmptyDesc') },
  };

  const renderTab = () => {
    if (activeTab === 'watchlist' || activeTab === 'favorites' || activeTab === 'watched') {
      if (library.loading) return <Spinner />;
      if (library[activeTab].length === 0) {
        const empty = emptyStates[activeTab];
        return <EmptyState {...empty} action={{ label: t('profilePage.emptyStates.exploreCatalog'), to: '/' }} />;
      }
      const filtered = filters[activeTab].filteredItems;
      if (filtered.length === 0) {
        return <p className="py-12 text-[15px] text-white/60">{t('profilePage.media.noMatch', 'Rien ne correspond à ces filtres.')}</p>;
      }
      return <LibraryGrid items={filtered} listType={activeTab} onRemove={(item) => removeItem(item, activeTab)} />;
    }
    if (activeTab === 'history') return <HistoryTab />;
    if (activeTab === 'alerts') return <AlertsTab onCountChange={setAlertCount} />;
    if (activeTab === 'custom-lists') {
      return <CustomListsTab lists={customLists.lists} saveLists={customLists.saveLists} loading={customLists.loading} />;
    }
    return <SessionsTab />;
  };

  if (!authenticated && !currentProfile) {
    return (
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        <EmptyState
          icon={<LogIn />}
          title={t('profilePage.auth.loginRequired')}
          description={t('profilePage.auth.loginRequiredDesc')}
          action={{ label: t('profilePage.auth.login'), to: '/create-account' }}
        />
      </main>
    );
  }

  const rise = (delay: number) => (reduceMotion
    ? {}
    : {
      initial: { opacity: 0, y: 18 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] as const },
    });

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-4 sm:px-6 sm:pt-6 lg:px-8">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <motion.div {...rise(0)}>
          <MemberCard
            name={displayName}
            avatar={displayAvatar}
            profileCount={profiles.length}
            memberSince={memberSince}
            providerLabel={providerLabel}
            isVip={vip.isVip}
            vipUntil={vipUntilLabel}
            onEditAvatar={() => setShowAvatarPicker(true)}
            onRename={handleRename}
          />
        </motion.div>
        <motion.div {...rise(0.08)}>
          <ResumePanel item={resume.item} loading={resume.loading} />
        </motion.div>
      </div>

      <section className="mt-12 sm:mt-16" aria-labelledby={tabButtonId(activeTab)}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('profilePage.library.title', 'Ta bibliothèque')}</h2>
        </div>
        <div className="mt-4">
          <ProfileTabs tabs={tabs} active={activeTab} onChange={changeTab} label={t('profilePage.library.title', 'Ta bibliothèque')} />
        </div>

        <div id={tabPanelId} role="tabpanel" aria-labelledby={tabButtonId(activeTab)} className="mt-6 min-h-[40vh]">
          {activeFilter && activeSource.length > 0 && (
            <FilterSystem
              onFiltersChange={handleFiltersChange}
              totalItems={activeSource.length}
              filteredItems={activeFilter.stats.filtered}
              isSorting={activeFilter.isSorting}
              availableTypeFilters={availableTypes}
            />
          )}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {renderTab()}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {showAvatarPicker && (
        <AvatarSelector
          isOpen={showAvatarPicker}
          onClose={() => setShowAvatarPicker(false)}
          onAvatarSelect={handleAvatarSelect}
          currentAvatar={displayAvatar}
        />
      )}
    </main>
  );
};

export default Profile;
