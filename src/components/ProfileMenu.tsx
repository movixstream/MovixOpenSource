import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Check, ChevronDown, Crown, KeyRound, List, LogOut, Settings, Shield, Star, User } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { cn } from '@/lib/utils';
import { isHiddenOnTv } from '@/routing/registry';
import { googleAuth } from '../services/googleAuth';
import { discordAuth } from '../services/discordAuth';
import { useVipModal } from '../context/VipModalContext';
import { isUserVip } from '../utils/authUtils';
import { checkVipStatus } from '../utils/vipUtils';
import { useProfile } from '../context/ProfileContext';
import { broadcastAuthChange, clearStoredAuthSession } from '../utils/accountAuth';
import { readLocalStorage } from '../utils/browserStorage';
import { getOverlayPortalRoot } from '../utils/overlayPortal';
import { useIsDesktopNav } from '../hooks/useIsDesktopNav';
import { HoverHighlight, HoverHighlightItem } from './ui/hover-highlight';
import { LiquidButton } from './ui/liquid-button';
import HoldButton from './ui/hold-button';
import { LiquidDropdown, LiquidSheet } from './header/liquidMenu';
import { useSheetScrollLock } from './header/useSheetScrollLock';
import { HeaderPanelsContext } from './header/headerPanels';

/* ─── Menu profil et menu de connexion ───────────────────────────────────────
   Même liquide que le menu Explorer : sur ordinateur, la pastille du profil
   se remplit en gardant sa forme, puis une patte étroite coule de son centre
   jusqu'au menu, auquel elle reste collée ; sur mobile, le rond de l'avatar
   s'étire en panneau plein écran.
   Des lignes comme celles d'Explorer, un seul fond qui glisse de l'une à
   l'autre ; un seul bouton en couleur, Devenir VIP, que l'or remplit au
   survol ; la déconnexion n'est qu'une ligne, rouge au survol. */

const DEFAULT_AVATAR = 'https://as2.ftcdn.net/v2/jpg/05/89/93/27/1000_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.webp';
const DISCORD_LOGO = 'https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png';
const GOOGLE_LOGO = 'https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png';

type Provider = 'discord' | 'google' | 'bip39' | null;
type MenuVariant = 'panel' | 'sheet';

const readProvider = (): Provider => {
  if (readLocalStorage('discord_auth') === 'true') return 'discord';
  if (readLocalStorage('google_auth') === 'true') return 'google';
  if (readLocalStorage('bip39_auth') === 'true') return 'bip39';
  return null;
};

const onAvatarError = (event: React.SyntheticEvent<HTMLImageElement>) => {
  if (event.currentTarget.src !== DEFAULT_AVATAR) event.currentTarget.src = DEFAULT_AVATAR;
};

// Couleur pleine et opacité sur l'icône seule : une couleur translucide
// éclaircirait les croisements de ses tracés.
const ICON_CLASS = 'h-[18px] w-[18px] shrink-0 text-white opacity-45 transition-[color,opacity] duration-150 group-hover:opacity-90';
// Fond de survol simple du panneau mobile, seulement avec une souris
// (fenêtre étroite sur ordinateur) : au toucher, il resterait accroché.
const SHEET_HOVER = '[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/[0.05]';

const rowClass = (variant: MenuVariant, extra?: string) => cn(
  'group flex w-full items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors duration-150 active:bg-white/[0.07] focus-visible:ring-1 focus-visible:ring-white/25',
  variant === 'sheet' ? cn('py-3 text-base', SHEET_HOVER) : 'py-2.5 text-sm',
  extra ?? 'text-white/85',
);

/** Liste du menu : sur ordinateur, un même fond glisse de ligne en ligne. */
const MenuList: React.FC<{ variant: MenuVariant; className?: string; children: React.ReactNode }> = ({ variant, className, children }) => (
  variant === 'panel'
    ? <HoverHighlight className="rounded-xl bg-white/[0.06]"><ul className={className}>{children}</ul></HoverHighlight>
    : <ul className={className}>{children}</ul>
);

