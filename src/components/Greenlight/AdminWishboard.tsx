import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getFrembedBase } from '../../utils/frembedConfig';
import { useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Filter, Trash2, MessageSquare,
    Loader2, Film, Tv, RefreshCw, Plus, Clock, Edit2, Check, X,
    Crown, ArrowUp, ArrowDown, ArrowUpDown, Play, CheckCircle, XCircle, AlertCircle, ListChecks,
    Star, User, ChevronLeft, ChevronRight, CalendarDays
} from 'lucide-react';
import axios from 'axios';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../ui/select';
import ReusableModal from '../ui/reusable-modal';
import Counter from '../ui/counter';
import { encodeId } from '../../utils/idEncoder';
import { getTmdbLanguage } from '../../i18n';

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

const formatMonthKey = (date: Date): string => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const shiftMonthKey = (monthKey: string, offset: number): string => {
    const [year, month] = monthKey.split('-').map(Number);
    return formatMonthKey(new Date(year, month - 1 + offset, 1));
};

const formatMonthLabel = (monthKey: string, language: string): string => {
    const [year, month] = monthKey.split('-').map(Number);
    const monthLabel = new Intl.DateTimeFormat(language?.startsWith('fr') ? 'fr-FR' : 'en-US', {
        month: 'long',
        year: 'numeric'
    }).format(new Date(year, month - 1, 1));

    return monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
};

const MAIN_API = import.meta.env.VITE_MAIN_API;
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
const ADMIN_WISHBOARD_INITIAL_RENDER_COUNT = 60;
const ADMIN_WISHBOARD_RENDER_STEP = 60;

// Interface for source check results
interface SourceCheckResult {
    name: string;
    available: boolean;
    count?: number;
    details?: string;
}

interface SeasonSourceCheck {
    seasonNumber: number;
    sources: SourceCheckResult[];
}

// Interface for batch check results
interface BatchCheckResult {
    request: WishboardRequest;
    availableCategories: number;
    sources: SourceCheckResult[];
}

interface WishboardRequest {
    id: number;
    user_id: string;
    profile_id: string;
    tmdb_id: number;
    media_type: 'movie' | 'tv';
    season_number: string | null;
    status: 'pending' | 'not_found' | 'not_found_recent' | 'searching' | 'added' | 'rejected';
    vote_count: number;
    created_at: string;
    updated_at: string;
    notes: WishboardNote[];
    // TMDB data
    title?: string;
    year?: string;
    poster_path?: string | null;
    statusHistory?: WishboardStatusHistory[];
    user?: {
        username: string;
        isVip: boolean;
        avatar?: string;
    };
}

interface WishboardStatusHistory {
    id?: number;
    status: string;
    reason: string | null;
    changed_at: string;
}

interface WishboardNote {
    id: number;
    admin_id: string;
    note: string;
    is_public: boolean;
    created_at: string;
}

interface AdminStats {
    total: number;
    pending: number;
    added: number;
    rejected: number;
    not_found: number;
}

interface LeaderboardEntry {
    admin_id: string;
    admin_auth_type: string;
    role: string;
    username: string;
    avatar: string | null;
    greenlight_count?: number;
    last_greenlight_at?: string;
    score?: number;
    last_action_at?: string;
}

const statusOptions = [
    { value: 'pending', label: 'admin.statusPending', color: 'text-amber-400' },
    { value: 'not_found', label: 'admin.statusNotFound', color: 'text-orange-400' },
    { value: 'searching', label: 'admin.statusSearching', color: 'text-blue-400' },
    { value: 'added', label: 'admin.statusAdded', color: 'text-green-400' },
    { value: 'rejected', label: 'admin.statusRejected', color: 'text-red-400' },
];

