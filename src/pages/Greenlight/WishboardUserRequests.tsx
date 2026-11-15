import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeft, Popcorn, Film, Tv, Calendar, Check, X, Clock,
    Search, AlertCircle, Loader2, MessageSquare, ArrowBigUp
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import Counter from '../../components/ui/counter';
import WishboardDetailsModal, { WishboardRequest } from '../../components/Greenlight/WishboardDetailsModal';
import BlurText from '../../components/ui/blur-text';
import ShinyText from '../../components/ui/shiny-text';
import AnimatedBorderCard from '../../components/ui/animated-border-card';
import { SquareBackground } from '../../components/ui/square-background';
import { getTmdbLanguage } from '../../i18n';
import { useTurnstile } from '../../context/TurnstileContext';


// Helper function to calculate places array based on value
const getPlacesForValue = (value: number): number[] => {
    if (value === 0) return [1];
    const digits = Math.floor(Math.log10(Math.max(1, value))) + 1;
    const places: number[] = [];
    for (let i = digits - 1; i >= 0; i--) {
        places.push(Math.pow(10, i));
    }
    return places;
};

// Shared types are imported from WishboardDetailsModal


type TabType = 'all' | 'mine' | 'upvoted';

const statusLabels: Record<string, string> = {
    pending: 'greenlight.statusPending',
    not_found: 'greenlight.statusNotFound',
    not_found_recent: 'greenlight.statusTooRecent',
    searching: 'greenlight.statusSearching',
    added: 'greenlight.statusAdded',
    rejected: 'greenlight.statusRejected',
};

const statusIcons: Record<string, React.ReactNode> = {
    pending: <Clock className="w-3 h-3" />,
    not_found: <X className="w-3 h-3" />,
    not_found_recent: <AlertCircle className="w-3 h-3" />,
    searching: <Search className="w-3 h-3" />,
    added: <Check className="w-3 h-3" />,
    rejected: <X className="w-3 h-3" />,
};

