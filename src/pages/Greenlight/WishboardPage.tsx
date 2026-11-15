import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { Popcorn, Plus, Settings, Loader2, HelpCircle, Check, Clock, Search, Zap, X, Ghost, LinkIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WishboardCard } from '../../components/Greenlight/WishboardCard';
import { WishboardFilters } from '../../components/Greenlight/WishboardFilters';
import WishboardDetailsModal, { WishboardRequest } from '../../components/Greenlight/WishboardDetailsModal';
import { Button } from '../../components/ui/button';
import AnimatedBorderCard from '../../components/ui/animated-border-card';
import ReusableModal from '../../components/ui/reusable-modal';
import { googleAuth } from '../../services/googleAuth';
import { discordAuth } from '../../services/discordAuth';

import { WishboardStats } from '../../components/Greenlight/WishboardStats';
import ShinyText from '../../components/ui/shiny-text';
import { SquareBackground } from '../../components/ui/square-background';
import { useWrappedTracker } from '../../hooks/useWrappedTracker';
import { getTmdbLanguage } from '../../i18n';
import { useTurnstile } from '../../context/TurnstileContext';

interface WishboardStatsData {
    total: number;
    pending: number;
    added_this_month: number;
    movies: number;
    tv: number;
}

const WishboardPage: React.FC = () => {
    const { t } = useTranslation();
    const { getValidToken, resetToken: resetTurnstile } = useTurnstile();
    const [requests, setRequests] = useState<WishboardRequest[]>([]);
    const [stats, setStats] = useState<WishboardStatsData>({
        total: 0,
        pending: 0,
        added_this_month: 0,
        movies: 0,
        tv: 0,
    });
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [mediaType, setMediaType] = useState<'all' | 'movie' | 'tv'>('all');
    const [status, setStatus] = useState('all');
    const [sortBy, setSortBy] = useState('votes_desc');

    // Debounce search query (500ms)
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Check authentication
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    // New state for help modal
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    // State for login modal
    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    // State for request detail modal
    const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);

    // Rotating taglines
    const taglines = [
        t('greenlight.tagline1'),
        t('greenlight.tagline2'),
        t('greenlight.tagline3'),
        t('greenlight.tagline4'),
        t('greenlight.tagline5'),
        <span>{t('greenlight.tagline6Prefix')}<ShinyText text={t('greenlight.tagline6Highlight')} speed={3} color="#ffffff" shineColor="#4ade80" className="inline-block font-medium" />.</span>
    ];
    const [taglineIndex, setTaglineIndex] = useState(() => Math.floor(Math.random() * taglines.length));

    // Cycle through taglines
    useEffect(() => {
        const interval = setInterval(() => {
            setTaglineIndex((prev) => (prev + 1) % taglines.length);
        }, 4000);
        return () => clearInterval(interval);
    }, [taglines.length]);

    // Derived selected request to ensure it stays in sync with optimistic updates
    const selectedRequest = requests.find(r => r.id === selectedRequestId) || null;

    const API_URL = import.meta.env.VITE_MAIN_API || '';

    // Movix Wrapped 2026 - Track wishboard page visit time
    useWrappedTracker({
        mode: 'page',
        pageData: { pageName: 'wishboard' },
        isActive: true,
    });

    const handleLogin = () => {
        discordAuth.login();
    };

    const handleGoogleLogin = () => {
        googleAuth.login();
    };

    useEffect(() => {
        const checkAuth = () => {
            const auth = localStorage.getItem('auth');
            const discordAuth = localStorage.getItem('discord_auth');
            const googleAuth = localStorage.getItem('google_auth');
            const bip39Auth = localStorage.getItem('bip39_auth');

            setIsAuthenticated(!!auth || discordAuth === 'true' || googleAuth === 'true' || bip39Auth === 'true');
        };

        checkAuth();
        window.addEventListener('storage', checkAuth);
        return () => window.removeEventListener('storage', checkAuth);
    }, []);

    // Fetch TMDB data for a request
    const fetchTmdbData = async (tmdbId: number, mediaType: 'movie' | 'tv') => {
        try {
            const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
            const response = await fetch(
                `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
            );
            if (response.ok) {
                const data = await response.json();
                return {
                    title: mediaType === 'movie' ? data.title : data.name,
                    year: (mediaType === 'movie' ? data.release_date : data.first_air_date)?.split('-')[0] || '',
                    poster_path: data.poster_path,
                };
            }
        } catch (error) {
            console.error('Error fetching TMDB data:', error);
        }
        return { title: 'Inconnu', year: '', poster_path: null };
    };

    // Fetch requests with filters
    const fetchRequests = useCallback(async (pageNum: number = 1, append: boolean = false) => {
        try {
            if (pageNum === 1) setLoading(true);
            else setLoadingMore(true);

            const params = new URLSearchParams({
                page: pageNum.toString(),
                limit: '20',
                sort: sortBy,
            });

            if (debouncedSearch) params.append('search', debouncedSearch);
            if (mediaType !== 'all') params.append('media_type', mediaType);
            if (status !== 'all') params.append('status', status);

            const authToken = localStorage.getItem('auth_token');
            const profileId = localStorage.getItem('selected_profile_id');

            const response = await fetch(`${API_URL}/api/wishboard?${params}`, {
                headers: {
                    'Authorization': authToken ? `Bearer ${authToken}` : '',
                    'X-Profile-ID': profileId || '',
                },
            });

            if (response.ok) {
                const data = await response.json();

                // Fetch TMDB data for each request
                const requestsWithTmdb = await Promise.all(
                    data.requests.map(async (req: WishboardRequest) => {
                        const tmdbData = await fetchTmdbData(req.tmdb_id, req.media_type);
                        return { ...req, ...tmdbData };
                    })
                );

                if (append) {
                    setRequests(prev => [...prev, ...requestsWithTmdb]);
                } else {
                    setRequests(requestsWithTmdb);
                }

                setHasMore(data.has_more);
                setStats(data.stats);
            }
        } catch (error) {
            console.error('Error fetching wishboard:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [API_URL, debouncedSearch, mediaType, status, sortBy]);

    // Initial fetch
    useEffect(() => {
        setPage(1);
        fetchRequests(1, false);
    }, [debouncedSearch, mediaType, status, sortBy, fetchRequests]);

    // Handle vote
    const handleVote = async (requestId: number) => {
        if (!isAuthenticated) return;

        const authToken = localStorage.getItem('auth_token');
        const profileId = localStorage.getItem('selected_profile_id');

        const turnstileToken = await getValidToken();
        if (!turnstileToken) return;

        await fetch(`${API_URL}/api/wishboard/${requestId}/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
                'X-Profile-ID': profileId || '',
            },
            body: JSON.stringify({ turnstileToken }),
        });

        resetTurnstile();

        // Optimistic update of local state to avoid full refetch
        setRequests(prev => prev.map(req =>
            req.id === requestId
                ? { ...req, vote_count: req.vote_count + 1, has_voted: true }
                : req
        ));
    };

    // Handle unvote
    const handleUnvote = async (requestId: number) => {
        if (!isAuthenticated) return;

        const authToken = localStorage.getItem('auth_token');
        const profileId = localStorage.getItem('selected_profile_id');

        const turnstileToken = await getValidToken();
        if (!turnstileToken) return;

        await fetch(`${API_URL}/api/wishboard/${requestId}/vote`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
                'X-Profile-ID': profileId || '',
            },
            body: JSON.stringify({ turnstileToken }),
        });

        resetTurnstile();

        // Optimistic update of local state to avoid full refetch
        setRequests(prev => prev.map(req =>
            req.id === requestId
                ? { ...req, vote_count: Math.max(0, req.vote_count - 1), has_voted: false }
                : req
        ));
    };

    // Load more
    const loadMore = () => {
        if (!loadingMore && hasMore) {
            const nextPage = page + 1;
            setPage(nextPage);
            fetchRequests(nextPage, true);
        }
    };

    return (
        <SquareBackground squareSize={48} borderColor="rgba(34, 197, 94, 0.10)" className="min-h-screen bg-black text-white">
            {/* Hero Section */}
            <div className="relative z-10 pt-24 pb-2 overflow-x-hidden">
                <div className="container mx-auto px-6 md:px-10">
                    <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="mb-6 relative"
                        >
                            {/* radial-gradient au lieu de blur-[80px] (même halo, ~0ms compositor) */}
                            <div
                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] max-w-[90vw] rounded-full -z-10 pointer-events-none"
                                style={{ background: 'radial-gradient(circle, rgba(34, 197, 94, 0.20) 0%, transparent 70%)' }}
                            />
                            <h1 className="relative text-5xl md:text-7xl font-black tracking-tight">
                                <ShinyText text="GREENLIGHT" speed={3} color="#ffffff" shineColor="#4ade80" className="" />
                            </h1>
                        </motion.div>

                        <div className="h-20 mb-8 flex flex-col items-center justify-center gap-2">
                            <AnimatePresence mode="wait">
                                <motion.p
                                    key={taglineIndex}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    transition={{ duration: 0.5 }}
                                    className="text-lg md:text-xl text-white/60 font-light text-center"
                                >
                                    {taglines[taglineIndex]}
                                </motion.p>
                            </AnimatePresence>
                            <div className="flex items-center gap-2 mt-2">
                                <ShinyText text={t('greenlight.propose')} speed={3} color="#4ade80" shineColor="#ffffff" className="text-lg md:text-xl font-medium" />
                                <span className="text-white/80 text-lg md:text-xl">{t('greenlight.voteAction')}</span>
                                <ShinyText text={t('greenlight.watchAction')} speed={3} color="#4ade80" shineColor="#ffffff" className="text-lg md:text-xl font-medium" />
                            </div>
                        </div>

                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="flex flex-col items-center gap-4"
                        >
                            {!isAuthenticated ? (
                                <Button
                                    size="lg"
                                    onClick={() => setIsLoginModalOpen(true)}
                                    className="bg-white text-black hover:bg-white/90 rounded-full px-8 h-12 text-base font-semibold transition-transform hover:scale-105"
                                >
                                    {t('greenlight.joinMovement')}
                                </Button>
                            ) : (
                                <div className="flex flex-wrap items-center justify-center gap-3">
                                    <Link to="/wishboard/new">
                                        <AnimatedBorderCard
                                            highlightColor="34 197 94"
                                            backgroundColor="0 0 0"
                                            className="flex items-center justify-center px-8 h-12 rounded-full cursor-pointer hover:scale-105 transition-transform group"
                                        >
                                            <Plus className="h-5 w-5 mr-2 text-green-500 group-hover:text-green-400" />
                                            <span className="text-base font-bold text-white group-hover:text-green-400 transition-colors">{t('greenlight.proposeProject')}</span>
                                        </AnimatedBorderCard>
                                    </Link>
                                    <Link to="/wishboard/submit-link">
                                        <AnimatedBorderCard
                                            highlightColor="16 185 129"
                                            backgroundColor="0 0 0"
                                            className="flex items-center justify-center px-8 h-12 rounded-full cursor-pointer hover:scale-105 transition-transform group"
                                        >
                                            <LinkIcon className="h-4 w-4 mr-2 text-emerald-400 group-hover:text-emerald-300" />
                                            <span className="text-base font-medium text-emerald-400 group-hover:text-emerald-300 transition-colors">{t('greenlight.submitLinkButton')}</span>
                                        </AnimatedBorderCard>
                                    </Link>
                                    <Link to="/wishboard/my-requests">
                                        <AnimatedBorderCard
                                            highlightColor="255 255 255"
                                            backgroundColor="0 0 0"
                                            className="flex items-center justify-center px-8 h-12 rounded-full cursor-pointer hover:scale-105 transition-transform group"
                                        >
                                            <Settings className="h-4 w-4 mr-2 text-white opacity-70 group-hover:opacity-100" />
                                            <span className="text-base font-medium text-white/70 group-hover:text-white transition-colors">{t('greenlight.myProjects')}</span>
                                        </AnimatedBorderCard>
                                    </Link>
                                </div>
                            )}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-full h-12 w-12 border border-white/10 text-white/50 hover:text-white group/icon"
                                onClick={() => setIsHelpOpen(true)}
                            >
                                <HelpCircle className="h-5 w-5 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" />
                            </Button>
                        </motion.div>
                    </div>
                </div>
            </div>

            {/* Content Section */}
            <div className="container mx-auto px-6 pb-24 md:px-10 relative z-10">
                <div className="flex flex-col lg:flex-row gap-8">
                    {/* Main Content Column */}
                    <div className="flex-1 order-2 lg:order-1">
                        {/* Filters Bar */}
                        <div className="sticky top-24 z-20 mb-6 -mx-2 px-2 py-4 bg-black/95 border-y border-white/5 lg:rounded-2xl lg:border lg:mx-0 lg:px-4">
                            <WishboardFilters
                                searchQuery={searchQuery}
                                onSearchChange={setSearchQuery}
                                mediaType={mediaType}
                                onMediaTypeChange={setMediaType}
                                status={status}
                                onStatusChange={setStatus}
                                sortBy={sortBy}
                                onSortChange={setSortBy}
                            />
                        </div>

                        {/* Grid */}
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-32 space-y-4">
                                <Loader2 className="h-10 w-10 animate-spin text-green-500" />
                                <p className="text-white/30 animate-pulse">{t('greenlight.searchingGems')}</p>
                            </div>
                        ) : requests.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center justify-center py-32 text-center bg-white/5 rounded-3xl border border-dashed border-white/10"
                            >
                                <div className="bg-white/5 p-6 rounded-full mb-6">
                                    <Ghost className="h-12 w-12 text-white opacity-20" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">{t('greenlight.emptyHere')}</h3>
                                <p className="text-white/50 max-w-sm mx-auto mb-8">
                                    {t('greenlight.noProjectMatch')}
                                </p>
                                <Link to="/wishboard/new">
                                    <Button className="bg-white text-black hover:bg-gray-200">
                                        {t('greenlight.proposeProject')}
                                    </Button>
                                </Link>
                            </motion.div>
                        ) : (
                            <>
                                <motion.div
                                    layout
                                    className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6"
                                >
                                    <AnimatePresence mode="popLayout">
                                        {requests.map((request, i) => (
                                            <motion.div
                                                key={request.id}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: i * 0.05 }}
                                            >
                                                <WishboardCard
                                                    id={request.id}
                                                    tmdbId={request.tmdb_id}
                                                    mediaType={request.media_type}
                                                    seasonNumber={request.season_number}
                                                    status={request.status}
                                                    voteCount={request.vote_count}
                                                    hasVoted={request.has_voted}
                                                    title={request.title || t('common.loading')}
                                                    year={request.year || ''}
                                                    posterPath={request.poster_path || null}
                                                    notes={request.notes}
                                                    onVote={handleVote}
                                                    onUnvote={handleUnvote}
                                                    onClick={() => setSelectedRequestId(request.id)}
                                                />
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </motion.div>

                                {hasMore && (
                                    <div className="mt-12 flex justify-center">
                                        <Button
                                            variant="outline"
                                            size="lg"
                                            onClick={loadMore}
                                            disabled={loadingMore}
                                            className="border-white/10 bg-white/5 hover:bg-white/10 px-8"
                                        >
                                            {loadingMore ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <Plus className="h-4 w-4 mr-2" />
                                            )}
                                            {t('greenlight.loadMoreProjects')}
                                        </Button>
                                    </div>
                                )}

                                {/* Mobile Stats - Show at the bottom of the catalog */}
                                <div className="lg:hidden mt-12 space-y-6">
                                    <WishboardStats
                                        totalRequests={stats.total}
                                        pendingRequests={stats.pending}
                                        addedThisMonth={stats.added_this_month}
                                        movieCount={stats.movies}
                                        tvCount={stats.tv}
                                    />

                                    {/* VIP Widget for mobile */}
                                    <div className="p-6 rounded-2xl bg-gradient-to-br from-green-500/10 to-emerald-600/5 border border-green-500/10 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-4 opacity-20">
                                            <Zap className="h-24 w-24 text-green-500 -mr-6 -mt-6" />
                                        </div>
                                        <ShinyText text={t('greenlight.becomeVip')} speed={3} color="#ffffff" shineColor="#facc15" className="text-lg font-bold mb-2 relative z-10 block" />
                                        <p className="text-sm text-green-100/70 mb-4 relative z-10">
                                            {t('greenlight.vipPriorityDesc')}
                                        </p>
                                        <Link to="/vip">
                                            <AnimatedBorderCard
                                                highlightColor="34 197 94"
                                                backgroundColor="23 23 23"
                                                className="w-full flex items-center justify-center h-10 px-4 cursor-pointer hover:scale-105 active:scale-95 transition-all group rounded-xl"
                                            >
                                                <span className="font-bold text-sm text-white group-hover:text-green-500 transition-colors">
                                                    {t('greenlight.discoverAdvantages')}
                                                </span>
                                            </AnimatedBorderCard>
                                        </Link>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Sidebar Stats Column (Desktop) */}
                    <div className="hidden lg:block w-80 shrink-0 order-1 lg:order-2">
                        <div className="sticky top-32">
                            <WishboardStats
                                totalRequests={stats.total}
                                pendingRequests={stats.pending}
                                addedThisMonth={stats.added_this_month}
                                movieCount={stats.movies}
                                tvCount={stats.tv}
                            />

                            {/* Additional Widget */}
                            <div className="mt-6 p-6 rounded-2xl bg-gradient-to-br from-green-500/10 to-emerald-600/5 border border-green-500/10 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-4 opacity-20">
                                    <Zap className="h-24 w-24 text-green-500 -mr-6 -mt-6" />
                                </div>
                                <ShinyText text={t('greenlight.becomeVip')} speed={3} color="#ffffff" shineColor="#facc15" className="text-lg font-bold mb-2 relative z-10 block" />
                                <p className="text-sm text-green-100/70 mb-4 relative z-10">
                                    {t('greenlight.vipPriorityDesc')}
                                </p>
                                <Link to="/vip">
                                    <AnimatedBorderCard
                                        highlightColor="34 197 94"
                                        backgroundColor="23 23 23"
                                        className="w-full flex items-center justify-center h-10 px-4 cursor-pointer hover:scale-105 active:scale-95 transition-all group lg:rounded-xl"
                                    >
                                        <span className="font-bold text-sm text-white group-hover:text-green-500 transition-colors">
                                            {t('greenlight.discoverAdvantages')}
                                        </span>
                                    </AnimatedBorderCard>
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Wishboard Details Modal */}
            <WishboardDetailsModal
                isOpen={!!selectedRequest}
                onClose={() => setSelectedRequestId(null)}
                request={selectedRequest}
                onVote={(id) => handleVote(id)}
                onUnvote={(id) => handleUnvote(id)}
            />

            <ReusableModal
                isOpen={isHelpOpen}
                onClose={() => setIsHelpOpen(false)}
                title={t('greenlight.glossaryTitle')}
                className="max-w-xl"
            >
                <div className="space-y-6">
                    <div>
                        <h4 className="flex items-center gap-2 text-lg font-medium text-white mb-2">
                            <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"></span>
                            {t('greenlight.conceptTitle')}
                        </h4>
                        <p className="text-sm text-white/70 leading-relaxed">
                            {t('greenlight.conceptDesc')}
                        </p>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                        <div className="p-4 rounded-xl bg-white/5 border border-white/5 hover:border-green-500/30 transition-colors">
                            <h5 className="font-bold text-green-400 mb-1 flex items-center gap-2">
                                <Check className="h-4 w-4" /> {t('greenlight.statusGreenlighted')}
                            </h5>
                            <p className="text-xs text-white/60">{t('greenlight.statusGreenlightedDesc')}</p>
                        </div>
                        <div className="p-4 rounded-xl bg-white/5 border border-white/5 hover:border-yellow-500/30 transition-colors">
                            <h5 className="font-bold text-yellow-500 mb-1 flex items-center gap-2">
                                <Clock className="h-4 w-4" /> {t('greenlight.statusUnderReview')}
                            </h5>
                            <p className="text-xs text-white/60">{t('greenlight.statusUnderReviewDesc')}</p>
                        </div>
                        <div className="p-4 rounded-xl bg-white/5 border border-white/5 hover:border-blue-400/30 transition-colors">
                            <h5 className="font-bold text-blue-400 mb-1 flex items-center gap-2">
                                <Search className="h-4 w-4" /> {t('greenlight.statusScouting')}
                            </h5>
                            <p className="text-xs text-white/60">{t('greenlight.statusScoutingDesc')}</p>
                        </div>
                        <div className="p-4 rounded-xl bg-white/5 border border-white/5 hover:border-red-400/30 transition-colors">
                            <h5 className="font-bold text-red-400 mb-1 flex items-center gap-2">
                                <X className="h-4 w-4" /> {t('greenlight.statusNotFound')}
                            </h5>
                            <p className="text-xs text-white/60">{t('greenlight.statusNotFoundDesc')}</p>
                        </div>
                    </div>

                    <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-xl p-4">
                        <p className="text-sm text-green-200">
                            💡 <strong>{t('greenlight.tipLabel')}</strong> {t('greenlight.tipText')}
                        </p>
                    </div>
                </div>
            </ReusableModal>

            <ReusableModal
                isOpen={isLoginModalOpen}
                onClose={() => setIsLoginModalOpen(false)}
                title={t('greenlight.joinCommunity')}
                className="max-w-md"
            >
                <div className="space-y-6">
                    <div className="text-center">
                        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/5 mb-4">
                            <Popcorn className="h-8 w-8 text-white opacity-50" />
                        </div>
                        <p className="text-white/70 text-sm">
                            {t('greenlight.loginPrompt')}
                        </p>
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={handleLogin}
                            className="relative flex items-center justify-center gap-3 w-full px-4 py-3.5 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-xl transition-all shadow-lg hover:shadow-xl font-medium overflow-hidden group"
                        >
                            <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform" />
                            <img
                                src="https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a6a49cf127bf92de1e2_icon_clyde_blurple_RGB.png"
                                alt="Discord"
                                className="w-5 h-5 object-contain bg-white rounded-full p-0.5 relative z-10"
                            />
                            <span className="relative z-10">{t('greenlight.continueDiscord')}</span>
                        </button>

                        <button
                            onClick={handleGoogleLogin}
                            className="relative flex items-center justify-center gap-3 w-full px-4 py-3.5 bg-white hover:bg-gray-100 text-gray-900 rounded-xl transition-all shadow-lg hover:shadow-xl font-medium overflow-hidden"
                        >
                            <img
                                src="https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png"
                                alt="Google"
                                className="w-5 h-5 object-contain"
                            />
                            <span>{t('greenlight.continueGoogle')}</span>
                        </button>

                        <button
                            onClick={() => window.location.href = '/login-bip39'}
                            className="relative flex items-center justify-center gap-3 w-full px-4 py-3.5 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl transition-all font-medium"
                        >
                    <svg className="w-5 h-5 text-white opacity-60" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
                            </svg>
                            <span>{t('greenlight.secretPhrase')}</span>
                        </button>
                    </div>
                </div>
            </ReusableModal>
        </SquareBackground>
    );
};

export default WishboardPage;
