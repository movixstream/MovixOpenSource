import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ReferralError,
  captureReferralCodeFromUrl,
  claimReferralCode,
  clearPendingReferralCode,
  formatWatchDuration,
  getPendingReferralCode,
  getReferralConfig,
  getReferralMe,
  hasAccountSession,
  isDataCollectionAllowed,
  redeemReferralReward,
  type ReferralMe
} from '@/services/referralService';
import { FINAL_CLAIM_ERRORS, applyRedeemedKey, describeReferralError, formatDays, formatDistinctDays } from './referralActions';

// Parrainage en arrière-plan, monté une fois dans App :
// - garde le code d'un lien ?ref= ;
// - après la connexion (Google, Discord ou phrase secrète), envoie le code
//   gardé : le serveur l'accepte seulement pour un compte récent ;
// - ajoute au VIP du profil les jours gagnés.
// Le temps de visionnage du filleul n'est pas envoyé ici : le serveur le
// prend dans les envois du Wrapped (coupés si la collecte de données l'est).

// Lecture gardée par onglet : 30 min, ou 5 min tant que le filleul n'a pas
// fini (ses jours sont récupérés peu après la fin de l'objectif).
const REFRESH_EVERY_MS = 30 * 60 * 1000;
const PENDING_REFRESH_EVERY_MS = 5 * 60 * 1000;
const CHECK_EVERY_MS = 5 * 60 * 1000;
const CACHE_KEY = 'movix_referral_state';
// Erreurs à taire quand le code vient d'un lien : la personne n'a rien tapé
// (ancien membre qui ouvre le lien d'un ami, compte déjà parrainé).
const QUIET_LINK_ERRORS = new Set(['ACCOUNT_TOO_OLD', 'ALREADY_REFERRED', 'OWN_CODE', 'REFERRAL_DISABLED']);

function cacheLifetime(me: ReferralMe): number {
  return me.enabled && me.referee?.status === 'pending' ? PENDING_REFRESH_EVERY_MS : REFRESH_EVERY_MS;
}

function readCache(token: string | null): ReferralMe | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null') as { at?: number; token?: string; me?: ReferralMe } | null;
    if (!parsed?.me || parsed.token !== token || Date.now() - Number(parsed.at) > cacheLifetime(parsed.me)) return null;
    return parsed.me;
  } catch {
    return null;
  }
}

function writeCache(token: string | null, me: ReferralMe | null): void {
  try {
    if (me) {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), token, me }));
    } else {
      sessionStorage.removeItem(CACHE_KEY);
    }
  } catch {
    // Sans sessionStorage, on relit au prochain chargement.
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
}

export default function ReferralManager() {
  const { t } = useTranslation();
  const busyRef = useRef(false);
  const queuedRef = useRef(false);
  const tokenRef = useRef<string | null>(readToken());

  const refresh = useCallback(async (force: boolean): Promise<void> => {
    // Demande arrivée pendant une lecture (code saisi, connexion) : relancée juste après.
    if (busyRef.current) {
      if (force) queuedRef.current = true;
      return;
    }
    if (!hasAccountSession()) {
      writeCache(null, null);
      return;
    }
    const token = readToken();
    const pending = getPendingReferralCode();
    if (!force && !pending && readCache(token)) return;

    busyRef.current = true;
    try {
      // Parrainage coupé : aucune requête avec la session (config publique en cache).
      const config = await getReferralConfig();
      if (!config.enabled) return;

      if (pending) {
        try {
          const claimed = await claimReferralCode(pending.code);
          clearPendingReferralCode();
          toast.success(t('referral.toast.claimed', {
            duration: formatWatchDuration(claimed.requiredMinutes),
            days: formatDistinctDays(t, claimed.requiredDays),
            reward: formatDays(t, claimed.rewardDays)
          }));
          if (!isDataCollectionAllowed()) toast.warning(t('referral.toast.collectionOff'));
        } catch (error) {
          const code = error instanceof ReferralError ? error.code : '';
          if (FINAL_CLAIM_ERRORS.has(code)) {
            clearPendingReferralCode();
            if (!(pending.source === 'link' && QUIET_LINK_ERRORS.has(code))) {
              toast.error(describeReferralError(t, error));
            }
          }
          // Autre erreur (réseau, limite) : le code reste gardé pour la prochaine fois.
        }
      }

      const data = await getReferralMe();
      let redeemFailed = false;
      if (data.enabled) {
        for (const reward of data.rewards) {
          try {
            const result = await redeemReferralReward(reward.id);
            applyRedeemedKey(result);
            toast.success(t(reward.role === 'referrer' ? 'referral.toast.rewardReferrer' : 'referral.toast.rewardReferee', {
              days: formatDays(t, reward.days)
            }));
          } catch (error) {
            console.warn('[Parrainage] Jours VIP non récupérés, nouvel essai plus tard :', error);
            redeemFailed = true;
          }
        }
      }
      // Un échec de récupération n'est pas gardé : on réessaie au prochain passage.
      writeCache(token, redeemFailed ? null : data);
    } catch (error) {
      // Panne passagère : on réessaiera au prochain passage.
      console.warn('[Parrainage] Lecture impossible :', error);
    } finally {
      busyRef.current = false;
    }
    if (queuedRef.current) {
      queuedRef.current = false;
      await refresh(true);
    }
  }, [t]);

  // Lien ?ref=, première lecture, puis un passage toutes les 5 min (sans
  // requête tant que la lecture gardée est encore valable).
  useEffect(() => {
    captureReferralCodeFromUrl();
    void refresh(false);
    const timer = window.setInterval(() => { void refresh(false); }, CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Connexion, déconnexion, code saisi ou demande d'une autre partie du site.
  useEffect(() => {
    const onAuthChange = () => {
      tokenRef.current = readToken();
      void refresh(true);
    };
    const onStorage = () => {
      const token = readToken();
      if (token === tokenRef.current) return;
      tokenRef.current = token;
      void refresh(true);
    };
    const onRefresh = () => { void refresh(true); };
    window.addEventListener('auth_changed', onAuthChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('referral-refresh', onRefresh);
    window.addEventListener('referral-code-changed', onRefresh);
    return () => {
      window.removeEventListener('auth_changed', onAuthChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('referral-refresh', onRefresh);
      window.removeEventListener('referral-code-changed', onRefresh);
    };
  }, [refresh]);

  return null;
}
