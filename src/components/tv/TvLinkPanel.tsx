import { useCallback, useEffect, useId, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, CheckCircle2, KeyRound, Loader2, Tv } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { cn } from '@/lib/utils';
import { useProfile } from '@/context/ProfileContext';
import { discordAuth } from '@/services/discordAuth';
import { googleAuth } from '@/services/googleAuth';
import { clearPendingAuthAction, getPendingAuthAction, setPendingAuthAuthorize } from '@/utils/accountAuth';
import {
  TvLinkError,
  confirmTvLink,
  getTvLinkInfo,
  isCompleteTvCode,
  sanitizeTvCode,
  type TvLinkErrorCode,
  type TvLinkInfo,
} from '@/services/tvLinkService';
import { TvCodeInput } from './TvCodeInput';
import { TV_EASE } from './tvMotion';

const DISCORD_LOGO = 'https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png';
const GOOGLE_LOGO = 'https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png';

/** Page qui accueille la liaison : `/tv?code=…` (QR de la télé) y redirige. */
const LINK_PATH = '/app-tv';
const LINK_ANCHOR = '#relier';

const hasAuthToken = () => {
  try {
    return Boolean(localStorage.getItem('auth_token'));
  } catch {
    return false;
  }
};

const buildReturnTo = (code: string) => `${LINK_PATH}${code ? `?code=${encodeURIComponent(code)}` : ''}${LINK_ANCHOR}`;

const toErrorCode = (error: unknown): TvLinkErrorCode => (error instanceof TvLinkError ? error.code : 'unknown');

/**
 * Garde `?code=` dans l'adresse pour un rechargement, sans passer par le
 * routeur : un changement de recherche relancerait le retour en haut de page
 * (ScrollToTop) à chaque caractère tapé.
 */
function useSilentCodeParam(code: string) {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.pathname !== LINK_PATH || (url.searchParams.get('code') ?? '') === code) return;
      if (code) url.searchParams.set('code', code);
      else url.searchParams.delete('code');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Adresse non modifiable : le code reste dans la page.
    }
  }, [code]);
}

type Phase = 'idle' | 'checking' | 'ready' | 'linking' | 'done';

interface TvLinkPanelProps {
  calm: boolean;
}

/**
 * Liaison d'une télé au compte : code à 5 caractères affiché par l'appli,
 * choix du profil, confirmation. Section `#relier` de `/app-tv`.
 */
