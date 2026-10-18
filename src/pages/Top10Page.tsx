import React, { useLayoutEffect, useEffect, useState, useCallback, useRef, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { motion, AnimatePresence } from 'framer-motion';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import {
  ArrowLeft, Trophy, Film, Tv, Sparkles, Users, Clock, Eye,
  BarChart3, ChevronDown, TrendingUp, Timer, Star, Hash,
  Activity, Flame, CalendarDays
} from 'lucide-react';
import { SquareBackground } from '../components/ui/square-background';
import BlurText from '../components/ui/blur-text';
import ShinyText from '../components/ui/shiny-text';
import AnimatedBorderCard from '../components/ui/animated-border-card';
import { Skeleton } from '../components/ui/Skeleton';

const MAIN_API = import.meta.env.VITE_MAIN_API;
const TMDB_IMAGE_URL = 'https://image.tmdb.org/t/p';

/**
 * Format a number in compact notation:
 * - < 1000: "845" with locale separator → "845"
 * - >= 1000: "3 960" (with space separator) or "57.1k" / "1.2M"
 * useCompact=true  → "57.1k", "1.2M"
 * useCompact=false → "3 960" (french locale with non-breaking space)
 */
function formatNumber(n: number, useCompact = false): string {
  if (useCompact) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return n.toLocaleString(i18n.language);
  }
  return n.toLocaleString(i18n.language);
}

