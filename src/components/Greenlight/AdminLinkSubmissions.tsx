import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Trash2, Loader2, Film, Tv, RefreshCw,
    Check, X, ExternalLink, LinkIcon, CheckCircle, XCircle,
    ChevronDown, ChevronUp
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
import { getTmdbLanguage } from '../../i18n';

const MAIN_API = import.meta.env.VITE_MAIN_API;
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

interface LinkSubmission {
    id: number;
    user_id: string;
    profile_id: string;
    tmdb_id: number;
    media_type: 'movie' | 'tv';
    season_number: number | null;
    episode_number: number | null;
    url: string;
    source_name: string | null;
    status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
    user?: { username: string; avatar: string | null };
    // TMDB enriched
    title?: string;
    year?: string;
    poster_path?: string | null;
}

// Grouped structures
interface LinkGroup {
    url: string;
    submissions: LinkSubmission[];
}

interface EpisodeGroup {
    season_number: number;
    episode_number: number;
    links: LinkGroup[];
    allSubmissions: LinkSubmission[];
}

interface ContentGroup {
    tmdb_id: number;
    media_type: 'movie' | 'tv';
    title: string;
    year: string;
    poster_path: string | null;
    episodes: EpisodeGroup[]; // For TV; for movies, single entry with season/episode = null
    links: LinkGroup[]; // For movies: grouped links
    allSubmissions: LinkSubmission[];
}

interface SubmissionStats {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
}

// Group submissions by content, then by episode, then by link URL
function groupSubmissions(submissions: LinkSubmission[]): ContentGroup[] {
    const contentMap = new Map<string, ContentGroup>();

    for (const sub of submissions) {
        const key = `${sub.media_type}-${sub.tmdb_id}`;
        if (!contentMap.has(key)) {
            contentMap.set(key, {
                tmdb_id: sub.tmdb_id,
                media_type: sub.media_type,
                title: sub.title || `TMDB #${sub.tmdb_id}`,
                year: sub.year || '',
                poster_path: sub.poster_path || null,
                episodes: [],
                links: [],
                allSubmissions: [],
            });
        }
        const group = contentMap.get(key)!;
        group.allSubmissions.push(sub);

        if (sub.media_type === 'movie') {
            // Group by URL for movies
            let linkGroup = group.links.find(l => l.url === sub.url);
            if (!linkGroup) {
                linkGroup = { url: sub.url, submissions: [] };
                group.links.push(linkGroup);
            }
            linkGroup.submissions.push(sub);
        } else {
            // Group by season+episode for TV
            let epGroup = group.episodes.find(e =>
                e.season_number === (sub.season_number ?? 0) && e.episode_number === (sub.episode_number ?? 0)
            );
            if (!epGroup) {
                epGroup = {
                    season_number: sub.season_number ?? 0,
                    episode_number: sub.episode_number ?? 0,
                    links: [],
                    allSubmissions: [],
                };
                group.episodes.push(epGroup);
            }
            epGroup.allSubmissions.push(sub);

            // Group by URL within episode
            let linkGroup = epGroup.links.find(l => l.url === sub.url);
            if (!linkGroup) {
                linkGroup = { url: sub.url, submissions: [] };
                epGroup.links.push(linkGroup);
            }
            linkGroup.submissions.push(sub);
        }
    }

    // Sort episodes within each TV group
    for (const group of contentMap.values()) {
        group.episodes.sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number);
    }

    return Array.from(contentMap.values());
}