const MenuItem: React.FC<{ variant: MenuVariant; value: string; children: React.ReactNode }> = ({ variant, value, children }) => (
  variant === 'panel'
    ? <HoverHighlightItem itemValue={value}>{children}</HoverHighlightItem>
    : <li data-sheet-item>{children}</li>
);

const MenuDivider: React.FC = () => (
  <li aria-hidden="true" data-sheet-item className="mx-3 my-1.5 h-px bg-white/[0.07]" />
);

const ProfileMenu: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktopNav = useIsDesktopNav();
  const { host: panelHost, onProfileOpenChange } = useContext(HeaderPanelsContext);
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isVip, setIsVip] = useState(false);
  const [provider, setProvider] = useState<Provider>(null);
  const [canAccessAdminPanel, setCanAccessAdminPanel] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Use profile context for display data
  let currentProfile = null;
  try {
    const profileCtx = useProfile();
    currentProfile = profileCtx.currentProfile;
  } catch {
    // ProfileProvider might not be available yet
  }

  const profileImage = currentProfile?.avatar || DEFAULT_AVATAR;
  const username = currentProfile?.name || '';

  // Safe hook usage with error handling
  let openVipModal: (() => void) | null = null;
  try {
    const vipModal = useVipModal();
    openVipModal = vipModal.openVipModal;
  } catch {
    // Silently handle the error - VipModalProvider might not be available yet
    openVipModal = null;
  }

  useEffect(() => {
    let mounted = true;

    const checkAuth = () => {
      try {
        const auth = localStorage.getItem('auth');
        const discordAuthFlag = localStorage.getItem('discord_auth');
        const googleAuthFlag = localStorage.getItem('google_auth');
        const bip39Auth = localStorage.getItem('bip39_auth');
        const isVipUser = isUserVip();

        const isAuth = discordAuthFlag === 'true' || googleAuthFlag === 'true' || bip39Auth === 'true' || !!auth;

        setIsAuthenticated(isAuth);
        setIsVip(isVipUser);
        setProvider(readProvider());
      } catch {
        // Conserver l'état courant si le stockage est inaccessible.
      }
    };

    checkAuth();
    window.addEventListener('storage', checkAuth);
    window.addEventListener('vipStatusChanged', checkAuth);

    try {
      if (localStorage.getItem('access_code')) {
        void checkVipStatus().then(() => {
          if (mounted) checkAuth();
        });
      }
    } catch { /* Conserver l'état courant si le stockage est inaccessible. */ }

    return () => {
      mounted = false;
      window.removeEventListener('storage', checkAuth);
      window.removeEventListener('vipStatusChanged', checkAuth);
    };
  }, []);

  useEffect(() => {
    const checkAdminAccess = async () => {
      if (!isAuthenticated) {
        setCanAccessAdminPanel(false);
        return;
      }

      let authToken: string | null;
      try {
        authToken = localStorage.getItem('auth_token');
      } catch {
        return;
      }
      if (!authToken) {
        setCanAccessAdminPanel(false);
        return;
      }

      try {
        const response = await fetch(`${import.meta.env.VITE_MAIN_API}/api/admin/check`, {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });

        if (!response.ok) {
          setCanAccessAdminPanel(false);
          return;
        }

        const data = await response.json();
        const role = String(data?.admin?.role || '').toLowerCase();
        setCanAccessAdminPanel(role === 'admin' || role === 'uploader');
      } catch {
        setCanAccessAdminPanel(false);
      }
    };

    checkAdminAccess();
  }, [isAuthenticated]);

  const close = useCallback(() => setIsOpen(false), []);

  // Une autre page referme le menu.
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  // L'en-tête suit l'ouverture (dégradé et décor, sur mobile), dans la même
  // image que le panneau : avec un useEffect, il suivait une image plus tard.
  useLayoutEffect(() => {
    onProfileOpenChange?.(isOpen);
  }, [isOpen, onProfileOpenChange]);
  useEffect(() => () => onProfileOpenChange?.(false), [onProfileOpenChange]);

  // Clic ailleurs : le menu se referme ; Échap le referme et rend le focus au
  // bouton. Le menu d'ordinateur et le panneau mobile sont rendus ailleurs
  // (portails) : leurs clics restent intérieurs.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target) || sheetRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useSheetScrollLock(isOpen && !isDesktopNav, scrollerRef);

  const handleLogout = async () => {
    const sessionId = localStorage.getItem('session_id');
    const token = localStorage.getItem('auth_token');

    // Tenter de supprimer la session courante côté serveur si possible
    try {
      if (sessionId && token) {
        await fetch(`${import.meta.env.VITE_MAIN_API}/api/sessions/delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ sessionId })
        });
      }
    } catch (err) {
      console.error('Erreur suppression de la session lors de la déconnexion:', err);
    }

    try {
      clearStoredAuthSession();
      broadcastAuthChange();
    } catch { /* Stockage inaccessible : la redirection déconnecte quand même l'affichage. */ }
    setIsAuthenticated(false);
    setIsOpen(false);
    // Redirection simple (pas besoin de reload explicite)
    window.location.href = '/';
  };

  const handleLogin = () => {
    discordAuth.login();
  };

  const handleGoogleLogin = () => {
    googleAuth.login();
  };

  // Fonction pour ouvrir la modal VIP
  const showVipButton = isVip || !isHiddenOnTv('/vip');

  const handleOpenVipModal = () => {
    setIsOpen(false); // Fermer le menu de profil
    if (openVipModal) {
      openVipModal(); // Utiliser la fonction du contexte pour ouvrir la modal
    } else {
      // Fallback: rediriger vers la page de connexion VIP
      window.location.href = '/login-bip39';
    }
  };

  const handleSwitchProfile = () => {
    setIsOpen(false);
    navigate('/profile-selection');
  };

  // Sous le nom : la fin du VIP (la date est gardée à l'activation de la clé),
  // ou le compte utilisé pour se connecter.
  const vipStatus = () => {
    const raw = readLocalStorage('access_code_expires');
    const expires = raw && raw !== 'never' ? new Date(raw) : null;
    if (!expires || Number.isNaN(expires.getTime())) return t('vip.youAreVip');
    try {
      const date = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }).format(expires);
      return t('vip.activeUntil', { date });
    } catch {
      return t('vip.youAreVip');
    }
  };

  const providerStatus = () => {
    if (provider === 'bip39') return t('profile.connectedWithSecretPhrase');
    if (provider === 'discord') return `${t('profile.connectedWith')} Discord`;
    if (provider === 'google') return `${t('profile.connectedWith')} Google`;
    return t('profile.connectedUser');
  };

  const vipLine = (className?: string) => (
    <p className={cn('flex items-center gap-1 text-xs text-[#e2b13c]', className)}>
      <Crown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{vipStatus()}</span>
    </p>
  );

  const becomeVipButton = (
    <LiquidButton tone="gold" onClick={handleOpenVipModal}>
      <Crown className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span>{t('vip.becomeVip')}</span>
    </LiquidButton>
  );

  const navLinks = [
    { to: '/profile', label: t('profile.title'), Icon: User },
    { to: '/profile?tab=watchlist', label: t('profile.watchlist'), Icon: List },
    { to: '/profile?tab=favorites', label: t('common.favorites'), Icon: Star },
    { to: '/profile?tab=watched', label: t('profile.watched'), Icon: Check },
  ];

  const renderConnected = (variant: MenuVariant) => (
    <div className={variant === 'panel' ? 'p-2' : undefined}>
      <div data-sheet-item className="flex items-center gap-3 px-3 pb-3 pt-2">
        <img
          src={profileImage}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full object-cover"
          onError={onAvatarError}
        />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium leading-5 text-white">{username}</p>
          {isVip
            ? vipLine('mt-0.5')
            : <p className="mt-0.5 truncate text-xs text-white/45">{providerStatus()}</p>}
        </div>
      </div>

      <MenuList variant={variant}>
        {currentProfile && (
          <MenuItem variant={variant} value="switch-profile">
            <button type="button" onClick={handleSwitchProfile} className={rowClass(variant)}>
              <ArrowLeftRight className={ICON_CLASS} aria-hidden="true" />
              <span>{t('profile.switchProfile')}</span>
            </button>
          </MenuItem>
        )}
        <MenuDivider />
        {navLinks.map(({ to, label, Icon }) => (
          <MenuItem key={to} variant={variant} value={to}>
            <Link to={to} onClick={close} className={rowClass(variant)}>
              <Icon className={ICON_CLASS} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          </MenuItem>
        ))}
        <MenuDivider />
        <MenuItem variant={variant} value="/settings">
          <Link to="/settings" onClick={close} className={rowClass(variant)}>
            <Settings className={ICON_CLASS} aria-hidden="true" />
            <span>{t('settings.title')}</span>
          </Link>
        </MenuItem>
        {canAccessAdminPanel && !isHiddenOnTv('/admin') && (
          <MenuItem variant={variant} value="/admin">
            <Link to="/admin" onClick={close} className={rowClass(variant)}>
              <Shield className={ICON_CLASS} aria-hidden="true" />
              <span>{t('admin.adminPanel')}</span>
            </Link>
          </MenuItem>
        )}
      </MenuList>

      {/* L'invitation « Devenir VIP » mène à /vip, hors périmètre V1 sur TV ;
          le statut VIP, lui, reste affiché. */}
      {!isVip && showVipButton && (
        <div data-sheet-item className="px-1 pt-2">
          {becomeVipButton}
        </div>
      )}

      <div data-sheet-item className="px-1 pb-1 pt-2">
          {/* Déconnexion à maintenir (HoldButton de React Bits) : le rouge
              du site monte en vague dans le bouton, un clic de travers ne
              déconnecte plus. */}
          <HoldButton
            onHold={handleLogout}
            hint={t('auth.holdToLogout')}
            icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
            doneIcon={<LogOut className="h-4 w-4" aria-hidden="true" />}
            doneLabel={t('auth.logout')}
            backgroundColor="rgba(255, 255, 255, 0.04)"
            fillColor="#dc2626"
            textColor="rgba(255, 255, 255, 0.75)"
            fillTextColor="#ffffff"
            radius={12}
            holdTime={1200}
            glow={false}
            resetAfter={0}
            size={variant === 'sheet' ? 'lg' : 'md'}
            className="w-full text-sm"
          >
            {t('auth.holdToLogout')}
          </HoldButton>
      </div>
    </div>
  );

  const renderSignIn = (variant: MenuVariant) => (
    <div className={variant === 'panel' ? 'p-3' : 'px-1'}>
      <p data-sheet-item className="px-1 pb-3 pt-1 text-[13px] leading-relaxed text-white/50">
        {t('auth.loginPrompt')}
      </p>
      <div className="grid gap-2">
        <LiquidButton data-sheet-item onClick={handleLogin}>
          <img src={DISCORD_LOGO} alt="" className="h-5 w-5 shrink-0 object-contain" />
          <span>{t('auth.loginWithDiscord')}</span>
        </LiquidButton>
        <LiquidButton data-sheet-item onClick={handleGoogleLogin}>
          <img src={GOOGLE_LOGO} alt="" className="h-[18px] w-[18px] shrink-0 object-contain" />
          <span>{t('auth.loginWithGoogle')}</span>
        </LiquidButton>
        <LiquidButton data-sheet-item onClick={() => { window.location.href = '/login-bip39'; }}>
          <KeyRound className="h-[18px] w-[18px] shrink-0 text-white opacity-70" aria-hidden="true" />
          <span>{t('auth.secretPhrase')}</span>
        </LiquidButton>
      </div>
      <div data-sheet-item aria-hidden="true" className="mx-2 mb-1.5 mt-3 h-px bg-white/[0.07]" />
      <MenuList variant={variant}>
        <MenuItem variant={variant} value="/settings">
          <Link to="/settings" onClick={close} className={rowClass(variant)}>
            <Settings className={ICON_CLASS} aria-hidden="true" />
            <span>{t('settings.title')}</span>
          </Link>
        </MenuItem>
      </MenuList>
      {showVipButton && (
        <div data-sheet-item className="pt-2">
          {isVip ? vipLine('justify-center py-2') : becomeVipButton}
        </div>
      )}
    </div>
  );

  const renderContent = (variant: MenuVariant) => (isAuthenticated ? renderConnected(variant) : renderSignIn(variant));

  const displayName = isAuthenticated
    ? (username.length > 12 ? `${username.substring(0, 12)}...` : username)
    : t('auth.login');

  return (
    <div className="relative flex items-center">
      {/* Le bouton du profil : une pastille que le liquide du menu remplit à
          l'ouverture (bord et fond s'effacent alors). Sur téléphone, le rond
          de l'avatar seul. */}
      <button
        ref={triggerRef}
        type="button"
        data-profile-trigger
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={isAuthenticated ? (username || t('header.profile')) : t('auth.login')}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          'flex h-9 min-w-9 shrink-0 items-center justify-center gap-2 rounded-full border outline-none transition-[color,background-color,border-color] duration-200 focus-visible:ring-2 focus-visible:ring-white/40 sm:pl-1 sm:pr-2.5',
          isOpen
            ? 'border-transparent bg-transparent text-white'
            : 'border-transparent text-white/85 hover:text-white sm:border-white/10 sm:hover:border-white/20 sm:hover:bg-white/5',
        )}
      >
        <span className="relative shrink-0" data-profile-avatar>
          <img
            src={isAuthenticated ? profileImage : DEFAULT_AVATAR}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
            onError={onAvatarError}
            key={profileImage}
          />
          {isVip && (
            <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-black bg-[#e2b13c] text-[#241a06]">
              <Crown className="h-2 w-2" strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="hidden max-w-[80px] truncate text-sm font-medium sm:inline lg:max-w-[120px]">
          {displayName}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('hidden h-4 w-4 shrink-0 text-white opacity-70 transition-transform duration-200 sm:block', isOpen && 'rotate-180')}
        />
      </button>

      {/* Ordinateur : le menu coule du bouton, dans le calque de l'en-tête. */}
      {panelHost && createPortal(
        <AnimatePresence>
          {isOpen && isDesktopNav && (
            <LiquidDropdown
              key="profile-menu"
              id={menuId}
              data-profile-menu
              triggerRef={triggerRef}
              containerRef={panelRef}
              triggerRadius={18}
              panelRadius={20}
              neckWidth={36}
              align="end"
              panelClassName="w-72"
            >
              {renderContent('panel')}
            </LiquidDropdown>
          )}
        </AnimatePresence>,
        panelHost,
      )}

      {/* Mobile et tablette : le rond de l'avatar s'étire en panneau, porté
          dans la racine des surcouches comme le menu Explorer. */}
      {createPortal(
        <AnimatePresence>
          {isOpen && !isDesktopNav && (
            <LiquidSheet
              key="profile-sheet"
              id={menuId}
              data-profile-sheet
              triggerRef={triggerRef}
              triggerRadius={18}
              rootRef={sheetRef}
              scrollerRef={scrollerRef}
              onClose={close}
              contentClassName="px-2"
            >
              {renderContent('sheet')}
            </LiquidSheet>
          )}
        </AnimatePresence>,
        getOverlayPortalRoot(),
      )}
    </div>
  );
};

export default ProfileMenu;