const WishboardUserRequests: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { getValidToken, resetToken: resetTurnstile } = useTurnstile();
    const [myRequests, setMyRequests] = useState<WishboardRequest[]>([]);
    const [upvotedRequests, setUpvotedRequests] = useState<WishboardRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabType>('mine');
    const [expandedNotes, setExpandedNotes] = useState<number | null>(null);
    const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);

    // Derived selected request to ensure it stays in sync
    const selectedRequest = [...myRequests, ...upvotedRequests].find(r => r.id === selectedRequestId) || null;

    const API_URL = import.meta.env.VITE_MAIN_API || '';

    // Fetch TMDB data
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
        return { title: t('greenlight.unknown'), year: '', poster_path: null };
    };

    // Fetch user's requests
    const fetchUserRequests = useCallback(async () => {
        setLoading(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const profileId = localStorage.getItem('selected_profile_id');

            // Fetch my requests
            const myResponse = await fetch(`${API_URL}/api/wishboard/user/requests`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'X-Profile-ID': profileId || '',
                },
            });

            // Fetch upvoted requests
            const upvotedResponse = await fetch(`${API_URL}/api/wishboard/user/votes`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'X-Profile-ID': profileId || '',
                },
            });

            if (myResponse.ok) {
                const myData = await myResponse.json();
                const myWithTmdb = await Promise.all(
                    myData.requests.map(async (req: WishboardRequest) => {
                        const tmdbData = await fetchTmdbData(req.tmdb_id, req.media_type);
                        return { ...req, ...tmdbData };
                    })
                );
                setMyRequests(myWithTmdb);
            }

            if (upvotedResponse.ok) {
                const upvotedData = await upvotedResponse.json();
                const upvotedWithTmdb = await Promise.all(
                    upvotedData.requests.map(async (req: WishboardRequest) => {
                        const tmdbData = await fetchTmdbData(req.tmdb_id, req.media_type);
                        return { ...req, ...tmdbData };
                    })
                );
                setUpvotedRequests(upvotedWithTmdb);
            }
        } catch (error) {
            console.error('Error fetching user requests:', error);
        } finally {
            setLoading(false);
        }
    }, [API_URL]);

    // Handle vote
    const handleVote = async (requestId: number) => {
        const authToken = localStorage.getItem('auth_token');
        const profileId = localStorage.getItem('selected_profile_id');
        const turnstileToken = await getValidToken();
        if (!turnstileToken) return;

        try {
            const response = await fetch(`${API_URL}/api/wishboard/${requestId}/vote`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                    'X-Profile-ID': profileId || '',
                },
                body: JSON.stringify({ turnstileToken }),
            });

            resetTurnstile();

            if (response.ok) {
                // Update local state
                const updateRequest = (req: WishboardRequest) => {
                    if (req.id === requestId) {
                        return { ...req, vote_count: req.vote_count + 1, has_voted: true };
                    }
                    return req;
                };

                setMyRequests(prev => prev.map(updateRequest));
                setUpvotedRequests(prev => {
                    // Check if it's already in upvoted (it shouldn't be if we are voting, but logic safety)
                    const existing = prev.find(r => r.id === requestId);
                    if (existing) return prev.map(updateRequest);
                    // If not in upvoted, we might need to add it, but we don't have the full object if it was only in myRequests
                    // Simpler to just re-fetch or just update if it exists. 
                    // For now, let's update if exists. If the user votes on their own request, it should appear in upvoted? 
                    // Usually "upvoted" tab is for things I voted on.
                    // If I vote on my own request (if allowed), it should be in both.
                    return prev.map(updateRequest);
                });

                // If it wasn't in upvoted, we might want to refresh to get it there, or just ignore for now until refresh.
                // But generally, handleVote is called when has_voted is false.
            }
        } catch (error) {
            console.error('Error voting:', error);
        }
    };

    // Handle unvote
    const handleUnvote = async (requestId: number) => {
        const authToken = localStorage.getItem('auth_token');
        const profileId = localStorage.getItem('selected_profile_id');
        const turnstileToken = await getValidToken();
        if (!turnstileToken) return;

        try {
            const response = await fetch(`${API_URL}/api/wishboard/${requestId}/vote`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                    'X-Profile-ID': profileId || '',
                },
                body: JSON.stringify({ turnstileToken }),
            });

            resetTurnstile();

            if (response.ok) {
                // Update local state
                const updateRequest = (req: WishboardRequest) => {
                    if (req.id === requestId) {
                        return { ...req, vote_count: Math.max(0, req.vote_count - 1), has_voted: false };
                    }
                    return req;
                };

                setMyRequests(prev => prev.map(updateRequest));

                // For upvoted requests, if we unvote, it should effectively be removed from the list or just marked unvoted?
                // The user said "ne plus voter", implying removing the vote.
                // If I am in "upvoted" tab, and I unvote, it should probably disappear or stay there until refresh?
                // UX-wise, staying there but marked unvoted is better than disappearing instantly often.
                // But since it's "Mes projets soutenus", if I don't soutiens anymore, it should go.
                // However, instant removal can be jarring. Let's just update state for now.
                setUpvotedRequests(prev => prev.map(updateRequest).filter(r => r.id !== requestId ? true : false /* maintain filter if we want to remove? let's keep it simple first: just update, and maybe filter out if we want instant removal */));
                // Actually, let's remove it from upvotedRequests if it was there, because "upvotedRequests" implies has_voted should be true.
                setUpvotedRequests(prev => prev.filter(req => req.id !== requestId));
            }
        } catch (error) {
            console.error('Error unvoting:', error);
        }
    };

    useEffect(() => {
        fetchUserRequests();
    }, [fetchUserRequests]);

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString(i18n.language, {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    };

    const displayedRequests = activeTab === 'mine' ? myRequests : upvotedRequests;

    return (
        <SquareBackground squareSize={48} borderColor="rgba(34, 197, 94, 0.10)" className="min-h-screen bg-black text-white">

            {/* Back link */}
            <div className="w-full absolute top-24 z-20">
                <div className="container px-6 md:px-10">
                    <Link
                        to="/wishboard"
                        className="inline-flex items-center gap-2 text-sm text-green-500 transition-colors hover:text-green-400 font-medium"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {t('greenlight.returnToGreenlight')}
                    </Link>
                </div>
            </div>

            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="pt-32 relative z-10 border-b border-white/10 bg-gradient-to-b from-green-900/10 to-transparent"
            >
                <div className="container px-6 pb-8 md:px-10">
                    <div className="relative inline-block">
                        {/* radial-gradient au lieu de blur-[60px] */}
                        <div
                            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[250px] max-w-[90vw] rounded-full -z-10 pointer-events-none"
                            style={{ background: 'radial-gradient(circle, rgba(34, 197, 94, 0.20) 0%, transparent 70%)' }}
                        />
                        <div className="relative flex items-center gap-3">
                            <Popcorn className="h-8 w-8 text-green-500" />
                            <h1 className="text-3xl md:text-4xl font-black tracking-tight">
                                <ShinyText text={t('greenlight.myProjectsTab')} speed={3} color="#ffffff" shineColor="#4ade80" className="" />
                            </h1>
                        </div>
                    </div>
                    <div className="mt-2 h-6 flex items-center">
                        <BlurText
                            text={t('greenlight.trackProgress')}
                            delay={200}
                            className="text-white/70"
                        />
                    </div>
                </div>
            </motion.div>

            {/* Tabs */}
            <div className="container px-6 md:px-10 py-6 relative z-10">
                <div className="flex items-center gap-2 mb-6">
                    {/* Mes projets tab */}
                    {activeTab === 'mine' ? (
                        <motion.div
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2 }}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setActiveTab('mine')}
                            className="cursor-pointer"
                        >
                            <AnimatedBorderCard
                                highlightColor="34 197 94"
                                backgroundColor="20 20 20"
                                className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white rounded-lg"
                            >
                                <Film className="h-4 w-4" />
                                {t('greenlight.myProjectsTab')}
                                <Badge variant="default" className="ml-1">{myRequests.length}</Badge>
                            </AnimatedBorderCard>
                        </motion.div>
                    ) : (
                        <motion.button
                            layout
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setActiveTab('mine')}
                            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white group/icon"
                        >
                            <Film className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" />
                            {t('greenlight.myProjectsTab')}
                            <Badge variant="default" className="ml-1">{myRequests.length}</Badge>
                        </motion.button>
                    )}

                    {/* Projets soutenus tab */}
                    {activeTab === 'upvoted' ? (
                        <motion.div
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2 }}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setActiveTab('upvoted')}
                            className="cursor-pointer"
                        >
                            <AnimatedBorderCard
                                highlightColor="34 197 94"
                                backgroundColor="20 20 20"
                                className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white rounded-lg"
                            >
                                <ArrowBigUp className="h-4 w-4" />
                                {t('greenlight.supportedProjects')}
                                <Badge variant="default" className="ml-1">{upvotedRequests.length}</Badge>
                            </AnimatedBorderCard>
                        </motion.div>
                    ) : (
                        <motion.button
                            layout
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setActiveTab('upvoted')}
                            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white group/icon"
                        >
                            <ArrowBigUp className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" />
                            {t('greenlight.supportedProjects')}
                            <Badge variant="default" className="ml-1">{upvotedRequests.length}</Badge>
                        </motion.button>
                    )}
                </div>

                {/* Content */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-8 w-8 animate-spin text-green-500" />
                    </div>
                ) : displayedRequests.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="bg-white/5 rounded-lg p-12 text-center border border-white/10"
                    >
                        <Popcorn className="h-12 w-12 text-green-500 opacity-30 mx-auto mb-4" />
                        <p className="text-lg font-medium">
                            {activeTab === 'mine'
                                ? t('greenlight.noProjectProposed')
                                : t('greenlight.noProjectSupported')
                            }
                        </p>
                        <p className="text-sm text-white/50 mt-1">
                            {activeTab === 'mine'
                                ? t('greenlight.noProjectProposedHint')
                                : t('greenlight.noProjectSupportedHint')
                            }
                        </p>
                        <Link to="/wishboard">
                            <AnimatedBorderCard
                                highlightColor="34 197 94"
                                backgroundColor="20 20 20"
                                className="mt-6 inline-flex items-center justify-center px-6 py-3 rounded-lg cursor-pointer hover:scale-105 transition-transform"
                            >
                                <Popcorn className="h-4 w-4 mr-2 text-green-400" />
                                <span className="font-bold text-white">{t('greenlight.viewGreenlight')}</span>
                            </AnimatedBorderCard>
                        </Link>
                    </motion.div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        <AnimatePresence mode="popLayout">
                            {displayedRequests.map((request, index) => (
                                <motion.div
                                    key={request.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ delay: index * 0.05 }}
                                    className="bg-white/5 rounded-lg border border-white/10 overflow-hidden cursor-pointer hover:bg-white/10 transition-colors"
                                    onClick={() => setSelectedRequestId(request.id)}
                                >
                                    <div className="flex items-start gap-4 p-4">
                                        {/* Poster */}
                                        {request.poster_path ? (
                                            <img
                                                src={`https://image.tmdb.org/t/p/w154${request.poster_path}`}
                                                alt={request.title}
                                                className="w-20 h-30 object-cover rounded-lg shrink-0"
                                            />
                                        ) : (
                                            <div className="w-20 h-30 bg-white/10 rounded-lg flex items-center justify-center shrink-0">
                                                {request.media_type === 'movie' ? (
                                                    <Film className="h-8 w-8 text-white opacity-30" />
                                                ) : (
                                                    <Tv className="h-8 w-8 text-white opacity-30" />
                                                )}
                                            </div>
                                        )}

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <Badge variant={request.media_type === 'movie' ? 'default' : 'secondary'}>
                                                    {request.media_type === 'movie' ? (
                                                        <><Film className="h-3 w-3 mr-1" /> {t('greenlight.movieType')}</>
                                                    ) : (
                                                        <><Tv className="h-3 w-3 mr-1" /> {t('greenlight.seriesType')}</>
                                                    )}
                                                </Badge>
                                                {request.season_number && (
                                                    <Badge variant="outline">
                                                        <Calendar className="h-3 w-3 mr-1" /> {t('greenlight.seasonLabel')} {request.season_number}
                                                    </Badge>
                                                )}
                                                <Badge variant="outline" className={`${statusLabels[request.status] === 'greenlight.statusAdded' ? 'text-green-400 border-green-500/50' : 'text-white opacity-70 border-white/20'}`}>
                                                    {statusIcons[request.status]}
                                                    <span className="ml-1">{t(statusLabels[request.status])}</span>
                                                </Badge>
                                            </div>

                                            <h3 className="text-lg font-semibold text-white truncate">
                                                {request.title}
                                            </h3>
                                            <p className="text-sm text-white/50">{request.year}</p>

                                            <div className="flex items-center gap-4 mt-3 text-sm text-white/60">
                                                <span className="flex items-center gap-1">
                                                    <ArrowBigUp className="h-4 w-4 text-white opacity-60" />
                                                    <div className="relative overflow-hidden flex items-center justify-center" style={{ minWidth: '1ch' }}>
                                                        <Counter
                                                            value={request.vote_count}
                                                            fontSize={14}
                                                            padding={0}
                                                            places={getPlacesForValue(Math.max(request.vote_count, 1))}
                                                            gap={0}
                                                            borderRadius={0}
                                                            horizontalPadding={0}
                                                            textColor="currentColor"
                                                            fontWeight="500"
                                                            gradientHeight={0}
                                                        />
                                                    </div>
                                                    votes
                                                </span>
                                                <span>{t('greenlight.requestedOn', { date: formatDate(request.created_at) })}</span>
                                            </div>

                                            {/* Notes */}
                                            {request.notes && request.notes.length > 0 && (
                                                <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        onClick={() => setExpandedNotes(expandedNotes === request.id ? null : request.id)}
                                                        className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors"
                                                    >
                                                        <MessageSquare className="h-4 w-4" />
                                                        {t('greenlight.teamNotes', { count: request.notes.length })}
                                                    </button>

                                                    <AnimatePresence>
                                                        {expandedNotes === request.id && (
                                                            <motion.div
                                                                initial={{ opacity: 0, height: 0 }}
                                                                animate={{ opacity: 1, height: 'auto' }}
                                                                exit={{ opacity: 0, height: 0 }}
                                                                className="mt-3 space-y-2"
                                                            >
                                                                {request.notes.map((note) => (
                                                                    <div
                                                                        key={note.id}
                                                                        className="p-3 rounded-lg bg-green-500/10 border border-green-500/20"
                                                                    >
                                                                        <p className="text-sm text-white/80">{note.note}</p>
                                                                        <p className="text-xs text-white/40 mt-1">
                                                                            {formatDate(note.created_at)}
                                                                        </p>
                                                                    </div>
                                                                ))}
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            )}
                                        </div>

                                        {/* Unvote Button for Upvoted items */}
                                        {request.has_voted && (
                                            <div onClick={(e) => e.stopPropagation()}>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => handleUnvote(request.id)}
                                                    className="bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-400 border-red-500/20"
                                                >
                                                    <ArrowBigUp className="h-4 w-4 mr-2 rotate-180" />
                                                    {t('greenlight.unsupport')}
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}

                {/* Wishboard Details Modal */}
                <WishboardDetailsModal
                    isOpen={!!selectedRequest}
                    onClose={() => setSelectedRequestId(null)}
                    request={selectedRequest}
                    onVote={handleVote}
                    onUnvote={handleUnvote}
                />
            </div>
        </SquareBackground>
    );
};

export default WishboardUserRequests;
