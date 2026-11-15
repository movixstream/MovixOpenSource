import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from 'react';
import { Profile, ProfileContextType } from '../types/profile';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import i18n from '../i18n';
import { predefinedAvatars } from '../data/avatars';
import {
  getSyncableLocalStorageEntries,
  hasSyncableLocalStorageData,
  isSyncableStorageKey,
  SYNC_OUTBOX_STORAGE_KEY
} from '../utils/syncStorage';
import { checkVipStatus } from '../utils/vipUtils';
import {
  clearDeletedProfileSelectionIfStillActive,
  commitProfileSelection,
  createLatestProfileHydrationGuard,
  createLatestProfileIntentGuard,
} from '../utils/profileSelectionTransaction';
import { replaceProfileStorage } from '../utils/profileStorage';

// Pending sync ops persisted by App.tsx flushPendingOpsSync at unload time.
// We POST these to /api/sync BEFORE replaceProfileStorage wipes
// localStorage — otherwise unsynced writes (Firefox keepalive flake, network
// hiccup) would be destroyed by the wipe-and-restore restoring stale backend
// state. On success the outbox is cleared; on transient failure it's kept for
// the next boot to retry; on 401 it's discarded (auth no longer matches).
const SYNC_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SyncOutboxPayload {
  userType: 'oauth' | 'bip39';
  profileId: string;
  userId?: string;
  ops: unknown[];
  ts: number;
}

function isSyncOutboxPayload(value: unknown): value is SyncOutboxPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SyncOutboxPayload>;
  return (
    (candidate.userType === 'oauth' || candidate.userType === 'bip39')
    && typeof candidate.profileId === 'string'
    && candidate.profileId.length > 0
    && Array.isArray(candidate.ops)
    && candidate.ops.length > 0
  );
}

async function replayOutboxIfAny(): Promise<void> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SYNC_OUTBOX_STORAGE_KEY); } catch { return; }
  if (!raw) return;

  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch {
    try { localStorage.removeItem(SYNC_OUTBOX_STORAGE_KEY); } catch { /* noop */ }
    return;
  }

  if (!isSyncOutboxPayload(parsed)) {
    try { localStorage.removeItem(SYNC_OUTBOX_STORAGE_KEY); } catch { /* noop */ }
    return;
  }

  const payload = parsed;
  const ageMs = Date.now() - (typeof payload.ts === 'number' ? payload.ts : 0);
  if (ageMs > SYNC_OUTBOX_MAX_AGE_MS) {
    try { localStorage.removeItem(SYNC_OUTBOX_STORAGE_KEY); } catch { /* noop */ }
    return;
  }

  const authToken = localStorage.getItem('auth_token');
  if (!authToken) {
    // No auth yet (e.g., logged out). Keep the outbox for a future replay.
    return;
  }

  // Cross-user guard: if a different account is logged in than the one that
  // wrote the outbox, do NOT replay. Replaying would POST with the outbox's
  // userId, the backend would respond 401 "UserId mismatch", and the catch
  // below would mark the outbox permanently failed → clearing the original
  // owner's pending writes forever. Keep the outbox idle instead; the 7-day
  // TTL evicts stale entries, and the original owner can return and replay.
  const currentUserId = localStorage.getItem('resolved_user_id') || localStorage.getItem('user_id');
  if (payload.userId && currentUserId && payload.userId !== currentUserId) {
    console.warn('[outbox] skipping replay — different user logged in than outbox owner');
    return;
  }

  // Filter out ops whose keys are no longer syncable. Legacy outboxes may
  // contain keys removed from the allowlist after a backend security update
  // (e.g. `is_vip` per audit P0). Without filtering, the backend rejects the
  // whole batch with 400 INVALID_SYNC_KEY → replayOutboxIfAny treats 400 as
  // permanent → outbox is dropped, taking legitimate co-batched ops with it.
  const validOps = payload.ops.filter((op): op is Record<string, unknown> & { key: string } => {
    if (!op || typeof op !== 'object') return false;
    const candidateKey = (op as { key?: unknown }).key;
    return typeof candidateKey === 'string' && isSyncableStorageKey(candidateKey);
  });

  if (validOps.length === 0) {
    try { localStorage.removeItem(SYNC_OUTBOX_STORAGE_KEY); } catch { /* noop */ }
    return;
  }

  try {
    await axios.post(`${API_URL}/api/sync`, {
      userType: payload.userType,
      profileId: payload.profileId,
      userId: payload.userId,
      ops: validOps
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    try { localStorage.removeItem(SYNC_OUTBOX_STORAGE_KEY); } catch { /* noop */ }
  } catch (error: unknown) {
    const response = (error as { response?: { status?: number; data?: { error?: string } } })?.response;
    const status = response?.status;
    const errMsg = response?.data?.error;

    // Decide whether the error is permanent (clear outbox) or transient (keep
    // for retry). Permanent rejections will never succeed on retry and would
    // otherwise sit in localStorage until the 7-day TTL evicts them, blocking
    // every boot's replay attempt and (with the merge logic in App.tsx)
    // potentially dropping legitimate ops that get appended each cycle.
    //
    //   401 + 'Unauthorized' → token expired or invalid; user can re-auth as
    //                          the same account → keep, retry next boot.
    //   401 + 'UserId mismatch' → different user logged in than the outbox's
    //                              owner → permanent, clear.
    //   400 / 403 / 404 / 413 → malformed op, missing profile, oversize
    //                            payload — none recover on retry → clear.
    //   408 / 429 → timeout / rate-limit → transient → keep.
    //   5xx / network errors → server hiccup → transient → keep.
    let isPermanent = false;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      if (status === 408 || status === 429) {
        isPermanent = false;
      } else if (status === 401 && errMsg === 'Unauthorized') {
        isPermanent = false;
      } else {
        isPermanent = true;
      }
    }

    if (isPermanent) {
      try { localStorage.removeItem(SYNC_OUTBOX_STORAGE_KEY); } catch { /* noop */ }
      console.warn('[outbox] replay rejected permanently, dropping outbox:', status, errMsg);
    } else {
      console.warn('[outbox] replay failed, will retry on next boot:', error);
    }
  }
}

