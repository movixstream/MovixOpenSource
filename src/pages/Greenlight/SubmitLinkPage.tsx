import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeft, ArrowRight, Film, Tv, Search, Check, Loader2,
    LinkIcon, ExternalLink, AlertCircle, Sparkles, Send, Trash2, Clock,
    ListChecks, Vote, List, AlignLeft
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { getVipHeaders } from '../../utils/vipUtils';
import BlurText from '../../components/ui/blur-text';
import ShinyText from '../../components/ui/shiny-text';
import AnimatedBorderCard from '../../components/ui/animated-border-card';
import { SquareBackground } from '../../components/ui/square-background';
import { getTmdbLanguage } from '../../i18n';

interface TmdbResult {
    id: number;
    title?: string;
    name?: string;
    poster_path: string | null;
    release_date?: string;
    first_air_date?: string;
    overview: string;
    media_type?: 'movie' | 'tv';
    number_of_seasons?: number;
    seasons?: { season_number: number; name: string; episode_count: number }[];
}

interface TmdbEpisode {
    episode_number: number;
    name: string;
}

interface WishboardRequestItem {
    id: number;
    tmdb_id: number;
    media_type: 'movie' | 'tv';
    status: string;
    vote_count: number;
    title?: string;
    poster_path?: string | null;
    year?: string;
}

type ContentType = 'movie' | 'tv';
type SourceMode = 'tmdb' | 'wishboard';
type Step = 1 | 2 | 3 | 4;

