import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Snowfall from 'react-snowfall';
import { useLightMode } from '@/context/LightModeContext';
import { isHalloweenSeason, setHalloweenTheme, useHalloweenTheme } from '@/hooks/useHalloweenTheme';
import { HalloweenBatIcon, HalloweenLantern, HalloweenPumpkinIcon, HalloweenThemeToggleIcon } from './halloween/HalloweenIcons';
import { MovixWordmark } from './brand/MovixWordmark';
import { useLocation, useNavigate } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { isHiddenOnTv } from '@/routing/registry';
import { Film, Search, X, Star, Tv2, Users, Clapperboard, Bell, Tv, Lightbulb, Network, List, Radio, Unlock, ChevronDown, ExternalLink, LayoutGrid, Settings, Dices, Sparkles, HelpCircle, Github, CalendarDays, Puzzle, Smartphone, MonitorPlay } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ProfileMenu from './ProfileMenu';
import NotificationsPopup from './NotificationsPopup';
import { getUnreadNotificationsCount, getNotificationsDisabled } from '../services/apiNotificationService';
import { encodeId } from '../utils/idEncoder';

import { useSearch } from '../context/SearchContext';
import { isUserVip } from '../utils/authUtils';
import { checkVipStatus } from '../utils/vipUtils';
import { useTranslation } from 'react-i18next';
import { BurgerIcon, ExploreDesktopPanel, ExploreMobileSheet, type ExploreGroup } from './ExploreMenu';
import { LiquidDropdown, LiquidSheet } from './header/liquidMenu';
import { useSheetScrollLock } from './header/useSheetScrollLock';
import { HeaderPanelsContext, type HeaderPanels } from './header/headerPanels';
import { useIsDesktopNav } from '../hooks/useIsDesktopNav';
import { APRIL_FOOLS_ADMIN_PATH, isAprilFoolsAdminEnabled } from '../utils/aprilFools';
import { getOverlayPortalRoot } from '../utils/overlayPortal';
import { useAgeRestrictedContent } from '../hooks/useAgeRestrictedContent';
import { readLocalStorage, readSessionStorage } from '../utils/browserStorage';
import { IX_MATRIX_URL } from '@/config/community';
import { MatrixIcon } from './brand/MatrixIcon';