const API_URL = import.meta.env.VITE_MAIN_API;

// Per-device record of which profiles have been confirmed to hold server-side
// data on a prior load. Used by loadProfileData to detect the "server returned
// empty for a profile that previously had data" scenario (corrupted profile
// file, transient backend bug, partial response) and preserve local state
// instead of wiping it. NOT synced — prefixed to fall outside the syncable
// allowlist and not in PROFILE_LOAD_PRESERVED_KEYS removal path.
const KNOWN_PROFILE_DATA_KEY = '__movix_known_profile_data';

interface KnownProfileDataMap {
  [profileId: string]: number;
}

function readKnownProfileData(): KnownProfileDataMap {
  try {
    const raw = localStorage.getItem(KNOWN_PROFILE_DATA_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as KnownProfileDataMap;
  } catch {
    return {};
  }
}

function markProfileHasData(profileId: string) {
  try {
    const current = readKnownProfileData();
    current[profileId] = Date.now();
    localStorage.setItem(KNOWN_PROFILE_DATA_KEY, JSON.stringify(current));
  } catch { /* noop — markers are best-effort */ }
}

function hasLocalSyncableContent(): boolean {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!isSyncableStorageKey(key)) continue;
    const value = localStorage.getItem(key);
    if (typeof value !== 'string') continue;
    if (value.trim() === '' || value === '[]' || value === '{}') continue;
    return true;
  }
  return false;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

interface ProfileProviderProps {
  children: ReactNode;
}

interface LoadProfileDataOptions {
  notifyConsumers?: boolean;
  preserveLocalOnUnexpectedEmpty?: boolean;
  isIntentCurrent?: () => boolean;
}

type ProfileDataLoadingWindow = Window & {
  setProfileDataLoading?: (loading: boolean) => void;
};