const AdminWishboard: React.FC = () => {
    const { t, i18n } = useTranslation();
    const [requests, setRequests] = useState<WishboardRequest[]>([]);
    const [stats, setStats] = useState<AdminStats>({
        total: 0,
        pending: 0,
        added: 0,
        rejected: 0,
        not_found: 0,
    });
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
    const [vipFilter, setVipFilter] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [renderCount, setRenderCount] = useState(ADMIN_WISHBOARD_INITIAL_RENDER_COUNT);

    // Debounce search query (500ms)
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Modal states
    const [noteModalOpen, setNoteModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<WishboardRequest | null>(null);
    const [noteContent, setNoteContent] = useState('');
    const [noteIsPublic, setNoteIsPublic] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    // Status change modal states
    const [statusModalOpen, setStatusModalOpen] = useState(false);
    const [pendingStatus, setPendingStatus] = useState<string | null>(null);
    const [statusReason, setStatusReason] = useState('');

    // History modal states
    const [historyModalOpen, setHistoryModalOpen] = useState(false);
    const [editingHistoryId, setEditingHistoryId] = useState<number | null>(null);
    const [editHistoryReason, setEditHistoryReason] = useState('');

    // View toggle: requests or leaderboard
    const [activeView, setActiveView] = useState<'requests' | 'leaderboard'>('requests');

    // Leaderboard state
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [leaderboardLoading, setLeaderboardLoading] = useState(false);
    const [leaderboardType, setLeaderboardType] = useState<'wishboard' | 'downloads'>('wishboard');
    const [leaderboardScope, setLeaderboardScope] = useState<'month' | 'all-time'>('month');
    const [selectedLeaderboardMonth, setSelectedLeaderboardMonth] = useState(() => formatMonthKey(new Date()));

    // Sorting state
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'vote_count', direction: 'desc' });

    // Source check modal states
    const [sourceCheckModalOpen, setSourceCheckModalOpen] = useState(false);
    const [checkingSources, setCheckingSources] = useState(false);
    const [sourceCheckResults, setSourceCheckResults] = useState<SourceCheckResult[]>([]);
    const [tvSourceCheckResults, setTvSourceCheckResults] = useState<SeasonSourceCheck[]>([]);
    const [sourceCheckTitle, setSourceCheckTitle] = useState('');
    const [sourceCheckMediaType, setSourceCheckMediaType] = useState<'movie' | 'tv'>('movie');

    // Batch check modal states
    const [batchCheckModalOpen, setBatchCheckModalOpen] = useState(false);
    const [batchChecking, setBatchChecking] = useState(false);
    const [batchProgress, setBatchProgress] = useState(0);
    const [batchTotal, setBatchTotal] = useState(0);
    const [batchCurrentTitle, setBatchCurrentTitle] = useState('');
    const [batchResults, setBatchResults] = useState<BatchCheckResult[]>([]);
    const [batchCompleted, setBatchCompleted] = useState(false);
    const [deletingBatch, setDeletingBatch] = useState(false);
    const tmdbCacheRef = useRef<Record<string, { title: string; year: string; poster_path: string | null }>>({});

    const handleSort = (key: string) => {
        setSortConfig(current => ({
            key,
            direction: current && current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const getSortIcon = (key: string) => {
        if (!sortConfig || sortConfig.key !== key) return <ArrowUpDown className="h-3 w-3 ml-1 text-white opacity-30" />;
        return sortConfig.direction === 'asc'
            ? <ArrowUp className="h-3 w-3 ml-1 text-green-400" />
            : <ArrowDown className="h-3 w-3 ml-1 text-green-400" />;
    };

    const sortedRequests = useMemo(() => {
        if (!sortConfig) return requests;

        return [...requests].sort((a, b) => {
            let aValue: any = a[sortConfig.key as keyof WishboardRequest];
            let bValue: any = b[sortConfig.key as keyof WishboardRequest];

            // Special cases
            if (sortConfig.key === 'notes_count') {
                aValue = a.notes?.length || 0;
                bValue = b.notes?.length || 0;
            } else if (sortConfig.key === 'username') {
                aValue = a.user?.username || '';
                bValue = b.user?.username || '';
            }

            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [requests, sortConfig]);
    const visibleRequests = useMemo(
        () => sortedRequests.slice(0, renderCount),
        [sortedRequests, renderCount]
    );
    const canRenderMoreRequests = visibleRequests.length < sortedRequests.length;

    const API_URL = import.meta.env.VITE_MAIN_API || '';
    const currentLeaderboardMonth = formatMonthKey(new Date());
    const selectedLeaderboardMonthLabel = formatMonthLabel(selectedLeaderboardMonth, i18n.language);
    const isCurrentLeaderboardMonth = selectedLeaderboardMonth === currentLeaderboardMonth;

    // Pre-fill note content when opening modal
    useEffect(() => {
        if (selectedRequest && selectedRequest.notes && selectedRequest.notes.length > 0) {
            setNoteContent(selectedRequest.notes[0].note);
            setNoteIsPublic(selectedRequest.notes[0].is_public);
        } else {
            setNoteContent('');
            setNoteIsPublic(true);
        }
    }, [selectedRequest, noteModalOpen]);

    // Fetch TMDB data
    const fetchTmdbData = async (tmdbId: number, mediaType: 'movie' | 'tv') => {
        const cacheKey = `${mediaType}:${tmdbId}`;
        const cached = tmdbCacheRef.current[cacheKey];

        if (cached) {
            return cached;
        }

        try {
            const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
            const response = await fetch(
                `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
            );
            if (response.ok) {
                const data = await response.json();
                const mappedData = {
                    title: mediaType === 'movie' ? data.title : data.name,
                    year: (mediaType === 'movie' ? data.release_date : data.first_air_date)?.split('-')[0] || '',
                    poster_path: data.poster_path,
                };
                tmdbCacheRef.current[cacheKey] = mappedData;
                return mappedData;
            }
        } catch (error) {
            console.error('Error fetching TMDB data:', error);
        }

        const fallbackData = { title: `TMDB ID: ${tmdbId}`, year: '', poster_path: null };
        tmdbCacheRef.current[cacheKey] = fallbackData;
        return fallbackData;
    };

    // Fetch requests
    const fetchRequests = useCallback(async (pageNum: number = 1, append: boolean = false) => {
        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }
        try {
            const authToken = localStorage.getItem('auth_token');
            const params = new URLSearchParams();
            if (debouncedSearch) params.append('search', debouncedSearch);
            if (statusFilter !== 'all') params.append('status', statusFilter);
            if (mediaTypeFilter !== 'all') params.append('media_type', mediaTypeFilter);
            if (vipFilter) params.append('vip_only', 'true');
            params.append('page', String(pageNum));
            params.append('limit', '50');

            const response = await fetch(`${API_URL}/api/wishboard/admin?${params}`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
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
                setHasMore(data.hasMore ?? false);
                setStats(data.stats);
            }
        } catch (error) {
            console.error('Error fetching admin wishboard:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [API_URL, debouncedSearch, statusFilter, mediaTypeFilter, vipFilter]);

    // Reset page when filters change
    useEffect(() => {
        setPage(1);
        fetchRequests(1, false);
    }, [fetchRequests]);

    useEffect(() => {
        if (activeView === 'requests') {
            setRenderCount(ADMIN_WISHBOARD_INITIAL_RENDER_COUNT);
        }
    }, [activeView, debouncedSearch, statusFilter, mediaTypeFilter, vipFilter, sortConfig]);

    const handleLoadMore = () => {
        const nextPage = page + 1;
        setPage(nextPage);
        fetchRequests(nextPage, true);
    };

    // Fetch leaderboard data
    const fetchLeaderboard = useCallback(async () => {
        setLeaderboardLoading(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            let url: string;
            if (leaderboardType === 'wishboard') {
                const params = new URLSearchParams();
                if (selectedLeaderboardMonth) params.set('month', selectedLeaderboardMonth);
                url = `${API_URL}/api/wishboard/admin/leaderboard?${params.toString()}`;
            } else {
                // downloads
                const params = new URLSearchParams();
                if (leaderboardScope === 'all-time') {
                    params.set('scope', 'all-time');
                } else if (selectedLeaderboardMonth) {
                    params.set('month', selectedLeaderboardMonth);
                }
                url = `${API_URL}/api/download-links/admin/leaderboard?${params.toString()}`;
            }

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${authToken}` },
            });
            if (response.ok) {
                const data = await response.json();
                // Normalize: map both shapes to a common LeaderboardEntry
                const entries = (data.leaderboard || []).map((entry: LeaderboardEntry) => ({
                    ...entry,
                    greenlight_count: entry.greenlight_count ?? entry.score ?? 0,
                    last_greenlight_at: entry.last_greenlight_at ?? entry.last_action_at ?? '',
                }));
                setLeaderboard(entries);
            }
        } catch (error) {
            console.error('Error fetching leaderboard:', error);
        } finally {
            setLeaderboardLoading(false);
        }
    }, [API_URL, leaderboardType, leaderboardScope, selectedLeaderboardMonth]);

    useEffect(() => {
        if (activeView === 'leaderboard') {
            fetchLeaderboard();
        }
    }, [activeView, fetchLeaderboard]);

    // Open status change modal
    const handleStatusClick = (request: WishboardRequest, newStatus: string) => {
        if (request.status === newStatus) return;
        setSelectedRequest(request);
        setPendingStatus(newStatus);
        setStatusReason(''); // Reset reason
        setStatusModalOpen(true);
    };

    // Update status
    const confirmStatusUpdate = async () => {
        if (!selectedRequest || !pendingStatus) return;

        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const response = await fetch(`${API_URL}/api/wishboard/admin/${selectedRequest.id}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    status: pendingStatus,
                    reason: statusReason.trim() || null
                }),
            });

            if (response.ok) {
                const data = await response.json();
                const historyId = data.historyId;

                setRequests(prev =>
                    prev.map(req =>
                        req.id === selectedRequest.id ? {
                            ...req,
                            status: pendingStatus as WishboardRequest['status'],
                            statusHistory: [
                                ...(req.statusHistory || []),
                                {
                                    id: historyId,
                                    status: pendingStatus,
                                    reason: statusReason.trim() || null,
                                    changed_at: new Date().toISOString()
                                }
                            ]
                        } : req
                    )
                );
                setStatusModalOpen(false);
                setPendingStatus(null);
                setStatusReason('');
            }
        } catch (error) {
            console.error('Error updating status:', error);
        } finally {
            setSubmitting(false);
        }
    };

    // Add note
    const handleAddNote = async () => {
        if (!selectedRequest || !noteContent.trim()) return;

        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const response = await fetch(`${API_URL}/api/wishboard/admin/${selectedRequest.id}/notes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    note: noteContent,
                    is_public: noteIsPublic,
                }),
            });

            if (response.ok) {
                const newNote = await response.json();
                setRequests(prev =>
                    prev.map(req =>
                        req.id === selectedRequest.id
                            ? { ...req, notes: [newNote] } // Replace notes array with single note
                            : req
                    )
                );
                setNoteModalOpen(false);
                setNoteContent('');
                setNoteIsPublic(true);
            }
        } catch (error) {
            console.error('Error adding note:', error);
        } finally {
            setSubmitting(false);
        }
    };

    // Delete request
    const handleDelete = async () => {
        if (!selectedRequest) return;

        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const response = await fetch(`${API_URL}/api/wishboard/admin/${selectedRequest.id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                },
            });

            if (response.ok) {
                setRequests(prev => prev.filter(req => req.id !== selectedRequest.id));
                setDeleteModalOpen(false);
            }
        } catch (error) {
            console.error('Error deleting request:', error);
        } finally {
            setSubmitting(false);
        }
    };

    // Update history reason
    const handleUpdateHistoryReason = async (historyId: number) => {
        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const response = await fetch(`${API_URL}/api/wishboard/admin/history/${historyId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    reason: editHistoryReason.trim() || null
                }),
            });

            if (response.ok) {
                // Update local request state and stats
                setRequests(prev => prev.map(req => {
                    if (req.id === selectedRequest?.id) {
                        const updatedHistory = req.statusHistory?.map(h =>
                            h.id === historyId ? { ...h, reason: editHistoryReason.trim() || null } : h
                        );
                        return { ...req, statusHistory: updatedHistory };
                    }
                    return req;
                }));

                // Also update selectedRequest if it's open in modal
                if (selectedRequest) {
                    setSelectedRequest({
                        ...selectedRequest,
                        statusHistory: selectedRequest.statusHistory?.map(h =>
                            h.id === historyId ? { ...h, reason: editHistoryReason.trim() || null } : h
                        )
                    });
                }

                setEditingHistoryId(null);
            }
        } catch (error) {
            console.error('Error updating history reason:', error);
        } finally {
            setSubmitting(false);
        }
    };

    // Function to check available sources for a movie
    const checkMovieSources = async (tmdbId: number, title: string): Promise<SourceCheckResult[]> => {
        const results: SourceCheckResult[] = [];

        // Check Custom Links
        try {
            const response = await axios.get(`${MAIN_API}/api/links/movie/${tmdbId}`);
            if (response.data?.success && response.data?.data?.links?.length > 0) {
                results.push({ name: t('admin.customLinks'), available: true, count: response.data.data.links.length });
            } else {
                results.push({ name: t('admin.customLinks'), available: false });
            }
        } catch {
            results.push({ name: t('admin.customLinks'), available: false });
        }

        // Check Frembed
        try {
            const response = await axios.get(`${getFrembedBase()}/api/public/v1/movies/${tmdbId}`, { timeout: 3000 });
            const isAvailable = response.data?.status === 200 && !!response.data?.result;
            results.push({ name: 'Frembed', available: isAvailable });
        } catch {
            results.push({ name: 'Frembed', available: false });
        }

        // Check Darkino
        try {
            const searchResponse = await axios.get(`${MAIN_API}/api/search`, { params: { title } });
            if (searchResponse.data?.results?.length > 0) {
                const match = searchResponse.data.results.find((r: any) => 
                    (r.type === 'films' || r.type === 'doc') && String(r.tmdb_id) === String(tmdbId)
                );
                if (match) {
                    const downloadResponse = await axios.get(`${MAIN_API}/api/films/download/${match.id}`);
                    const hasSources = downloadResponse.data?.sources?.some((s: any) => s.m3u8);
                    results.push({ name: 'Nightflix (Darkino)', available: hasSources, count: downloadResponse.data?.sources?.length || 0 });
                } else {
                    results.push({ name: 'Nightflix (Darkino)', available: false });
                }
            } else {
                results.push({ name: 'Nightflix (Darkino)', available: false });
            }
        } catch {
            results.push({ name: 'Nightflix (Darkino)', available: false });
        }

        // Check Coflix
        try {
            const response = await axios.get(`${MAIN_API}/api/tmdb/movie/${tmdbId}`);
            const hasPlayers = response.data?.player_links?.length > 0;
            results.push({ name: 'Coflix', available: hasPlayers, count: response.data?.player_links?.length || 0 });
        } catch {
            results.push({ name: 'Coflix', available: false });
        }

        // Check FStream
        try {
            const response = await axios.get(`${MAIN_API}/api/fstream/movie/${tmdbId}`);
            const totalPlayers = Object.values(response.data?.players || {}).reduce((acc: number, arr: any) => acc + (arr?.length || 0), 0);
            results.push({ name: 'FStream', available: totalPlayers > 0, count: totalPlayers as number });
        } catch {
            results.push({ name: 'FStream', available: false });
        }

        // Check Wiflix
        try {
            const response = await axios.get(`${MAIN_API}/api/wiflix/movie/${tmdbId}`);
            const vfCount = response.data?.players?.vf?.length || 0;
            const vostfrCount = response.data?.players?.vostfr?.length || 0;
            results.push({ name: 'Wiflix', available: (vfCount + vostfrCount) > 0, count: vfCount + vostfrCount });
        } catch {
            results.push({ name: 'Wiflix', available: false });
        }

        // Check Viper (Cpasmal)
        try {
            const response = await axios.get(`${MAIN_API}/api/cpasmal/movie/${tmdbId}`);
            const vfCount = response.data?.links?.vf?.length || 0;
            const vostfrCount = response.data?.links?.vostfr?.length || 0;
            results.push({ name: 'Viper (Cpasmal)', available: (vfCount + vostfrCount) > 0, count: vfCount + vostfrCount });
        } catch {
            results.push({ name: 'Viper (Cpasmal)', available: false });
        }

        // Check Omega (via IMDB ID)
        try {
            const imdbResponse = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}/external_ids`, {
                params: { api_key: TMDB_API_KEY }
            });
            if (imdbResponse.data?.imdb_id) {
                const omegaResponse = await axios.get(`${MAIN_API}/api/imdb/movie/${imdbResponse.data.imdb_id}`);
                const hasPlayers = omegaResponse.data?.player_links?.length > 0;
                results.push({ name: 'Omega', available: hasPlayers, count: omegaResponse.data?.player_links?.length || 0 });
            } else {
                results.push({ name: 'Omega', available: false });
            }
        } catch {
            results.push({ name: 'Omega', available: false });
        }

        // Check Purstream (Bravo)
        try {
            const response = await axios.get(`${MAIN_API}/api/purstream/movie/${tmdbId}`);
            const hasUrls = response.data?.success && response.data?.data?.urls?.some((u: any) => u.available);
            const availableCount = response.data?.data?.urls?.filter((u: any) => u.available)?.length || 0;
            results.push({ name: 'Bravo (Purstream)', available: hasUrls, count: availableCount });
        } catch {
            results.push({ name: 'Bravo (Purstream)', available: false });
        }

        return results;
    };

    // Function to check available sources for a TV episode
    const checkTvEpisodeSources = async (tmdbId: number, title: string, season: number, episode: number): Promise<SourceCheckResult[]> => {
        const results: SourceCheckResult[] = [];

        // Check Custom Links
        try {
            const response = await axios.get(`${MAIN_API}/api/links/tv/${tmdbId}`, { params: { season, episode } });
            if (response.data?.success && response.data?.data?.length > 0 && response.data.data[0]?.links?.length > 0) {
                results.push({ name: t('admin.customLinks'), available: true, count: response.data.data[0].links.length });
            } else {
                results.push({ name: t('admin.customLinks'), available: false });
            }
        } catch {
            results.push({ name: t('admin.customLinks'), available: false });
        }

        // Check Frembed
        try {
            const response = await axios.get(`${getFrembedBase()}/api/public/v1/tv/${tmdbId}?sa=${season}&epi=${episode}`, { timeout: 3000 });
            const isAvailable = response.data?.status === 200 && !!response.data?.result;
            results.push({ name: 'Frembed', available: isAvailable });
        } catch {
            results.push({ name: 'Frembed', available: false });
        }

        // Check Darkino
        try {
            const searchResponse = await axios.get(`${MAIN_API}/api/search`, { params: { title } });
            if (searchResponse.data?.results?.length > 0) {
                const match = searchResponse.data.results.find((r: any) => 
                    (r.type === 'series' || r.type === 'animes' || r.type === 'doc') && String(r.tmdb_id) === String(tmdbId)
                );
                if (match) {
                    const downloadResponse = await axios.get(`${MAIN_API}/api/series/download/${match.id}/season/${season}/episode/${episode}`);
                    const hasSources = downloadResponse.data?.sources?.some((s: any) => s.m3u8);
                    results.push({ name: 'Nightflix (Darkino)', available: hasSources, count: downloadResponse.data?.sources?.length || 0 });
                } else {
                    results.push({ name: 'Nightflix (Darkino)', available: false });
                }
            } else {
                results.push({ name: 'Nightflix (Darkino)', available: false });
            }
        } catch {
            results.push({ name: 'Nightflix (Darkino)', available: false });
        }

        // Check Coflix
        try {
            const response = await axios.get(`${MAIN_API}/api/tmdb/tv/${tmdbId}`, { params: { season, episode } });
            const hasPlayers = response.data?.current_episode?.player_links?.length > 0 || response.data?.player_links?.length > 0;
            results.push({ name: 'Coflix', available: hasPlayers, count: (response.data?.current_episode?.player_links?.length || response.data?.player_links?.length) || 0 });
        } catch {
            results.push({ name: 'Coflix', available: false });
        }

        // Check FStream
        try {
            const response = await axios.get(`${MAIN_API}/api/fstream/tv/${tmdbId}/season/${season}`);
            const episodeData = response.data?.episodes?.[String(episode)];
            const totalPlayers = Object.values(episodeData?.languages || {}).reduce((acc: number, arr: any) => acc + (arr?.length || 0), 0);
            results.push({ name: 'FStream', available: totalPlayers > 0, count: totalPlayers as number });
        } catch {
            results.push({ name: 'FStream', available: false });
        }

        // Check Wiflix
        try {
            const response = await axios.get(`${MAIN_API}/api/wiflix/tv/${tmdbId}/${season}`);
            const episodeData = response.data?.episodes?.[String(episode)];
            const vfCount = episodeData?.vf?.length || 0;
            const vostfrCount = episodeData?.vostfr?.length || 0;
            results.push({ name: 'Wiflix', available: (vfCount + vostfrCount) > 0, count: vfCount + vostfrCount });
        } catch {
            results.push({ name: 'Wiflix', available: false });
        }

        // Check Viper (Cpasmal)
        try {
            const response = await axios.get(`${MAIN_API}/api/cpasmal/tv/${tmdbId}/${season}/${episode}`);
            const vfCount = response.data?.links?.vf?.length || 0;
            const vostfrCount = response.data?.links?.vostfr?.length || 0;
            results.push({ name: 'Viper (Cpasmal)', available: (vfCount + vostfrCount) > 0, count: vfCount + vostfrCount });
        } catch {
            results.push({ name: 'Viper (Cpasmal)', available: false });
        }

        // Check Vox
        try {
            const response = await axios.get(`${MAIN_API}/api/drama/tv/${tmdbId}`, { params: { season, episode } });
            results.push({ name: 'Vox (Drama)', available: response.data?.success && response.data?.data?.length > 0, count: response.data?.data?.length || 0 });
        } catch {
            results.push({ name: 'Vox (Drama)', available: false });
        }

        // Check Omega (via IMDB ID)
        try {
            const imdbResponse = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/external_ids`, {
                params: { api_key: TMDB_API_KEY }
            });
            if (imdbResponse.data?.imdb_id) {
                const omegaResponse = await axios.get(`${MAIN_API}/api/imdb/tv/${imdbResponse.data.imdb_id}`);
                const hasPlayers = omegaResponse.data?.players?.length > 0;
                results.push({ name: 'Omega', available: hasPlayers, count: omegaResponse.data?.players?.length || 0 });
            } else {
                results.push({ name: 'Omega', available: false });
            }
        } catch {
            results.push({ name: 'Omega', available: false });
        }

        return results;
    };

    // Main function to handle source checking
    const handleCheckSources = async (request: WishboardRequest) => {
        setSelectedRequest(request);
        setSourceCheckTitle(request.title || `TMDB ID: ${request.tmdb_id}`);
        setSourceCheckMediaType(request.media_type);
        setSourceCheckResults([]);
        setTvSourceCheckResults([]);
        setSourceCheckModalOpen(true);
        setCheckingSources(true);

        try {
            if (request.media_type === 'movie') {
                const results = await checkMovieSources(request.tmdb_id, request.title || '');
                setSourceCheckResults(results);
            } else {
                // For TV shows, get number of seasons first
                const tmdbResponse = await axios.get(
                    `https://api.themoviedb.org/3/tv/${request.tmdb_id}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
                );
                const numberOfSeasons = tmdbResponse.data.number_of_seasons || 1;
                
                // Parse requested seasons from season_number field
                let seasonsToCheck: number[] = [];
                if (request.season_number) {
                    try {
                        if (request.season_number.startsWith('[')) {
                            const parsed = JSON.parse(request.season_number);
                            if (parsed.includes(0)) {
                                // 0 means all seasons
                                seasonsToCheck = Array.from({ length: numberOfSeasons }, (_, i) => i + 1);
                            } else {
                                seasonsToCheck = parsed;
                            }
                        } else {
                            seasonsToCheck = [parseInt(request.season_number)];
                        }
                    } catch {
                        seasonsToCheck = [1];
                    }
                } else {
                    seasonsToCheck = [1];
                }

                // Check episode 1 of each requested season
                const seasonResults: SeasonSourceCheck[] = [];
                for (const season of seasonsToCheck) {
                    const results = await checkTvEpisodeSources(request.tmdb_id, request.title || '', season, 1);
                    seasonResults.push({ seasonNumber: season, sources: results });
                }
                setTvSourceCheckResults(seasonResults);
            }
        } catch (error) {
            console.error('Error checking sources:', error);
        } finally {
            setCheckingSources(false);
        }
    };

    // Function to count available source categories
    const countAvailableCategories = (sources: SourceCheckResult[]): number => {
        return sources.filter(s => s.available).length;
    };

    // Sleep function for rate limiting
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Cache key for session storage
    const BATCH_CACHE_KEY = 'wishboard_batch_check_cache';

    // Get cached result from sessionStorage
    const getCachedResult = (tmdbId: number, mediaType: 'movie' | 'tv'): { availableCategories: number; sources: SourceCheckResult[] } | null => {
        try {
            const cache = sessionStorage.getItem(BATCH_CACHE_KEY);
            if (!cache) return null;
            const parsed = JSON.parse(cache);
            const key = `${mediaType}_${tmdbId}`;
            return parsed[key] || null;
        } catch {
            return null;
        }
    };

    // Save result to sessionStorage cache
    const setCachedResult = (tmdbId: number, mediaType: 'movie' | 'tv', availableCategories: number, sources: SourceCheckResult[]) => {
        try {
            const cache = sessionStorage.getItem(BATCH_CACHE_KEY);
            const parsed = cache ? JSON.parse(cache) : {};
            const key = `${mediaType}_${tmdbId}`;
            parsed[key] = { availableCategories, sources, timestamp: Date.now() };
            sessionStorage.setItem(BATCH_CACHE_KEY, JSON.stringify(parsed));
        } catch {
            // Ignore storage errors
        }
    };

    // Clear cache
    const clearBatchCache = () => {
        sessionStorage.removeItem(BATCH_CACHE_KEY);
    };

    // Fetch ALL pending requests from all pages
    const fetchAllPendingRequests = async (): Promise<WishboardRequest[]> => {
        const authToken = localStorage.getItem('auth_token');
        const allRequests: WishboardRequest[] = [];
        let page = 1;
        const limit = 100; // Fetch 100 per page for efficiency
        let hasMore = true;

        while (hasMore) {
            const params = new URLSearchParams();
            params.append('status', 'pending');
            params.append('page', String(page));
            params.append('limit', String(limit));

            const response = await fetch(`${API_URL}/api/wishboard?${params}`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
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
                
                allRequests.push(...requestsWithTmdb);
                
                // Check if there are more pages
                if (data.requests.length < limit) {
                    hasMore = false;
                } else {
                    page++;
                }
            } else {
                hasMore = false;
            }
        }

        return allRequests;
    };

    // Batch check all requests
    const handleBatchCheck = async () => {
        setBatchCheckModalOpen(true);
        setBatchChecking(true);
        setBatchCompleted(false);
        setBatchResults([]);
        setBatchProgress(0);
        setBatchCurrentTitle(t('admin.loadingAllRequests'));

        // Fetch ALL pending requests from all pages
        const allPendingRequests = await fetchAllPendingRequests();
        setBatchTotal(allPendingRequests.length);

        const results: BatchCheckResult[] = [];

        // Check all requests in parallel batches for speed
        const batchSize = 10; // Process 10 requests at a time
        
        for (let i = 0; i < allPendingRequests.length; i += batchSize) {
            const batch = allPendingRequests.slice(i, Math.min(i + batchSize, allPendingRequests.length));
            
            const batchPromises = batch.map(async (request, batchIndex) => {
                const currentIndex = i + batchIndex;
                setBatchCurrentTitle(request.title || `TMDB ID: ${request.tmdb_id}`);
                setBatchProgress(currentIndex + 1);

                // Check cache first
                const cached = getCachedResult(request.tmdb_id, request.media_type);
                if (cached) {
                    return { request, availableCategories: cached.availableCategories, sources: cached.sources };
                }

                try {
                    let sources: SourceCheckResult[] = [];
                    
                    if (request.media_type === 'movie') {
                        sources = await checkMovieSources(request.tmdb_id, request.title || '');
                    } else {
                        // For TV, just check season 1 episode 1
                        sources = await checkTvEpisodeSources(request.tmdb_id, request.title || '', 1, 1);
                    }

                    const availableCategories = countAvailableCategories(sources);
                    
                    // Save to cache
                    setCachedResult(request.tmdb_id, request.media_type, availableCategories, sources);
                    
                    return { request, availableCategories, sources };
                } catch (error) {
                    console.error(`Error checking ${request.title}:`, error);
                    return { request, availableCategories: 0, sources: [] };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Update progress after each batch
            setBatchProgress(Math.min(i + batchSize, allPendingRequests.length));
        }

        setBatchResults(results);
        setBatchChecking(false);
        setBatchCompleted(true);
    };

    // Reject requests with 2+ source categories
    const handleRejectWithMultipleSources = async () => {
        const toReject = batchResults.filter(r => r.availableCategories >= 2);
        if (toReject.length === 0) return;

        setDeletingBatch(true);
        const authToken = localStorage.getItem('auth_token');
        const rejectionReason = 'Déjà disponible, pour plus d\'assistance : https://t.me/ix_annonces';

        for (const item of toReject) {
            try {
                await fetch(`${API_URL}/api/wishboard/admin/${item.request.id}/status`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`,
                    },
                    body: JSON.stringify({
                        status: 'rejected',
                        reason: rejectionReason,
                    }),
                });
                // Rate limiting
                await sleep(200);
            } catch (error) {
                console.error(`Error rejecting ${item.request.title}:`, error);
            }
        }

        // Refresh the list
        await fetchRequests();
        setDeletingBatch(false);
        setBatchCheckModalOpen(false);
    };

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString(i18n.language, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                    { label: 'admin.total', value: stats.total, color: 'text-white' },
                    { label: 'admin.pending', value: stats.pending, color: 'text-amber-400' },
                    { label: 'admin.addedPlural', value: stats.added, color: 'text-green-400' },
                    { label: 'admin.rejectedPlural', value: stats.rejected, color: 'text-red-400' },
                    { label: 'admin.notFoundPlural', value: stats.not_found, color: 'text-orange-400' },
                ].map((stat) => (
                    <motion.div
                        key={stat.label}
                        whileHover={{ scale: 1.02 }}
                        className="bg-white/5 rounded-lg p-4 border border-white/10"
                    >
                        <div className={`text-2xl font-bold ${stat.color}`}>
                            <Counter
                                value={stat.value}
                                fontSize={24}
                                padding={0}
                                places={getPlacesForValue(Math.max(stat.value, 1))}
                                gap={0}
                                borderRadius={0}
                                horizontalPadding={0}
                                textColor="currentColor"
                                fontWeight="bold"
                                gradientHeight={0}
                            />
                        </div>
                        <p className="text-xs text-white/50">{t(stat.label)}</p>
                    </motion.div>
                ))}
            </div>

            {/* View Toggle */}
            <div className="flex gap-2">
                <Button
                    variant={activeView === 'requests' ? 'default' : 'ghost'}
                    onClick={() => setActiveView('requests')}
                    className={activeView === 'requests' ? 'bg-green-600 hover:bg-green-700' : ''}
                >
                    <ListChecks className="h-4 w-4 mr-2" />
                    Demandes
                </Button>
                <Button
                    variant={activeView === 'leaderboard' ? 'default' : 'ghost'}
                    onClick={() => setActiveView('leaderboard')}
                    className={activeView === 'leaderboard' ? 'bg-amber-600 hover:bg-amber-700' : ''}
                >
                    <Star className="h-4 w-4 mr-2" />
                    Classement mensuel
                </Button>
            </div>

            {activeView === 'leaderboard' ? (
                /* Leaderboard View */
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="space-y-4"
                >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Star className="h-5 w-5 text-amber-400" />
                                Classement des Admins / Uploaders
                            </h3>
                            <p className="mt-1 flex items-center gap-2 text-sm text-white/45">
                            <CalendarDays className="h-4 w-4 text-amber-400 opacity-80" />
                                {selectedLeaderboardMonthLabel}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 mt-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-white/60">Type:</span>
                                    <Button
                                        variant={leaderboardType === 'wishboard' ? 'default' : 'secondary'}
                                        size="sm"
                                        onClick={() => setLeaderboardType('wishboard')}
                                    >
                                        Wishboard
                                    </Button>
                                    <Button
                                        variant={leaderboardType === 'downloads' ? 'default' : 'secondary'}
                                        size="sm"
                                        onClick={() => setLeaderboardType('downloads')}
                                    >
                                        Liens
                                    </Button>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-white/60">Période:</span>
                                    <Button
                                        variant={leaderboardScope === 'month' ? 'default' : 'secondary'}
                                        size="sm"
                                        onClick={() => setLeaderboardScope('month')}
                                    >
                                        Ce mois
                                    </Button>
                                    <Button
                                        variant={leaderboardScope === 'all-time' ? 'default' : 'secondary'}
                                        size="sm"
                                        onClick={() => {
                                            if (leaderboardType === 'wishboard') return;
                                            setLeaderboardScope('all-time');
                                        }}
                                        disabled={leaderboardType === 'wishboard'}
                                        title={leaderboardType === 'wishboard' ? 'Non disponible pour le wishboard' : ''}
                                    >
                                        All-time
                                    </Button>
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {leaderboardScope === 'month' && (
                                <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        onClick={() => setSelectedLeaderboardMonth(prev => shiftMonthKey(prev, -1))}
                                        className="h-8 w-8 group/icon"
                                    >
                                        <ChevronLeft className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" />
                                    </Button>
                                    <div className="min-w-[140px] px-2 text-center text-sm font-medium text-white/80">
                                        {selectedLeaderboardMonthLabel}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        onClick={() => setSelectedLeaderboardMonth(prev => shiftMonthKey(prev, 1))}
                                        disabled={isCurrentLeaderboardMonth}
                                        className="h-8 w-8 group/icon"
                                    >
                                        <ChevronRight className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" />
                                    </Button>
                                </div>
                            )}
                            <Button variant="secondary" onClick={fetchLeaderboard} disabled={leaderboardLoading} size="sm">
                                <RefreshCw className={`h-4 w-4 mr-2 ${leaderboardLoading ? 'animate-spin' : ''}`} />
                                Actualiser
                            </Button>
                        </div>
                    </div>

                    {leaderboardLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
                        </div>
                    ) : leaderboard.length === 0 ? (
                        <div className="text-center py-20 bg-white/5 rounded-lg border border-white/10">
                            <Star className="h-12 w-12 text-white opacity-20 mx-auto mb-4" />
                            <p className="text-white/50">
                                {leaderboardType === 'wishboard'
                                    ? `Aucun greenlight enregistré pour ${selectedLeaderboardMonthLabel}`
                                    : leaderboardScope === 'all-time'
                                        ? `Aucun lien ajouté`
                                        : `Aucun lien ajouté pour ${selectedLeaderboardMonthLabel}`}
                            </p>
                            <p className="text-white/30 text-sm mt-1">Navigue entre les mois pour consulter les classements precedents</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {leaderboard.map((entry, index) => {
                                const rank = index + 1;
                                const isTop3 = rank <= 3;
                                const medalColors = ['text-amber-400', 'text-gray-300', 'text-amber-700'];
                                const bgColors = ['bg-amber-500/10 border-amber-500/30', 'bg-gray-400/10 border-gray-400/30', 'bg-amber-800/10 border-amber-700/30'];

                                return (
                                    <motion.div
                                        key={entry.admin_id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                        className={`flex items-center gap-4 p-4 rounded-lg border transition-all ${
                                            isTop3 ? bgColors[index] : 'bg-white/5 border-white/10'
                                        }`}
                                    >
                                        {/* Rank */}
                                        <div className="flex-shrink-0 w-10 text-center">
                                            {isTop3 ? (
                                                <Crown className={`h-6 w-6 mx-auto ${medalColors[index]}`} />
                                            ) : (
                                                <span className="text-lg font-bold text-white/40">#{rank}</span>
                                            )}
                                        </div>

                                        {/* Avatar */}
                                        <div className="flex-shrink-0">
                                            {entry.avatar ? (
                                                <img
                                                    src={entry.avatar}
                                                    alt={entry.username}
                                                    className="w-10 h-10 rounded-full object-cover border-2 border-white/20"
                                                />
                                            ) : (
                                                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center border-2 border-white/20">
                                                    <User className="h-5 w-5 text-white opacity-40" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className={`font-semibold truncate ${isTop3 ? 'text-white' : 'text-white/80'}`}>
                                                    {entry.username}
                                                </p>
                                                <Badge variant={entry.role === 'admin' ? 'default' : 'secondary'} className={`text-xs ${
                                                    entry.role === 'admin' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                                                }`}>
                                                    {entry.role === 'admin' ? 'Admin' : 'Uploader'}
                                                </Badge>
                                            </div>
                                            <p className="text-xs text-white/40 truncate">
                                                ID: {entry.admin_id}
                                            </p>
                                        </div>

                                        {/* Count */}
                                        <div className="flex-shrink-0 text-right">
                                            <div className={`text-2xl font-bold ${isTop3 ? 'text-green-400' : 'text-green-400/70'}`}>
                                                <Counter
                                                    value={entry.greenlight_count ?? 0}
                                                    fontSize={24}
                                                    padding={0}
                                                    places={getPlacesForValue(Math.max(entry.greenlight_count ?? 0, 1))}
                                                    gap={0}
                                                    borderRadius={0}
                                                    horizontalPadding={0}
                                                    textColor="currentColor"
                                                    fontWeight="bold"
                                                    gradientHeight={0}
                                                />
                                            </div>
                                            <p className="text-xs text-white/40">
                                                {leaderboardType === 'wishboard'
                                                    ? `greenlight${(entry.greenlight_count ?? 0) > 1 ? 's' : ''}`
                                                    : `lien${(entry.greenlight_count ?? 0) > 1 ? 's' : ''} ajouté${(entry.greenlight_count ?? 0) > 1 ? 's' : ''}`}
                                            </p>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    )}
                </motion.div>
            ) : (
            <>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white opacity-40" />
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('admin.searchByTitleId')}
                        className="pl-10"
                    />
                </div>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder={t('admin.status')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t('admin.allStatuses')}</SelectItem>
                        {statusOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {t(option.label)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={mediaTypeFilter} onValueChange={setMediaTypeFilter}>
                    <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder={t('admin.type')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t('admin.allFilter')}</SelectItem>
                        <SelectItem value="movie">{t('admin.movies')}</SelectItem>
                        <SelectItem value="tv">{t('admin.tvShows')}</SelectItem>
                    </SelectContent>
                </Select>

                <Button
                    variant="secondary"
                    onClick={() => setVipFilter(v => !v)}
                    className={vipFilter ? 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border-yellow-500/30' : ''}
                >
                    <Crown className="h-4 w-4 mr-2" />
                    VIP
                </Button>

                <Button variant="secondary" onClick={() => { setPage(1); fetchRequests(1, false); }} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    {t('admin.refresh')}
                </Button>

                <Button
                    variant="secondary"
                    onClick={handleBatchCheck}
                    disabled={loading || batchChecking}
                    className="bg-purple-500/20 hover:bg-purple-500/30 text-purple-400"
                >
                    <ListChecks className="h-4 w-4 mr-2" />
                    {t('admin.checkAll')}
                </Button>

                <Button
                    variant="secondary"
                    onClick={clearBatchCache}
                    disabled={loading || batchChecking}
                    className="bg-red-500/20 hover:bg-red-500/30 text-red-400"
                    title={t('admin.clearCheckCache')}
                >
                    <Trash2 className="h-4 w-4" />
                </Button>

                {requests.length > 0 && (
                    <span className="text-xs text-white/40 whitespace-nowrap">
                        {visibleRequests.length}/{sortedRequests.length} affichees
                    </span>
                )}
            </div>

            {/* Load More Button (top) */}
            {hasMore && !loading && (
                <div className="p-4 flex justify-center border-b border-white/10">
                    <Button className="group/icon"
                        variant="ghost"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                    >
                        {loadingMore ? <Loader2 className="h-4 w-4 animate-spin mr-2 text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" /> : null}
                        {loadingMore ? 'Chargement...' : 'Charger plus'}
                    </Button>
                </div>
            )}

            {/* Table */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="bg-white/5 rounded-lg border border-white/10 overflow-hidden"
            >
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-8 w-8 animate-spin text-green-500" />
                    </div>
                ) : requests.length === 0 ? (
                    <div className="text-center py-20">
                        <Filter className="h-12 w-12 text-white opacity-20 mx-auto mb-4" />
                        <p className="text-white/50">{t('admin.noRequestFound')}</p>
                    </div>
                ) : (
                    <div className="overflow-auto max-h-[72vh] custom-scrollbar" data-lenis-prevent>
                        <table className="w-full min-w-[800px]"> {/* Min width for horizontal scroll on mobile */}
                            <thead>
                                <tr className="border-b border-white/10 bg-white/5">
                                    <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70 cursor-pointer hover:text-white" onClick={() => handleSort('title')}>
                                        <div className="flex items-center">{t('admin.content')} {getSortIcon('title')}</div>
                                    </th>
                                    <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70 cursor-pointer hover:text-white" onClick={() => handleSort('media_type')}>
                                        <div className="flex items-center">{t('admin.type')} {getSortIcon('media_type')}</div>
                                    </th>
                                    <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70 cursor-pointer hover:text-white" onClick={() => handleSort('status')}>
                                        <div className="flex items-center">{t('admin.status')} {getSortIcon('status')}</div>
                                    </th>
                                    <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70 cursor-pointer hover:text-white" onClick={() => handleSort('vote_count')}>
                                        <div className="flex items-center">{t('greenlight.votes')} {getSortIcon('vote_count')}</div>
                                    </th>
                                    <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70 cursor-pointer hover:text-white" onClick={() => handleSort('username')}>
                                        <div className="flex items-center">{t('admin.requestedBy')} {getSortIcon('username')}</div>
                                    </th>
                                    <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70 cursor-pointer hover:text-white" onClick={() => handleSort('created_at')}>
                                        <div className="flex items-center">{t('admin.date')} {getSortIcon('created_at')}</div>
                                    </th>
                                    <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70 cursor-pointer hover:text-white" onClick={() => handleSort('notes_count')}>
                                        <div className="flex items-center">{t('admin.notes')} {getSortIcon('notes_count')}</div>
                                    </th>
                                    <th className="sticky top-0 z-20 bg-black/95 text-right p-4 text-sm font-medium text-white/70">{t('admin.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <AnimatePresence mode='popLayout'>
                                    {visibleRequests.map((request) => (
                                        <motion.tr
                                            key={request.id}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20 }}
                                            transition={{ duration: 0.18 }}
                                            className="border-b border-white/5 hover:bg-white/5 transition-colors"
                                        >
                                            <td className="p-4">
                                                <div className="flex items-center gap-3">
                                                    {request.poster_path ? (
                                                        <Link to={`/${request.media_type}/${encodeId(request.tmdb_id)}`}>
                                                            <img
                                                                src={`https://image.tmdb.org/t/p/w92${request.poster_path}`}
                                                                alt={request.title}
                                                                className="w-10 h-14 object-cover rounded shadow-md hover:ring-2 hover:ring-white/50 transition-all"
                                                            />
                                                        </Link>
                                                    ) : (
                                                        <div className="w-10 h-14 bg-white/10 rounded flex items-center justify-center">
                                                            <Film className="h-5 w-5 text-white opacity-30" />
                                                        </div>
                                                    )}
                                                    <div>
                                                        <Link to={`/${request.media_type}/${encodeId(request.tmdb_id)}`} className="hover:underline hover:text-green-400 transition-colors">
                                                            <p className="font-medium text-white">{request.title}</p>
                                                        </Link>
                                                        <p className="text-xs text-white/50">
                                                            TMDB: {request.tmdb_id} • {request.year}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <Badge variant={request.media_type}>
                                                    {request.media_type === 'movie' ? (
                                                        <><Film className="h-3 w-3 mr-1" /> {t('admin.movie')}</>
                                                    ) : (
                                                        <><Tv className="h-3 w-3 mr-1" /> {t('admin.tvShow')}</>
                                                    )}
                                                </Badge>
                                                {request.season_number && (() => {
                                                    // Parse season_number which can be: "1", "[1,2,3]", "[0]" (all seasons)
                                                    try {
                                                        if (request.season_number.startsWith('[')) {
                                                            const seasons = JSON.parse(request.season_number);
                                                            if (seasons.includes(0)) {
                                                                return <Badge variant="default" className="ml-1">{t('admin.allSeasons')}</Badge>;
                                                            }
                                                            return <Badge variant="default" className="ml-1">{seasons.map((s: number) => `S${s}`).join(', ')}</Badge>;
                                                        }
                                                        return <Badge variant="default" className="ml-1">S{request.season_number}</Badge>;
                                                    } catch {
                                                        return <Badge variant="default" className="ml-1">S{request.season_number}</Badge>;
                                                    }
                                                })()}
                                            </td>
                                            <td className="p-4">
                                                <Select
                                                    value={request.status}
                                                    onValueChange={(value) => handleStatusClick(request, value)}
                                                >
                                                    <SelectTrigger className="w-[140px] border-none bg-transparent hover:bg-white/5 p-1 h-8">
                                                        <div className="flex items-center gap-2">
                                                            <Badge variant={request.status}>
                                                                {statusOptions.find(s => s.value === request.status)?.label ? t(statusOptions.find(s => s.value === request.status)!.label) : t('admin.unknown')}
                                                            </Badge>
                                                        </div>
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {statusOptions.map((option) => (
                                                            <SelectItem key={option.value} value={option.value}>
                                                                <span className={option.color}>{t(option.label)}</span>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </td>
                                            <td className="p-4">
                                                <span className="text-sm font-medium text-white tabular-nums">
                                                    {request.vote_count.toLocaleString(i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-US')}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-white font-medium text-sm truncate max-w-[150px]">
                                                        {request.user?.username || t('admin.unknown')}
                                                    </span>
                                                    {request.user?.isVip && (
                                                        <Badge variant="default" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 hover:bg-yellow-500/20 px-1.5 py-0 h-5">
                                                            <Crown className="h-3 w-3 mr-1" /> VIP
                                                        </Badge>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <span className="text-white/50 text-sm">{formatDate(request.created_at)}</span>
                                            </td>
                                            <td className="p-4">
                                                {request.notes && request.notes.length > 0 ? (
                                                    <Badge variant="default" className="cursor-pointer hover:bg-white/20 transition-colors" onClick={() => {
                                                        setSelectedRequest(request);
                                                        setNoteModalOpen(true);
                                                    }}>
                                                        <MessageSquare className="h-3 w-3 mr-1" />
                                                        {request.notes.length}
                                                    </Badge>
                                                ) : (
                                                    <motion.button
                                                        whileHover={{ scale: 1.1 }}
                                                        whileTap={{ scale: 0.9 }}
                                                        onClick={() => {
                                                            setSelectedRequest(request);
                                                            setNoteModalOpen(true);
                                                        }}
                                                        className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <Plus className="h-4 w-4 text-white opacity-30 hover:opacity-100" />
                                                    </motion.button>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <div className="flex items-center justify-end gap-2">
                                                    <motion.button
                                                        whileHover={{ scale: 1.1 }}
                                                        whileTap={{ scale: 0.9 }}
                                                        onClick={() => handleCheckSources(request)}
                                                        className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 transition-colors"
                                                        title={t('admin.checkSources')}
                                                    >
                                                        <Play className="h-4 w-4 text-green-400" />
                                                    </motion.button>
                                                    <motion.button
                                                        whileHover={{ scale: 1.1 }}
                                                        whileTap={{ scale: 0.9 }}
                                                        onClick={() => {
                                                            setSelectedRequest(request);
                                                            setHistoryModalOpen(true);
                                                        }}
                                                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                                                        title={t('admin.history')}
                                                    >
                                                        <Clock className="h-4 w-4 text-white opacity-70" />
                                                    </motion.button>
                                                    <motion.button
                                                        whileHover={{ scale: 1.1 }}
                                                        whileTap={{ scale: 0.9 }}
                                                        onClick={() => {
                                                            setSelectedRequest(request);
                                                            setNoteModalOpen(true);
                                                        }}
                                                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                                                        title={t('admin.addNote')}
                                                    >
                                                        <MessageSquare className="h-4 w-4 text-white opacity-70" />
                                                    </motion.button>
                                                    <motion.button
                                                        whileHover={{ scale: 1.1 }}
                                                        whileTap={{ scale: 0.9 }}
                                                        onClick={() => {
                                                            setSelectedRequest(request);
                                                            setDeleteModalOpen(true);
                                                        }}
                                                        className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                                                        title={t('admin.delete')}
                                                    >
                                                        <Trash2 className="h-4 w-4 text-red-400" />
                                                    </motion.button>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    ))}
                                </AnimatePresence>
                            </tbody>
                        </table>
                    </div>
                )
                }
            </motion.div >

            {/* Load More Button */}
            {(canRenderMoreRequests || (hasMore && !loading)) && (
                <div className="p-4 flex flex-wrap justify-center gap-3 border-t border-white/10">
                    {canRenderMoreRequests && (
                        <Button
                            variant="secondary"
                            onClick={() => setRenderCount(prev => Math.min(prev + ADMIN_WISHBOARD_RENDER_STEP, sortedRequests.length))}
                        >
                            Afficher {Math.min(ADMIN_WISHBOARD_RENDER_STEP, sortedRequests.length - visibleRequests.length)} de plus
                        </Button>
                    )}
                    {hasMore && !loading && (
                        <Button className="group/icon"
                            variant="ghost"
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                        >
                            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin mr-2 text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" /> : null}
                            {loadingMore ? 'Chargement...' : 'Charger plus'}
                        </Button>
                    )}
                </div>
            )}

            {/* Note Modal */}
            < ReusableModal
                isOpen={noteModalOpen}
                onClose={() => setNoteModalOpen(false)}
                title={selectedRequest?.notes?.length ? t('admin.notes') : t('admin.addNote')}
            >
                <div className="space-y-6">
                    <p className="text-sm text-gray-400">
                        {selectedRequest?.title} ({selectedRequest?.year})
                    </p>

                    {/* Note Input */}
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                        <p className="text-sm text-blue-200">
                            <MessageSquare className="h-4 w-4 inline mr-2" />
                            Une seule note est autorisée par demande. Si vous ajoutez une note, elle remplacera l'existante.
                        </p>
                    </div>

                    {/* Add new note */}
                    <div className="space-y-4">
                        <Textarea
                            value={noteContent}
                            onChange={(e) => setNoteContent(e.target.value)}
                            placeholder={t('admin.writeNote')}
                            rows={3}
                        />
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="notePublic"
                                checked={noteIsPublic}
                                onChange={(e) => setNoteIsPublic(e.target.checked)}
                                className="rounded border-white/20"
                            />
                            <label htmlFor="notePublic" className="text-sm text-white/70">
                                {t('admin.publicNoteLabel')}
                            </label>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-white/10">
                        <Button variant="ghost" onClick={() => setNoteModalOpen(false)}>
                            {t('admin.cancel')}
                        </Button>
                        <Button onClick={handleAddNote} disabled={submitting || !noteContent.trim()}>
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {t('admin.addTheNote')}
                        </Button>
                    </div>
                </div>
            </ReusableModal >

            {/* History Modal */}
            < ReusableModal
                isOpen={historyModalOpen}
                onClose={() => {
                    if (!submitting) {
                        setHistoryModalOpen(false);
                        setEditingHistoryId(null);
                    }
                }}
                title={`${t('admin.history')} : ${selectedRequest?.title}`}
            >
                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                    {selectedRequest?.statusHistory && selectedRequest.statusHistory.length > 0 ? (
                        [...selectedRequest.statusHistory].reverse().map((entry) => (
                            <div key={entry.id} className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-2">
                                        <Badge variant={entry.status as any}>
                                            {statusOptions.find(o => o.value === entry.status)?.label ? t(statusOptions.find(o => o.value === entry.status)!.label) : entry.status}
                                        </Badge>
                                        <span className="text-xs text-white/40">{formatDate(entry.changed_at)}</span>
                                    </div>

                                    {editingHistoryId !== entry.id && (
                                        <button
                                            onClick={() => {
                                                setEditingHistoryId(entry.id || null);
                                                setEditHistoryReason(entry.reason || '');
                                            }}
                                            className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors group/icon"
                                        >
                                            <Edit2 className="h-3.5 w-3.5 text-white opacity-40 group-hover/icon:opacity-100 transition-[color,opacity]" />
                                        </button>
                                    )}
                                </div>

                                {editingHistoryId === entry.id ? (
                                    <div className="space-y-3 pt-2">
                                        <Textarea
                                            value={editHistoryReason}
                                            onChange={(e) => setEditHistoryReason(e.target.value)}
                                            placeholder={t('admin.editReason')}
                                            rows={2}
                                            className="text-sm bg-black/40"
                                            autoFocus
                                        />
                                        <div className="flex justify-end gap-2">
                                            <Button className="group/icon"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => setEditingHistoryId(null)}
                                                disabled={submitting}
                                            >
                                                <X className="h-3.5 w-3.5 mr-1 text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" />
                                                {t('admin.cancel')}
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={() => entry.id && handleUpdateHistoryReason(entry.id)}
                                                disabled={submitting}
                                            >
                                                {submitting ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <>
                                                        <Check className="h-3.5 w-3.5 mr-1" />
                                                        {t('admin.save')}
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-white/70 italic">
                                        {entry.reason || t('admin.noReasonSpecified')}
                                    </p>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="text-center py-8 text-white/30">
                            {t('admin.noHistoryAvailable')}
                        </div>
                    )}
                </div>
            </ReusableModal >

            {/* Delete Modal */}
            < ReusableModal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title={t('admin.deleteRequest')}
            >
                <div className="space-y-6">
                    <p className="text-white">
                        {t('admin.confirmDeleteRequest', { title: selectedRequest?.title })}
                    </p>
                    <div className="flex justify-end gap-2 pt-4">
                        <Button variant="ghost" onClick={() => setDeleteModalOpen(false)}>
                            {t('admin.cancel')}
                        </Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {t('admin.delete')}
                        </Button>
                    </div>
                </div>
            </ReusableModal >

            {/* Status Change Modal */}
            < ReusableModal
                isOpen={statusModalOpen}
                onClose={() => !submitting && setStatusModalOpen(false)}
                title={t('admin.changeStatus')}
            >
                <div className="space-y-6">
                    <div>
                        <p className="text-white text-sm mb-4">
                            {t('admin.changeStatusOf')} <span className="font-bold">"{selectedRequest?.title}"</span> {t('admin.towards')} :
                        </p>
                        <Badge variant={pendingStatus as any || 'default'} className="text-base py-1 px-3">
                            {statusOptions.find(o => o.value === pendingStatus)?.label ? t(statusOptions.find(o => o.value === pendingStatus)!.label) : ''}
                        </Badge>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-white/70">
                            {t('admin.changeReasonLabel')}
                        </label>
                        <Textarea
                            value={statusReason}
                            onChange={(e) => setStatusReason(e.target.value)}
                            placeholder={t('admin.changeReasonPlaceholder')}
                            rows={3}
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
                        <Button variant="ghost" onClick={() => setStatusModalOpen(false)} disabled={submitting}>
                            {t('admin.cancel')}
                        </Button>
                        <Button onClick={confirmStatusUpdate} disabled={submitting}>
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {t('admin.confirmChange')}
                        </Button>
                    </div>
                </div>
            </ReusableModal >

            {/* Source Check Modal */}
            <ReusableModal
                isOpen={sourceCheckModalOpen}
                onClose={() => !checkingSources && setSourceCheckModalOpen(false)}
                title={`${t('admin.availableSources')} : ${sourceCheckTitle}`}
            >
                <div className="space-y-4">
                    {checkingSources ? (
                        <div className="flex flex-col items-center justify-center py-10">
                            <Loader2 className="h-8 w-8 animate-spin text-green-500 mb-4" />
                            <p className="text-white/70">{t('admin.checkingSourcesInProgress')}</p>
                            <p className="text-white/50 text-sm mt-2">{t('admin.mayTakeFewSeconds')}</p>
                        </div>
                    ) : sourceCheckMediaType === 'movie' ? (
                        // Movie sources display
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 mb-4">
                                <Film className="h-5 w-5 text-green-400" />
                                <span className="text-white font-medium">{t('admin.movie')}</span>
                                <span className="text-white/50 text-sm ml-auto">
                                    {sourceCheckResults.filter(r => r.available).length}/{sourceCheckResults.length} sources
                                </span>
                            </div>
                            {sourceCheckResults.map((result, index) => (
                                <motion.div
                                    key={result.name}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                    className={`flex items-center justify-between p-3 rounded-lg border ${
                                        result.available 
                                            ? 'bg-green-500/10 border-green-500/30' 
                                            : 'bg-white/5 border-white/10'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        {result.available ? (
                                            <CheckCircle className="h-5 w-5 text-green-400" />
                                        ) : (
                                            <XCircle className="h-5 w-5 text-red-400 opacity-50" />
                                        )}
                                        <span className={result.available ? 'text-white' : 'text-white/50'}>
                                            {result.name}
                                        </span>
                                    </div>
                                    {result.available && result.count !== undefined && (
                                        <Badge variant="default" className="bg-green-500/20 text-green-400">
                                            {result.count} {result.count > 1 ? t('admin.linksPlural') : t('admin.linkSingular')}
                                        </Badge>
                                    )}
                                </motion.div>
                            ))}
                        </div>
                    ) : (
                        // TV show sources display (per season)
                        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                            <div className="flex items-center gap-2 mb-2">
                                <Tv className="h-5 w-5 text-blue-400" />
                                <span className="text-white font-medium">{t('admin.tvShowLabel')}</span>
                                <span className="text-white/50 text-sm ml-auto">
                                    {tvSourceCheckResults.length} {t('admin.seasonsChecked')}
                                </span>
                            </div>
                            {tvSourceCheckResults.map((seasonCheck, sIndex) => (
                                <div key={seasonCheck.seasonNumber} className="space-y-2">
                                    <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                                        <Badge variant="default" className="bg-blue-500/20 text-blue-400">
                                            Saison {seasonCheck.seasonNumber} - Épisode 1
                                        </Badge>
                                        <span className="text-white/50 text-sm ml-auto">
                                            {seasonCheck.sources.filter(r => r.available).length}/{seasonCheck.sources.length} sources
                                        </span>
                                    </div>
                                    {seasonCheck.sources.map((result, index) => (
                                        <motion.div
                                            key={`${seasonCheck.seasonNumber}-${result.name}`}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: (sIndex * seasonCheck.sources.length + index) * 0.02 }}
                                            className={`flex items-center justify-between p-2.5 rounded-lg border ${
                                                result.available 
                                                    ? 'bg-green-500/10 border-green-500/30' 
                                                    : 'bg-white/5 border-white/10'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                {result.available ? (
                                                    <CheckCircle className="h-4 w-4 text-green-400" />
                                                ) : (
                                                    <XCircle className="h-4 w-4 text-red-400 opacity-50" />
                                                )}
                                                <span className={`text-sm ${result.available ? 'text-white' : 'text-white/50'}`}>
                                                    {result.name}
                                                </span>
                                            </div>
                                            {result.available && result.count !== undefined && (
                                                <Badge variant="default" className="bg-green-500/20 text-green-400 text-xs">
                                                    {result.count}
                                                </Badge>
                                            )}
                                        </motion.div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}

                    {!checkingSources && (
                        <div className="flex items-center gap-2 pt-4 border-t border-white/10">
                            <AlertCircle className="h-4 w-4 text-amber-400" />
                            <p className="text-white/50 text-xs">
                                {sourceCheckMediaType === 'tv'
                                    ? t('admin.onlyEp1Checked')
                                    : t('admin.currentAvailability')}
                            </p>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <Button 
                            variant="ghost" 
                            onClick={() => setSourceCheckModalOpen(false)} 
                            disabled={checkingSources}
                        >
                            {t('admin.close')}
                        </Button>
                        <Button
                            onClick={() => selectedRequest && handleCheckSources(selectedRequest)}
                            disabled={checkingSources}
                            variant="secondary"
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${checkingSources ? 'animate-spin' : ''}`} />
                            {t('admin.recheck')}
                        </Button>
                    </div>
                </div>
            </ReusableModal>

            {/* Batch Check Modal */}
            <ReusableModal
                isOpen={batchCheckModalOpen}
                onClose={() => !batchChecking && !deletingBatch && setBatchCheckModalOpen(false)}
                title={t('admin.batchCheck')}
            >
                <div className="space-y-4">
                    {batchChecking ? (
                        <div className="space-y-4">
                            <div className="flex flex-col items-center justify-center py-6">
                                <Loader2 className="h-8 w-8 animate-spin text-purple-500 mb-4" />
                                <p className="text-white font-medium">{t('admin.checkInProgress')}</p>
                                <p className="text-white/50 text-sm mt-1">{batchCurrentTitle}</p>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-white/70">{t('admin.progress')}</span>
                                    <span className="text-white">{batchProgress}/{batchTotal}</span>
                                </div>
                                <div className="w-full bg-white/10 rounded-full h-2">
                                    <motion.div
                                        className="bg-purple-500 h-2 rounded-full"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${(batchProgress / batchTotal) * 100}%` }}
                                        transition={{ duration: 0.3 }}
                                    />
                                </div>
                            </div>
                            <p className="text-white/50 text-xs text-center">
                                {t('admin.rateLimitNote')}
                            </p>
                        </div>
                    ) : batchCompleted ? (
                        <div className="space-y-4">
                            {/* Summary Stats */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-red-400">
                                        {batchResults.filter(r => r.availableCategories === 0).length}
                                    </p>
                                    <p className="text-xs text-white/50">{t('admin.noSourceLabel')}</p>
                                </div>
                                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-amber-400">
                                        {batchResults.filter(r => r.availableCategories === 1).length}
                                    </p>
                                    <p className="text-xs text-white/50">{t('admin.oneCategory')}</p>
                                </div>
                                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-green-400">
                                        {batchResults.filter(r => r.availableCategories >= 2).length}
                                    </p>
                                    <p className="text-xs text-white/50">{t('admin.twoPlusCategories')}</p>
                                </div>
                            </div>

                            {/* Results List */}
                            <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                {/* No sources */}
                                {batchResults.filter(r => r.availableCategories === 0).length > 0 && (
                                    <div className="space-y-2">
                                        <h4 className="text-red-400 font-medium text-sm flex items-center gap-2">
                                            <XCircle className="h-4 w-4" />
                                            {t('admin.noSourceLabel')} ({batchResults.filter(r => r.availableCategories === 0).length})
                                        </h4>
                                        {batchResults.filter(r => r.availableCategories === 0).map((item) => (
                                            <div key={item.request.id} className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 flex items-center gap-2">
                                                {item.request.poster_path && (
                                                    <img src={`https://image.tmdb.org/t/p/w45${item.request.poster_path}`} alt="" className="w-8 h-12 rounded object-cover" />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-white text-sm truncate">{item.request.title}</p>
                                                    <p className="text-white/50 text-xs">{item.request.media_type === 'movie' ? t('admin.movie') : t('admin.tvShow')}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* 1 source */}
                                {batchResults.filter(r => r.availableCategories === 1).length > 0 && (
                                    <div className="space-y-2 mt-4">
                                        <h4 className="text-amber-400 font-medium text-sm flex items-center gap-2">
                                            <AlertCircle className="h-4 w-4" />
                                            {t('admin.oneCategoryLabel')} ({batchResults.filter(r => r.availableCategories === 1).length})
                                        </h4>
                                        {batchResults.filter(r => r.availableCategories === 1).map((item) => (
                                            <div key={item.request.id} className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 flex items-center gap-2">
                                                {item.request.poster_path && (
                                                    <img src={`https://image.tmdb.org/t/p/w45${item.request.poster_path}`} alt="" className="w-8 h-12 rounded object-cover" />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-white text-sm truncate">{item.request.title}</p>
                                                    <div className="flex items-center gap-1 mt-0.5">
                                                        <Badge variant="default" className="text-xs bg-amber-500/20 text-amber-400">
                                                            {item.sources.find(s => s.available)?.name}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* 2+ sources */}
                                {batchResults.filter(r => r.availableCategories >= 2).length > 0 && (
                                    <div className="space-y-2 mt-4">
                                        <h4 className="text-green-400 font-medium text-sm flex items-center gap-2">
                                            <CheckCircle className="h-4 w-4" />
                                            {t('admin.twoPlusCategoriesRemove')} ({batchResults.filter(r => r.availableCategories >= 2).length})
                                        </h4>
                                        {batchResults.filter(r => r.availableCategories >= 2).map((item) => (
                                            <div key={item.request.id} className="bg-green-500/10 border border-green-500/20 rounded-lg p-2 flex items-center gap-2">
                                                {item.request.poster_path && (
                                                    <img src={`https://image.tmdb.org/t/p/w45${item.request.poster_path}`} alt="" className="w-8 h-12 rounded object-cover" />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-white text-sm truncate">{item.request.title}</p>
                                                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                                        {item.sources.filter(s => s.available).slice(0, 3).map((s, idx) => (
                                                            <Badge key={idx} variant="default" className="text-xs bg-green-500/20 text-green-400">
                                                                {s.name.split(' ')[0]}
                                                            </Badge>
                                                        ))}
                                                        {item.sources.filter(s => s.available).length > 3 && (
                                                            <Badge variant="default" className="text-xs bg-white/10 text-white opacity-50">
                                                                +{item.sources.filter(s => s.available).length - 3}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex justify-between items-center pt-4 border-t border-white/10">
                                <p className="text-white/50 text-xs">
                                    {t('admin.twoSourcesRejectNote')}
                                </p>
                                <div className="flex gap-2">
                                    <Button 
                                        variant="ghost" 
                                        onClick={() => setBatchCheckModalOpen(false)}
                                        disabled={deletingBatch}
                                    >
                                        {t('admin.close')}
                                    </Button>
                                    {batchResults.filter(r => r.availableCategories >= 2).length > 0 && (
                                        <Button
                                            variant="destructive"
                                            onClick={handleRejectWithMultipleSources}
                                            disabled={deletingBatch}
                                        >
                                            {deletingBatch ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <Trash2 className="h-4 w-4 mr-2" />
                                            )}
                                            {t('admin.rejectRequestCount', { count: batchResults.filter(r => r.availableCategories >= 2).length })}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-10">
                            <ListChecks className="h-12 w-12 text-purple-400 mx-auto mb-4" />
                            <p className="text-white mb-2">{t('admin.checkAllPendingRequests')}</p>
                            <p className="text-white/50 text-sm mb-6">
                                {t('admin.checkAllPendingDesc', { count: requests.filter(r => r.status === 'pending').length })}
                            </p>
                            <Button onClick={handleBatchCheck}>
                                <Play className="h-4 w-4 mr-2" />
                                {t('admin.startCheck')}
                            </Button>
                        </div>
                    )}
                </div>
            </ReusableModal>
            </>
            )}
        </div >
    );
};

export default AdminWishboard;