const Header: React.FC = () => {
  const { t } = useTranslation();
  const { effectivePrefs } = useLightMode();
  const halloween = useHalloweenTheme();
  // Citrouille qui allume ou éteint le thème : en octobre, ou dès que le thème
  // est actif pour pouvoir le couper ; le reste de l'année, seul le réglage.
  const showHalloweenToggle = halloween || isHalloweenSeason();
  const [isExploreOpen, setIsExploreOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const isDesktopNav = useIsDesktopNav();
  // Un panneau plein écran (Explorer, notifications ou profil) couvre la page.
  const isSheetOpen = !isDesktopNav && (isExploreOpen || showNotifications || isProfileOpen);
  const pauseDecor = isExploreOpen || showNotifications || isProfileOpen;

  // Signale un menu ouvert (Explorer, notifications ou profil, sur ordinateur
  // comme sur mobile) : le décor
  // Halloween se fige le temps du menu (voir halloween-decor.css).
  // L'attribut de pause va sur les trois conteneurs du décor, pas sur
  // <html> : une règle CSS lue depuis <html> recalculait le style de toute la
  // page (~100 ms bloquées sur Chrome Android, à l'ouverture comme à la
  // fermeture). Sur <html>, l'attribut ne sert plus qu'à
  // HalloweenWitchFlight, et aucune règle CSS ne le lit.
  useEffect(() => {
    if (!pauseDecor) return;
    const root = document.documentElement;
    const decor = document.querySelectorAll('.halloween-backdrop, .halloween-atmosphere, .halloween-overhead');
    root.setAttribute('data-explore-open', '');
    decor.forEach((el) => el.setAttribute('data-explore-paused', ''));
    return () => {
      root.removeAttribute('data-explore-open');
      decor.forEach((el) => el.removeAttribute('data-explore-paused'));
    };
  }, [pauseDecor]);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isSnowfallActive, setIsSnowfallActive] = useState(() => {
    return readSessionStorage('snowfall_active') === 'true';
  });
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  useEffect(() => {
    try { sessionStorage.setItem('snowfall_active', String(isSnowfallActive)); } catch { /* Préférence facultative. */ }
  }, [isSnowfallActive]);

  useEffect(() => {
    const handleSnowfallToggle = () => {
      setIsSnowfallActive(readSessionStorage('snowfall_active') === 'true');
    };
    window.addEventListener('snowfall_toggled', handleSnowfallToggle);
    return () => window.removeEventListener('snowfall_toggled', handleSnowfallToggle);
  }, []);

  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsDisabled, setNotificationsDisabled] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isVip, setIsVip] = useState(false);

  const [headerQuery, setHeaderQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const exploreRef = useRef<HTMLDivElement>(null);
  const exploreSheetRef = useRef<HTMLDivElement>(null);
  const exploreOverlayRef = useRef<HTMLDivElement>(null);
  const exploreTriggerRef = useRef<HTMLButtonElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const notificationsTriggerRef = useRef<HTMLButtonElement>(null);
  const notificationsSheetScrollerRef = useRef<HTMLDivElement>(null);
  // Calque de l'en-tête où coulent les menus d'ordinateur du profil (rendu
  // par ProfileMenu, en portail) : sous la ligne d'icônes, comme Explorer.
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
  const headerPanels = useMemo<HeaderPanels>(() => ({ host: panelHost, onProfileOpenChange: setIsProfileOpen }), [panelHost]);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const location = useLocation();
  const navigate = useNavigate();
  const isAprilFoolsAdminVisible = isAprilFoolsAdminEnabled(location.search);

  const {
    autocompleteSuggestions,
    loadingAutocomplete,
    fetchAutocompleteSuggestions,
    clearAutocompleteSuggestions
  } = useSearch();
  const { items: ageFilteredAutocomplete } = useAgeRestrictedContent(autocompleteSuggestions);

  // 4 items principaux visibles dans le header
  const mainNavItems = useMemo(() => [
    { name: t('nav.movies'), path: '/movies', icon: <Clapperboard size={16} />, isActive: location.pathname === '/movies' },
    { name: t('nav.tvShows'), path: '/tv-shows', icon: <Tv2 size={16} />, isActive: location.pathname === '/tv-shows' },
    { name: t('nav.anime'), path: '/anime', icon: <Sparkles size={16} />, isActive: location.pathname === '/anime' },
    { name: t('nav.search'), path: '/search', icon: <Search size={16} />, isActive: location.pathname === '/search' },
  ], [t, location.pathname]);

  // Groupes du mega menu — rangés par intention plutôt que par type de contenu :
  // ce que je cherche à voir / avec qui / ce qui passe maintenant / le reste.
  const exploreGroups: ExploreGroup[] = useMemo(() => [
    {
      // Trouver quoi regarder, du plus dirigé au plus sérendipitaire.
      title: t('nav.groupDiscover'),
      items: [
        { name: t('nav.collections'), path: '/collections', icon: <Film size={18} />, desc: t('nav.collectionsDesc') },
        { name: t('nav.top10'), path: '/top10', icon: <Star size={18} />, desc: t('nav.top10Desc') },
        { name: t('nav.suggestions'), path: '/suggestion', icon: <Sparkles size={18} />, desc: t('nav.suggestionsDesc') },
        { name: t('nav.roulette'), path: '/roulette', icon: <Dices size={18} />, desc: t('roulette.navDesc') },
        { name: t('nav.cinegraph'), path: '/cinegraph', icon: <Network size={18} />, desc: t('nav.cinegraphDesc') },
      ]
    },
    {
      // Tout ce qui implique d'autres utilisateurs — Watch Party compris.
      title: t('nav.groupCommunity'),
      items: [
        { name: t('nav.watchParty'), path: '/watchparty/list', icon: <Users size={18} />, desc: t('nav.watchPartyDesc') },
        { name: t('nav.sharedLists'), path: '/list-catalog', icon: <List size={18} />, desc: t('nav.sharedListsDesc') },
        { name: t('nav.greenlight'), path: '/wishboard', icon: <Lightbulb size={18} />, desc: t('nav.greenlightDesc') },
      ]
    },
    {
      // Ce qui passe en ce moment, puis ce qui arrive bientôt.
      title: t('nav.groupLive'),
      items: [
        { name: t('nav.liveTV'), path: '/live-tv', icon: <Tv size={18} />, desc: t('nav.liveTVDesc') },
        ...(isVip ? [{ name: t('nav.francetv'), path: '/ftv', icon: <Radio size={18} />, desc: t('nav.francetvDesc') }] : []),
        { name: t('nav.calendar'), path: '/calendar', icon: <CalendarDays size={18} />, desc: t('nav.calendarDesc') },
      ]
    },
    {
      // Movix hors du site : pour que les visiteurs découvrent les applis.
      title: t('nav.groupApps'),
      items: [
        { name: t('nav.appsExtension'), path: '/extension', icon: <Puzzle size={18} />, desc: t('nav.appsExtensionDesc') },
        { name: t('nav.appsMobile'), path: '/app', icon: <Smartphone size={18} />, desc: t('nav.appsMobileDesc') },
        { name: t('nav.appsTv'), path: '/app-tv', icon: <MonitorPlay size={18} />, desc: t('nav.appsTvDesc') },
      ]
    },
    {
      // Outils du compte d'abord, liens externes en dernier.
      title: t('nav.groupTools'),
      items: [
        ...(isVip ? [{ name: t('nav.debrid'), path: '/debrid', icon: <Unlock size={18} />, desc: t('nav.debridDesc') }] : []),
        { name: t('nav.settings'), path: '/settings', icon: <Settings size={18} />, desc: t('nav.settingsDesc') },
        { name: t('nav.helpHub'), path: '/help', icon: <HelpCircle size={18} />, desc: t('nav.helpHubDesc') },
        { name: t('nav.github'), path: 'https://github.com/movixstream/MovixOpenSource', icon: <Github size={18} />, desc: t('nav.githubDesc'), external: true },
        { name: t('footer.ourUrls'), path: 'https://movix.online', icon: <ExternalLink size={18} />, desc: t('nav.officialLinksDesc'), external: true },
      ]
    },
  ]
    // Sur TV, les entrées hors périmètre V1 (CinéGraph, Watch Party) mèneraient
    // à <NotFound /> : on les retire, puis on écarte les groupes vidés.
    .map(g => ({ ...g, items: g.items.filter(item => !isHiddenOnTv(item.path)) }))
    .filter(g => g.items.length > 0), [t, isVip]);

  // Auth
  useEffect(() => {
    let mounted = true;

    const checkAuth = () => {
      try {
        const auth = localStorage.getItem('auth');
        const discordAuth = localStorage.getItem('discord_auth');
        const googleAuth = localStorage.getItem('google_auth');
        const bip39Auth = localStorage.getItem('bip39_auth');
        const isVipUser = isUserVip();
        const isAuth = discordAuth === 'true' || googleAuth === 'true' || bip39Auth === 'true' || !!auth;
        setIsAuthenticated(isAuth);
        setIsVip(isVipUser);
      } catch {
        // Conserver l'affichage courant si le stockage devient inaccessible.
      }
    };
    checkAuth();
    window.addEventListener('storage', checkAuth);
    window.addEventListener('vipStatusChanged', checkAuth);

    if (readLocalStorage('access_code')) {
      void checkVipStatus().then(() => {
        if (mounted) checkAuth();
      });
    }

    return () => {
      mounted = false;
      window.removeEventListener('storage', checkAuth);
      window.removeEventListener('vipStatusChanged', checkAuth);
    };
  }, []);

  // Notifications
  const refreshUnreadCount = useCallback(async () => {
    if (!isAuthenticated) { setUnreadCount(0); return; }
    try {
      const count = await getUnreadNotificationsCount();
      setUnreadCount(count);
    } catch {
      setUnreadCount(0);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      refreshUnreadCount();
      getNotificationsDisabled().then(setNotificationsDisabled);
      const interval = setInterval(refreshUnreadCount, 30000);
      return () => clearInterval(interval);
    } else {
      setUnreadCount(0);
      setNotificationsDisabled(false);
    }
  }, [refreshUnreadCount, isAuthenticated]);

  useEffect(() => {
    const handler = (e: Event) => {
      setNotificationsDisabled((e as CustomEvent).detail);
    };
    window.addEventListener('notifications_disabled_changed', handler);
    return () => window.removeEventListener('notifications_disabled_changed', handler);
  }, []);

  // Click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (autocompleteRef.current && !autocompleteRef.current.contains(target)
        && !searchInputRef.current?.contains(target)
        && !mobileSearchInputRef.current?.contains(target)) {
        setShowAutocomplete(false);
      }
      // Le menu des notifications (déroulant ou panneau mobile) porte
      // data-notifications-popup : ses clics, liquide compris, restent
      // intérieurs.
      if (showNotifications && notificationsRef.current) {
        if (target.closest('[data-notification-button]') || target.closest('[data-notifications-popup]')) return;
        if (!notificationsRef.current.contains(target)) setShowNotifications(false);
      }
      // Le menu mobile est rendu en portail : ses clics restent intérieurs (son
      // voile referme le menu lui-même). Un toucher sur une icône de l'en-tête
      // ferme le menu et fait son action.
      if (isExploreOpen
        && !exploreRef.current?.contains(target)
        && !exploreSheetRef.current?.contains(target)
        && !target.closest('[data-explore-trigger]')) {
        setIsExploreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications, isExploreOpen]);

  // Échap ferme le menu et rend le focus au bouton qui l'a ouvert.
  useEffect(() => {
    if (!isExploreOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsExploreOpen(false);
      (isDesktopNav ? exploreTriggerRef : burgerRef).current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExploreOpen, isDesktopNav]);

  // Même chose pour les notifications : focus rendu à la cloche.
  useEffect(() => {
    if (!showNotifications) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowNotifications(false);
      notificationsTriggerRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showNotifications]);

  // Panneaux plein écran ouverts : la page derrière ne défile plus.
  useSheetScrollLock(isExploreOpen && !isDesktopNav, exploreOverlayRef);
  useSheetScrollLock(showNotifications && !isDesktopNav, notificationsSheetScrollerRef);

  const closeNotifications = useCallback(() => setShowNotifications(false), []);
  // Croix du menu d'ordinateur : le focus revient à la cloche.
  const closeNotificationsToBell = useCallback(() => {
    setShowNotifications(false);
    notificationsTriggerRef.current?.focus();
  }, []);

  // Cloche retirée menu ouvert (déconnexion, préférence arrivée en retard) :
  // le menu se ferme aussi, sinon la page restait verrouillée sans menu, puis
  // il se rouvrait tout seul au retour de la cloche.
  const notificationsAvailable = isAuthenticated && !notificationsDisabled;
  useEffect(() => {
    if (!notificationsAvailable) setShowNotifications(false);
  }, [notificationsAvailable]);

  // Reset on navigation
  useEffect(() => {
    clearAutocompleteSuggestions();
    setShowAutocomplete(false);
    setIsExploreOpen(false);
    setIsMobileSearchOpen(false);
    setShowNotifications(false);
    if (location.pathname !== '/search') setHeaderQuery('');
  }, [location.pathname]);

  // Autocomplete dropdown position
  const prevDropdownPosRef = useRef<{ top: number; left: number } | null>(null);
  const dropdownRafIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!showAutocomplete) return;
    const activeInput = isMobileSearchOpen ? mobileSearchInputRef.current : searchInputRef.current;
    if (!activeInput) return;
    const calcPos = () => {
      const inputRect = activeInput.getBoundingClientRect();
      const dropdownWidth = Math.min(400, window.innerWidth * 0.92);
      let left = inputRect.left + inputRect.width / 2 - dropdownWidth / 2;
      const margin = 8;
      if (left + dropdownWidth > window.innerWidth - margin) left = window.innerWidth - margin - dropdownWidth;
      if (left < margin) left = margin;
      const top = inputRect.bottom + 8;
      if (dropdownRafIdRef.current != null) cancelAnimationFrame(dropdownRafIdRef.current);
      dropdownRafIdRef.current = requestAnimationFrame(() => {
        dropdownRafIdRef.current = null;
        const prev = prevDropdownPosRef.current;
        if (prev && prev.top === top && prev.left === left) return;
        prevDropdownPosRef.current = { top, left };
        setDropdownStyle({ position: 'fixed', top, left, width: dropdownWidth });
      });
    };
    calcPos();
    window.addEventListener('resize', calcPos);
    window.addEventListener('scroll', calcPos, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', calcPos);
      window.removeEventListener('scroll', calcPos, { capture: true } as EventListenerOptions);
      if (dropdownRafIdRef.current != null) {
        cancelAnimationFrame(dropdownRafIdRef.current);
        dropdownRafIdRef.current = null;
      }
    };
  // autocompleteSuggestions intentionally excluded — body doesn't reference it;
  // including it churns listener registration on every keystroke
  }, [showAutocomplete, isMobileSearchOpen]);

  // Focus mobile search input when opened
  useEffect(() => {
    if (isMobileSearchOpen && mobileSearchInputRef.current) {
      mobileSearchInputRef.current.focus();
    }
  }, [isMobileSearchOpen]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setHeaderQuery(value);
    if (value.length >= 2) {
      fetchAutocompleteSuggestions(value);
      setShowAutocomplete(true);
    } else {
      clearAutocompleteSuggestions();
      setShowAutocomplete(false);
    }
  };

  const handleSelectAutocomplete = (item: any) => {
    clearAutocompleteSuggestions();
    setShowAutocomplete(false);
    setHeaderQuery('');
    setIsMobileSearchOpen(false);
    navigate(`/${item.media_type}/${encodeId(item.id)}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (headerQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(headerQuery)}`);
      clearAutocompleteSuggestions();
      setShowAutocomplete(false);
      setHeaderQuery('');
      setIsMobileSearchOpen(false);
    }
  };

  const closeExplore = useCallback(() => setIsExploreOpen(false), []);

  return (
    <HeaderPanelsContext.Provider value={headerPanels}>
      {/* L'en-tête (z-11000) reste au-dessus des panneaux mobiles (z-10999) :
          ses icônes forment la première ligne du panneau, la croix comprise.
          La zone qui défile commence sous lui, il peut donc garder ses
          clics. */}
      <header data-site-header className="!fixed inset-x-0 top-0 w-full z-[11000] transition-all duration-300">
        {/* Panneau mobile ouvert : le dégradé s'efface, sinon il assombrit le
            haut du panneau. Il se retire de bas en haut : il remonte hors de
            l'écran en s'effaçant, sans être écrasé, et redescend par le même
            chemin à la fermeture (transform et opacity seulement : composité). */}
        <div className={`absolute inset-0 pointer-events-none z-0 bg-gradient-to-b from-black/90 via-black/70 to-transparent [will-change:opacity,transform] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-opacity motion-reduce:!translate-y-0 ${isExploreOpen || showNotifications || isProfileOpen ? 'max-lg:!opacity-0 max-lg:-translate-y-full' : ''}`} aria-hidden="true" />
        {/* Même grille que le cadre du HeroSlider : 100vw comme `body`
            (index.css), 1920 px au plus, marges px-3 / sm:px-6 / md:px-12 /
            lg:px-20. Le logo et le profil tombent sur ses bords. 100vw et non
            la largeur de l'en-tête fixe : selon le navigateur, 100vw inclut
            la barre de défilement, sous laquelle passe toute la page. */}
        <div className="relative z-10 w-screen">
          <div className="max-w-[1920px] mx-auto">
            {/* La citrouille ajoute un bouton : sous 390 px, les écarts passent
                à ceux des petits écrans pour que la ligne tienne avec la
                cloche et l'avatar. Sous 361 px, marge de 8 px au lieu de 12
                pour la même raison. */}
            <div className={`flex items-center h-16 px-3 sm:px-6 md:px-12 lg:px-20 gap-3 md:gap-5 lg:gap-3 xl:gap-5 max-[360px]:gap-1 max-[360px]:px-2 ${showHalloweenToggle ? 'max-[389px]:gap-1' : ''}`}>

              {/* Logo */}
              <Link
                to="/"
                className="flex items-center hover:scale-105 transition-transform duration-300 flex-shrink-0"
                onClick={(e) => {
                  if (location.pathname === '/') {
                    e.preventDefault();
                    const lenis = (window as any).lenis;
                    if (lenis) {
                      lenis.scrollTo(0, { duration: 1.2 });
                    } else {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }
                }}
              >
                {/* Logo long [Movix] : rouge fixe hors palette, lettres claires. Le thème
                    Halloween lui ajoute une lueur et une chauve-souris. */}
                <span data-movix-logo className="inline-flex text-[#f4f4f0]">
                  <MovixWordmark className="h-[30px] w-auto md:h-9" />
                </span>
              </Link>

              <a
                href={IX_MATRIX_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('telegram.joinTelegram')}
                title={t('telegram.joinTelegram')}
                className="pointer-events-auto inline-flex h-11 w-11 shrink-0 items-center justify-center p-2 text-white group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <MatrixIcon className="h-5 w-5 shrink-0 opacity-80 transition-opacity duration-150 group-hover:opacity-100 motion-reduce:transition-none" />
              </a>

              {/* Desktop Nav: 3 items principaux + Explorer */}
              <nav className="hidden lg:flex items-center gap-1" data-main-nav>
                {mainNavItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-1.5 px-2 xl:px-3 py-1.5 rounded-lg text-sm transition-all duration-200 max-xl:[&>svg]:hidden ${
                      item.isActive
                        ? 'text-white bg-white/10 font-medium'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {item.icon}
                    <span>{item.name}</span>
                  </Link>
                ))}

                {isAprilFoolsAdminVisible && (
                  <Link
                    to={APRIL_FOOLS_ADMIN_PATH}
                    className={`ml-1 flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-all duration-200 ${
                      location.pathname === APRIL_FOOLS_ADMIN_PATH
                        ? 'border-amber-300/35 bg-amber-300/15 text-white'
                        : 'border-amber-300/20 bg-amber-300/10 text-amber-100 hover:border-amber-300/35 hover:bg-amber-300/15 hover:text-white'
                    }`}
                  >
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300/60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-200" />
                    </span>
                    <Settings size={15} />
                    <span>{t('aprilAdmin.navLabel')}</span>
                  </Link>
                )}

                {/* Bouton Explorer */}
                <button
                  ref={exploreTriggerRef}
                  type="button"
                  data-explore-trigger
                  aria-expanded={isExploreOpen}
                  aria-controls={isExploreOpen ? 'explore-menu' : undefined}
                  onClick={() => setIsExploreOpen(!isExploreOpen)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-[color,background-color,border-color] duration-200 border ${
                    isExploreOpen
                      // Ouvert : le liquide du menu le remplit et le borde.
                      ? 'text-white bg-transparent border-transparent'
                      : 'text-gray-400 hover:text-white border-white/10 hover:border-white/20 hover:bg-white/5'
                  }`}
                >
                  {halloween ? <HalloweenPumpkinIcon /> : <LayoutGrid size={15} />}
                  <span>{t('nav.explore')}</span>
                  {halloween
                    ? <HalloweenBatIcon className={`transition-transform duration-200 ${isExploreOpen ? 'rotate-180' : ''}`} />
                    : <ChevronDown size={14} className={`transition-transform duration-200 ${isExploreOpen ? 'rotate-180' : ''}`} />}
                </button>
              </nav>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Desktop Search. min-w-0 : c'est lui qui rétrécit quand la ligne
                  manque de place (marges du HeroSlider, 1024-1280 px) ; sans
                  lui, la largeur minimale du champ écrasait le profil. */}
              <div className="hidden md:block relative min-w-0 w-[14rem] lg:w-[15rem] xl:w-[20rem] 2xl:w-[22rem]">
                <form onSubmit={handleSearchSubmit} className="relative" data-header-search>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={headerQuery}
                    onChange={handleQueryChange}
                    placeholder={t('header.searchPlaceholder')}
                    className="w-full py-2 pl-9 pr-3 bg-white/5 text-white rounded-xl border border-white/10 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30 focus:bg-white/10 placeholder-gray-500 text-sm transition-all"
                  />
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  {headerQuery && (
                    <button
                      type="button"
                      onClick={() => { setHeaderQuery(''); clearAutocompleteSuggestions(); setShowAutocomplete(false); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  )}
                </form>
              </div>

              {/* Right section */}
              <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
                {isAprilFoolsAdminVisible && (
                  <Link
                    to={APRIL_FOOLS_ADMIN_PATH}
                    aria-label={t('aprilAdmin.mobileAriaLabel')}
                    className={`relative flex items-center justify-center rounded-xl border p-2 transition-colors lg:hidden ${
                      location.pathname === APRIL_FOOLS_ADMIN_PATH
                        ? 'border-amber-300/35 bg-amber-300/15 text-white'
                        : 'border-amber-300/20 bg-amber-300/10 text-amber-100 hover:border-amber-300/35 hover:bg-amber-300/15 hover:text-white'
                    }`}
                  >
                    <Settings size={18} />
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-200 shadow-[0_0_10px_rgba(253,230,138,0.85)]" />
                  </Link>
                )}

                {/* Mobile search icon */}
                <motion.button
                  className="md:hidden p-2 text-gray-400 hover:text-white transition-colors"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsMobileSearchOpen(true)}
                >
                  <Search size={20} />
                </motion.button>

                {/* Thème Halloween : la citrouille l'allume ou l'éteint. Sous
                    346 px, la ligne ne tient plus : le réglage reste. */}
                {showHalloweenToggle && (
                  <motion.button
                    type="button"
                    data-halloween-toggle
                    className="group flex items-center justify-center p-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 max-[345px]:hidden"
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setHalloweenTheme(!halloween)}
                    aria-label={t('settings.halloweenTheme')}
                    aria-pressed={halloween}
                    title={t(halloween ? 'header.halloweenOff' : 'header.halloweenOn')}
                  >
                    <HalloweenThemeToggleIcon lit={halloween} />
                  </motion.button>
                )}

                {/* Notifications : le menu coule de la cloche (rond de 36 px),
                    voir plus bas. Sur ordinateur, pas d'enfoncement au clic :
                    le liquide prend la mesure du bouton à l'ouverture. */}
                {isAuthenticated && !notificationsDisabled && (
                  <div className="relative" ref={notificationsRef}>
                    <motion.button
                      ref={notificationsTriggerRef}
                      type="button"
                      data-notification-button
                      aria-label={t('notifications.title')}
                      aria-expanded={showNotifications}
                      className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-colors ${showNotifications ? 'text-white' : 'text-gray-400 hover:text-white'}`}
                      whileTap={isDesktopNav ? undefined : { scale: 0.9 }}
                      onClick={() => setShowNotifications(!showNotifications)}
                    >
                      <Bell size={20} />
                      {/* La lanterne pend sous la cloche, là où coule le menu. */}
                      {/* Elle s'efface avant que le liquide la couvre, et ne
                          revient qu'une fois le panneau rentré (300 ms). */}
                      {halloween && (
                        <HalloweenLantern
                          className={`transition-opacity motion-reduce:transition-none ${showNotifications || isSheetOpen ? 'opacity-0 duration-100' : 'opacity-100 delay-300 duration-150'}`}
                        />
                      )}
                      {unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[10px] rounded-full h-4 min-w-4 flex items-center justify-center px-1 font-bold">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </motion.button>
                  </div>
                )}

                {/* Profile */}
                <div className="flex items-center cursor-pointer relative shrink-0">
                  <ProfileMenu />
                </div>

                {/* Mobile/Tablet : le panneau Explorer sort de ce rond, de même
                    taille et de même teinte que lui au départ. 36 px, comme
                    les autres icônes : la ligne tient encore à 375 px avec la
                    citrouille. */}
                <motion.button
                  ref={burgerRef}
                  type="button"
                  className="lg:hidden flex h-9 w-9 shrink-0 items-center justify-center group rounded-full bg-white/[0.07] text-white"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsExploreOpen(!isExploreOpen)}
                  data-explore-trigger
                  aria-label={t('header.menu')}
                  aria-expanded={isExploreOpen}
                  aria-controls={isExploreOpen ? 'explore-menu' : undefined}
                >
                  <BurgerIcon open={isExploreOpen} />
                </motion.button>
              </div>
            </div>
          </div>
        </div>

        {/* Menu Explorer sur ordinateur : il se déroule depuis son bouton. */}
        <AnimatePresence>
          {isExploreOpen && isDesktopNav && (
            <ExploreDesktopPanel
              key="explore-desktop"
              groups={exploreGroups}
              pathname={location.pathname}
              label={t('nav.explore')}
              triggerRef={exploreTriggerRef}
              containerRef={exploreRef}
              onNavigate={closeExplore}
            />
          )}
        </AnimatePresence>

        {/* Notifications sur ordinateur : la cloche se remplit et coule dans
            le menu, calé sur le bord droit de la grille. */}
        <AnimatePresence>
          {showNotifications && isAuthenticated && !notificationsDisabled && isDesktopNav && (
            <LiquidDropdown
              key="notifications-desktop"
              data-notifications-menu
              data-notifications-popup
              triggerRef={notificationsTriggerRef}
              triggerRadius={18}
              panelRadius={20}
              neckWidth={16}
              align="end"
              panelClassName="w-96"
            >
              <NotificationsPopup variant="panel" onClose={closeNotificationsToBell} onNotificationUpdate={refreshUnreadCount} />
            </LiquidDropdown>
          )}
        </AnimatePresence>

        {/* Calque des menus d'ordinateur rendus par d'autres composants (le
            profil) : sans boîte, ses menus se placent dans l'en-tête. */}
        <div ref={setPanelHost} data-header-panels className="contents" />
      </header>

      {/* Menu Explorer mobile/tablette. Porté dans la racine de surcouches
          (enfant direct de <body>) plutôt que rendu sur place. Sur place, la
          chaîne d'ancêtres du menu est #movix-fullscreen-host (`relative
          overflow-clip`) → #root (`overflow-x: clip`) → body (`position:
          relative; overflow-x: clip`). C'est la configuration connue pour
          casser `position: fixed` sur iOS WebKit : le panneau est clippé ou
          mal dimensionné de façon intermittente selon l'état de la barre
          d'outils, et la zone qui défile se retrouve avec scrollHeight ==
          clientHeight — le menu s'affiche mais ne défile plus. Le portail sort
          des deux `clip` intérieurs et rend le dimensionnement de nouveau
          relatif au viewport. La zone qui défile a ses quatre bords fixés :
          aucune chaîne de height:100% que WebKit pourrait résoudre en `auto`. */}
      {createPortal(
        <AnimatePresence>
          {isExploreOpen && !isDesktopNav && (
            <ExploreMobileSheet
              key="explore-mobile"
              groups={exploreGroups}
              mainItems={mainNavItems}
              pathname={location.pathname}
              label={t('nav.explore')}
              triggerRef={burgerRef}
              rootRef={exploreSheetRef}
              scrollerRef={exploreOverlayRef}
              onClose={closeExplore}
            />
          )}
        </AnimatePresence>,
        getOverlayPortalRoot(),
      )}

      {/* Notifications sur mobile et tablette : le rond de la cloche s'étire
          en panneau, porté dans la même racine que le menu Explorer. */}
      {createPortal(
        <AnimatePresence>
          {showNotifications && isAuthenticated && !notificationsDisabled && !isDesktopNav && (
            <LiquidSheet
              key="notifications-sheet"
              data-notifications-sheet
              data-notifications-popup
              triggerRef={notificationsTriggerRef}
              triggerRadius={18}
              scrollerRef={notificationsSheetScrollerRef}
              onClose={closeNotifications}
              contentClassName="px-1"
            >
              <NotificationsPopup variant="sheet" onClose={closeNotifications} onNotificationUpdate={refreshUnreadCount} />
            </LiquidSheet>
          )}
        </AnimatePresence>,
        getOverlayPortalRoot(),
      )}

      {/* Mobile Search Overlay */}
      <AnimatePresence>
        {isMobileSearchOpen && (
          <motion.div
            className="md:hidden fixed inset-x-0 top-0 z-[11002] bg-black/95 p-4"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-3">
              <div className="flex-1 relative">
                <input
                  ref={mobileSearchInputRef}
                  type="text"
                  value={headerQuery}
                  onChange={handleQueryChange}
                  placeholder={t('header.searchPlaceholder')}
                  className="w-full py-3 pl-10 pr-4 bg-white/10 text-white rounded-xl border border-white/15 focus:outline-none focus:border-red-500/50 placeholder-gray-500 text-sm"
                />
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              </div>
              <button
                type="button"
                onClick={() => { setIsMobileSearchOpen(false); setHeaderQuery(''); clearAutocompleteSuggestions(); setShowAutocomplete(false); }}
                className="p-2 text-gray-400 hover:text-white"
              >
                <X size={22} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Autocomplete dropdown (shared between desktop & mobile search) */}
      <AnimatePresence>
        {showAutocomplete && ageFilteredAutocomplete.length > 0 && (
          <motion.div
            ref={autocompleteRef}
            className="bg-black/95 border border-white/15 rounded-xl shadow-2xl z-[12000] overflow-hidden"
            style={dropdownStyle}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="py-2">
              {loadingAutocomplete ? (
                <div className="flex justify-center items-center py-4">
                  <div className="w-5 h-5 border-2 border-gray-600 border-t-red-600 rounded-full animate-spin" />
                </div>
              ) : (
                <ul>
                  {ageFilteredAutocomplete.map((item: any) => (
                    <li key={item.id} className="px-2">
                      <button
                        className="w-full flex items-center py-2 px-3 hover:bg-white/5 rounded-lg transition-colors"
                        onClick={() => handleSelectAutocomplete(item)}
                      >
                        <div className="flex-shrink-0 w-10 h-15 rounded overflow-hidden mr-3">
                          {item.poster_path ? (
                            <img
                              src={`https://image.tmdb.org/t/p/w92${item.poster_path}`}
                              alt={item.title || item.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                              <Film size={20} className="text-gray-500" />
                            </div>
                          )}
                        </div>
                        <div className="text-left flex-1 min-w-0">
                          <div className="font-medium text-white text-sm line-clamp-1">{item.title || item.name}</div>
                          <div className="text-xs text-gray-400 flex items-center">
                            <span className="capitalize">{item.media_type === 'movie' ? t('nav.movies') : t('nav.tvShows')}</span>
                            {item.vote_average > 0 && (
                              <>
                                <span className="mx-1.5">•</span>
                                <span className="flex items-center">
                                  <Star size={12} className="text-yellow-500 mr-0.5" />
                                  {item.vote_average.toFixed(1)}
                                </span>
                              </>
                            )}
                            {(item.release_date || item.first_air_date) && (
                              <>
                                <span className="mx-1.5">•</span>
                                <span>{new Date(item.release_date || item.first_air_date).getFullYear()}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                  <li className="mt-1 pt-1 border-t border-white/10">
                    <Link
                      to={`/search?q=${encodeURIComponent(headerQuery)}`}
                      className="block w-full text-center py-2 text-sm text-gray-400 hover:text-white"
                      onClick={() => { setShowAutocomplete(false); setHeaderQuery(''); setIsMobileSearchOpen(false); }}
                    >
                      {t('search.seeAllResults')}
                    </Link>
                  </li>
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spacer */}
      <div className="w-full h-0" aria-hidden="true" />

      {isSnowfallActive && effectivePrefs.bgAnimations && (
        <Snowfall
          style={{
            position: 'fixed',
            width: '100vw',
            height: '100vh',
            zIndex: 2147483647,
            pointerEvents: 'none',
          }}
        />
      )}
    </HeaderPanelsContext.Provider>
  );
};

export default Header;