export const ProfileProvider: React.FC<ProfileProviderProps> = ({ children }) => {
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const location = useLocation();

  // Dedupes the two useEffects below (mount timer + auth_changed listener)
  // that can both call loadProfiles within ~500ms of each other. Without
  // this guard, two concurrent GET /api/profiles → loadProfileData chains
  // race the wipe-and-restore against in-flight user writes.
  const loadProfilesInFlightRef = useRef(false);

  // The /watch/* skip only applies to automatic hydration during loadProfiles;
  // an explicit profile selection always hydrates its target before publishing.
  const isWatchRoute = location.pathname.startsWith('/watch/');

  // Perf : l'ancien pattern [isWatchRoute] sur les effets de montage relançait TOUT le
  // cycle réseau (GET /api/profiles + GET /api/profiles/:id/data + wipe/rewrite du
  // localStorage) à CHAQUE transition watch <-> reste du site — le chemin le plus
  // emprunté (retour sur Home après une vidéo). On ne garde que le strict nécessaire :
  // un chargement au boot, un rattrapage si l'app a démarré sur /watch/ (deep-link).
  const profileDataHydratedRef = useRef(false);
  const prevIsWatchRouteRef = useRef(isWatchRoute);
  const profileHydrationGuardRef = useRef<ReturnType<typeof createLatestProfileHydrationGuard> | null>(null);
  if (!profileHydrationGuardRef.current) {
    profileHydrationGuardRef.current = createLatestProfileHydrationGuard((loading) => {
      (window as ProfileDataLoadingWindow).setProfileDataLoading?.(loading);
    });
  }
  const profileHydrationGuard = profileHydrationGuardRef.current;
  const profileIntentGuardRef = useRef<ReturnType<typeof createLatestProfileIntentGuard> | null>(null);
  if (!profileIntentGuardRef.current) {
    profileIntentGuardRef.current = createLatestProfileIntentGuard();
  }
  const profileIntentGuard = profileIntentGuardRef.current;

  const refreshVipState = () => {
    if (localStorage.getItem('access_code')) {
      checkVipStatus(true).catch(() => { /* ignore */ });
    } else {
      window.dispatchEvent(new CustomEvent('vipStatusChanged', { detail: { vip: false } }));
    }
  };

  const notifyProfileDataUpdated = () => {
    window.dispatchEvent(new CustomEvent('sync_storage_updated'));
    refreshVipState();
  };

  const clearDeletedProfileSelection = (deletedProfileId: string) => (
    clearDeletedProfileSelectionIfStillActive({
      deletedProfileId,
      readSelectedProfileId: () => localStorage.getItem('selected_profile_id'),
      clearCurrentProfile: () => setCurrentProfile(null),
      clearSelectedProfileId: () => localStorage.removeItem('selected_profile_id'),
      notifyProfileDataUpdated,
    })
  );

  // Load profiles from server
  const loadProfiles = async () => {
    if (loadProfilesInFlightRef.current) return;
    loadProfilesInFlightRef.current = true;
    try {
      setIsLoading(true);
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) return;

      // For BIP39 users, ensure auth data is fully loaded
      const isBip39Auth = localStorage.getItem('bip39_auth') === 'true';
      if (isBip39Auth) {
        // Wait a bit more for BIP39 auth to be fully processed
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const response = await axios.get(`${API_URL}/api/profiles`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (response.data.success) {
        setProfiles(response.data.profiles);
        
        // If no profiles exist, try to migrate existing data
        if (response.data.profiles.length === 0) {
          // Keep loading state while creating profile
          setIsLoading(true);
          
          // Check if this is a new user (no existing data to migrate)
          const hasExistingData = await checkForExistingUserData();
          if (hasExistingData) {
            await migrateExistingData();
          } else {
            // For new users, create a default profile automatically
            await createDefaultProfileForNewUser();
          }
          return;
        }
        
        // Pick the previously-selected profile if it still exists for this
        // account; otherwise fall back to the default. The fallback covers two
        // cases: (1) account switch (user A's selectedProfileId stale for user
        // B), (2) profile deleted server-side between sessions.
        const selectedProfileId = localStorage.getItem('selected_profile_id');
        const selectedProfile = selectedProfileId
          ? response.data.profiles.find((p: Profile) => p.id === selectedProfileId)
          : null;

        if (selectedProfile) {
          setCurrentProfile(selectedProfile);
          if (!isWatchRoute) {
            await loadProfileData(selectedProfile.id);
          } else {
            console.log('Skipping profile data loading for selected profile - on watch route');
          }
        } else if (response.data.profiles.length > 0) {
          const defaultProfile = response.data.profiles.find((p: Profile) => p.isDefault) || response.data.profiles[0];
          setCurrentProfile(defaultProfile);
          localStorage.setItem('selected_profile_id', defaultProfile.id);
          if (!isWatchRoute) {
            await loadProfileData(defaultProfile.id);
          } else {
            console.log('Skipping profile data loading for default profile - on watch route');
          }
        }
      }
    } catch (error) {
      console.error('Error loading profiles:', error);
    } finally {
      loadProfilesInFlightRef.current = false;
      setIsLoading(false);
      // Libère la garde anti-sync (App.tsx l'init à true au boot pour bloquer
      // tout push pendant la fenêtre où des composants pourraient écrire des
      // valeurs vides dans localStorage avant l'hydration serveur).
      // loadProfileData a son propre try/finally qui la baisse aussi ; cet
      // appel couvre les branches qui ne l'invoquent pas (pas d'auth_token,
      // route /watch/*, profiles.length === 0).
      profileHydrationGuard.releaseLoadingIfIdle();
    }
  };

  // Check if user has existing data to migrate
  const checkForExistingUserData = async (): Promise<boolean> => {
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) return false;

      return hasSyncableLocalStorageData();
    } catch (error) {
      console.error('Error checking for existing user data:', error);
      return false;
    }
  };

  // Create default profile for new users
  const createDefaultProfileForNewUser = async (
    isIntentCurrent: () => boolean = () => true,
  ) => {
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) return;

      // Get user info for default profile name
      let defaultName = i18n.t('nav.profile');
      let defaultAvatar = predefinedAvatars[Math.floor(Math.random() * predefinedAvatars.length)];
      
      // Try to get username from auth data
      const authStr = localStorage.getItem('auth');
      if (authStr) {
        try {
          const authObj = JSON.parse(authStr);
          if (authObj.userProfile && authObj.userProfile.username) {
            defaultName = authObj.userProfile.username;
          }
          if (authObj.userProfile && authObj.userProfile.avatar) {
            defaultAvatar = authObj.userProfile.avatar;
          }
        } catch (e) {
          console.log('Could not parse auth data for default profile');
        }
      }

      console.log('Creating default profile for new user:', defaultName);

      const response = await axios.post(`${API_URL}/api/profiles`, {
        name: defaultName,
        avatar: defaultAvatar
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (response.data.success) {
        if (!isIntentCurrent()) return;
        const defaultProfile = response.data.profile;
        setProfiles([defaultProfile]);
        setCurrentProfile(defaultProfile);
        localStorage.setItem('selected_profile_id', defaultProfile.id);
        window.dispatchEvent(new CustomEvent('sync_storage_updated'));
        refreshVipState();
        console.log('Default profile created for new user:', defaultProfile.name);
      }
    } catch (error) {
      console.error('Error creating default profile for new user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Migrate existing user data to default profile
  const migrateExistingData = async () => {
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) return;

      // Collect all localStorage data for migration
      const userData = getSyncableLocalStorageEntries();

      const response = await axios.post(`${API_URL}/api/profiles/migrate`, {
        userData
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (response.data.success) {
        const defaultProfile = response.data.profile;
        setProfiles([defaultProfile]);
        setCurrentProfile(defaultProfile);
        localStorage.setItem('selected_profile_id', defaultProfile.id);
        window.dispatchEvent(new CustomEvent('sync_storage_updated'));
        refreshVipState();
        console.log('Data migrated to default profile:', defaultProfile.name);
      }
    } catch (error) {
      console.error('Error migrating data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Load profile data from server and update localStorage
  const loadProfileData = async (
    profileId: string,
    {
      notifyConsumers = true,
      preserveLocalOnUnexpectedEmpty = true,
      isIntentCurrent = () => true,
    }: LoadProfileDataOptions = {},
  ): Promise<boolean> => {
    const hydrationRequest = profileHydrationGuard.begin();
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) return false;

      // Recovery flush: replay any sync ops persisted at the previous unload
      // BEFORE the GET below pulls server state. Without this, a write that
      // didn't reach the server (Firefox keepalive flake, network hiccup,
      // browser crash) would be destroyed when replaceProfileStorage
      // wipes localStorage and restores stale backend data.
      await replayOutboxIfAny();
      if (!hydrationRequest.isCurrent() || !isIntentCurrent()) return false;

      const response = await axios.get(`${API_URL}/api/profiles/${profileId}/data`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (!hydrationRequest.isCurrent() || !isIntentCurrent()) return false;
      if (!response.data.success || !response.data.data) return false;

      const profileData = response.data.data;
      const profileEntries = Object.fromEntries(
        Object.entries(profileData).filter(
          ([key, value]) => typeof value === 'string' && isSyncableStorageKey(key)
        )
      ) as Record<string, string>;

      const serverHasData = Object.keys(profileEntries).length > 0;
      const known = readKnownProfileData();
      const profileWasKnownToHaveData = Object.prototype.hasOwnProperty.call(known, profileId);

      // Wipe guard: if the server returns an empty profile for a profile
      // we previously confirmed had data on this device, AND we still have
      // local syncable content, do NOT wipe. A transient backend error or
      // corrupted profile file would otherwise silently destroy the user's
      // local state. Preserve local; the next sync push will restore the
      // server side from localStorage.
      if (
        preserveLocalOnUnexpectedEmpty
        && !serverHasData
        && profileWasKnownToHaveData
        && hasLocalSyncableContent()
      ) {
        console.warn(
          `[sync] Server returned empty profile ${profileId} that previously held data — preserving local state`
        );
        profileDataHydratedRef.current = true;
        if (notifyConsumers) notifyProfileDataUpdated();
        return true;
      }

      if (!isIntentCurrent()) return false;
      replaceProfileStorage(profileEntries);
      profileDataHydratedRef.current = true;

      if (serverHasData) {
        markProfileHasData(profileId);
      }

      if (notifyConsumers) notifyProfileDataUpdated();

      console.log('Profile data loaded for profile:', profileId);
      return true;
    } catch (error) {
      console.error('Error loading profile data:', error);
      return false;
    } finally {
      hydrationRequest.finish();
    }
  };

  const activateProfile = async (
    profile: Profile,
    isIntentCurrent: () => boolean,
  ): Promise<boolean> => (
    commitProfileSelection({
      profile,
      hydrateProfileData: (profileId, currentIntent) => loadProfileData(profileId, {
        notifyConsumers: false,
        preserveLocalOnUnexpectedEmpty: false,
        isIntentCurrent: currentIntent,
      }),
      persistSelectedProfileId: (profileId) => {
        localStorage.setItem('selected_profile_id', profileId);
      },
      publishCurrentProfile: setCurrentProfile,
      notifyProfileDataUpdated,
      isIntentCurrent,
    })
  );

  // Select a profile
  const selectProfile = async (profileId: string): Promise<boolean> => {
    const selectionIntent = profileIntentGuard.begin();
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return false;
    return activateProfile(profile, selectionIntent.isCurrent);
  };

  // Create a new profile
  const createProfile = async (name: string, avatar: string, ageRestriction?: number) => {
    try {
      setIsLoading(true);
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) throw new Error('No auth token');

      const response = await axios.post(`${API_URL}/api/profiles`, {
        name,
        avatar,
        ageRestriction: ageRestriction ?? 0
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (response.data.success) {
        const newProfile = response.data.profile;
        setProfiles(prev => [...prev, newProfile]);
        
        // If this is the first profile, select it
        if (profiles.length === 0) {
          setCurrentProfile(newProfile);
          localStorage.setItem('selected_profile_id', newProfile.id);
        }
      }
    } catch (error) {
      console.error('Error creating profile:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Update a profile
  // Pas de setIsLoading ici : ProfileGate remplace toutes les routes par
  // l'écran « Chargement des profils… » tant que isLoading est vrai, ce qui
  // démontait la page profil à chaque changement de nom ou d'avatar.
  const updateProfile = async (profileId: string, updates: Partial<Profile>) => {
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) throw new Error('No auth token');

      const response = await axios.put(`${API_URL}/api/profiles/${profileId}`, updates, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (response.data.success) {
        const updatedProfile = response.data.profile;
        setProfiles(prev => prev.map(p => p.id === profileId ? updatedProfile : p));
        
        // Update current profile if it's the one being updated
        if (currentProfile?.id === profileId) {
          setCurrentProfile(updatedProfile);
        }
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  };

  // Delete a profile
  const deleteProfile = async (profileId: string) => {
    const deletionIntent = profileIntentGuard.begin();
    try {
      setIsLoading(true);
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) throw new Error('No auth token');

      const response = await axios.delete(`${API_URL}/api/profiles/${profileId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (response.data.success) {
        // Check if server created a new default profile
        if (response.data.newDefaultProfile) {
          // Server created a new default profile, use it directly
          const newDefaultProfile = response.data.newDefaultProfile;
          if (!deletionIntent.isCurrent()) return;
          setProfiles([newDefaultProfile]);
          const activated = await activateProfile(
            newDefaultProfile,
            deletionIntent.isCurrent,
          );
          if (!activated && deletionIntent.isCurrent()) {
            console.error('Failed to activate replacement profile:', newDefaultProfile.id);
            clearDeletedProfileSelection(profileId);
          }
          console.log('New default profile created by server:', newDefaultProfile.name);
        } else {
          // Reload profiles from server to get updated default status
          const profilesResponse = await axios.get(`${API_URL}/api/profiles`, {
            headers: { Authorization: `Bearer ${authToken}` }
          });
          
          if (profilesResponse.data.success) {
            const updatedProfiles = profilesResponse.data.profiles;
            setProfiles(updatedProfiles);
            
            // If deleted profile was current, select the default one
            if (currentProfile?.id === profileId) {
              if (updatedProfiles.length > 0) {
                const newCurrent = updatedProfiles.find((p: Profile) => p.isDefault) || updatedProfiles[0];
                if (!deletionIntent.isCurrent()) return;
                const activated = await activateProfile(
                  newCurrent,
                  deletionIntent.isCurrent,
                );
                if (!activated && deletionIntent.isCurrent()) {
                  console.error('Failed to activate profile after deletion:', newCurrent.id);
                  clearDeletedProfileSelection(profileId);
                }
              } else {
                // No profiles left, create a new default profile automatically
                console.log('No profiles left, creating new default profile...');
                if (!deletionIntent.isCurrent()) return;
                await createDefaultProfileForNewUser(deletionIntent.isCurrent);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error deleting profile:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Ref vers la dernière version de loadProfiles (closure fraîche, avec le bon
  // isWatchRoute) pour les effets/listeners montés une seule fois ci-dessous
  const loadProfilesRef = useRef(loadProfiles);
  useEffect(() => {
    loadProfilesRef.current = loadProfiles;
  });

  // Load profiles on mount with delay for BIP39 users — montage unique (perf)
  useEffect(() => {
    // Add a small delay to ensure auth data is fully loaded
    const timer = setTimeout(() => {
      loadProfilesRef.current();
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Rattrapage deep-link : si l'app a démarré sur /watch/*, l'hydratation automatique
  // de loadProfiles a été ignorée. La première sortie de /watch/ déclenche alors le
  // chargement ; une sélection explicite, elle, hydrate toujours immédiatement.
  useEffect(() => {
    const wasWatch = prevIsWatchRouteRef.current;
    prevIsWatchRouteRef.current = isWatchRoute;
    if (wasWatch && !isWatchRoute && !profileDataHydratedRef.current) {
      loadProfilesRef.current();
    }
  }, [isWatchRoute]);

  // Listen for auth changes to reload profiles — montage unique (perf)
  useEffect(() => {
    const handleAuthChange = () => {
      // Nouveau compte → les données profil devront être réhydratées
      profileDataHydratedRef.current = false;
      // Reload profiles when auth changes (especially for BIP39)
      setTimeout(() => {
        loadProfilesRef.current();
      }, 500);
    };

    window.addEventListener('auth_changed', handleAuthChange);
    return () => window.removeEventListener('auth_changed', handleAuthChange);
  }, []);

  // Memoize value with state-only deps. The 4 callbacks (selectProfile,
  // createProfile, updateProfile, deleteProfile) are recreated each render
  // but they only close over state listed in deps below, so capturing the
  // most-recent ones on memo invalidation is correct.
  //
  // Why this matters: 12 consumers (every Watch page, MovieDetails, TVDetails,
  // ProfileSwitcher, ProfileMenu, LikeDislikeButton-on-cards). The previous
  // bare object literal was a fresh ref every render, and ProfileProvider
  // re-runs on every route transition between watch and non-watch routes
  // because its loadProfiles effect depends on `isWatchRoute`. — perf
  const value = useMemo<ProfileContextType>(() => ({
    currentProfile,
    profiles,
    selectProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    isLoading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currentProfile, profiles, isLoading]);

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
};

export const useProfile = (): ProfileContextType => {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
};