const SubmitLinkPage: React.FC = () => {
    const { t } = useTranslation();
    const topRef = useRef<HTMLDivElement>(null);

    const [step, setStep] = useState<Step>(1);
    const [direction] = useState<'right' | 'left'>('right');

    // Content selection
    const [contentType, setContentType] = useState<ContentType | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<TmdbResult[]>([]);
    const [selectedContent, setSelectedContent] = useState<TmdbResult | null>(null);
    const [loading, setLoading] = useState(false);

    // TV specifics
    const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
    const [episodes, setEpisodes] = useState<TmdbEpisode[]>([]);
    const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(new Set());
    const [loadingEpisodes, setLoadingEpisodes] = useState(false);

    // Source mode
    const [sourceMode, setSourceMode] = useState<SourceMode | null>(null);

    // Wishboard requests
    const [wishboardRequests, setWishboardRequests] = useState<WishboardRequestItem[]>([]);
    const [wishboardSearch, setWishboardSearch] = useState('');
    const [loadingWishboard, setLoadingWishboard] = useState(false);
    const [wishboardPage, setWishboardPage] = useState(1);
    const [wishboardHasMore, setWishboardHasMore] = useState(false);

    // Link submission
    const [linkUrl, setLinkUrl] = useState('');
    const [episodeUrls, setEpisodeUrls] = useState<Record<number, string>>({});
    const [linkInputMode, setLinkInputMode] = useState<'individual' | 'textarea'>('individual');
    const [bulkTextarea, setBulkTextarea] = useState('');
    const [sourceName, setSourceName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    // Limits
    const [limitStatus, setLimitStatus] = useState<{ movies: { count: number; limit: number; remaining: number }; series: { count: number; limit: number; remaining: number } } | null>(null);

    // User submissions
    const [mySubmissions, setMySubmissions] = useState<any[]>([]);
    const [loadingSubmissions, setLoadingSubmissions] = useState(false);
    const [showMySubmissions, setShowMySubmissions] = useState(false);

    const API_URL = import.meta.env.VITE_MAIN_API || '';
    const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

    const navigateStep = (newStep: Step) => {
        setStep(newStep);
    };

    // Scroll to top on step change
    useEffect(() => {
        const timeout = setTimeout(() => {
            topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);
        return () => clearTimeout(timeout);
    }, [step]);

    // Fetch limits
    useEffect(() => {
        const fetchLimits = async () => {
            try {
                const authToken = localStorage.getItem('auth_token');
                const profileId = localStorage.getItem('selected_profile_id');
                const response = await fetch(`${API_URL}/api/link-submissions/limits`, {
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'X-Profile-ID': profileId || '',
                        ...getVipHeaders(),
                    }
                });
                if (response.ok) {
                    const data = await response.json();
                    setLimitStatus(data);
                }
            } catch (err) {
                console.error('Error fetching limits:', err);
            }
        };
        fetchLimits();
    }, [API_URL]);

    // Search TMDB
    const searchTmdb = useCallback(async () => {
        if (!searchQuery.trim() || !contentType) return;

        setLoading(true);
        setError(null);

        try {
            const response = await fetch(
                `https://api.themoviedb.org/3/search/${contentType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(searchQuery)}&language=${getTmdbLanguage()}`
            );
            const data = await response.json();
            setSearchResults(data.results?.slice(0, 12) || []);
        } catch {
            setError(t('greenlight.searchError'));
        } finally {
            setLoading(false);
        }
    }, [searchQuery, contentType, TMDB_API_KEY]);

    // Auto-search with debounce
    useEffect(() => {
        if (searchQuery.trim().length < 2) return;
        const timer = setTimeout(() => searchTmdb(), 500);
        return () => clearTimeout(timer);
    }, [searchQuery, searchTmdb]);

    // Fetch wishboard requests
    const fetchWishboardRequests = useCallback(async (search = '', pageNum = 1, append = false) => {
        setLoadingWishboard(true);
        try {
            const params = new URLSearchParams();
            params.append('page', String(pageNum));
            params.append('limit', '20');
            params.append('sort', 'votes_desc');
            if (contentType) params.append('media_type', contentType);
            if (search.trim()) params.append('search', search.trim());
            // Only show pending requests (not yet added)
            params.append('status', 'pending');

            const response = await fetch(`${API_URL}/api/wishboard?${params.toString()}`);
            if (response.ok) {
                const data = await response.json();
                const enriched = await Promise.all(
                    (data.requests || []).map(async (req: any) => {
                        try {
                            const tmdbResp = await fetch(
                                `https://api.themoviedb.org/3/${req.media_type}/${req.tmdb_id}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
                            );
                            const tmdbData = await tmdbResp.json();
                            return {
                                ...req,
                                title: tmdbData.title || tmdbData.name || `TMDB #${req.tmdb_id}`,
                                poster_path: tmdbData.poster_path,
                                year: (tmdbData.release_date || tmdbData.first_air_date || '').split('-')[0],
                            };
                        } catch {
                            return { ...req, title: `TMDB #${req.tmdb_id}`, poster_path: null, year: '' };
                        }
                    })
                );
                if (append) {
                    setWishboardRequests(prev => [...prev, ...enriched]);
                } else {
                    setWishboardRequests(enriched);
                }
                setWishboardHasMore(data.has_more || false);
            }
        } catch { /* silent */ }
        setLoadingWishboard(false);
    }, [API_URL, TMDB_API_KEY, contentType]);

    // Auto-search wishboard with debounce
    useEffect(() => {
        if (sourceMode !== 'wishboard') return;
        const timer = setTimeout(() => {
            setWishboardPage(1);
            fetchWishboardRequests(wishboardSearch, 1);
        }, 500);
        return () => clearTimeout(timer);
    }, [wishboardSearch, sourceMode, fetchWishboardRequests]);

    // Select from wishboard
    const handleSelectWishboard = async (req: WishboardRequestItem) => {
        const tmdbResult: TmdbResult = {
            id: req.tmdb_id,
            title: req.media_type === 'movie' ? req.title : undefined,
            name: req.media_type === 'tv' ? req.title : undefined,
            poster_path: req.poster_path || null,
            release_date: req.media_type === 'movie' ? (req.year ? `${req.year}-01-01` : undefined) : undefined,
            first_air_date: req.media_type === 'tv' ? (req.year ? `${req.year}-01-01` : undefined) : undefined,
            overview: '',
        };
        setContentType(req.media_type);
        handleSelectContent(tmdbResult);
    };

    // Fetch seasons for TV
    const fetchSeasons = async (tmdbId: number) => {
        try {
            const response = await fetch(
                `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
            );
            const data = await response.json();
            setSelectedContent(prev => prev ? { ...prev, seasons: data.seasons?.filter((s: any) => s.season_number > 0), number_of_seasons: data.number_of_seasons } : prev);
        } catch { /* silent */ }
    };

    // Fetch episodes for a season
    const fetchEpisodes = async (tmdbId: number, seasonNumber: number) => {
        setLoadingEpisodes(true);
        try {
            const response = await fetch(
                `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
            );
            const data = await response.json();
            setEpisodes(data.episodes?.map((e: any) => ({ episode_number: e.episode_number, name: e.name })) || []);
        } catch {
            setEpisodes([]);
        } finally {
            setLoadingEpisodes(false);
        }
    };

    // Select content
    const handleSelectContent = (item: TmdbResult) => {
        setSelectedContent(item);
        setSearchResults([]);
        if (contentType === 'tv') {
            fetchSeasons(item.id);
            setSelectedEpisodes(new Set());
            navigateStep(3);
        } else {
            navigateStep(3);
        }
    };

    // Fetch user submissions
    const fetchMySubmissions = async () => {
        setLoadingSubmissions(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const profileId = localStorage.getItem('selected_profile_id');
            const response = await fetch(`${API_URL}/api/link-submissions/my`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'X-Profile-ID': profileId || '',
                }
            });
            if (response.ok) {
                const data = await response.json();
                const subs = data.submissions || [];
                // Enrich with TMDB titles
                const enriched = await Promise.all(subs.map(async (sub: any) => {
                    try {
                        const tmdbRes = await fetch(
                            `https://api.themoviedb.org/3/${sub.media_type}/${sub.tmdb_id}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
                        );
                        if (tmdbRes.ok) {
                            const tmdb = await tmdbRes.json();
                            return { ...sub, _title: tmdb.title || tmdb.name || `TMDB #${sub.tmdb_id}`, _poster: tmdb.poster_path };
                        }
                    } catch { /* silent */ }
                    return { ...sub, _title: `TMDB #${sub.tmdb_id}`, _poster: null };
                }));
                setMySubmissions(enriched);
            }
        } catch { /* silent */ }
        setLoadingSubmissions(false);
    };

    // Delete own submission
    const handleDeleteSubmission = async (id: number) => {
        try {
            const authToken = localStorage.getItem('auth_token');
            const profileId = localStorage.getItem('selected_profile_id');
            const response = await fetch(`${API_URL}/api/link-submissions/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'X-Profile-ID': profileId || '',
                }
            });
            if (response.ok) {
                setMySubmissions(prev => prev.filter(s => s.id !== id));
            }
        } catch { /* silent */ }
    };

    // Submit link
    const handleSubmit = async () => {
        if (!selectedContent) return;

        const isTvBulk = contentType === 'tv' && selectedSeason !== null && selectedEpisodes.size > 0;

        if (!isTvBulk) {
            // Movie: require linkUrl
            if (!linkUrl.trim()) return;

            // Validate URL
            try {
                new URL(linkUrl.trim());
            } catch {
                setError(t('greenlight.invalidUrl'));
                return;
            }
        }

        setSubmitting(true);
        setError(null);

        try {
            const authToken = localStorage.getItem('auth_token');
            const profileId = localStorage.getItem('selected_profile_id');

            if (!authToken) {
                setError(t('greenlight.mustBeLoggedIn'));
                setSubmitting(false);
                return;
            }

            // Lien Uqload sans nom de source saisi : on nomme la source « Uqload »
            const finalSourceName = sourceName.trim() || (isUqload ? 'Uqload' : '');

            if (isTvBulk) {
                // Bulk submit for TV episodes with per-episode URLs
                const epUrlsClean: Record<number, string> = {};
                for (const ep of Array.from(selectedEpisodes).sort((a, b) => a - b)) {
                    const u = (episodeUrls[ep] || '').trim();
                    if (!u) {
                        setError(t('greenlight.missingUrlForEpisode', { ep }));
                        setSubmitting(false);
                        return;
                    }
                    try { new URL(u); } catch { setError(t('greenlight.invalidUrlForEpisode', { ep })); setSubmitting(false); return; }
                    epUrlsClean[ep] = u;
                }

                const body: any = {
                    tmdb_id: selectedContent.id,
                    media_type: 'tv',
                    season_number: selectedSeason,
                    episode_urls: epUrlsClean,
                };
                if (finalSourceName) body.source_name = finalSourceName;

                const response = await fetch(`${API_URL}/api/link-submissions/bulk`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`,
                        'X-Profile-ID': profileId || '',
                        ...getVipHeaders(),
                    },
                    body: JSON.stringify(body),
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || t('greenlight.submissionError'));
                setSuccess(true);
            } else {
                // Single submit (movie)
                const body: any = {
                    tmdb_id: selectedContent.id,
                    media_type: contentType,
                    url: linkUrl.trim(),
                };
                if (finalSourceName) body.source_name = finalSourceName;

                const response = await fetch(`${API_URL}/api/link-submissions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`,
                        'X-Profile-ID': profileId || '',
                        ...getVipHeaders(),
                    },
                    body: JSON.stringify(body),
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || t('greenlight.submissionError'));
                setSuccess(true);
            }

            // Refresh limits
            if (limitStatus) {
                const newLimits = { ...limitStatus };
                if (contentType === 'movie') {
                    newLimits.movies = { ...newLimits.movies, remaining: newLimits.movies.remaining - 1, count: newLimits.movies.count + 1 };
                }
                setLimitStatus(newLimits);
            }
        } catch (err: any) {
            setError(err.message || t('greenlight.submissionError'));
        } finally {
            setSubmitting(false);
        }
    };

    // Reset form
    const handleReset = () => {
        setStep(1);
        setContentType(null);
        setSourceMode(null);
        setSearchQuery('');
        setSearchResults([]);
        setSelectedContent(null);
        setSelectedSeason(null);
        setSelectedEpisodes(new Set());
        setEpisodes([]);
        setLinkUrl('');
        setEpisodeUrls({});
        setLinkInputMode('individual');
        setBulkTextarea('');
        setSourceName('');
        setError(null);
        setSuccess(false);
        setWishboardRequests([]);
        setWishboardSearch('');
        setWishboardPage(1);
    };

    // Lien Uqload (tous TLD : .vc, .is, .cx…)
    const allUrls = contentType === 'tv' ? Object.values(episodeUrls).join(' ') : linkUrl;
    const isUqload = allUrls.toLowerCase().includes('uqload.');

    const contentTitle = selectedContent?.title || selectedContent?.name || '';
    const contentYear = (selectedContent?.release_date || selectedContent?.first_air_date || '').split('-')[0];
    const posterUrl = selectedContent?.poster_path ? `https://image.tmdb.org/t/p/w342${selectedContent.poster_path}` : null;

    // Animation variants
    const slideVariants = {
        enter: (dir: string) => ({ x: dir === 'right' ? 100 : -100, opacity: 0 }),
        center: { x: 0, opacity: 1 },
        exit: (dir: string) => ({ x: dir === 'right' ? -100 : 100, opacity: 0 }),
    };

    const statusColors: Record<string, string> = {
        pending: 'bg-yellow-500/20 text-yellow-400',
        approved: 'bg-green-500/20 text-green-400',
        rejected: 'bg-red-500/20 text-red-400',
    };
    const statusLabels: Record<string, string> = {
        pending: t('greenlight.pendingStatus'),
        approved: t('greenlight.approvedStatus'),
        rejected: t('greenlight.rejectedLinkStatus'),
    };

    return (
        <SquareBackground squareSize={48} borderColor="rgba(34, 197, 94, 0.10)" className="min-h-screen bg-black text-white">
            <div ref={topRef} />
            <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-4">
                        <Link to="/wishboard">
                            <Button variant="ghost" size="sm" className="text-white/60 hover:text-white group/icon">
                                <ArrowLeft className="w-4 h-4 mr-1 text-white opacity-60 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" /> Greenlight
                            </Button>
                        </Link>
                    </div>

                    <BlurText
                        text={t('greenlight.submitLinkTitle')}
                        delay={50}
                        animateBy="words"
                        className="text-3xl sm:text-4xl font-black tracking-tight text-center"
                    />

                    <p className="text-center text-white/50 mt-2 max-w-lg mx-auto">
                        {t('greenlight.submitLinkIntro')}
                    </p>

                    {/* Uqload recommendation */}
                    <div className="mt-4 mx-auto max-w-md">
                        <a
                            href="https://uqload.vc/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 hover:border-emerald-500/40 transition-all group"
                        >
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                                <Sparkles className="w-5 h-5 text-emerald-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-emerald-400">
                                    <ShinyText text={t('greenlight.uqloadTip')} speed={3} color="#34d399" shineColor="#6ee7b7" className="inline-block" />
                                </p>
                                <p className="text-xs text-white/40 mt-0.5">
                                    {t('greenlight.uqloadDesc')}
                                </p>
                            </div>
                            <ExternalLink className="w-4 h-4 text-white opacity-30 group-hover:text-emerald-400 group-hover:opacity-100 transition-all flex-shrink-0" />
                        </a>
                    </div>

                    {/* Limits badge */}
                    {limitStatus && (
                        <div className="flex flex-wrap justify-center gap-3 mt-4">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${limitStatus.movies.remaining > 0 ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                <Film className="w-3 h-3" />
                                {limitStatus.movies.remaining > 0
                                    ? t('greenlight.moviesRemaining', { remaining: limitStatus.movies.remaining, limit: limitStatus.movies.limit })
                                    : t('greenlight.moviesLimitReached')
                                }
                            </span>
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${limitStatus.series.remaining > 0 ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                <Tv className="w-3 h-3" />
                                {limitStatus.series.remaining > 0
                                    ? t('greenlight.seriesRemaining', { remaining: limitStatus.series.remaining, limit: limitStatus.series.limit })
                                    : t('greenlight.seriesLimitReached')
                                }
                            </span>
                        </div>
                    )}

                    {/* My submissions toggle */}
                    <div className="text-center mt-3">
                        <button
                            onClick={() => {
                                setShowMySubmissions(!showMySubmissions);
                                if (!showMySubmissions && mySubmissions.length === 0) fetchMySubmissions();
                            }}
                            className="text-xs text-white/40 hover:text-white/60 transition-colors underline underline-offset-2"
                        >
                            {showMySubmissions ? t('greenlight.hideMySubmissions') : t('greenlight.showMySubmissions')}
                        </button>
                    </div>
                </div>

                {/* My Submissions Panel */}
                <AnimatePresence>
                    {showMySubmissions && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden mb-8"
                        >
                            <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                                <h3 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-white opacity-80" /> {t('greenlight.recentSubmissions')}
                                </h3>
                                {loadingSubmissions ? (
                                    <div className="flex justify-center py-4">
                                        <Loader2 className="w-5 h-5 animate-spin text-white opacity-40" />
                                    </div>
                                ) : mySubmissions.length === 0 ? (
                                    <p className="text-sm text-white/30 text-center py-4">{t('greenlight.noSubmissions')}</p>
                                ) : (
                                    <div className="space-y-2 max-h-60 overflow-y-auto" data-lenis-prevent>
                                        {mySubmissions.map((sub) => (
                                            <div key={sub.id} className="flex items-center gap-3 bg-white/5 rounded-lg p-2.5">
                                                <div className="flex-shrink-0 w-8 h-12 rounded overflow-hidden bg-white/5">
                                                    {sub._poster ? (
                                                        <img src={`https://image.tmdb.org/t/p/w92${sub._poster}`} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center">
                                                            {sub.media_type === 'movie' ? <Film className="w-3 h-3 text-white opacity-20" /> : <Tv className="w-3 h-3 text-white opacity-20" />}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs text-white/70 truncate">
                                                        {sub._title || `TMDB #${sub.tmdb_id}`}
                                                        {sub.media_type === 'tv' && sub.season_number != null && (
                                                            <span className="text-white/40 ml-1">S{sub.season_number}{sub.episode_number != null ? `E${sub.episode_number}` : ''}</span>
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-white/40 truncate">{sub.url}</p>
                                                </div>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[sub.status]}`}>
                                                    {statusLabels[sub.status]}
                                                </span>
                                                {sub.status === 'pending' && (
                                                    <button
                                                        onClick={() => handleDeleteSubmission(sub.id)}
                                                        className="text-white/30 hover:text-red-400 transition-colors group/icon"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5 text-white opacity-30 group-hover/icon:text-red-400 group-hover/icon:opacity-100 transition-[color,opacity]" />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Success State */}
                {success ? (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="text-center py-12"
                    >
                        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-500/20 flex items-center justify-center">
                            <Check className="w-10 h-10 text-green-400" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2">{t('greenlight.linkSubmitted')}</h2>
                        <p className="text-white/50 mb-6 max-w-md mx-auto">
                            {t('greenlight.linkSubmittedDesc')}
                        </p>
                        <div className="flex gap-3 justify-center">
                            <Button onClick={handleReset} className="bg-white/10 hover:bg-white/20">
                                <LinkIcon className="w-4 h-4 mr-2" /> {t('greenlight.submitAnotherLink')}
                            </Button>
                            <Link to="/wishboard">
                                <Button variant="ghost" className="text-white/60 hover:text-white">
                                    {t('greenlight.returnToGreenlightLink')}
                                </Button>
                            </Link>
                        </div>
                    </motion.div>
                ) : selectedContent ? (
                    /* Content selected — show season/episode or link input */
                    <>
                        <AnimatePresence mode="wait" custom={direction}>
                            {/* Step 3: For TV - select season/episode, For Movie - enter link */}
                            {step === 3 && (
                                <motion.div
                                    key="step3"
                                    custom={direction}
                                    variants={slideVariants}
                                    initial="enter"
                                    animate="center"
                                    exit="exit"
                                    transition={{ duration: 0.25 }}
                                >
                                    {contentType === 'tv' ? (
                                        <>
                                            {/* TV: Select season and episode */}
                                            <div className="flex items-center gap-4 mb-6">
                                                {posterUrl && (
                                                    <img src={posterUrl} alt={contentTitle} className="w-16 h-24 rounded-lg object-cover" />
                                                )}
                                                <div>
                                                    <h2 className="text-xl font-bold">{contentTitle}</h2>
                                                    <p className="text-white/40 text-sm">{contentYear}</p>
                                                </div>
                                            </div>

                                            <h3 className="text-lg font-semibold mb-4">{t('greenlight.chooseSeasonsAndEpisodes')}</h3>

                                            {/* Season selection */}
                                            <div className="mb-4">
                                                <label className="text-sm text-white/60 mb-2 block">{t('greenlight.seasonLabel')}</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {(selectedContent?.seasons || Array.from({ length: selectedContent?.number_of_seasons || 1 }, (_, i) => ({ season_number: i + 1 }))).map((s: any) => (
                                                        <button
                                                            key={s.season_number}
                                                            onClick={() => {
                                                                setSelectedSeason(s.season_number);
                                                                setSelectedEpisodes(new Set());
                                                                setEpisodes([]);
                                                                fetchEpisodes(selectedContent!.id, s.season_number);
                                                            }}
                                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedSeason === s.season_number
                                                                ? 'bg-green-500 text-white'
                                                                : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                                                                }`}
                                                        >
                                                            S{s.season_number}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Episode selection (multi) */}
                                            {selectedSeason !== null && (
                                                <div className="mb-6">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <label className="text-sm text-white/60">{t('greenlight.episodesLabel')} <span className="text-green-400">({t('greenlight.episodesSelected', { count: selectedEpisodes.size })})</span></label>
                                                        {episodes.length > 0 && (
                                                            <button
                                                                onClick={() => {
                                                                    if (selectedEpisodes.size === episodes.length) {
                                                                        setSelectedEpisodes(new Set());
                                                                    } else {
                                                                        setSelectedEpisodes(new Set(episodes.map(e => e.episode_number)));
                                                                    }
                                                                }}
                                                                className="text-xs text-green-400 hover:text-green-300 transition-colors"
                                                            >
                                                                {selectedEpisodes.size === episodes.length ? t('greenlight.deselectAll') : t('greenlight.selectAll')}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {loadingEpisodes ? (
                                                        <div className="flex justify-center py-4">
                                                            <Loader2 className="w-5 h-5 animate-spin text-green-400" />
                                                        </div>
                                                    ) : (
                                                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-48 overflow-y-auto" data-lenis-prevent>
                                                            {episodes.map((ep) => (
                                                                <button
                                                                    key={ep.episode_number}
                                                                    onClick={() => {
                                                                        setSelectedEpisodes(prev => {
                                                                            const next = new Set(prev);
                                                                            if (next.has(ep.episode_number)) next.delete(ep.episode_number);
                                                                            else next.add(ep.episode_number);
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    title={ep.name}
                                                                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${selectedEpisodes.has(ep.episode_number)
                                                                        ? 'bg-green-500 text-white'
                                                                        : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                                                                        }`}
                                                                >
                                                                    E{ep.episode_number}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <div className="flex justify-between mt-6">
                                                <Button variant="ghost" onClick={() => { setSelectedContent(null); setSelectedSeason(null); setSelectedEpisodes(new Set()); setEpisodes([]); setStep(1); }} className="text-white/50 hover:text-white group/icon">
                                                    <ArrowLeft className="w-4 h-4 mr-1 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" /> {t('common.back')}
                                                </Button>
                                                <Button
                                                    disabled={selectedSeason === null || selectedEpisodes.size === 0}
                                                    onClick={() => navigateStep(4)}
                                                    className="bg-green-600 hover:bg-green-700 disabled:opacity-30"
                                                >
                                                    {t('greenlight.nextEpisodes', { count: selectedEpisodes.size })} <ArrowRight className="w-4 h-4 ml-1" />
                                                </Button>
                                            </div>
                                        </>
                                    ) : (
                                        /* Movie: Enter link directly */
                                        <LinkInputForm
                                            contentTitle={contentTitle}
                                            contentYear={contentYear}
                                            posterUrl={posterUrl}
                                            contentType="movie"
                                            seasonLabel={null}
                                            linkUrl={linkUrl}
                                            setLinkUrl={setLinkUrl}
                                            sourceName={sourceName}
                                            setSourceName={setSourceName}
                                            isUqload={isUqload}
                                            error={error}
                                            submitting={submitting}
                                            onSubmit={handleSubmit}
                                            onBack={() => { setSelectedContent(null); setStep(1); }}
                                        />
                                    )}
                                </motion.div>
                            )}

                            {/* Step 4: TV - Enter per-episode links */}
                            {step === 4 && contentType === 'tv' && (
                                <motion.div
                                    key="step4"
                                    custom={direction}
                                    variants={slideVariants}
                                    initial="enter"
                                    animate="center"
                                    exit="exit"
                                    transition={{ duration: 0.25 }}
                                >
                                    {/* Content summary */}
                                    <div className="flex items-center gap-4 mb-6">
                                        {posterUrl && (
                                            <img src={posterUrl} alt={contentTitle} className="w-16 h-24 rounded-lg object-cover shadow-lg" />
                                        )}
                                        <div>
                                            <h2 className="text-xl font-bold">{contentTitle}</h2>
                                            <p className="text-white/40 text-sm">
                                                {contentYear}
                                                <span className="ml-2 text-green-400 font-medium">• S{selectedSeason} — {selectedEpisodes.size} épisode{selectedEpisodes.size > 1 ? 's' : ''}</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-lg font-semibold flex items-center gap-2">
                                            <LinkIcon className="w-5 h-5 text-green-400" />
                                            {t('greenlight.oneLinkPerEpisode')}
                                        </h3>
                                        <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/10">
                                            <button
                                                onClick={() => {
                                                    setLinkInputMode('individual');
                                                    // Sync from textarea to individual if switching
                                                    if (bulkTextarea.trim()) {
                                                        const lines = bulkTextarea.split('\n').map(l => l.trim()).filter(Boolean);
                                                        const sortedEps = Array.from(selectedEpisodes).sort((a, b) => a - b);
                                                        const filled: Record<number, string> = {};
                                                        sortedEps.forEach((ep, i) => { filled[ep] = lines[i] || ''; });
                                                        setEpisodeUrls(filled);
                                                    }
                                                }}
                                                className={`group/icon flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                                                    linkInputMode === 'individual'
                                                        ? 'bg-green-500/20 text-green-400'
                                                        : 'text-white/40 hover:text-white/60'
                                                }`}
                                            >
                                                <List className={`w-3.5 h-3.5 transition-[color,opacity] ${(linkInputMode === 'individual' ? "text-green-400 opacity-100" : "text-white opacity-40 group-hover/icon:opacity-60")}`} />
                                                {t('greenlight.detailedMode')}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setLinkInputMode('textarea');
                                                    // Sync from individual to textarea if switching
                                                    const sortedEps = Array.from(selectedEpisodes).sort((a, b) => a - b);
                                                    const lines = sortedEps.map(ep => episodeUrls[ep] || '').join('\n');
                                                    setBulkTextarea(lines);
                                                }}
                                                className={`group/icon flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                                                    linkInputMode === 'textarea'
                                                        ? 'bg-green-500/20 text-green-400'
                                                        : 'text-white/40 hover:text-white/60'
                                                }`}
                                            >
                                                <AlignLeft className={`w-3.5 h-3.5 transition-[color,opacity] ${(linkInputMode === 'textarea' ? "text-green-400 opacity-100" : "text-white opacity-40 group-hover/icon:opacity-60")}`} />
                                                {t('greenlight.textMode')}
                                            </button>
                                        </div>
                                    </div>

                                    {linkInputMode === 'individual' ? (
                                        <>
                                            {/* Per-episode link inputs */}
                                            <div className="space-y-2 mb-4 max-h-[40vh] overflow-y-auto pr-1" data-lenis-prevent>
                                                {Array.from(selectedEpisodes).sort((a, b) => a - b).map((epNum) => {
                                                    const epName = episodes.find(e => e.episode_number === epNum)?.name;
                                                    return (
                                                        <div key={epNum} className="flex items-center gap-2">
                                                            <span className="text-xs font-bold text-green-400 w-10 flex-shrink-0 text-right">E{epNum}</span>
                                                            <div className="flex-1 relative">
                                                                <input
                                                                    type="url"
                                                                    value={episodeUrls[epNum] || ''}
                                                                    onChange={(e) => setEpisodeUrls(prev => ({ ...prev, [epNum]: e.target.value }))}
                                                                    placeholder={epName ? t('greenlight.linkForEpisode', { name: epName }) : t('greenlight.linkEpisodeNum', { num: epNum })}
                                                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-green-500/50 focus:border-green-500/50"
                                                                />
                                                                {(episodeUrls[epNum] || '').toLowerCase().includes('uqload.') && (
                                                                    <Sparkles className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-400" />
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Paste same URL for all button */}
                                            <div className="flex items-center gap-2 mb-4">
                                                <div className="flex-1 relative">
                                                    <input
                                                        type="url"
                                                        id="bulk-url-input"
                                                        placeholder={t('greenlight.pasteForAll')}
                                                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-green-500/50"
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                const val = (e.target as HTMLInputElement).value.trim();
                                                                if (val) {
                                                                    const filled: Record<number, string> = {};
                                                                    selectedEpisodes.forEach(ep => { filled[ep] = val; });
                                                                    setEpisodeUrls(filled);
                                                                    (e.target as HTMLInputElement).value = '';
                                                                }
                                                            }
                                                        }}
                                                    />
                                                </div>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-xs text-white/40 hover:text-white h-8 px-2 flex-shrink-0"
                                                    onClick={() => {
                                                        const input = document.getElementById('bulk-url-input') as HTMLInputElement;
                                                        const val = input?.value?.trim();
                                                        if (val) {
                                                            const filled: Record<number, string> = {};
                                                            selectedEpisodes.forEach(ep => { filled[ep] = val; });
                                                            setEpisodeUrls(filled);
                                                            input.value = '';
                                                        }
                                                    }}
                                                >
                                                    {t('greenlight.applyToAll')}
                                                </Button>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            {/* Textarea mode */}
                                            <p className="text-xs text-white/40 mb-2">
                                                {t('greenlight.textAreaHint', { first: Array.from(selectedEpisodes).sort((a, b) => a - b)[0], second: Array.from(selectedEpisodes).sort((a, b) => a - b)[1] || '...' })}
                                            </p>
                                            <div className="relative mb-4 overflow-hidden rounded-lg border border-white/10 bg-white/5 focus-within:ring-1 focus-within:ring-green-500/50 focus-within:border-green-500/50">
                                                <div
                                                    className="absolute left-0 top-0 w-8 flex flex-col pt-[9px] text-right pr-1 pointer-events-none select-none"
                                                    style={{ lineHeight: '1.625rem', transform: `translateY(-${(() => { const ta = document.getElementById('bulk-textarea'); return ta ? ta.scrollTop : 0; })()}px)` }}
                                                    id="bulk-textarea-labels"
                                                >
                                                    {Array.from(selectedEpisodes).sort((a, b) => a - b).map((ep) => (
                                                        <span key={ep} className="text-[10px] font-bold text-green-400/60">E{ep}</span>
                                                    ))}
                                                </div>
                                                <textarea
                                                    id="bulk-textarea"
                                                    value={bulkTextarea}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setBulkTextarea(val);
                                                        // Sync to episodeUrls
                                                        const lines = val.split('\n');
                                                        const sortedEps = Array.from(selectedEpisodes).sort((a, b) => a - b);
                                                        const filled: Record<number, string> = {};
                                                        sortedEps.forEach((ep, i) => { filled[ep] = (lines[i] || '').trim(); });
                                                        setEpisodeUrls(filled);
                                                    }}
                                                    onScroll={(e) => {
                                                        const labels = document.getElementById('bulk-textarea-labels');
                                                        if (labels) labels.style.transform = `translateY(-${(e.target as HTMLTextAreaElement).scrollTop}px)`;
                                                    }}
                                                    rows={Math.min(selectedEpisodes.size, 12)}
                                                    placeholder={`https://exemple.com/episode1\nhttps://exemple.com/episode2\nhttps://exemple.com/episode3`}
                                                    className="w-full pl-10 pr-3 py-2 bg-transparent text-sm text-white placeholder:text-white/15 focus:outline-none font-mono resize-none"
                                                    style={{ lineHeight: '1.625rem' }}
                                                    data-lenis-prevent
                                                />
                                            </div>
                                        </>
                                    )}

                                    {/* Source name (optional) */}
                                    <div className="mb-4">
                                        <label className="text-sm text-white/60 mb-1.5 block">{t('greenlight.sourceNameOptional')}</label>
                                        <input
                                            type="text"
                                            value={sourceName}
                                            onChange={(e) => setSourceName(e.target.value)}
                                            placeholder={t('greenlight.sourceNamePlaceholder')}
                                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
                                        />
                                    </div>

                                    {/* Uqload reminder */}
                                    <div className="mb-4 p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white/40">
                                        <p className="font-medium text-white/60 mb-1">{t('greenlight.tipTitle')}</p>
                                        <p>{t('greenlight.tipUploadUqload')}</p>
                                        <p className="mt-1">{t('greenlight.tipPremiumAccount')}</p>
                                    </div>

                                    {isUqload && (
                                        <motion.p
                                            initial={{ opacity: 0, y: -5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="text-xs text-emerald-400 mb-4 flex items-center gap-1"
                                        >
                                            <Sparkles className="w-3 h-3" /> {t('greenlight.uqloadDetected')}
                                        </motion.p>
                                    )}

                                    {/* Error */}
                                    {error && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2"
                                        >
                                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                            {error}
                                        </motion.div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex justify-between">
                                        <Button variant="ghost" onClick={() => navigateStep(3)} className="text-white/50 hover:text-white group/icon">
                                            <ArrowLeft className="w-4 h-4 mr-1 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" /> {t('common.back')}
                                        </Button>
                                        <Button
                                            disabled={Object.keys(episodeUrls).length < selectedEpisodes.size || Object.values(episodeUrls).some(u => !u.trim()) || submitting}
                                            onClick={handleSubmit}
                                            className="bg-green-600 hover:bg-green-700 disabled:opacity-30"
                                        >
                                            {submitting ? (
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            ) : (
                                                <Send className="w-4 h-4 mr-2" />
                                            )}
                                            {t('greenlight.submitLinks', { count: selectedEpisodes.size })}
                                        </Button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </>
                ) : (
                    /* No content selected yet — show filter bar + search/browse */
                    <>
                        {/* Filter toggles */}
                        <div className="space-y-4 mb-6">
                            {/* Content type toggle */}
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs text-white/40 mr-1">{t('greenlight.typeFilter')}</span>
                                {/* Films */}
                                {contentType === 'movie' ? (
                                    <motion.div layout whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { setContentType('movie'); setSearchQuery(''); setSearchResults([]); setWishboardRequests([]); setWishboardSearch(''); }} className="cursor-pointer">
                                        <AnimatedBorderCard highlightColor="34 197 94" backgroundColor="20 20 20" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-white rounded-lg">
                                            <Film className="h-4 w-4" /> {t('greenlight.films')}
                                        </AnimatedBorderCard>
                                    </motion.div>
                                ) : (
                                    <motion.button layout whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { setContentType('movie'); setSearchQuery(''); setSearchResults([]); setWishboardRequests([]); setWishboardSearch(''); }} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white group/icon">
                                        <Film className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" /> {t('greenlight.films')}
                                    </motion.button>
                                )}
                                {/* Séries */}
                                {contentType === 'tv' ? (
                                    <motion.div layout whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { setContentType('tv'); setSearchQuery(''); setSearchResults([]); setWishboardRequests([]); setWishboardSearch(''); }} className="cursor-pointer">
                                        <AnimatedBorderCard highlightColor="34 197 94" backgroundColor="20 20 20" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-white rounded-lg">
                                            <Tv className="h-4 w-4" /> {t('greenlight.tvSeries')}
                                        </AnimatedBorderCard>
                                    </motion.div>
                                ) : (
                                    <motion.button layout whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { setContentType('tv'); setSearchQuery(''); setSearchResults([]); setWishboardRequests([]); setWishboardSearch(''); }} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white group/icon">
                                        <Tv className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" /> {t('greenlight.tvSeries')}
                                    </motion.button>
                                )}

                                <div className="h-6 w-px bg-white/10" />

                                {/* Source mode toggle */}
                                <span className="text-xs text-white/40 mr-1">{t('greenlight.sourceFilter')}</span>
                                {sourceMode === 'tmdb' ? (
                                    <motion.div layout whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { setSourceMode('tmdb'); }} className="cursor-pointer">
                                        <AnimatedBorderCard highlightColor="34 197 94" backgroundColor="20 20 20" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-white rounded-lg">
                                            <Search className="h-4 w-4" /> TMDB
                                        </AnimatedBorderCard>
                                    </motion.div>
                                ) : (
                                    <motion.button layout whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { setSourceMode('tmdb'); setWishboardRequests([]); setWishboardSearch(''); }} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white group/icon">
                                        <Search className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" /> TMDB
                                    </motion.button>
                                )}
                                {sourceMode === 'wishboard' ? (
                                    <motion.div layout whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { setSourceMode('wishboard'); }} className="cursor-pointer">
                                        <AnimatedBorderCard highlightColor="34 197 94" backgroundColor="20 20 20" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-white rounded-lg">
                                            <Vote className="h-4 w-4" /> {t('greenlight.requests')}
                                        </AnimatedBorderCard>
                                    </motion.div>
                                ) : (
                                    <motion.button layout whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { setSourceMode('wishboard'); setSearchQuery(''); setSearchResults([]); fetchWishboardRequests('', 1); }} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white group/icon">
                                        <Vote className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" /> {t('greenlight.requests')}
                                    </motion.button>
                                )}
                            </div>
                        </div>

                        {/* Prompt to select type if none chosen */}
                        {!contentType ? (
                            <div className="text-center py-16">
                                <Film className="w-12 h-12 mx-auto text-white opacity-10 mb-3" />
                                <p className="text-white/30 text-sm">{t('greenlight.selectContentType')}</p>
                            </div>
                        ) : !sourceMode ? (
                            <div className="text-center py-16">
                                <Search className="w-12 h-12 mx-auto text-white opacity-10 mb-3" />
                                <p className="text-white/30 text-sm">{t('greenlight.chooseSource')}</p>
                            </div>
                        ) : sourceMode === 'tmdb' ? (
                            /* TMDB Search */
                            <>
                                <div className="relative mb-6">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white opacity-30" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && searchTmdb()}
                                        placeholder={contentType === 'movie' ? t('greenlight.searchMoviePlaceholder') : t('greenlight.searchSeriesPlaceholder')}
                                        className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
                                        autoFocus
                                    />
                                    {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-green-400" />}
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-lenis-prevent>
                                    {searchResults.map((item) => {
                                        const title = item.title || item.name || '';
                                        const year = (item.release_date || item.first_air_date || '').split('-')[0];
                                        return (
                                            <motion.button
                                                key={item.id}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                whileHover={{ scale: 1.03 }}
                                                whileTap={{ scale: 0.97 }}
                                                onClick={() => handleSelectContent(item)}
                                                className="text-left bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-green-500/40 transition-all"
                                            >
                                                {item.poster_path ? (
                                                    <img
                                                        src={`https://image.tmdb.org/t/p/w185${item.poster_path}`}
                                                        alt={title}
                                                        className="w-full aspect-[2/3] object-cover"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="w-full aspect-[2/3] bg-white/5 flex items-center justify-center">
                                                        {contentType === 'movie' ? <Film className="w-8 h-8 text-white opacity-20" /> : <Tv className="w-8 h-8 text-white opacity-20" />}
                                                    </div>
                                                )}
                                                <div className="p-2">
                                                    <p className="text-xs font-medium text-white line-clamp-2">{title}</p>
                                                    <p className="text-xs text-white/40">{year}</p>
                                                </div>
                                            </motion.button>
                                        );
                                    })}
                                </div>

                                {searchResults.length === 0 && searchQuery.trim().length >= 2 && !loading && (
                                    <div className="text-center py-12">
                                        <Search className="w-10 h-10 mx-auto text-white opacity-10 mb-3" />
                                        <p className="text-white/30 text-sm">{t('greenlight.noResultsFor', { query: searchQuery })}</p>
                                    </div>
                                )}
                            </>
                        ) : (
                            /* Wishboard Requests Browser */
                            <>
                                <div className="relative mb-6">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white opacity-30" />
                                    <input
                                        type="text"
                                        value={wishboardSearch}
                                        onChange={(e) => setWishboardSearch(e.target.value)}
                                        placeholder={t('greenlight.filterRequests')}
                                        className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
                                        autoFocus
                                    />
                                    {loadingWishboard && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-green-400" />}
                                </div>

                                {!loadingWishboard && wishboardRequests.length === 0 ? (
                                    <div className="text-center py-12">
                                        <ListChecks className="w-12 h-12 mx-auto text-white opacity-15 mb-3" />
                                        <p className="text-white/30 text-sm">{t('greenlight.noRequestsFound')}</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-lenis-prevent>
                                            {wishboardRequests.map((req) => (
                                                <motion.button
                                                    key={req.id}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    whileHover={{ scale: 1.03 }}
                                                    whileTap={{ scale: 0.97 }}
                                                    onClick={() => handleSelectWishboard(req)}
                                                    className="text-left bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-green-500/40 transition-all relative"
                                                >
                                                    {req.poster_path ? (
                                                        <img
                                                            src={`https://image.tmdb.org/t/p/w185${req.poster_path}`}
                                                            alt={req.title || ''}
                                                            className="w-full aspect-[2/3] object-cover"
                                                            loading="lazy"
                                                        />
                                                    ) : (
                                                        <div className="w-full aspect-[2/3] bg-white/5 flex items-center justify-center">
                                                            {req.media_type === 'movie' ? <Film className="w-8 h-8 text-white opacity-20" /> : <Tv className="w-8 h-8 text-white opacity-20" />}
                                                        </div>
                                                    )}
                                                    {/* Vote count badge */}
                                                    <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[10px] font-medium text-green-400 flex items-center gap-0.5">
                                                        <Vote className="w-2.5 h-2.5" /> {req.vote_count}
                                                    </div>
                                                    <div className="p-2">
                                                        <p className="text-xs font-medium text-white line-clamp-2">{req.title}</p>
                                                        <p className="text-xs text-white/40">{req.year}</p>
                                                    </div>
                                                </motion.button>
                                            ))}
                                        </div>

                                        {wishboardHasMore && (
                                            <div className="text-center mt-4">
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => {
                                                        const nextPage = wishboardPage + 1;
                                                        setWishboardPage(nextPage);
                                                        fetchWishboardRequests(wishboardSearch, nextPage, true);
                                                    }}
                                                    className="text-white/50 hover:text-white text-xs group/icon"
                                                    disabled={loadingWishboard}
                                                >
                                                    {loadingWishboard ? <Loader2 className="w-4 h-4 animate-spin mr-1 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" /> : null}
                                                    {t('greenlight.seeMoreRequests')}
                                                </Button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>
        </SquareBackground>
    );
};

// =====================================
// Link Input Form Sub-Component
// =====================================
interface LinkInputFormProps {
    contentTitle: string;
    contentYear: string;
    posterUrl: string | null;
    contentType: string;
    seasonLabel: string | null;
    linkUrl: string;
    setLinkUrl: (val: string) => void;
    sourceName: string;
    setSourceName: (val: string) => void;
    isUqload: boolean;
    error: string | null;
    submitting: boolean;
    onSubmit: () => void;
    onBack: () => void;
}

const LinkInputForm: React.FC<LinkInputFormProps> = ({
    contentTitle, contentYear, posterUrl, seasonLabel,
    linkUrl, setLinkUrl, sourceName, setSourceName, isUqload,
    error, submitting, onSubmit, onBack
}) => {
    const { t } = useTranslation();
    return (
        <>
            {/* Content summary */}
            <div className="flex items-center gap-4 mb-6">
                {posterUrl && (
                    <img src={posterUrl} alt={contentTitle} className="w-16 h-24 rounded-lg object-cover shadow-lg" />
                )}
                <div>
                    <h2 className="text-xl font-bold">{contentTitle}</h2>
                    <p className="text-white/40 text-sm">
                        {contentYear}
                        {seasonLabel && <span className="ml-2 text-green-400 font-medium">• {seasonLabel}</span>}
                    </p>
                </div>
            </div>

            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <LinkIcon className="w-5 h-5 text-green-400" />
                {t('greenlight.pasteYourLink')}
            </h3>

            {/* Link URL input */}
            <div className="mb-4">
                <label className="text-sm text-white/60 mb-1.5 block">{t('greenlight.urlStreamingLabel')}</label>
                <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder={t('greenlight.urlStreamingPlaceholder')}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
                    autoFocus
                />
                {isUqload && (
                    <motion.p
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-xs text-emerald-400 mt-1.5 flex items-center gap-1"
                    >
                        <Sparkles className="w-3 h-3" /> {t('greenlight.uqloadDetected')}
                    </motion.p>
                )}
            </div>

            {/* Source name (optional) */}
            <div className="mb-6">
                <label className="text-sm text-white/60 mb-1.5 block">{t('greenlight.sourceNameOptional')}</label>
                <input
                    type="text"
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder={t('greenlight.sourceNamePlaceholder')}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
                />
            </div>

            {/* Uqload reminder */}
            <div className="mb-6 p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white/40">
                <p className="font-medium text-white/60 mb-1">{t('greenlight.tipTitle')}</p>
                <p>{t('greenlight.tipUploadUqloadFull')}</p>
                <p className="mt-1">{t('greenlight.tipPremiumAccount')}</p>
            </div>

            {/* Error */}
            {error && (
                <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2"
                >
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {error}
                </motion.div>
            )}

            {/* Actions */}
            <div className="flex justify-between">
                <Button variant="ghost" onClick={onBack} className="text-white/50 hover:text-white group/icon">
                    <ArrowLeft className="w-4 h-4 mr-1 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" /> {t('common.back')}
                </Button>
                <Button
                    disabled={!linkUrl.trim() || submitting}
                    onClick={onSubmit}
                    className="bg-green-600 hover:bg-green-700 disabled:opacity-30"
                >
                    {submitting ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                        <Send className="w-4 h-4 mr-2" />
                    )}
                    {t('greenlight.submitTheLink')}
                </Button>
            </div>
        </>
    );
};

export default SubmitLinkPage;