const AdminLinkSubmissions: React.FC = () => {
    const { t, i18n } = useTranslation();
    const [submissions, setSubmissions] = useState<LinkSubmission[]>([]);
    const [stats, setStats] = useState<SubmissionStats>({ total: 0, pending: 0, approved: 0, rejected: 0 });
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('pending');
    const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    // Modals
    const [rejectModal, setRejectModal] = useState<{ id: number; url: string } | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [bulkRejectModal, setBulkRejectModal] = useState(false);
    const [bulkRejectReason, setBulkRejectReason] = useState('');

    // Processing state
    const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());

    // Expanded groups/items
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set());

    // Debounce
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Fetch submissions
    const fetchSubmissions = useCallback(async () => {
        setLoading(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const params = new URLSearchParams();
            if (debouncedSearch) params.append('search', debouncedSearch);
            if (statusFilter !== 'all') params.append('status', statusFilter);
            if (mediaTypeFilter !== 'all') params.append('media_type', mediaTypeFilter);
            params.append('limit', '100');

            const response = await axios.get(`${MAIN_API}/api/link-submissions/admin?${params}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            const data = response.data;
            // Enrich with TMDB data
            const enriched = await Promise.all((data.submissions || []).map(async (sub: LinkSubmission) => {
                try {
                    const tmdbRes = await fetch(
                        `https://api.themoviedb.org/3/${sub.media_type}/${sub.tmdb_id}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
                    );
                    if (tmdbRes.ok) {
                        const tmdb = await tmdbRes.json();
                        return {
                            ...sub,
                            title: tmdb.title || tmdb.name || `TMDB #${sub.tmdb_id}`,
                            year: (tmdb.release_date || tmdb.first_air_date || '').split('-')[0],
                            poster_path: tmdb.poster_path,
                        };
                    }
                } catch { /* silent */ }
                return { ...sub, title: `TMDB #${sub.tmdb_id}` };
            }));

            setSubmissions(enriched);
            setStats(data.stats || stats);
            setSelectedIds(new Set());
        } catch (error) {
            console.error('Error fetching submissions:', error);
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch, statusFilter, mediaTypeFilter]);

    useEffect(() => {
        fetchSubmissions();
    }, [fetchSubmissions]);

    // Approve a submission
    const handleApprove = async (id: number) => {
        setProcessingIds(prev => new Set(prev).add(id));
        try {
            const authToken = localStorage.getItem('auth_token');
            await axios.put(`${MAIN_API}/api/link-submissions/admin/${id}/approve`, {}, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'approved' as const } : s));
            setStats(prev => ({ ...prev, pending: prev.pending - 1, approved: prev.approved + 1 }));
        } catch (error) {
            console.error('Error approving:', error);
        } finally {
            setProcessingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        }
    };

    // Reject a submission
    const handleReject = async (id: number, reason: string) => {
        setProcessingIds(prev => new Set(prev).add(id));
        try {
            const authToken = localStorage.getItem('auth_token');
            await axios.put(`${MAIN_API}/api/link-submissions/admin/${id}/reject`, { reason }, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'rejected' as const, rejection_reason: reason } : s));
            setStats(prev => ({ ...prev, pending: prev.pending - 1, rejected: prev.rejected + 1 }));
        } catch (error) {
            console.error('Error rejecting:', error);
        } finally {
            setProcessingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
            setRejectModal(null);
            setRejectReason('');
        }
    };

    // Bulk approve
    const handleBulkApprove = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        try {
            const authToken = localStorage.getItem('auth_token');
            await axios.put(`${MAIN_API}/api/link-submissions/admin/bulk-approve`, { ids }, {
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' }
            });
            fetchSubmissions();
        } catch (error) {
            console.error('Error bulk approving:', error);
        }
    };

    // Bulk reject
    const handleBulkReject = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        try {
            const authToken = localStorage.getItem('auth_token');
            await axios.put(`${MAIN_API}/api/link-submissions/admin/bulk-reject`, { ids, reason: bulkRejectReason || null }, {
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' }
            });
            fetchSubmissions();
        } catch (error) {
            console.error('Error bulk rejecting:', error);
        } finally {
            setBulkRejectModal(false);
            setBulkRejectReason('');
        }
    };

    // Delete
    const handleDelete = async (id: number) => {
        try {
            const authToken = localStorage.getItem('auth_token');
            await axios.delete(`${MAIN_API}/api/link-submissions/admin/${id}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            setSubmissions(prev => prev.filter(s => s.id !== id));
        } catch (error) {
            console.error('Error deleting:', error);
        }
    };

    // Toggle selection
    const toggleSelect = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        const pendingSubs = submissions.filter(s => s.status === 'pending');
        if (selectedIds.size === pendingSubs.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(pendingSubs.map(s => s.id)));
        }
    };

    const formatDate = (date: string) => new Date(date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const pendingSubs = submissions.filter(s => s.status === 'pending');
    const grouped = groupSubmissions(submissions);

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const toggleEpisode = (key: string) => {
        setExpandedEpisodes(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    // Inline submission row renderer
    const renderSubmissionRow = (sub: LinkSubmission, compact = false) => (
        <div key={sub.id} className={`flex items-center gap-2 ${compact ? 'py-1.5 px-2' : 'p-2'} rounded-lg bg-white/[0.02] hover:bg-white/5 transition-colors`}>
            {sub.status === 'pending' && (
                <input
                    type="checkbox"
                    checked={selectedIds.has(sub.id)}
                    onChange={() => toggleSelect(sub.id)}
                    className="w-3.5 h-3.5 rounded bg-white/10 border-white/20 accent-green-500 flex-shrink-0"
                />
            )}
            <div className="flex-1 min-w-0">
                <a href={/^https?:\/\//i.test(sub.url ?? '') ? sub.url : '#'} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 truncate block" title={sub.url}>
                    {sub.url}
                </a>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-white/30">{sub.user?.username || t('admin.unknown')}</span>
                    <span className="text-[10px] text-white/15">•</span>
                    <span className="text-[10px] text-white/30">{formatDate(sub.created_at)}</span>
                    {sub.source_name && (
                        <>
                            <span className="text-[10px] text-white/15">•</span>
                            <span className="text-[10px] text-white/40">{sub.source_name}</span>
                        </>
                    )}
                </div>
                {sub.rejection_reason && (
                    <p className="text-[10px] text-red-400 mt-0.5">{t('admin.rejectionPrefix')} {sub.rejection_reason}</p>
                )}
            </div>
            {/* Status */}
            <div className="flex-shrink-0">
                {sub.status === 'pending' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">{t('admin.pending')}</span>}
                {sub.status === 'approved' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">{t('admin.approvedLabel')}</span>}
                {sub.status === 'rejected' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">{t('admin.rejectedLabel')}</span>}
            </div>
            {/* Actions */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
                {sub.status === 'pending' && (
                    <>
                        <Button size="sm" onClick={() => handleApprove(sub.id)} disabled={processingIds.has(sub.id)} className="bg-green-600 hover:bg-green-700 h-6 w-6 p-0" title={t('admin.approve')}>
                            {processingIds.has(sub.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        </Button>
                        <Button size="sm" onClick={() => setRejectModal({ id: sub.id, url: sub.url })} disabled={processingIds.has(sub.id)} variant="destructive" className="h-6 w-6 p-0" title={t('admin.reject')}>
                            <X className="w-3 h-3" />
                        </Button>
                    </>
                )}
                <Button size="sm" variant="ghost" onClick={() => window.open(sub.url, '_blank')} className="h-6 w-6 p-0 text-white/20 hover:text-white group/icon" title={t('admin.open')}>
                    <ExternalLink className="w-3 h-3 text-white opacity-20 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(sub.id)} className="h-6 w-6 p-0 text-white/20 hover:text-red-400 group/icon" title={t('admin.delete')}>
                    <Trash2 className="w-3 h-3 text-white opacity-20 group-hover/icon:text-red-400 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" />
                </Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: 'admin.total', value: stats.total, color: 'text-white' },
                    { label: 'admin.pending', value: stats.pending, color: 'text-yellow-400' },
                    { label: 'admin.approvedPlural', value: stats.approved, color: 'text-green-400' },
                    { label: 'admin.rejectedPlural', value: stats.rejected, color: 'text-red-400' },
                ].map((stat) => (
                    <div key={stat.label} className="bg-white/5 rounded-lg p-3 text-center">
                        <p className="text-xs text-white/40">{t(stat.label)}</p>
                        <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white opacity-30" />
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('admin.searchByTmdbUrl')}
                        className="pl-9 bg-white/5 border-white/10"
                    />
                </div>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[150px] bg-white/5 border-white/10">
                        <SelectValue placeholder={t('admin.status')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t('admin.allFilter')}</SelectItem>
                        <SelectItem value="pending">{t('admin.pending')}</SelectItem>
                        <SelectItem value="approved">{t('admin.approvedPlural')}</SelectItem>
                        <SelectItem value="rejected">{t('admin.rejectedPlural')}</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={mediaTypeFilter} onValueChange={setMediaTypeFilter}>
                    <SelectTrigger className="w-[130px] bg-white/5 border-white/10">
                        <SelectValue placeholder={t('admin.type')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t('admin.allFilter')}</SelectItem>
                        <SelectItem value="movie">{t('admin.movies')}</SelectItem>
                        <SelectItem value="tv">{t('admin.tvShows')}</SelectItem>
                    </SelectContent>
                </Select>

                <Button onClick={fetchSubmissions} variant="ghost" size="sm" className="text-white/60 group/icon">
                    <RefreshCw className="w-4 h-4 text-white opacity-60 group-hover/icon:opacity-100 transition-opacity duration-200" />
                </Button>
            </div>

            {/* Bulk actions */}
            {selectedIds.size > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg"
                >
                    <span className="text-sm text-green-400 font-medium">{t('admin.selectedCount', { count: selectedIds.size })}</span>
                    <div className="flex-1" />
                    <Button size="sm" onClick={handleBulkApprove} className="bg-green-600 hover:bg-green-700 text-sm">
                        <CheckCircle className="w-4 h-4 mr-1" /> {t('admin.approveAll')}
                    </Button>
                    <Button size="sm" onClick={() => setBulkRejectModal(true)} variant="destructive" className="text-sm">
                        <XCircle className="w-4 h-4 mr-1" /> {t('admin.rejectAll')}
                    </Button>
                    <Button size="sm" onClick={() => setSelectedIds(new Set())} variant="ghost" className="text-white/50">
                        {t('admin.deselect')}
                    </Button>
                </motion.div>
            )}

            {/* Grouped submissions list */}
            {loading ? (
                <div className="flex justify-center items-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-green-400" />
                </div>
            ) : grouped.length === 0 ? (
                <div className="text-center py-16">
                    <LinkIcon className="w-12 h-12 mx-auto mb-4 text-white opacity-10" />
                    <p className="text-white/40">{t('admin.noSubmissionsFound')}</p>
                </div>
            ) : (
                <>
                    {/* Select all checkbox for pending */}
                    {statusFilter === 'pending' && pendingSubs.length > 0 && (
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="checkbox"
                                checked={selectedIds.size === pendingSubs.length && pendingSubs.length > 0}
                                onChange={toggleSelectAll}
                                className="w-4 h-4 rounded bg-white/10 border-white/20 accent-green-500"
                            />
                            <span className="text-xs text-white/40">{t('admin.selectAll')} ({pendingSubs.length})</span>
                        </div>
                    )}

                    <div className="space-y-3">
                        {grouped.map((group) => {
                            const groupKey = `${group.media_type}-${group.tmdb_id}`;
                            const isExpanded = expandedGroups.has(groupKey);
                            const pendingCount = group.allSubmissions.filter(s => s.status === 'pending').length;

                            return (
                                <motion.div
                                    key={groupKey}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    layout
                                    className="bg-white/5 rounded-xl border border-white/10 overflow-hidden"
                                >
                                    {/* Group header */}
                                    <button
                                        onClick={() => toggleGroup(groupKey)}
                                        className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors text-left"
                                    >
                                        {/* Poster */}
                                        <div className="flex-shrink-0 w-10 h-14 rounded overflow-hidden bg-white/5">
                                            {group.poster_path ? (
                                                <img src={`https://image.tmdb.org/t/p/w92${group.poster_path}`} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    {group.media_type === 'movie' ? <Film className="w-4 h-4 text-white opacity-20" /> : <Tv className="w-4 h-4 text-white opacity-20" />}
                                                </div>
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm font-semibold text-white truncate max-w-[250px]">{group.title}</p>
                                                {group.year && <span className="text-xs text-white/30">{group.year}</span>}
                                                <Badge variant={group.media_type === 'movie' ? 'default' : 'secondary'} className="text-[10px] py-0 px-1.5">
                                                    {group.media_type === 'movie' ? t('admin.movie') : t('admin.tvShow')}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-xs text-white/40">
                                                    {group.allSubmissions.length} {t('admin.linkCount', { count: group.allSubmissions.length })}
                                                </span>
                                                {group.media_type === 'tv' && (
                                                    <span className="text-xs text-white/30">
                                                        • {group.episodes.length} {t('admin.episodeCount', { count: group.episodes.length })}
                                                    </span>
                                                )}
                                                {pendingCount > 0 && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">
                                                        {t('admin.pendingCount', { count: pendingCount })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Bulk approve all pending in group */}
                                        {pendingCount > 0 && (
                                            <Button
                                                size="sm"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const ids = group.allSubmissions.filter(s => s.status === 'pending').map(s => s.id);
                                                    setSelectedIds(new Set(ids));
                                                }}
                                                className="bg-green-600/20 hover:bg-green-600/30 text-green-400 h-7 text-xs px-2"
                                                title={t('admin.selectGroup')}
                                            >
                                                <CheckCircle className="w-3 h-3 mr-1" /> {pendingCount}
                                            </Button>
                                        )}

                                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/30 group/icon" onClick={(e) => { e.stopPropagation(); window.open(`https://www.themoviedb.org/${group.media_type}/${group.tmdb_id}`, '_blank'); }} title={t('greenlight.viewOnTmdb')}>
                                            <ExternalLink className="w-3.5 h-3.5 text-white opacity-30 group-hover/icon:opacity-100 transition-opacity duration-200" />
                                        </Button>

                                        {isExpanded ? <ChevronUp className="w-4 h-4 text-white opacity-30 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-white opacity-30 flex-shrink-0" />}
                                    </button>

                                    {/* Expanded content */}
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="border-t border-white/5 px-3 pb-3 pt-2">
                                                    {group.media_type === 'movie' ? (
                                                        /* Movie: list links directly */
                                                        <div className="space-y-1">
                                                            {group.links.map((lg) => (
                                                                <div key={lg.url}>
                                                                    {lg.submissions.length > 1 && (
                                                                        <p className="text-[10px] text-white/20 mb-0.5 pl-1">{t('admin.sameLinkSubmissions', { count: lg.submissions.length })}</p>
                                                                    )}
                                                                    {lg.submissions.map(sub => renderSubmissionRow(sub, true))}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        /* TV: group by episode */
                                                        <div className="space-y-2">
                                                            {group.episodes.map((ep) => {
                                                                const epKey = `${groupKey}-s${ep.season_number}e${ep.episode_number}`;
                                                                const epExpanded = expandedEpisodes.has(epKey);
                                                                const epPending = ep.allSubmissions.filter(s => s.status === 'pending').length;

                                                                return (
                                                                    <div key={epKey} className="rounded-lg bg-white/[0.03] border border-white/5">
                                                                        <button
                                                                            onClick={() => toggleEpisode(epKey)}
                                                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/5 transition-colors text-left rounded-lg"
                                                                        >
                                                                            <span className="text-xs font-medium text-green-400 w-14 flex-shrink-0">
                                                                                S{String(ep.season_number).padStart(2, '0')}E{String(ep.episode_number).padStart(2, '0')}
                                                                            </span>
                                                                            <span className="text-xs text-white/40 flex-1">
                                                                                {ep.links.length} {t('admin.linkCount', { count: ep.links.length })}
                                                                                {ep.allSubmissions.length > ep.links.length && ` (${ep.allSubmissions.length} ${t('admin.submissions')})`}
                                                                            </span>
                                                                            {epPending > 0 && (
                                                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">{epPending}</span>
                                                                            )}
                                                                            {epExpanded ? <ChevronUp className="w-3 h-3 text-white opacity-20" /> : <ChevronDown className="w-3 h-3 text-white opacity-20" />}
                                                                        </button>

                                                                        <AnimatePresence>
                                                                            {epExpanded && (
                                                                                <motion.div
                                                                                    initial={{ height: 0, opacity: 0 }}
                                                                                    animate={{ height: 'auto', opacity: 1 }}
                                                                                    exit={{ height: 0, opacity: 0 }}
                                                                                    className="overflow-hidden"
                                                                                >
                                                                                    <div className="px-2 pb-2 space-y-1">
                                                                                        {ep.links.map((lg) => (
                                                                                            <div key={lg.url}>
                                                                                                {lg.submissions.length > 1 && (
                                                                                                    <p className="text-[10px] text-white/20 mb-0.5 pl-1">{t('admin.sameLinkShort', { count: lg.submissions.length })}</p>
                                                                                                )}
                                                                                                {lg.submissions.map(sub => renderSubmissionRow(sub, true))}
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                </motion.div>
                                                                            )}
                                                                        </AnimatePresence>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* Reject Modal */}
            <ReusableModal
                isOpen={!!rejectModal}
                onClose={() => { setRejectModal(null); setRejectReason(''); }}
                title={t('admin.rejectSubmission')}
                className="max-w-md"
            >
                <div className="p-6 space-y-4">
                    <p className="text-sm text-white/60">
                        {t('admin.rejectLink')} <span className="text-white/80 break-all">{rejectModal?.url}</span>
                    </p>
                    <Textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder={t('admin.rejectionReasonOptional')}
                        className="bg-white/5 border-white/10 min-h-[80px]"
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => { setRejectModal(null); setRejectReason(''); }}>
                            {t('admin.cancel')}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => rejectModal && handleReject(rejectModal.id, rejectReason)}
                        >
                            <XCircle className="w-4 h-4 mr-1" /> {t('admin.reject')}
                        </Button>
                    </div>
                </div>
            </ReusableModal>

            {/* Bulk Reject Modal */}
            <ReusableModal
                isOpen={bulkRejectModal}
                onClose={() => { setBulkRejectModal(false); setBulkRejectReason(''); }}
                title={t('admin.bulkReject')}
                className="max-w-md"
            >
                <div className="p-6 space-y-4">
                    <p className="text-sm text-white/60">
                        {t('admin.bulkRejectConfirm', { count: selectedIds.size })}
                    </p>
                    <Textarea
                        value={bulkRejectReason}
                        onChange={(e) => setBulkRejectReason(e.target.value)}
                        placeholder={t('admin.rejectionReasonOptional')}
                        className="bg-white/5 border-white/10 min-h-[80px]"
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => { setBulkRejectModal(false); setBulkRejectReason(''); }}>
                            {t('admin.cancel')}
                        </Button>
                        <Button variant="destructive" onClick={handleBulkReject}>
                            <XCircle className="w-4 h-4 mr-1" /> {t('admin.rejectCount', { count: selectedIds.size })}
                        </Button>
                    </div>
                </div>
            </ReusableModal>
        </div>
    );
};

export default AdminLinkSubmissions;