/** Format hours in compact notation: 92.4k, 2.9k, 340 */
function formatHours(h: number): string {
  if (h >= 1_000) return `${(h / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (h >= 100) return Math.round(h).toLocaleString(i18n.language);
  return h.toFixed(1);
}

// Types
interface Top10Entry {
  rank: number;
  contentId: string;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  voteAverage: number | null;
  genres: string[];
  releaseDate: string | null;
  uniqueViewers: number;
  totalHours: number;
  totalSessions: number;
  avgSessionMinutes: number;
  episodesWatched?: number;
}

interface GlobalStats {
  totalActiveUsers: number;
  totalUniqueContent: number;
  totalHoursWatched: number;
  totalSessions: number;
  avgSessionMinutes: number;
  dataFrom: string | null;
  dataTo: string | null;
}

type TabType = 'movies' | 'tv' | 'anime';

interface Top10OverviewResponse {
  success: boolean;
  type: TabType;
  top10: Top10Entry[];
  stats: GlobalStats | null;
  updatedAt: string | null;
}

const tabs: { id: TabType; labelKey: string; icon: React.ReactNode; color: string }[] = [
  { id: 'movies', labelKey: 'top10.movies', icon: <Film className="w-4 h-4" />, color: '#f59e0b' },
  { id: 'tv', labelKey: 'top10.tvShows', icon: <Tv className="w-4 h-4" />, color: '#6366f1' },
  { id: 'anime', labelKey: 'top10.anime', icon: <Sparkles className="w-4 h-4" />, color: '#ec4899' },
];

type PeriodType = 'day' | 'week' | 'month' | 'year' | 'all';
type AlgoType = 'viewers' | 'hours' | 'sessions';

const periodOptions: { id: PeriodType; labelKey: string }[] = [
  { id: 'day', labelKey: 'top10.filters.day' },
  { id: 'week', labelKey: 'top10.filters.week' },
  { id: 'month', labelKey: 'top10.filters.month' },
  { id: 'year', labelKey: 'top10.filters.year' },
  { id: 'all', labelKey: 'top10.filters.all' },
];

const algoOptions: { id: AlgoType; labelKey: string; icon: React.ReactNode }[] = [
  { id: 'viewers', labelKey: 'top10.filters.algoViewers', icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'hours', labelKey: 'top10.filters.algoHours', icon: <Clock className="w-3.5 h-3.5" /> },
  { id: 'sessions', labelKey: 'top10.filters.algoSessions', icon: <Eye className="w-3.5 h-3.5" /> },
];

const tabIds: TabType[] = ['movies', 'tv', 'anime'];
const emptyTop10ByTab: Record<TabType, Top10Entry[]> = { movies: [], tv: [], anime: [] };
const emptyStatsByTab: Record<TabType, GlobalStats | null> = { movies: null, tv: null, anime: null };
const emptyBooleanByTab: Record<TabType, boolean> = { movies: false, tv: false, anime: false };
const emptyErrorByTab: Record<TabType, string | null> = { movies: null, tv: null, anime: null };
const emptyUpdatedAtByTab: Record<TabType, string | null> = { movies: null, tv: null, anime: null };

// Rank badge colors
const rankColors: Record<number, { bg: string; text: string; border: string; glow: string }> = {
  1: { bg: 'rgba(255,215,0,0.15)', text: '#FFD700', border: 'rgba(255,215,0,0.5)', glow: '0 0 20px rgba(255,215,0,0.3)' },
  2: { bg: 'rgba(192,192,192,0.12)', text: '#C0C0C0', border: 'rgba(192,192,192,0.4)', glow: '0 0 15px rgba(192,192,192,0.2)' },
  3: { bg: 'rgba(205,127,50,0.12)', text: '#CD7F32', border: 'rgba(205,127,50,0.4)', glow: '0 0 15px rgba(205,127,50,0.2)' },
};

// FAQ items about methodology
const methodologyItems = [
  { questionKey: 'top10.faq.q1', answerKey: 'top10.faq.a1' },
  { questionKey: 'top10.faq.q2', answerKey: 'top10.faq.a2' },
  { questionKey: 'top10.faq.q3', answerKey: 'top10.faq.a3' },
  { questionKey: 'top10.faq.q4', answerKey: 'top10.faq.a4' },
  { questionKey: 'top10.faq.q5', answerKey: 'top10.faq.a5' },
  { questionKey: 'top10.faq.q6', answerKey: 'top10.faq.a6' },
];

const Top10Page: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('movies');
  const [period, setPeriod] = useState<PeriodType>('all');
  const [algo, setAlgo] = useState<AlgoType>('viewers');
  const [top10Data, setTop10Data] = useState<Record<TabType, Top10Entry[]>>(emptyTop10ByTab);
  const [statsByTab, setStatsByTab] = useState<Record<TabType, GlobalStats | null>>(emptyStatsByTab);
  const [loadingTabs, setLoadingTabs] = useState<Record<TabType, boolean>>(emptyBooleanByTab);
  const [loadedTabs, setLoadedTabs] = useState<Record<TabType, boolean>>(emptyBooleanByTab);
  const [errorsByTab, setErrorsByTab] = useState<Record<TabType, string | null>>(emptyErrorByTab);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [updatedAtByTab, setUpdatedAtByTab] = useState<Record<TabType, string | null>>(emptyUpdatedAtByTab);
  const loadedTabsRef = useRef<Record<TabType, boolean>>(emptyBooleanByTab);
  const statsByTabRef = useRef<Record<TabType, GlobalStats | null>>(emptyStatsByTab);
  const top10RequestsRef = useRef<Set<TabType>>(new Set());
  const statsRequestsRef = useRef<Set<TabType>>(new Set());
  const overviewRequestsRef = useRef<Set<TabType>>(new Set());
  // Current filters key: responses from an older filter combo are dropped.
  const filtersKeyRef = useRef('all:viewers');

  const applyFilters = useCallback((nextPeriod: PeriodType, nextAlgo: AlgoType) => {
    if (filtersKeyRef.current === `${nextPeriod}:${nextAlgo}`) return;
    filtersKeyRef.current = `${nextPeriod}:${nextAlgo}`;
    loadedTabsRef.current = emptyBooleanByTab;
    statsByTabRef.current = emptyStatsByTab;
    top10RequestsRef.current.clear();
    statsRequestsRef.current.clear();
    overviewRequestsRef.current.clear();
    setPeriod(nextPeriod);
    setAlgo(nextAlgo);
    setTop10Data(emptyTop10ByTab);
    setStatsByTab(emptyStatsByTab);
    setLoadedTabs(emptyBooleanByTab);
    setLoadingTabs(emptyBooleanByTab);
    setErrorsByTab(emptyErrorByTab);
    setUpdatedAtByTab(emptyUpdatedAtByTab);
  }, []);

  // Hide footer.
  // The previous implementation also ran a `setInterval(..., 100)` polling
  // `document.querySelector('footer')` for the entire page lifetime, which
  // wasted main-thread time and prevented idle callbacks from firing. The
  // useLayoutEffect below is sufficient on its own. — perf
  useLayoutEffect(() => {
    const footer = document.querySelector('footer');
    if (footer) footer.style.display = 'none';
    document.body.classList.add('no-footer-page');
    return () => {
      if (footer) footer.style.display = '';
      document.body.classList.remove('no-footer-page');
    };
  }, []);

  useEffect(() => {
    loadedTabsRef.current = loadedTabs;
  }, [loadedTabs]);

  useEffect(() => {
    statsByTabRef.current = statsByTab;
  }, [statsByTab]);

  const applyOverviewPayload = useCallback((
    type: TabType,
    payload: { top10?: Top10Entry[]; stats?: GlobalStats | null; updatedAt?: string | null },
    options?: { background?: boolean; markLoaded?: boolean; clearError?: boolean },
  ) => {
    const commit = () => {
      if (payload.top10 !== undefined) {
        setTop10Data(prev => ({ ...prev, [type]: payload.top10! }));
      }
      if (payload.stats !== undefined) {
        setStatsByTab(prev => ({ ...prev, [type]: payload.stats ?? null }));
      }
      if (payload.updatedAt !== undefined) {
        setUpdatedAtByTab(prev => ({ ...prev, [type]: payload.updatedAt ?? null }));
      }
      if (options?.markLoaded) {
        setLoadedTabs(prev => ({ ...prev, [type]: true }));
      }
      if (options?.clearError) {
        setErrorsByTab(prev => ({ ...prev, [type]: null }));
      }
    };

    if (options?.background) {
      startTransition(commit);
      return;
    }

    commit();
  }, []);

  // Fetch data
  const fetchTop10 = useCallback(async (type: TabType, options?: { background?: boolean; signal?: AbortSignal }) => {
    if (loadedTabsRef.current[type] || top10RequestsRef.current.has(type)) return;

    const requestKey = `${period}:${algo}`;
    top10RequestsRef.current.add(type);
    setLoadingTabs(prev => ({ ...prev, [type]: true }));

    try {
      const response = await fetch(`${MAIN_API}/api/top10/${type}?period=${period}&algo=${algo}`, { signal: options?.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success && filtersKeyRef.current === requestKey) {
        applyOverviewPayload(
          type,
          { top10: data.top10, updatedAt: data.updatedAt ?? null },
          { background: options?.background, markLoaded: true, clearError: true },
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(`[Top10] Error fetching ${type}:`, err);
      if (filtersKeyRef.current === requestKey) {
        setErrorsByTab(prev => ({ ...prev, [type]: 'top10.loadError' }));
      }
    } finally {
      top10RequestsRef.current.delete(type);
      setLoadingTabs(prev => ({ ...prev, [type]: false }));
    }
  }, [applyOverviewPayload, period, algo]);

  const fetchStats = useCallback(async (type: TabType, options?: { background?: boolean; signal?: AbortSignal }) => {
    if (statsByTabRef.current[type] || statsRequestsRef.current.has(type)) return;

    const requestKey = `${period}:${algo}`;
    statsRequestsRef.current.add(type);

    try {
      const response = await fetch(`${MAIN_API}/api/top10/stats?type=${type}&period=${period}`, { signal: options?.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success && filtersKeyRef.current === requestKey) {
        applyOverviewPayload(
          type,
          { stats: data.stats ?? null },
          { background: options?.background },
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(`[Top10] Error fetching stats ${type}:`, err);
    } finally {
      statsRequestsRef.current.delete(type);
    }
  }, [applyOverviewPayload, period, algo]);

  const fetchOverview = useCallback(async (type: TabType, options?: { background?: boolean; signal?: AbortSignal }) => {
    if (loadedTabsRef.current[type] || overviewRequestsRef.current.has(type)) return;

    const requestKey = `${period}:${algo}`;
    overviewRequestsRef.current.add(type);
    setLoadingTabs(prev => ({ ...prev, [type]: true }));

    try {
      const response = await fetch(`${MAIN_API}/api/top10/overview?type=${type}&period=${period}&algo=${algo}`, { signal: options?.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: Top10OverviewResponse = await response.json();
      if (data.success && filtersKeyRef.current === requestKey) {
        applyOverviewPayload(
          type,
          {
            top10: data.top10,
            stats: data.stats ?? null,
            updatedAt: data.updatedAt ?? null,
          },
          { background: options?.background, markLoaded: true, clearError: true },
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(`[Top10] Error fetching overview ${type}:`, err);
      if (filtersKeyRef.current === requestKey) {
        setErrorsByTab(prev => ({ ...prev, [type]: 'top10.loadError' }));
      }
    } finally {
      overviewRequestsRef.current.delete(type);
      setLoadingTabs(prev => ({ ...prev, [type]: false }));
    }
  }, [applyOverviewPayload, period, algo]);

  // Chargement initial uniquement — au changement de filtre c'est l'effect
  // ci-dessous qui refetch l'onglet actif (sinon on relançait movies à chaque
  // changement même depuis un autre onglet = agrégat SQL lourd gaspillé).
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    const controller = new AbortController();
    void fetchTop10('movies', { signal: controller.signal });
    void fetchStats('movies', { background: true, signal: controller.signal });
    return () => controller.abort();
  }, [fetchTop10, fetchStats]);

  useEffect(() => {
    if (!loadedTabs[activeTab]) {
      if (top10RequestsRef.current.has(activeTab) || overviewRequestsRef.current.has(activeTab)) return;
      void fetchOverview(activeTab);
      return;
    }

    if (!statsByTab[activeTab] && !statsRequestsRef.current.has(activeTab)) {
      void fetchStats(activeTab, { background: true });
    }
  }, [activeTab, loadedTabs, statsByTab, fetchOverview, fetchStats]);

  useEffect(() => {
    if (!loadedTabs[activeTab]) return;
    // Prefetch des autres onglets seulement sur le combo par défaut (cache
    // serveur chaud). Avec des filtres actifs, chaque combo est potentiellement
    // froid : précharger 2 onglets = 2 gros agrégats SQL en plus pour rien.
    if (period !== 'all' || algo !== 'viewers') return;

    const remainingTabs = tabIds.filter(tab => tab !== activeTab && !loadedTabs[tab]);
    if (remainingTabs.length === 0) return;

    const timers = remainingTabs.map((tab, index) =>
      window.setTimeout(() => {
        if (!loadedTabsRef.current[tab]) {
          void fetchOverview(tab, { background: true });
        }
      }, 400 + index * 250),
    );

    return () => {
      timers.forEach(timer => window.clearTimeout(timer));
    };
  }, [activeTab, loadedTabs, fetchOverview, period, algo]);

  const activeTabConfig = tabs.find(t => t.id === activeTab)!;
  const currentData = top10Data[activeTab];
  const currentStats = statsByTab[activeTab];
  const currentError = errorsByTab[activeTab];
  const isCurrentTabLoading = loadingTabs[activeTab] && !loadedTabs[activeTab];
  const lastUpdated = updatedAtByTab[activeTab];

  // Compute average vote from current tab's data
  const avgVote = (() => {
    const rated = currentData.filter(e => e.voteAverage && e.voteAverage > 0);
    if (rated.length === 0) return '0.00';
    const avg = rated.reduce((sum, e) => sum + (e.voteAverage || 0), 0) / rated.length;
    return avg.toFixed(2);
  })();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
  };

  return (
    <SquareBackground squareSize={48} borderColor="rgba(99, 102, 241, 0.08)" className="min-h-screen bg-black text-white">
      <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 relative z-10 h-full overflow-y-auto">
        {/* Back */}
        <Link to="/" className="inline-flex items-center text-white/50 hover:text-white transition-colors mb-8 group/icon">
          <ArrowLeft className="w-5 h-5 mr-2 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity]" />
          {t('common.backToHome')}
        </Link>

        {/* Hero */}
        <div className="max-w-4xl mx-auto text-center mb-14">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mb-6">
            <div className="inline-flex items-center justify-center p-3 bg-amber-500/10 rounded-full mb-4 ring-1 ring-amber-500/40">
              <Trophy className="w-8 h-8 text-amber-500" />
            </div>
            <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-4 pb-4 flex flex-col items-center gap-1">
              <ShinyText text="Top 10 Movix" speed={3} color="#ffffff" shineColor="#f59e0b" className="py-2 leading-tight" />
              <ShinyText text={t('top10.ranking')} speed={2} color="#f59e0b" shineColor="#ffffff" className="py-2 leading-tight" />
            </h1>
            <BlurText
              text={t('top10.description')}
              delay={150}
              className="text-lg text-white/60 max-w-2xl mx-auto justify-center"
            />
          </motion.div>

          {/* Badge: logged-in users only */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border mt-2"
            style={{ borderColor: 'rgba(99,102,241,0.4)', backgroundColor: 'rgba(99,102,241,0.08)' }}
          >
            <Users className="w-4 h-4 text-indigo-400" />
            <span className="text-indigo-300 text-sm font-medium">{t('top10.loggedInOnly')}</span>
          </motion.div>
        </div>

        {/* Category stats bar */}
        {currentStats && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="max-w-4xl mx-auto mb-12"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: <Eye className="w-4 h-4" />, label: t('top10.views'), value: formatNumber(currentStats.totalSessions, true), color: '#6366f1' },
                { icon: <Clock className="w-4 h-4" />, label: t('top10.hoursWatched'), value: formatHours(currentStats.totalHoursWatched), color: '#f59e0b' },
                { icon: <Star className="w-4 h-4" />, label: t('top10.avgRating'), value: avgVote, color: '#22c55e' },
                { icon: <Timer className="w-4 h-4" />, label: t('top10.avgSessionDuration'), value: `${currentStats.avgSessionMinutes}min`, color: '#ec4899' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center"
                >
                  <div className="flex items-center justify-center gap-1.5 mb-1" style={{ color: stat.color }}>
                    {stat.icon}
                    <span className="text-xl font-bold">{stat.value}</span>
                  </div>
                  <p className="text-xs text-white/40">{stat.label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="max-w-4xl mx-auto mb-8"
        >
          <div className="flex items-center justify-center gap-2 p-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] w-fit mx-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300"
                style={{
                  color: activeTab === tab.id ? tab.color : 'rgba(255,255,255,0.5)',
                  backgroundColor: activeTab === tab.id ? `${tab.color}15` : 'transparent',
                }}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTabBg"
                    className="absolute inset-0 rounded-lg border"
                    style={{ borderColor: `${tab.color}30` }}
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  {/* Couleur pleine + opacité : évite les croisements plus clairs du rgba hérité */}
                  <span className={`flex transition-opacity duration-300 ${activeTab === tab.id ? 'opacity-100' : 'text-white opacity-50'}`}>
                    {tab.icon}
                  </span>
                  {t(tab.labelKey)}
                </span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Filters: period + ranking algorithm */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="max-w-4xl mx-auto mb-10 flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <div className="flex items-center gap-1 p-1 pl-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] flex-wrap justify-center">
                              <CalendarDays className="w-3.5 h-3.5 text-white opacity-30 mr-1" />
            {periodOptions.map((p) => (
              <button
                key={p.id}
                onClick={() => applyFilters(p.id, algo)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  period === p.id ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 p-1 pl-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] flex-wrap justify-center">
                              <BarChart3 className="w-3.5 h-3.5 text-white opacity-30 mr-1" />
            {algoOptions.map((a) => (
              <button
                key={a.id}
                onClick={() => applyFilters(period, a.id)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  algo === a.id ? '' : 'text-white/40 hover:text-white/70'
                }`}
                style={algo === a.id ? { color: activeTabConfig.color, backgroundColor: `${activeTabConfig.color}15` } : undefined}
              >
                <span className={`flex transition-opacity ${algo === a.id ? '' : 'text-white opacity-40 group-hover:opacity-70'}`}>
                  {a.icon}
                </span>
                {t(a.labelKey)}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Top 10 List */}
        <div className="max-w-4xl mx-auto mb-20">
          {isCurrentTabLoading ? (
            <div className="space-y-3" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="animated-border-card bg-white/[0.03]">
                  <div className="flex items-center gap-4 p-4 sm:p-5">
                    <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14"><Skeleton height="100%" className="!rounded-xl" /></div>
                    <div className="flex-shrink-0 w-16 h-24 sm:w-20 sm:h-28"><Skeleton height="100%" className="!rounded-lg" /></div>
                    <div className="flex-1 min-w-0">
                      <Skeleton width="75%" className="h-6 sm:h-7" />
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5"><Skeleton width={72} height={16} /><Skeleton width={32} height={16} /></div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5"><Skeleton width={88} height={16} /><Skeleton width={112} height={16} /></div>
                    </div>
                    <div className="flex-shrink-0 hidden sm:block w-5 h-5" />
                  </div>
                </div>
              ))}
            </div>
          ) : currentError ? (
            <AnimatedBorderCard highlightColor="239 68 68" backgroundColor="10 10 10" className="p-8 text-center">
              <p className="text-red-400">{t(currentError)}</p>
            </AnimatedBorderCard>
          ) : currentData.length === 0 ? (
            <AnimatedBorderCard highlightColor="99 102 241" backgroundColor="10 10 10" className="p-12 text-center">
              <Trophy className="w-12 h-12 text-white opacity-20 mx-auto mb-4" />
              <p className="text-white/50 text-lg">{t('top10.noData')}</p>
              <p className="text-white/30 text-sm mt-2">{t('top10.fillsUp')}</p>
            </AnimatedBorderCard>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                className="space-y-3"
              >
                {currentData.map((entry) => {
                  const rankStyle = rankColors[entry.rank] || {
                    bg: 'rgba(255,255,255,0.05)',
                    text: 'rgba(255,255,255,0.6)',
                    border: 'rgba(255,255,255,0.1)',
                    glow: 'none',
                  };
                  const isTopThree = entry.rank <= 3;

                  return (
                    <motion.div key={entry.contentId} variants={itemVariants}>
                      <Link
                        to={activeTab === 'movies' ? `/movie/${entry.contentId}` : `/tv/${entry.contentId}`}
                        className="block"
                      >
                        <AnimatedBorderCard
                          highlightColor={hexToRgb(activeTabConfig.color)}
                          backgroundColor={isTopThree ? '14 14 14' : '10 10 10'}
                          className={`group transition-all duration-300 hover:scale-[1.01] ${isTopThree ? 'ring-1' : ''}`}
                          style={isTopThree ? { boxShadow: rankStyle.glow, '--ring-color': rankStyle.border } as React.CSSProperties : undefined}
                        >
                          <div className="flex items-center gap-4 p-4 sm:p-5">
                            {/* Rank */}
                            <div
                              className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center font-black text-xl sm:text-2xl border"
                              style={{
                                backgroundColor: rankStyle.bg,
                                color: rankStyle.text,
                                borderColor: rankStyle.border,
                              }}
                            >
                              {entry.rank <= 3 ? (
                                <span>{entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'}</span>
                              ) : (
                                <span className="flex items-center gap-0.5">
                                  <Hash className="w-3.5 h-3.5 text-white opacity-30" />
                                  {entry.rank}
                                </span>
                              )}
                            </div>

                            {/* Poster */}
                            <div className="flex-shrink-0 w-16 h-24 sm:w-20 sm:h-28 rounded-lg overflow-hidden bg-white/5 relative">
                              {entry.posterPath ? (
                                <img
                                  src={`${TMDB_IMAGE_URL}/w185${entry.posterPath}`}
                                  alt={entry.title}
                                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                  decoding="async"
                                  {...{ fetchpriority: entry.rank <= 3 ? 'high' : 'low' }}
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Film className="w-6 h-6 text-white opacity-20" />
                                </div>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <h3 className="font-bold text-white text-base sm:text-lg truncate group-hover:text-amber-400 transition-colors">
                                {entry.title}
                              </h3>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                                {entry.genres.length > 0 && (
                                  <span className="text-xs text-white/40 truncate max-w-[200px]">
                                    {entry.genres.slice(0, 3).join(' · ')}
                                  </span>
                                )}
                                {entry.releaseDate && (
                                  <span className="text-xs text-white/30">
                                    {new Date(entry.releaseDate).getFullYear()}
                                  </span>
                                )}
                                {entry.voteAverage && entry.voteAverage > 0 && (
                                  <span className="flex items-center gap-0.5 text-xs text-amber-400/80">
                                    <Star className="w-3 h-3 fill-current text-amber-400 opacity-80" />
                                    {entry.voteAverage.toFixed(1)}
                                  </span>
                                )}
                              </div>

                              {/* Stats row */}
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
                                <div className="flex items-center gap-1 text-xs text-white/50">
                                  <Eye className="w-3.5 h-3.5" style={{ color: activeTabConfig.color }} />
                                  <span><strong className="text-white/80">{formatNumber(entry.uniqueViewers)}</strong> {t('top10.views')}</span>
                                </div>
                                <div className="flex items-center gap-1 text-xs text-white/50">
                                  <Clock className="w-3.5 h-3.5" style={{ color: activeTabConfig.color }} />
                                  <span><strong className="text-white/80">{formatHours(entry.totalHours)}</strong> {t('top10.hoursWatched')}</span>
                                </div>
                                {entry.episodesWatched && (
                                  <div className="hidden sm:flex items-center gap-1 text-xs text-white/50">
                                    <BarChart3 className="w-3.5 h-3.5" style={{ color: activeTabConfig.color }} />
                                    <span><strong className="text-white/80">{formatNumber(entry.episodesWatched)}</strong> {t('top10.episodes')}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Right arrow on hover */}
                            <div className="flex-shrink-0 hidden sm:flex items-center">
                              <TrendingUp
                                className="w-5 h-5 opacity-0 group-hover:opacity-60 transition-opacity"
                                style={{ color: activeTabConfig.color }}
                              />
                            </div>
                          </div>
                        </AnimatedBorderCard>
                      </Link>
                    </motion.div>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          )}

          {/* Last updated */}
          {lastUpdated && !isCurrentTabLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center mt-6 space-y-1"
            >
              <p className="text-xs text-white/25">
                {t('top10.updatedAt', { date: new Date(lastUpdated).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) })}
              </p>
              {currentStats?.dataFrom && currentStats?.dataTo && (
                <p className="text-xs text-white/20">
                  {t('top10.dataRange', { from: new Date(currentStats.dataFrom).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }), to: new Date(currentStats.dataTo).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) })}
                </p>
              )}
            </motion.div>
          )}
        </div>

        {/* Methodology Section */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="max-w-4xl mx-auto mb-20"
        >
          <motion.div variants={itemVariants} className="text-center mb-10">
            <div className="inline-flex items-center justify-center p-2.5 bg-indigo-500/10 rounded-full mb-4 ring-1 ring-indigo-500/30">
              <BarChart3 className="w-6 h-6 text-indigo-400" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t('top10.howItWorks')}</h2>
            <p className="text-white/50 max-w-2xl mx-auto">
              {t('top10.howItWorksDesc')}
            </p>
          </motion.div>

          {/* Explanation cards */}
          <motion.div variants={itemVariants} className="mb-10">
            <AnimatedBorderCard
              highlightColor="99 102 241"
              backgroundColor="10 10 10"
              className="p-6 sm:p-8 backdrop-blur-sm"
            >
              <div className="grid md:grid-cols-3 gap-6">
                {/* Card: What counts as a view */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-amber-500/10">
                      <Eye className="w-5 h-5 text-amber-500" />
                    </div>
                    <h3 className="text-base font-semibold text-white">{t('top10.whatCounts')}</h3>
                  </div>
                  <div className="space-y-2">
                    <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                      <div className="flex items-center gap-2 mb-1">
                        <Film className="w-4 h-4 text-amber-400" />
                        <span className="text-sm font-medium text-white">{t('top10.movies')}</span>
                      </div>
                      <p className="text-xs text-white/50" dangerouslySetInnerHTML={{ __html: t('top10.moviesMinWatch') }} />
                    </div>
                    <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                      <div className="flex items-center gap-2 mb-1">
                        <Tv className="w-4 h-4 text-indigo-400" />
                        <span className="text-sm font-medium text-white">{t('top10.seriesAndAnime')}</span>
                      </div>
                      <p className="text-xs text-white/50" dangerouslySetInnerHTML={{ __html: t('top10.seriesMinWatch') }} />
                    </div>
                  </div>
                </div>

                {/* Card: What data we use */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-green-500/10">
                      <BarChart3 className="w-5 h-5 text-green-500" />
                    </div>
                    <h3 className="text-base font-semibold text-white">{t('top10.theData')}</h3>
                  </div>
                  <div className="space-y-2 text-sm text-white/60">
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-white/[0.03]">
                      <Users className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>{t('top10.uniqueViewers')}</span>
                    </div>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-white/[0.03]">
                      <Clock className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>{t('top10.totalWatchTime')}</span>
                    </div>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-white/[0.03]">
                      <Timer className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>{t('top10.avgDuration')}</span>
                    </div>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-white/[0.03]">
                      <Activity className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>{t('top10.totalSessions')}</span>
                    </div>
                  </div>
                </div>

                {/* Card: Who is counted */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-pink-500/10">
                      <Flame className="w-5 h-5 text-pink-500" />
                    </div>
                    <h3 className="text-base font-semibold text-white">{t('top10.whoIsCounted')}</h3>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="p-3 rounded-lg bg-green-500/[0.06] border border-green-500/10">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-green-400 font-medium">{t('top10.loggedInUsers')}</span>
                      </div>
                      <p className="text-xs text-white/50">{t('top10.loggedInUsersDesc')}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-red-500/[0.05] border border-red-500/10">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-red-500/70" />
                        <span className="text-red-400/80 font-medium">{t('top10.guestsAnonymous')}</span>
                      </div>
                      <p className="text-xs text-white/40">{t('top10.guestsAnonymousDesc')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </AnimatedBorderCard>
          </motion.div>
        </motion.div>

        {/* FAQ */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="max-w-3xl mx-auto mb-20"
        >
          <motion.div variants={itemVariants} className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t('top10.faq')}</h2>
          </motion.div>

          <div className="space-y-3">
            {methodologyItems.map((faq, index) => (
              <motion.div key={index} variants={itemVariants}>
                <AnimatedBorderCard
                  highlightColor="99 102 241"
                  backgroundColor="12 12 12"
                  className="overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full p-5 flex items-center justify-between text-left gap-4"
                  >
                    <span className="font-medium text-white text-sm sm:text-base">{t(faq.questionKey)}</span>
                    <motion.div
                      animate={{ rotate: openFaq === index ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex-shrink-0"
                    >
                      <ChevronDown className="w-5 h-5 text-white opacity-50" />
                    </motion.div>
                  </button>
                  <motion.div
                    initial={false}
                    animate={{
                      height: openFaq === index ? 'auto' : 0,
                      opacity: openFaq === index ? 1 : 0,
                    }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-5 text-sm text-white/50 leading-relaxed">{t(faq.answerKey)}</p>
                  </motion.div>
                </AnimatedBorderCard>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto text-center pb-12"
        >
          <AnimatedBorderCard
            highlightColor="245 158 11"
            backgroundColor="10 10 10"
            className="p-8 backdrop-blur-sm"
          >
            <Trophy className="w-10 h-10 text-amber-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">{t('top10.evolvingRanking')}</h3>
            <p className="text-white/50 text-sm mb-6 max-w-md mx-auto">
              {t('top10.evolvingRankingDesc')}
            </p>
            <Link to="/">
              <button className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors">
                <ArrowLeft className="w-4 h-4" />
                {t('top10.exploreCatalog')}
              </button>
            </Link>
          </AnimatedBorderCard>
        </motion.div>
      </div>
    </SquareBackground>
  );
};

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '99 102 241';
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`;
}

export default Top10Page;