export function TvLinkPanel({ calm }: TvLinkPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profiles, currentProfile, isLoading: profilesLoading } = useProfile();
  const hintId = useId();
  const profileLabelId = useId();

  const [isLoggedIn, setIsLoggedIn] = useState(hasAuthToken);
  const [code, setCode] = useState(() => sanitizeTvCode(searchParams.get('code') ?? ''));
  const [phase, setPhase] = useState<Phase>('idle');
  const [info, setInfo] = useState<TvLinkInfo | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [errorCode, setErrorCode] = useState<TvLinkErrorCode | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [linkedDeviceName, setLinkedDeviceName] = useState('');

  useSilentCodeParam(phase === 'done' ? '' : code);

  // Suit la connexion ou la déconnexion faite ailleurs (autre onglet, menu du site).
  useEffect(() => {
    const refresh = () => setIsLoggedIn(hasAuthToken());
    window.addEventListener('storage', refresh);
    window.addEventListener('auth_changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('auth_changed', refresh);
    };
  }, []);

  // Retour de connexion : la redirection est faite, on oublie l'action en attente.
  useEffect(() => {
    if (!isLoggedIn) return;
    const pending = getPendingAuthAction();
    if (pending?.type === 'oauth-authorize' && pending.returnTo.startsWith(LINK_PATH)) {
      clearPendingAuthAction();
    }
  }, [isLoggedIn]);

  // Profil par défaut : le profil courant, sinon le premier du compte.
  useEffect(() => {
    if (selectedProfileId && profiles.some((profile) => profile.id === selectedProfileId)) return;
    setSelectedProfileId(currentProfile?.id ?? profiles[0]?.id ?? null);
  }, [currentProfile?.id, profiles, selectedProfileId]);

  // Code complet : on demande le nom de la télé.
  useEffect(() => {
    if (!isLoggedIn || phase === 'done') return undefined;
    if (!isCompleteTvCode(code)) {
      setInfo(null);
      setExpiresAt(null);
      setPhase('idle');
      return undefined;
    }

    const controller = new AbortController();
    setPhase('checking');
    setErrorCode(null);
    setInfo(null);
    getTvLinkInfo(code, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setInfo(result);
        setExpiresAt(result.expiresIn > 0 ? Date.now() + result.expiresIn * 1000 : null);
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const nextError = toErrorCode(error);
        if (nextError === 'unauthorized') setIsLoggedIn(false);
        setErrorCode(nextError);
        setPhase('idle');
      });
    return () => controller.abort();
    // `phase` est lu pour ne pas relancer après la réussite, pas pour réagir à ses changements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, isLoggedIn]);

  // Compte à rebours du code affiché sur la télé.
  useEffect(() => {
    if (!expiresAt || phase === 'done') {
      setSecondsLeft(null);
      return undefined;
    }
    const tick = () => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        setInfo(null);
        setExpiresAt(null);
        setPhase('idle');
        setErrorCode('code_invalid');
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, phase]);

  const handleCodeChange = useCallback((next: string) => {
    setErrorCode(null);
    setCode(next);
  }, []);

  const handleConfirm = async () => {
    if (!info || !selectedProfileId || phase !== 'ready') return;
    setPhase('linking');
    setErrorCode(null);
    try {
      const result = await confirmTvLink(code, selectedProfileId);
      setLinkedDeviceName(result.deviceName || info.deviceName);
      setPhase('done');
      setExpiresAt(null);
    } catch (error: unknown) {
      const nextError = toErrorCode(error);
      setErrorCode(nextError);
      if (nextError === 'unauthorized') {
        setIsLoggedIn(false);
        setPhase('idle');
      } else if (nextError === 'code_invalid') {
        setInfo(null);
        setExpiresAt(null);
        setPhase('idle');
      } else {
        setPhase('ready');
      }
    }
  };

  const handleLinkAnother = () => {
    setLinkedDeviceName('');
    setInfo(null);
    setErrorCode(null);
    setPhase('idle');
    setCode('');
  };

  const returnTo = buildReturnTo(code);
  const handleDiscordLogin = () => discordAuth.login({ mode: 'authorize', returnTo });
  const handleGoogleLogin = () => googleAuth.login({ mode: 'authorize', returnTo });
  const handleBip39Login = () => {
    setPendingAuthAuthorize(returnTo);
    navigate('/login-bip39');
  };

  const deviceName = info?.deviceName || t('tvLink.defaultDeviceName');
  const isBusy = phase === 'checking' || phase === 'linking';
  const errorMessage = errorCode ? t(`tvLink.errors.${errorCode}`) : null;
  const minutesLeft = secondsLeft !== null ? Math.max(1, Math.ceil(secondsLeft / 60)) : null;
  const fade = { duration: calm ? 0 : 0.25, ease: TV_EASE };

  const pillBase = 'inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

  return (
    <AnimatePresence mode="wait" initial={false}>
      {phase === 'done' ? (
        <motion.div
          key="done"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={fade}
          className="flex flex-col items-center py-4 text-center"
          role="status"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          </span>
          <p className="mt-5 text-2xl font-bold tracking-tight text-white">{t('tvLink.success.title')}</p>
          <p className="mt-2 text-base text-zinc-300">{t('tvLink.success.subtitle')}</p>
          {linkedDeviceName && (
            <p className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full bg-white/[0.06] px-3.5 py-1.5 text-sm text-zinc-200 ring-1 ring-inset ring-white/10">
              <Tv className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
              <span className="truncate">{linkedDeviceName}</span>
            </p>
          )}
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-zinc-400">{t('tvLink.success.sessionsHint')}</p>
          <div className="mt-7 grid w-full max-w-sm gap-2.5">
            <Link to="/" className={cn(pillBase, 'bg-white text-zinc-950 hover:bg-zinc-100')}>
              {t('tvLink.success.home')}
            </Link>
            <button type="button" onClick={handleLinkAnother} className={cn(pillBase, 'bg-white/[0.06] text-white hover:bg-white/10')}>
              {t('tvLink.success.another')}
            </button>
          </div>
        </motion.div>
      ) : !isLoggedIn ? (
        <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
          <p className="text-base leading-relaxed text-zinc-200">{t('tvLink.login.description')}</p>
          {code && (
            <p className="mt-3 text-sm text-zinc-400">
              {t('tvLink.login.codeKept')}{' '}
              <span className="font-mono text-base font-bold tracking-[0.3em] text-white">{code}</span>
            </p>
          )}
          {errorCode === 'unauthorized' && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-100 ring-1 ring-inset ring-amber-400/20">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t('tvLink.errors.unauthorized')}
            </p>
          )}
          <div className="mt-6 grid gap-2.5">
            <button type="button" onClick={handleDiscordLogin} className={cn(pillBase, 'bg-[#5865F2] text-white hover:bg-[#4752C4]')}>
              <img src={DISCORD_LOGO} alt="" className="h-5 w-5 shrink-0 object-contain" />
              {t('tvLink.login.discord')}
            </button>
            <button type="button" onClick={handleGoogleLogin} className={cn(pillBase, 'bg-white text-zinc-900 hover:bg-zinc-100')}>
              <img src={GOOGLE_LOGO} alt="" className="h-[18px] w-[18px] shrink-0 object-contain" />
              {t('tvLink.login.google')}
            </button>
            <button type="button" onClick={handleBip39Login} className={cn(pillBase, 'bg-white/[0.06] text-white hover:bg-white/10')}>
              <KeyRound className="h-[18px] w-[18px] shrink-0 opacity-70" aria-hidden="true" />
              {t('tvLink.login.bip39')}
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
          <p className="mb-5 text-center text-base text-zinc-200">{t('tvLink.code.prompt')}</p>
          <TvCodeInput
            value={code}
            onChange={handleCodeChange}
            disabled={phase === 'linking'}
            invalid={errorCode === 'code_invalid'}
            calm={calm}
            label={t('tvLink.code.label')}
            describedBy={hintId}
          />
          <p id={hintId} className="mt-4 min-h-[1.25rem] text-center text-sm text-zinc-400" aria-live="polite">
            {phase === 'checking' ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {t('tvLink.code.checking')}
              </span>
            ) : phase === 'ready' && minutesLeft !== null ? (
              t('tvLink.code.expiresIn', { count: minutesLeft })
            ) : (
              t('tvLink.code.hint')
            )}
          </p>

          {errorMessage && (
            <p role="alert" className="mt-5 flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-100 ring-1 ring-inset ring-red-500/30">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {errorMessage}
            </p>
          )}

          <AnimatePresence initial={false}>
            {info && (phase === 'ready' || phase === 'linking') && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={fade}
                className="mt-6 space-y-5 border-t border-white/10 pt-6"
              >
                <p className="text-lg font-bold leading-snug text-white">
                  {t('tvLink.confirm.question', { name: deviceName })}
                </p>

                <div>
                  <p id={profileLabelId} className="mb-3 text-sm font-medium text-zinc-300">
                    {t('tvLink.confirm.profileLabel')}
                  </p>
                  {profilesLoading && profiles.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-zinc-400">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {t('tvLink.confirm.profilesLoading')}
                    </p>
                  ) : profiles.length === 0 ? (
                    <p className="text-sm text-zinc-400">{t('tvLink.confirm.noProfiles')}</p>
                  ) : (
                    <div role="radiogroup" aria-labelledby={profileLabelId} className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                      {profiles.map((profile) => {
                        const selected = profile.id === selectedProfileId;
                        return (
                          <button
                            key={profile.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={phase === 'linking'}
                            onClick={() => {
                              setSelectedProfileId(profile.id);
                              if (errorCode === 'profile_not_owned') setErrorCode(null);
                            }}
                            className="group flex min-w-0 flex-col items-center gap-2 rounded-xl p-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-60"
                          >
                            <span
                              className={cn(
                                'relative block aspect-square w-full max-w-[4.5rem] overflow-hidden rounded-xl ring-2 transition-shadow',
                                selected ? 'ring-red-600' : 'ring-transparent group-hover:ring-white/30',
                              )}
                            >
                              <img src={profile.avatar} alt="" className="h-full w-full object-cover" loading="lazy" />
                              {selected && (
                                <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white shadow">
                                  <Check className="h-3 w-3" aria-hidden="true" />
                                </span>
                              )}
                            </span>
                            <span className={cn('w-full truncate text-xs', selected ? 'font-semibold text-white' : 'text-zinc-400')}>
                              {profile.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!selectedProfileId || isBusy}
                  className={cn(pillBase, 'bg-red-600 text-base text-white hover:bg-red-700')}
                >
                  {phase === 'linking' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {phase === 'linking' ? t('tvLink.confirm.linking') : t('tvLink.confirm.cta')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default TvLinkPanel;
