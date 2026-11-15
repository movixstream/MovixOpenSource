import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Trash2, Loader2, Film, Tv, RefreshCw, MessageSquare, AlertCircle, Sparkles,
    Ban, Shield, Copy, UserX, Clock, CheckCircle, MoreHorizontal
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from './ui/select';
import ReusableModal from './ui/reusable-modal';
import { getTmdbLanguage } from '../i18n';
import { copyText } from '../utils/clipboard';

interface Comment {
    id: number;
    content_id: string;
    content_type: 'movie' | 'tv';
    user_id: string;
    user_type: string;
    profile_id: string;
    username: string;
    avatar: string | null;
    content: string;
    is_spoiler: boolean;
    is_vip: boolean;
    is_admin: boolean;
    is_edited: boolean;
    created_at: number;
    reaction_count: number;
    // TMDB data
    title?: string;
    poster_path?: string | null;
    // Moderation data
    item_type?: 'comment' | 'reply';
    moderation_reason?: string;
    moderation_details?: string;
    moderated_at?: number;
    ip_address?: string;
}

interface AdminStats {
    total: number;
    movies: number;
    tv: number;
    reports: number;
    moderated?: number;
}

interface BanEntry {
    id: number;
    ban_type: 'ip' | 'user';
    ban_value: string;
    user_type: string | null;
    reason: string | null;
    banned_by: string;
    banned_at: number;
    expires_at: number | null;
    username: string | null;
}

interface DuplicateGroup {
    content: string;
    count: number;
    firstPosted: number;
    lastPosted: number;
    isFancyUnicode?: boolean;
    comments: {
        id: number;
        user_id: string;
        user_type: string;
        profile_id: string;
        username: string;
        avatar: string | null;
        content?: string;
        content_type: string;
        content_id: string;
        created_at: number;
        ip_address?: string;
    }[];
}

const ADMIN_COMMENTS_PAGE_SIZE = 50;
const ADMIN_COMMENTS_INITIAL_RENDER_COUNT = 60;
const ADMIN_COMMENTS_RENDER_STEP = 60;
const ADMIN_COMMENTS_ANIMATION_THRESHOLD = 24;

interface AdminIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    compact?: boolean;
}

const AdminIconButton: React.FC<AdminIconButtonProps> = ({
    compact = false,
    className,
    children,
    ...props
}) => {
    if (compact) {
        return (
            <button className={className} {...props}>
                {children}
            </button>
        );
    }

    return (
        <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className={className}
            {...props}
        >
            {children}
        </motion.button>
    );
};

const AdminComments: React.FC = () => {
    const { t, i18n } = useTranslation();
    const [comments, setComments] = useState<Comment[]>([]);
    const [stats, setStats] = useState<AdminStats>({
        total: 0,
        movies: 0,
        tv: 0,
        reports: 0,
        moderated: 0,
    });
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'live' | 'moderated' | 'bans'>('live');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [contentTypeFilter, setContentTypeFilter] = useState('all');
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [renderCount, setRenderCount] = useState(ADMIN_COMMENTS_INITIAL_RENDER_COUNT);

    // Modal states
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [selectedComment, setSelectedComment] = useState<Comment | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [viewComment, setViewComment] = useState<Comment | null>(null);

    // Ban states
    const [banModalOpen, setBanModalOpen] = useState(false);
    const [banTarget, setBanTarget] = useState<Comment | null>(null);
    const [banType, setBanType] = useState<'ip' | 'user'>('user');
    const [banDuration, setBanDuration] = useState('permanent');
    const [banReason, setBanReason] = useState('');
    const [banDeleteAll, setBanDeleteAll] = useState(true);
    const [bans, setBans] = useState<BanEntry[]>([]);
    const [bansLoading, setBansLoading] = useState(false);
    const [showExpiredBans, setShowExpiredBans] = useState(false);
    const [bansPage, setBansPage] = useState(1);
    const [bansHasMore, setBansHasMore] = useState(false);
    const [bansTotal, setBansTotal] = useState(0);
    const [bansSearch, setBansSearch] = useState('');

    // Duplicates states
    const [duplicatesModalOpen, setDuplicatesModalOpen] = useState(false);
    const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
    const [duplicatesLoading, setDuplicatesLoading] = useState(false);
    const [duplicateBanDuration, setDuplicateBanDuration] = useState('permanent');

    const API_URL = import.meta.env.VITE_MAIN_API || '';
    const tmdbCacheRef = useRef<Record<string, { title: string; poster_path: string | null }>>({});
    const loadedCommentCountRef = useRef(0);
    const currentCommentsPageRef = useRef(1);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearch(searchQuery.trim());
        }, 250);

        return () => window.clearTimeout(timeoutId);
    }, [searchQuery]);

    // Fetch TMDB data
    const fetchTmdbData = async (tmdbId: string, mediaType: 'movie' | 'tv') => {
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
                    poster_path: data.poster_path,
                };
                tmdbCacheRef.current[cacheKey] = mappedData;
                return mappedData;
            }
        } catch (error) {
            console.error('Error fetching TMDB data:', error);
        }

        const fallbackData = { title: `TMDB ID: ${tmdbId}`, poster_path: null };
        tmdbCacheRef.current[cacheKey] = fallbackData;
        return fallbackData;
    };

    // Fetch comments
    const fetchComments = useCallback(async (options?: { reset?: boolean; pageOverride?: number }) => {
        const reset = options?.reset ?? false;
        setLoading(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const currentPage = reset ? 1 : (options?.pageOverride ?? currentCommentsPageRef.current);
            const params = new URLSearchParams();
            params.append('page', currentPage.toString());
            params.append('limit', String(ADMIN_COMMENTS_PAGE_SIZE));
            if (debouncedSearch) params.append('search', debouncedSearch);
            if (contentTypeFilter !== 'all') params.append('contentType', contentTypeFilter);


            let url = '';
            if (activeTab === 'live') {
                url = `${API_URL}/api/comments/admin/list?${params}`;
            } else {
                url = `${API_URL}/api/comments/admin/moderated?${params}`;
            }

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                },
            });

            if (response.ok) {
                const data = await response.json();

                // Determine the correct data property based on active tab
                const commentsData = activeTab === 'live' ? data.comments : data.items;

                // Fetch TMDB data for each unique content_id in the current batch
                const uniqueContents = Array.from(new Set((commentsData || []).map((c: Comment) => `${c.content_type}:${c.content_id}`)));
                const tmdbCache: Record<string, any> = {};

                await Promise.all(uniqueContents.map(async (key) => {
                    const stringKey = key as string;
                    const [type, id] = stringKey.split(':');
                    tmdbCache[stringKey] = await fetchTmdbData(id, type as 'movie' | 'tv');
                }));
                const commentsWithTmdb = commentsData.map((comment: Comment) => ({
                    ...comment,
                    ...tmdbCache[`${comment.content_type}:${comment.content_id}`]
                }));

                if (reset) {
                    setComments(commentsWithTmdb);
                    setPage(1);
                    setRenderCount(ADMIN_COMMENTS_INITIAL_RENDER_COUNT);
                    currentCommentsPageRef.current = 1;
                    loadedCommentCountRef.current = commentsWithTmdb.length;
                } else {
                    setComments(prev => [...prev, ...commentsWithTmdb]);
                    setPage(currentPage);
                    setRenderCount(prev => prev + commentsWithTmdb.length);
                    currentCommentsPageRef.current = currentPage;
                    loadedCommentCountRef.current += commentsWithTmdb.length;
                }

                if (data && data.stats) {
                    setStats(data.stats);
                }

                if (data && typeof data.total === 'number') {
                    setHasMore(data.total > loadedCommentCountRef.current);
                }
            }
        } catch (error) {
            console.error('Error fetching admin comments:', error);
        } finally {
            setLoading(false);
        }
    }, [API_URL, debouncedSearch, contentTypeFilter, activeTab]);

    // Fetch bans with pagination (page by page)
    const fetchBans = useCallback(async (pageOverride?: number) => {
        setBansLoading(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const p = pageOverride ?? bansPage;
            const params = new URLSearchParams({ page: String(p), limit: '30' });
            if (showExpiredBans) params.append('showExpired', 'true');
            if (bansSearch.trim()) params.append('search', bansSearch.trim());

            const response = await fetch(`${API_URL}/api/comments/admin/bans?${params}`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
            });
            if (response.ok) {
                const data = await response.json();
                setBans(data.bans || []);
                setBansHasMore(data.hasMore || false);
                setBansTotal(data.total || 0);
            }
        } catch (error) {
            console.error('Error fetching bans:', error);
        } finally {
            setBansLoading(false);
        }
    }, [API_URL, showExpiredBans, bansPage, bansSearch]);

    useEffect(() => {
        if (activeTab === 'bans') {
            fetchBans(1);
            setBansPage(1);
        } else {
            fetchComments({ reset: true, pageOverride: 1 });
        }
    }, [debouncedSearch, contentTypeFilter, activeTab, showExpiredBans, bansSearch, fetchComments, fetchBans]);

    useEffect(() => {
        if (activeTab !== 'bans') {
            setRenderCount(ADMIN_COMMENTS_INITIAL_RENDER_COUNT);
        }
    }, [activeTab, debouncedSearch, contentTypeFilter]);

    // Fetch bans when page changes
    useEffect(() => {
        if (activeTab === 'bans') {
            fetchBans();
        }
    }, [activeTab, bansPage, fetchBans]);

    // Approve moderated comment
    const handleApprove = async (comment: Comment) => {
        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const type = comment.item_type || 'comment';
            const response = await fetch(`${API_URL}/api/comments/admin/moderated/${type}/${comment.id}/approve`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                },
            });

            if (response.ok) {
                setComments(prev => prev.filter(c => c.id !== comment.id));
                setStats(prev => ({ ...prev, moderated: (prev.moderated || 1) - 1 }));
            }
        } catch (error) {
            console.error('Error approving comment:', error);
        } finally {
            setSubmitting(false);
        }
    };

    // Delete permanently (for moderated)
    const handlePermanentDelete = async (comment: Comment) => {
        if (!confirm(t('admin.confirmDeleteContent'))) return;

        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const type = comment.item_type || 'comment';
            const response = await fetch(`${API_URL}/api/comments/admin/moderated/${type}/${comment.id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                },
            });

            if (response.ok) {
                setComments(prev => prev.filter(c => c.id !== comment.id));
                setStats(prev => ({ ...prev, moderated: (prev.moderated || 1) - 1 }));
            }
        } catch (error) {
            console.error('Error deleting comment permanently:', error);
        } finally {
            setSubmitting(false);
        }
    };

    // Delete comment
    const handleDelete = async () => {
        if (!selectedComment) return;

        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const response = await fetch(`${API_URL}/api/comments/${selectedComment.id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                },
            });

            if (response.ok) {
                setComments(prev => prev.filter(c => c.id !== selectedComment.id));
                setDeleteModalOpen(false);
                setStats(prev => ({ ...prev, total: prev.total - 1 }));
            }
        } catch (error) {
            console.error('Error deleting comment:', error);
        } finally {
            setSubmitting(false);
        }
    };

    // Ban user
    const handleBan = async () => {
        if (!banTarget) return;
        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const banValue = banType === 'ip' ? banTarget.ip_address : banTarget.user_id;
            if (banType === 'ip' && !banValue) {
                toast.error(t('admin.commentUnknownIp'));
                setSubmitting(false);
                return;
            }

            const response = await fetch(`${API_URL}/api/comments/admin/ban`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    banType,
                    banValue,
                    userType: banTarget.user_type,
                    reason: banReason || undefined,
                    duration: banDuration,
                    username: banTarget.username,
                    deleteAll: banDeleteAll,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                toast.success(t('admin.banSuccess') + (data.deletedCount > 0 ? ` (${data.deletedCount} supprimé(s))` : ''));
                setBanModalOpen(false);
                setBanReason('');
                if (banDeleteAll) {
                    setComments(prev => prev.filter(c => c.user_id !== banTarget.user_id));
                }
            }
        } catch (error) {
            console.error('Error banning user:', error);
            toast.error(t('admin.banError'));
        } finally {
            setSubmitting(false);
        }
    };

    // Unban
    const handleUnban = async (banId: number, restore: boolean) => {
        try {
            const authToken = localStorage.getItem('auth_token');
            const response = await fetch(`${API_URL}/api/comments/admin/ban/${banId}?restore=${restore}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` },
            });
            if (response.ok) {
                const data = await response.json();
                setBans(prev => prev.filter(b => b.id !== banId));
                const msg = data.restoredCount > 0
                    ? `${t('admin.unbanSuccess')} (${data.restoredCount} ${t('admin.commentsRestored')})`
                    : t('admin.unbanSuccess');
                toast.success(msg);
            }
        } catch (error) {
            console.error('Error unbanning:', error);
            toast.error(t('admin.unbanError'));
        }
    };

    // Unban all
    const handleUnbanAll = async (restore: boolean) => {
        if (!confirm(restore ? t('admin.unbanAllRestoreConfirm') : t('admin.unbanAllConfirm'))) return;
        try {
            const authToken = localStorage.getItem('auth_token');
            const response = await fetch(`${API_URL}/api/comments/admin/bans?restore=${restore}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` },
            });
            if (response.ok) {
                const data = await response.json();
                setBans([]);
                const msg = data.restoredCount > 0
                    ? t('admin.unbanAllSuccess', { count: data.deletedCount }) + ` (${data.restoredCount} ${t('admin.commentsRestored')})`
                    : t('admin.unbanAllSuccess', { count: data.deletedCount });
                toast.success(msg);
            }
        } catch (error) {
            console.error('Error unbanning all:', error);
            toast.error(t('admin.genericError'));
        }
    };

    // Delete all by user
    const handleDeleteAllByUser = async (comment: Comment) => {
        if (!confirm(t('admin.deleteAllByUserConfirm', { username: comment.username }))) return;

        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const response = await fetch(`${API_URL}/api/comments/admin/delete-all-by-user`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ userId: comment.user_id, userType: comment.user_type }),
            });

            if (response.ok) {
                const data = await response.json();
                toast.success(t('admin.deleteAllSuccess', { count: (data.deletedComments || 0) + (data.deletedReplies || 0) }));
                setComments(prev => prev.filter(c => c.user_id !== comment.user_id));
            }
        } catch (error) {
            console.error('Error deleting all by user:', error);
            toast.error(t('admin.genericError'));
        } finally {
            setSubmitting(false);
        }
    };

    // Detect duplicates
    const handleDetectDuplicates = async () => {
        setDuplicatesLoading(true);
        setDuplicatesModalOpen(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const response = await fetch(`${API_URL}/api/comments/admin/detect-duplicates`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
            });
            if (response.ok) {
                const data = await response.json();
                const allGroups = [...(data.duplicates || [])];
                // Ajouter le groupe de polices Unicode spéciales en premier si présent
                if (data.fancyUnicode) {
                    allGroups.unshift(data.fancyUnicode);
                }
                setDuplicates(allGroups);
            }
        } catch (error) {
            console.error('Error detecting duplicates:', error);
        } finally {
            setDuplicatesLoading(false);
        }
    };

    // Delete duplicates group
    const handleDeleteDuplicates = async (group: DuplicateGroup, banAuthors: boolean) => {
        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const commentIds = group.comments.map(c => c.id);
            const response = await fetch(`${API_URL}/api/comments/admin/delete-duplicates`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    commentIds,
                    banAuthors,
                    banDuration: duplicateBanDuration,
                    banReason: t('admin.spamDuplicates'),
                }),
            });

            if (response.ok) {
                const data = await response.json();
                toast.success(t('admin.deleteDuplicatesSuccess', { deleted: data.deletedCount, banned: data.bannedCount }));
                setDuplicates(prev => prev.filter(d => d.content !== group.content));
                // Retirer les commentaires supprimés de la liste principale
                const deletedIds = new Set(commentIds);
                setComments(prev => prev.filter(c => !deletedIds.has(c.id)));
            }
        } catch (error) {
            console.error('Error deleting duplicates:', error);
            toast.error(t('admin.genericError'));
        } finally {
            setSubmitting(false);
        }
    };

    // Delete ALL duplicate groups at once
    const handleDeleteAllDuplicates = async (banAuthors: boolean) => {
        if (duplicates.length === 0) return;
        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const allCommentIds = duplicates.flatMap(g => g.comments.map(c => c.id));
            const response = await fetch(`${API_URL}/api/comments/admin/delete-duplicates`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    commentIds: allCommentIds,
                    banAuthors,
                    banDuration: duplicateBanDuration,
                    banReason: t('admin.spamDuplicates'),
                }),
            });

            if (response.ok) {
                const data = await response.json();
                toast.success(t('admin.deleteDuplicatesSuccess', { deleted: data.deletedCount, banned: data.bannedCount }));
                setDuplicates([]);
                const deletedIds = new Set(allCommentIds);
                setComments(prev => prev.filter(c => !deletedIds.has(c.id)));
            }
        } catch (error) {
            console.error('Error deleting all duplicates:', error);
            toast.error(t('admin.genericError'));
        } finally {
            setSubmitting(false);
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString(i18n.language, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const openBanModal = (comment: Comment) => {
        setBanTarget(comment);
        setBanType('user');
        setBanDuration('permanent');
        setBanReason(comment.moderation_reason || '');
        setBanDeleteAll(true);
        setBanModalOpen(true);
    };

    const visibleComments = useMemo(
        () => comments.slice(0, renderCount),
        [comments, renderCount]
    );
    const canRenderMoreComments = visibleComments.length < comments.length;
    const shouldUseCompactCommentRows = comments.length > ADMIN_COMMENTS_ANIMATION_THRESHOLD;
    const shouldAnimateCommentRows = !shouldUseCompactCommentRows;
    const shouldAnimateBanRows = bans.length <= ADMIN_COMMENTS_ANIMATION_THRESHOLD;
    const renderLegacyCommentRows = renderCount < 0;
    const handleLoadMoreComments = () => {
        if (canRenderMoreComments) {
            setRenderCount(prev => Math.min(prev + ADMIN_COMMENTS_RENDER_STEP, comments.length));
            return;
        }

        const nextPage = page + 1;
        void fetchComments({ pageOverride: nextPage });
    };

    const renderBanRow = (ban: BanEntry) => {
        const isExpired = ban.expires_at && ban.expires_at < Date.now();
        const rowContent = (
            <>
                <td className="p-4">
                    <Badge variant={ban.ban_type === 'ip' ? 'secondary' : 'rejected'} className="text-xs">
                        {ban.ban_type === 'ip' ? t('admin.banByIp') : t('admin.banByUser')}
                    </Badge>
                </td>
                <td className="p-4">
                    <div>
                        <p className="text-sm text-white font-medium">{ban.username || ban.ban_value}</p>
                        <p className="text-[10px] text-white/30 truncate max-w-[200px]" title={ban.ban_value}>
                            {ban.ban_type === 'ip' ? t('admin.ipAddress') : t('admin.userId')}: {ban.ban_value.substring(0, 16)}...
                        </p>
                    </div>
                </td>
                <td className="p-4">
                    <p className="text-xs text-white/70">{ban.reason || '-'}</p>
                </td>
                <td className="p-4">
                    <span className="text-xs text-white/50">{formatDate(ban.banned_at)}</span>
                </td>
                <td className="p-4">
                    {ban.expires_at ? (
                        <span className={`text-xs ${isExpired ? 'text-red-400' : 'text-amber-400'}`}>
                            {formatDate(ban.expires_at)}
                        </span>
                    ) : (
                        <Badge variant="rejected" className="text-[10px] bg-red-500/20 text-red-400 border-red-500/30">
                            {t('admin.permanentBan')}
                        </Badge>
                    )}
                </td>
                <td className="p-4">
                    <div className="flex items-center justify-end">
                        <AdminIconButton
                            compact={!shouldAnimateBanRows}
                            onClick={() => handleUnban(ban.id, true)}
                            className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 transition-colors"
                            title={t('admin.unbanAndRestore')}
                        >
                            <CheckCircle className="h-4 w-4 text-green-400" />
                        </AdminIconButton>
                        <AdminIconButton
                            compact={!shouldAnimateBanRows}
                            onClick={() => handleUnban(ban.id, false)}
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                            title={t('admin.unbanOnly')}
                        >
                            <Ban className="h-4 w-4 text-white opacity-40" />
                        </AdminIconButton>
                    </div>
                </td>
            </>
        );

        if (shouldAnimateBanRows) {
            return (
                <motion.tr
                    key={ban.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.18 }}
                    className={`border-b border-white/5 hover:bg-white/5 transition-colors ${isExpired ? 'opacity-50' : ''}`}
                >
                    {rowContent}
                </motion.tr>
            );
        }

        return (
            <tr
                key={ban.id}
                className={`border-b border-white/5 hover:bg-white/5 transition-colors ${isExpired ? 'opacity-50' : ''}`}
            >
                {rowContent}
            </tr>
        );
    };

    const renderCommentRow = (comment: Comment) => {
        const rowContent = (
            <>
                <td className="p-4">
                    <div className="flex items-center gap-3">
                        {comment.avatar ? (
                            <img
                                src={comment.avatar}
                                alt={comment.username}
                                className="w-10 h-10 object-cover rounded-full border border-white/10 shadow-md"
                            />
                        ) : (
                            <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center border border-white/10">
                                <span className="text-xs">{comment.username[0]}</span>
                            </div>
                        )}
                        <div>
                            <div className="flex items-center gap-1">
                                <p className="font-medium text-white">{comment.username}</p>
                                {!!comment.is_vip && <span title={t('admin.vipLabel')} className="text-amber-400 text-[10px] font-semibold">{t('admin.vipLabel')}</span>}
                                {!!comment.is_admin && <span title={t('admin.adminLabel')} className="text-red-500 text-[10px] font-semibold">{t('admin.adminLabel')}</span>}
                            </div>
                            <p className="text-[10px] text-white/30 truncate max-w-[100px]" title={comment.user_id}>
                                {t('admin.idLabel')}: {comment.user_id.substring(0, 8)}...
                            </p>
                        </div>
                    </div>
                </td>
                <td className="p-4">
                    <Link
                        to={comment.content_type === 'movie' ? `/movie/${comment.content_id}` : `/tv/${comment.content_id}`}
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                        {comment.poster_path ? (
                            <img
                                src={`https://image.tmdb.org/t/p/w92${comment.poster_path}`}
                                alt={comment.title}
                                className="w-8 h-12 object-cover rounded shadow-md"
                            />
                        ) : (
                            <div className="w-8 h-12 bg-white/10 rounded flex items-center justify-center">
                                {comment.content_type === 'movie' ? <Film className="h-4 w-4 text-white opacity-30" /> : <Tv className="h-4 w-4 text-white opacity-30" />}
                            </div>
                        )}
                        <div>
                            <p className="text-xs font-medium text-white line-clamp-1">{comment.title}</p>
                            <Badge variant={comment.content_type} className="text-[10px] py-0 h-4">
                                {comment.content_type === 'movie' ? t('admin.movie') : t('admin.tvShow')}
                            </Badge>
                        </div>
                    </Link>
                </td>
                <td className="p-4">
                    <div className="space-y-1">
                        {activeTab === 'moderated' && comment.moderation_reason && (
                            <div className="flex flex-col gap-1 mb-2">
                                <div className="flex items-center gap-2">
                                    <Badge variant="rejected" className="bg-red-500/20 text-red-400 border-red-500/30">
                                        {comment.moderation_reason}
                                    </Badge>
                                    <span className="text-[10px] text-white/40">{t('admin.generatedByGemini')}</span>
                                </div>
                                {comment.moderation_details && (
                                    <p className="text-xs text-white/60 bg-white/5 p-2 rounded border border-white/5">
                                        <Sparkles className="h-3 w-3 inline mr-1 text-amber-400" />
                                        {comment.moderation_details}
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="flex items-start gap-1.5">
                            <p className={`text-sm text-white/90 line-clamp-2 italic flex-1 ${activeTab === 'moderated' ? 'opacity-70' : ''}`}>
                                "{comment.content}"
                            </p>
                            {comment.content.length > 100 && (
                                <button
                                    onClick={() => setViewComment(comment)}
                                    className="flex-shrink-0 p-1 rounded-md bg-white/5 hover:bg-white/10 transition-colors mt-0.5"
                                    title={t('admin.viewFull')}
                                >
                                    <MoreHorizontal className="h-3.5 w-3.5 text-white opacity-50" />
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {!!comment.is_spoiler && (
                                <Badge variant="rejected" className="text-[8px] py-0 h-3">{t('common.spoiler')}</Badge>
                            )}
                            {activeTab === 'moderated' && comment.item_type === 'reply' && (
                                <Badge variant="secondary" className="text-[8px] py-0 h-3">{t('admin.reply')}</Badge>
                            )}
                            {!!comment.is_edited && (
                                <span className="text-[8px] text-white/30">{t('admin.edited')}</span>
                            )}
                        </div>
                    </div>
                </td>
                <td className="p-4 whitespace-nowrap">
                    {activeTab === 'live' ? (
                        <span className="text-white/50 text-xs">{formatDate(comment.created_at)}</span>
                    ) : (
                        <div className="space-y-0.5">
                            <span className="text-white/50 text-[11px] line-through block">{formatDate(comment.created_at)}</span>
                            <span className="text-amber-400/80 text-[10px] block">
                                {comment.moderated_at ? formatDate(comment.moderated_at) : t('common.notAvailable')}
                            </span>
                        </div>
                    )}
                </td>
                {activeTab === 'live' && (
                    <td className="p-4">
                        <div className="flex items-center gap-1">
                            <span className="text-white/70 text-sm">{comment.reaction_count}</span>
                            <span className="text-xs text-white/30">{t('common.like')}</span>
                        </div>
                    </td>
                )}
                <td className="p-4">
                    <div className="flex items-center justify-end gap-1">
                        {activeTab === 'moderated' ? (
                            <>
                                <AdminIconButton
                                    compact={shouldUseCompactCommentRows}
                                    onClick={() => handleApprove(comment)}
                                    className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 transition-colors"
                                    title={t('admin.approveVisible')}
                                    disabled={submitting}
                                >
                                    <CheckCircle className="h-4 w-4 text-green-400" />
                                </AdminIconButton>
                                <AdminIconButton
                                    compact={shouldUseCompactCommentRows}
                                    onClick={() => handlePermanentDelete(comment)}
                                    className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                                    title={t('admin.deletePermanently')}
                                    disabled={submitting}
                                >
                                    <Trash2 className="h-4 w-4 text-red-400" />
                                </AdminIconButton>
                            </>
                        ) : (
                            <AdminIconButton
                                compact={shouldUseCompactCommentRows}
                                onClick={() => {
                                    setSelectedComment(comment);
                                    setDeleteModalOpen(true);
                                }}
                                className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                                title={t('admin.delete')}
                            >
                                <Trash2 className="h-4 w-4 text-red-400" />
                            </AdminIconButton>
                        )}
                        <AdminIconButton
                            compact={shouldUseCompactCommentRows}
                            onClick={() => openBanModal(comment)}
                            className="p-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 transition-colors"
                            title={t('admin.banUser')}
                        >
                            <Ban className="h-4 w-4 text-orange-400" />
                        </AdminIconButton>
                        <AdminIconButton
                            compact={shouldUseCompactCommentRows}
                            onClick={() => handleDeleteAllByUser(comment)}
                            className="p-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 transition-colors"
                            title={t('admin.deleteAllByUser')}
                            disabled={submitting}
                        >
                            <UserX className="h-4 w-4 text-purple-400" />
                        </AdminIconButton>
                    </div>
                </td>
            </>
        );

        const rowKey = `${comment.id}-${comment.item_type || 'comment'}`;

        if (shouldAnimateCommentRows) {
            return (
                <motion.tr
                    key={rowKey}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.18 }}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors group"
                >
                    {rowContent}
                </motion.tr>
            );
        }

        return (
            <tr key={rowKey} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                {rowContent}
            </tr>
        );
    };

    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: t('admin.totalComments'), value: stats?.total ?? 0, color: 'text-white' },
                    { label: t('admin.movies'), value: stats?.movies ?? 0, color: 'text-blue-400' },
                    { label: t('admin.tvShows'), value: stats?.tv ?? 0, color: 'text-purple-400' },
                    { label: t('admin.reports'), value: stats?.reports ?? 0, color: 'text-red-400' },
                    { label: t('admin.autoModeration'), value: stats?.moderated ?? 0, color: 'text-amber-400' },
                ].map((stat) => (
                    <motion.div
                        key={stat.label}
                        whileHover={{ scale: 1.02 }}
                        className="bg-white/5 rounded-lg p-4 border border-white/10"
                    >
                        <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                        <p className="text-xs text-white/50">{stat.label}</p>
                    </motion.div>
                ))}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-4 bg-white/5 p-1 rounded-lg w-fit border border-white/10">
                <button
                    onClick={() => setActiveTab('live')}
                    className={`group/icon px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'live'
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <MessageSquare className={`h-4 w-4 transition-[color,opacity] ${(activeTab === 'live' ? "text-white opacity-100" : "text-white opacity-60 group-hover/icon:opacity-100")}`} />
                        Commentaires
                    </div>
                </button>
                <button
                    onClick={() => setActiveTab('moderated')}
                    className={`group/icon px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'moderated'
                        ? 'bg-amber-600 text-white shadow-lg'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <Sparkles className={`h-4 w-4 transition-[color,opacity] ${(activeTab === 'moderated' ? "text-white opacity-100" : "text-white opacity-60 group-hover/icon:opacity-100")}`} />
                        {t('admin.geminiModeration')}
                        {(stats?.moderated ?? 0) > 0 && (
                            <span className="bg-white/20 text-white px-1.5 py-0.5 rounded-full text-[10px]">
                                {stats.moderated}
                            </span>
                        )}
                    </div>
                </button>
                <button
                    onClick={() => setActiveTab('bans')}
                    className={`group/icon px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'bans'
                        ? 'bg-red-600 text-white shadow-lg'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <Ban className={`h-4 w-4 transition-[color,opacity] ${(activeTab === 'bans' ? "text-white opacity-100" : "text-white opacity-60 group-hover/icon:opacity-100")}`} />
                        {t('admin.bans')}
                    </div>
                </button>
            </div>

            {/* Filters */}
            {activeTab !== 'bans' && (
                <div className="flex flex-wrap items-center gap-4">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white opacity-40" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('admin.searchByTextUsernameId')}
                            className="pl-10"
                        />
                    </div>

                    <Select value={contentTypeFilter} onValueChange={setContentTypeFilter}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder={t('admin.contentType')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t('admin.allTypes')}</SelectItem>
                            <SelectItem value="movie">{t('admin.movies')}</SelectItem>
                            <SelectItem value="tv">{t('admin.tvShows')}</SelectItem>
                        </SelectContent>
                    </Select>

                    <Button variant="secondary" onClick={() => fetchComments({ reset: true, pageOverride: 1 })} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        {t('admin.refresh')}
                    </Button>

                    <Button variant="secondary" onClick={handleDetectDuplicates} disabled={duplicatesLoading}>
                        <Copy className={`h-4 w-4 mr-2 ${duplicatesLoading ? 'animate-spin' : ''}`} />
                        {t('admin.detectDuplicates')}
                    </Button>

                    {comments.length > 0 && (
                        <span className="text-xs text-white/40 whitespace-nowrap">
                            {visibleComments.length}/{comments.length} affiches
                        </span>
                    )}
                </div>
            )}

            {/* Bans filters */}
            {activeTab === 'bans' && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    <div className="relative flex-1 w-full sm:max-w-xs">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white opacity-30" />
                        <Input
                            placeholder={t('admin.searchBans')}
                            value={bansSearch}
                            onChange={(e) => setBansSearch(e.target.value)}
                            className="pl-9 bg-white/5 border-white/10 text-white"
                        />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer whitespace-nowrap">
                        <input
                            type="checkbox"
                            checked={showExpiredBans}
                            onChange={(e) => setShowExpiredBans(e.target.checked)}
                            className="rounded border-white/20 bg-white/5"
                        />
                        {t('admin.showExpired')}
                    </label>
                    {bansTotal > 0 && (
                        <span className="text-xs text-white/40">{bans.length}/{bansTotal}</span>
                    )}
                    <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => fetchBans(true)} disabled={bansLoading}>
                            <RefreshCw className={`h-4 w-4 mr-1.5 ${bansLoading ? 'animate-spin' : ''}`} />
                            {t('admin.refresh')}
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleUnbanAll(true)}>
                            <CheckCircle className="h-4 w-4 mr-1.5" />
                            {t('admin.unbanAllRestore')}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleUnbanAll(false)}>
                            <Trash2 className="h-4 w-4 mr-1.5" />
                            {t('admin.unbanAll')}
                        </Button>
                    </div>
                </div>
            )}

            {/* === BANS TAB === */}
            {activeTab === 'bans' && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="bg-white/5 rounded-lg border border-white/10 overflow-hidden"
                >
                    {bansLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-red-500" />
                        </div>
                    ) : bans.length === 0 ? (
                        <div className="text-center py-20">
                            <Shield className="h-12 w-12 text-white opacity-20 mx-auto mb-4" />
                            <p className="text-white/50">{t('admin.noBansFound')}</p>
                        </div>
                    ) : (
                        <div className="overflow-auto max-h-[72vh] custom-scrollbar" data-lenis-prevent>
                            <table className="w-full min-w-[800px]">
                                <thead>
                                    <tr className="border-b border-white/10 bg-white/5">
                                        <th className="text-left p-4 text-sm font-medium text-white/70">{t('admin.banType')}</th>
                                        <th className="text-left p-4 text-sm font-medium text-white/70">{t('admin.user')}</th>
                                        <th className="text-left p-4 text-sm font-medium text-white/70">{t('admin.banReason')}</th>
                                        <th className="text-left p-4 text-sm font-medium text-white/70">{t('admin.bannedSince')}</th>
                                        <th className="text-left p-4 text-sm font-medium text-white/70">{t('admin.expiresAt')}</th>
                                        <th className="text-right p-4 text-sm font-medium text-white/70">{t('admin.actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <AnimatePresence mode='popLayout'>
                                        {bans.map(renderBanRow)}
                                    </AnimatePresence>
                                </tbody>
                            </table>
                        </div>
                    )}
                    {/* Pagination bans */}
                    {bansTotal > 30 && (
                        <div className="flex items-center justify-between p-4 border-t border-white/5">
                            <span className="text-xs text-white/40">
                                {t('admin.page')} {bansPage}/{Math.ceil(bansTotal / 30)} ({bansTotal} {t('admin.total')})
                            </span>
                            <div className="flex gap-2">
                                <Button variant="secondary" size="sm" disabled={bansPage <= 1 || bansLoading} onClick={() => setBansPage(p => p - 1)}>
                                    {t('admin.previous')}
                                </Button>
                                <Button variant="secondary" size="sm" disabled={!bansHasMore || bansLoading} onClick={() => setBansPage(p => p + 1)}>
                                    {t('admin.next')}
                                </Button>
                            </div>
                        </div>
                    )}
                </motion.div>
            )}

            {/* === COMMENTS / MODERATED TAB === */}
            {activeTab !== 'bans' && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="bg-white/5 rounded-lg border border-white/10 overflow-hidden"
                >
                    {loading && comments.length === 0 ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                        </div>
                    ) : comments.length === 0 ? (
                        <div className="text-center py-20">
                            <MessageSquare className="h-12 w-12 text-white opacity-20 mx-auto mb-4" />
                            <p className="text-white/50">{t('admin.noCommentsFound')}</p>
                        </div>
                    ) : (
                        <div className="overflow-auto max-h-[72vh] custom-scrollbar" data-lenis-prevent>
                            <table className="w-full min-w-[900px] table-fixed">
                                <colgroup>
                                    <col className="w-[180px]" />
                                    <col className="w-[160px]" />
                                    <col />
                                    <col className="w-[130px]" />
                                    {activeTab === 'live' && <col className="w-[80px]" />}
                                    <col className="w-[140px]" />
                                </colgroup>
                                <thead>
                                    <tr className="border-b border-white/10 bg-white/5">
                                        <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70">{t('admin.user')}</th>
                                        <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70">{t('admin.content')}</th>
                                        <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70">
                                            {activeTab === 'live' ? t('admin.comment') : t('admin.messageAndReason')}
                                        </th>
                                        <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70 whitespace-nowrap">{t('admin.date')}</th>
                                        {activeTab === 'live' && <th className="sticky top-0 z-20 bg-black/95 text-left p-4 text-sm font-medium text-white/70">{t('admin.reactions')}</th>}
                                        <th className="sticky top-0 z-20 bg-black/95 text-right p-4 text-sm font-medium text-white/70">{t('admin.actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <AnimatePresence mode='popLayout'>
                                        {visibleComments.map(renderCommentRow)}
                                        {renderLegacyCommentRows && comments.map((comment, index) => (
                                            <motion.tr
                                                key={`${comment.id}-${comment.item_type || 'comment'}`}
                                                initial={{ opacity: 0, x: -20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, x: -20 }}
                                                transition={{ duration: 0.2, delay: index * 0.02 }}
                                                className="border-b border-white/5 hover:bg-white/5 transition-colors group"
                                            >
                                                <td className="p-4">
                                                    <div className="flex items-center gap-3">
                                                        {comment.avatar ? (
                                                            <img
                                                                src={comment.avatar}
                                                                alt={comment.username}
                                                                className="w-10 h-10 object-cover rounded-full border border-white/10 shadow-md"
                                                            />
                                                        ) : (
                                                            <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center border border-white/10">
                                                                <span className="text-xs">{comment.username[0]}</span>
                                                            </div>
                                                        )}
                                                        <div>
                                                            <div className="flex items-center gap-1">
                                                                <p className="font-medium text-white">{comment.username}</p>
                                                                {!!comment.is_vip && <span title={t('admin.vipLabel')} className="text-amber-400 text-xs">⭐</span>}
                                                                {!!comment.is_admin && <span title={t('admin.adminLabel')} className="text-red-500 text-xs">🛡️</span>}
                                                            </div>
                                                            <p className="text-[10px] text-white/30 truncate max-w-[100px]" title={comment.user_id}>
                                                                {t('admin.idLabel')}: {comment.user_id.substring(0, 8)}...
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <Link
                                                        to={comment.content_type === 'movie' ? `/movie/${comment.content_id}` : `/tv/${comment.content_id}`}
                                                        className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                                                    >
                                                        {comment.poster_path ? (
                                                            <img
                                                                src={`https://image.tmdb.org/t/p/w92${comment.poster_path}`}
                                                                alt={comment.title}
                                                                className="w-8 h-12 object-cover rounded shadow-md"
                                                            />
                                                        ) : (
                                                            <div className="w-8 h-12 bg-white/10 rounded flex items-center justify-center">
                                                                {comment.content_type === 'movie' ? <Film className="h-4 w-4 text-white opacity-30" /> : <Tv className="h-4 w-4 text-white opacity-30" />}
                                                            </div>
                                                        )}
                                                        <div>
                                                            <p className="text-xs font-medium text-white line-clamp-1">{comment.title}</p>
                                                            <Badge variant={comment.content_type} className="text-[10px] py-0 h-4">
                                                                {comment.content_type === 'movie' ? t('admin.movie') : t('admin.tvShow')}
                                                            </Badge>
                                                        </div>
                                                    </Link>
                                                </td>
                                                <td className="p-4">
                                                    <div className="space-y-1">
                                                        {activeTab === 'moderated' && comment.moderation_reason && (
                                                            <div className="flex flex-col gap-1 mb-2">
                                                                <div className="flex items-center gap-2">
                                                                    <Badge variant="rejected" className="bg-red-500/20 text-red-400 border-red-500/30">
                                                                        {comment.moderation_reason}
                                                                    </Badge>
                                                                    <span className="text-[10px] text-white/40">{t('admin.generatedByGemini')}</span>
                                                                </div>
                                                                {comment.moderation_details && (
                                                                    <p className="text-xs text-white/60 bg-white/5 p-2 rounded border border-white/5">
                                                                        <Sparkles className="h-3 w-3 inline mr-1 text-amber-400" />
                                                                        {comment.moderation_details}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}

                                                        <div className="flex items-start gap-1.5">
                                                            <p className={`text-sm text-white/90 line-clamp-2 italic flex-1 ${activeTab === 'moderated' ? 'opacity-70' : ''}`}>
                                                                "{comment.content}"
                                                            </p>
                                                            {comment.content.length > 100 && (
                                                                <button
                                                                    onClick={() => setViewComment(comment)}
                                                                    className="flex-shrink-0 p-1 rounded-md bg-white/5 hover:bg-white/10 transition-colors mt-0.5"
                                                                    title={t('admin.viewFull')}
                                                                >
                                                                    <MoreHorizontal className="h-3.5 w-3.5 text-white opacity-50" />
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {!!comment.is_spoiler && (
                                                                <Badge variant="rejected" className="text-[8px] py-0 h-3">{t('common.spoiler')}</Badge>
                                                            )}
                                                            {activeTab === 'moderated' && comment.item_type === 'reply' && (
                                                                <Badge variant="secondary" className="text-[8px] py-0 h-3">{t('admin.reply')}</Badge>
                                                            )}
                                                            {!!comment.is_edited && (
                                                                <span className="text-[8px] text-white/30">{t('admin.edited')}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-4 whitespace-nowrap">
                                                    {activeTab === 'live' ? (
                                                        <span className="text-white/50 text-xs">{formatDate(comment.created_at)}</span>
                                                    ) : (
                                                        <div className="space-y-0.5">
                                                            <span className="text-white/50 text-[11px] line-through block">{formatDate(comment.created_at)}</span>
                                                            <span className="text-amber-400/80 text-[10px] block">
                                                                {comment.moderated_at ? formatDate(comment.moderated_at) : 'N/A'}
                                                            </span>
                                                        </div>
                                                    )}
                                                </td>
                                                {activeTab === 'live' && (
                                                    <td className="p-4">
                                                        <div className="flex items-center gap-1">
                                                            <span className="text-white/70 text-sm">{comment.reaction_count}</span>
                                                            <span className="text-xs text-white/30">👍</span>
                                                        </div>
                                                    </td>
                                                )}
                                                <td className="p-4">
                                                    <div className="flex items-center justify-end gap-1">
                                                        {activeTab === 'moderated' ? (
                                                            <>
                                                                <motion.button
                                                                    whileHover={{ scale: 1.1 }}
                                                                    whileTap={{ scale: 0.9 }}
                                                                    onClick={() => handleApprove(comment)}
                                                                    className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 transition-colors"
                                                                    title={t('admin.approveVisible')}
                                                                    disabled={submitting}
                                                                >
                                                                    <CheckCircle className="h-4 w-4 text-green-400" />
                                                                </motion.button>
                                                                <motion.button
                                                                    whileHover={{ scale: 1.1 }}
                                                                    whileTap={{ scale: 0.9 }}
                                                                    onClick={() => handlePermanentDelete(comment)}
                                                                    className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                                                                    title={t('admin.deletePermanently')}
                                                                    disabled={submitting}
                                                                >
                                                                    <Trash2 className="h-4 w-4 text-red-400" />
                                                                </motion.button>
                                                            </>
                                                        ) : (
                                                            <motion.button
                                                                whileHover={{ scale: 1.1 }}
                                                                whileTap={{ scale: 0.9 }}
                                                                onClick={() => {
                                                                    setSelectedComment(comment);
                                                                    setDeleteModalOpen(true);
                                                                }}
                                                                className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                                                                title={t('admin.delete')}
                                                            >
                                                                <Trash2 className="h-4 w-4 text-red-400" />
                                                            </motion.button>
                                                        )}
                                                        {/* Ban button */}
                                                        <motion.button
                                                            whileHover={{ scale: 1.1 }}
                                                            whileTap={{ scale: 0.9 }}
                                                            onClick={() => openBanModal(comment)}
                                                            className="p-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 transition-colors"
                                                            title={t('admin.banUser')}
                                                        >
                                                            <Ban className="h-4 w-4 text-orange-400" />
                                                        </motion.button>
                                                        {/* Delete all by user button */}
                                                        <motion.button
                                                            whileHover={{ scale: 1.1 }}
                                                            whileTap={{ scale: 0.9 }}
                                                            onClick={() => handleDeleteAllByUser(comment)}
                                                            className="p-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 transition-colors"
                                                            title={t('admin.deleteAllByUser')}
                                                            disabled={submitting}
                                                        >
                                                            <UserX className="h-4 w-4 text-purple-400" />
                                                        </motion.button>
                                                    </div>
                                                </td>
                                            </motion.tr>
                                        ))}
                                    </AnimatePresence>
                                </tbody>
                            </table>
                        </div>
                    )}

                    {(canRenderMoreComments || hasMore) && (
                        <div className="p-4 flex flex-wrap justify-center gap-3 border-t border-white/10">
                            <Button
                                variant={canRenderMoreComments ? 'secondary' : 'ghost'}
                                onClick={handleLoadMoreComments}
                                disabled={loading}
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                {canRenderMoreComments
                                    ? `Afficher ${Math.min(ADMIN_COMMENTS_RENDER_STEP, comments.length - visibleComments.length)} de plus`
                                    : t('admin.loadMoreComments')}
                            </Button>
                        </div>
                    )}

                    {renderLegacyCommentRows && hasMore && (
                        <div className="p-4 flex justify-center border-t border-white/10">
                            <Button className="group/icon"
                                variant="ghost"
                                onClick={() => {
                                    setPage(prev => prev + 1);
                                    fetchComments({ pageOverride: page + 1 });
                                }}
                                disabled={loading}
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2 text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" /> : null}
                                {t('admin.loadMoreComments')}
                            </Button>
                        </div>
                    )}
                </motion.div>
            )}

            {/* Delete Modal */}
            <ReusableModal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title={t('admin.deleteComment')}
            >
                <div className="space-y-6">
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm text-red-200 font-medium">{t('admin.irreversibleAction')}</p>
                            <p className="text-xs text-red-100/70">
                                {t('admin.deleteCommentWarning')}
                            </p>
                        </div>
                    </div>

                    <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                        <p className="text-xs text-white/50 mb-1">{t('admin.commentBy', { username: selectedComment?.username })} :</p>
                        <p className="text-sm italic text-white/80">"{selectedComment?.content}"</p>
                    </div>

                    <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
                        <Button variant="ghost" onClick={() => setDeleteModalOpen(false)}>
                            {t('admin.cancel')}
                        </Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {t('admin.deletePermanently')}
                        </Button>
                    </div>
                </div>
            </ReusableModal>

            {/* Ban Modal */}
            <ReusableModal
                isOpen={banModalOpen}
                onClose={() => setBanModalOpen(false)}
                title={t('admin.banUser')}
            >
                <div className="space-y-5">
                    {/* User info */}
                    {banTarget && (
                        <div className="bg-white/5 p-3 rounded-lg border border-white/10 flex items-center gap-3">
                            {banTarget.avatar ? (
                                <img src={banTarget.avatar} alt={banTarget.username} className="w-10 h-10 rounded-full border border-white/10" />
                            ) : (
                                <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center border border-white/10">
                                    <span className="text-sm">{banTarget.username[0]}</span>
                                </div>
                            )}
                            <div>
                                <p className="text-sm text-white font-medium">{banTarget.username}</p>
                                <p className="text-[10px] text-white/30">{t('admin.idLabel')}: {banTarget.user_id}</p>
                                {banTarget.ip_address && (
                                    <p className="text-[10px] text-white/30">{t('admin.ipLabel')}: {banTarget.ip_address}</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Ban type */}
                    <div>
                        <label className="text-xs text-white/60 mb-2 block">{t('admin.banType')}</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setBanType('user')}
                                className={`group/icon flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${banType === 'user'
                                    ? 'bg-red-500/20 border-red-500/30 text-red-300'
                                    : 'bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10'
                                    }`}
                            >
                                <UserX className={`h-4 w-4 inline mr-2 transition-[color,opacity] ${(banType === 'user' ? "text-red-300 opacity-100" : "text-white opacity-50 group-hover/icon:opacity-100")}`} />
                                {t('admin.banByUser')}
                            </button>
                            <button
                                onClick={() => setBanType('ip')}
                                disabled={!banTarget?.ip_address}
                                className={`group/icon flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${banType === 'ip'
                                    ? 'bg-red-500/20 border-red-500/30 text-red-300'
                                    : !banTarget?.ip_address
                                        ? 'bg-white/5 border-white/10 text-white/20 cursor-not-allowed'
                                        : 'bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10'
                                    }`}
                            >
                                <Shield className={`h-4 w-4 inline mr-2 transition-[color,opacity] ${(banType === 'ip' ? "text-red-300 opacity-100" : (!banTarget?.ip_address ? "text-white opacity-20" : "text-white opacity-50 group-hover/icon:opacity-100"))}`} />
                                {t('admin.banByIp')}
                                {!banTarget?.ip_address && <span className="text-[9px] block text-white/20 mt-0.5">{t('admin.ipUnavailable')}</span>}
                            </button>
                        </div>
                    </div>

                    {/* Duration */}
                    <div>
                        <label className="text-xs text-white/60 mb-2 block">{t('admin.banDuration')}</label>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { value: '1h', label: t('admin.ban1h') },
                                { value: '24h', label: t('admin.ban24h') },
                                { value: '7d', label: t('admin.ban7d') },
                                { value: '30d', label: t('admin.ban30d') },
                                { value: 'permanent', label: t('admin.banPermanent') },
                            ].map(({ value, label }) => (
                                <button
                                    key={value}
                                    onClick={() => setBanDuration(value)}
                                    className={`group/icon px-3 py-2 rounded-lg text-xs font-medium transition-all border ${banDuration === value
                                        ? value === 'permanent' ? 'bg-red-500/30 border-red-500/40 text-red-300' : 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                                        : 'bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10'
                                        }`}
                                >
                                    <Clock className={`h-3 w-3 inline mr-1 transition-[color,opacity] ${(banDuration === value ? (value === 'permanent' ? "text-red-300 opacity-100" : "text-amber-300 opacity-100") : "text-white opacity-50 group-hover/icon:opacity-100")}`} />
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Reason */}
                    <div>
                        <label className="text-xs text-white/60 mb-2 block">{t('admin.banReason')}</label>
                        <Input
                            value={banReason}
                            onChange={(e) => setBanReason(e.target.value)}
                            placeholder={t('admin.banReasonPlaceholder')}
                        />
                    </div>

                    {/* Delete all checkbox */}
                    <label className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10 cursor-pointer hover:bg-white/10 transition-colors">
                        <input
                            type="checkbox"
                            checked={banDeleteAll}
                            onChange={(e) => setBanDeleteAll(e.target.checked)}
                            className="rounded border-white/20 bg-white/5"
                        />
                        <div>
                            <p className="text-sm text-white">{t('admin.deleteAllComments')}</p>
                            <p className="text-[10px] text-white/40">{t('admin.deleteAllByUser')}</p>
                        </div>
                    </label>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
                        <Button variant="ghost" onClick={() => setBanModalOpen(false)}>
                            {t('admin.cancel')}
                        </Button>
                        <Button variant="destructive" onClick={handleBan} disabled={submitting}>
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Ban className="h-4 w-4 mr-2" />}
                            {t('admin.confirmBan')}
                        </Button>
                    </div>
                </div>
            </ReusableModal>

            {/* Duplicates Modal */}
            <ReusableModal
                isOpen={duplicatesModalOpen}
                onClose={() => setDuplicatesModalOpen(false)}
                title={t('admin.detectDuplicates')}
            >
                <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                    {duplicatesLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                        </div>
                    ) : duplicates.length === 0 ? (
                        <div className="text-center py-12">
                            <CheckCircle className="h-12 w-12 text-green-400 opacity-30 mx-auto mb-4" />
                            <p className="text-white/50">{t('admin.noDuplicatesFound')}</p>
                        </div>
                    ) : (
                        <>
                            <p className="text-sm text-white/60">
                                {t('admin.duplicatesFound', { count: duplicates.length })}
                            </p>

                            {/* Ban duration for duplicates */}
                            <div>
                                <label className="text-xs text-white/60 mb-2 block">{t('admin.banDuration')}</label>
                                <Select value={duplicateBanDuration} onValueChange={setDuplicateBanDuration}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1h">{t('admin.ban1h')}</SelectItem>
                                        <SelectItem value="24h">{t('admin.ban24h')}</SelectItem>
                                        <SelectItem value="7d">{t('admin.ban7d')}</SelectItem>
                                        <SelectItem value="30d">{t('admin.ban30d')}</SelectItem>
                                        <SelectItem value="permanent">{t('admin.banPermanent')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Bulk actions for all duplicates */}
                            <div className="flex items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10">
                                <span className="text-xs text-white/50 mr-auto">
                                    {duplicates.reduce((acc, g) => acc + g.count, 0)} commentaires au total
                                </span>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => handleDeleteAllDuplicates(true)}
                                    disabled={submitting}
                                >
                                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Ban className="h-3.5 w-3.5 mr-1.5" />}
                                    {t('admin.deleteAndBanAll')}
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleDeleteAllDuplicates(false)}
                                    disabled={submitting}
                                >
                                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                                    {t('admin.deleteAllOnly')}
                                </Button>
                            </div>

                            {duplicates.map((group, index) => (
                                <motion.div
                                    key={index}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                    className={`bg-white/5 rounded-lg border p-4 space-y-3 ${group.isFancyUnicode ? 'border-yellow-500/50' : 'border-white/10'}`}
                                >
                                    {/* Duplicate content */}
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Badge variant="rejected" className="text-xs">
                                                    {t('admin.duplicateGroup', { count: group.count })}
                                                </Badge>
                                                {group.isFancyUnicode && (
                                                    <Badge className="text-xs bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                                                        Unicode Spam
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-sm text-white/80 italic">"{group.content}"</p>
                                        </div>
                                    </div>

                                    {/* Authors list with individual content */}
                                    <div className="flex flex-wrap gap-2">
                                        {group.comments.map((c) => (
                                            <div key={c.id} className="flex items-center gap-1.5 bg-white/5 rounded-full px-2 py-1 border border-white/10" title={c.content || group.content}>
                                                {c.avatar ? (
                                                    <img src={c.avatar} alt={c.username} className="w-4 h-4 rounded-full" />
                                                ) : (
                                                    <div className="w-4 h-4 bg-white/20 rounded-full flex items-center justify-center">
                                                        <span className="text-[8px]">{c.username[0]}</span>
                                                    </div>
                                                )}
                                                <span className="text-[10px] text-white/70">{c.username}</span>
                                                {c.content && c.content !== group.content && (
                                                    <span className="text-[9px] text-white/40 max-w-[120px] truncate">: {c.content}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            onClick={() => handleDeleteDuplicates(group, true)}
                                            disabled={submitting}
                                            className="text-xs"
                                        >
                                            <Ban className="h-3 w-3 mr-1" />
                                            {t('admin.deleteAndBan')}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => handleDeleteDuplicates(group, false)}
                                            disabled={submitting}
                                            className="text-xs"
                                        >
                                            <Trash2 className="h-3 w-3 mr-1" />
                                            {t('admin.deleteOnly')}
                                        </Button>
                                    </div>
                                </motion.div>
                            ))}
                        </>
                    )}
                </div>
            </ReusableModal>

            {/* View full comment modal */}
            <ReusableModal
                isOpen={!!viewComment}
                onClose={() => setViewComment(null)}
                title={t('admin.fullComment')}
            >
                {viewComment && (
                    <div className="space-y-4">
                        {/* Author info */}
                        <div className="flex items-center gap-3">
                            {viewComment.avatar ? (
                                <img src={viewComment.avatar} alt="" className="w-8 h-8 rounded-full" />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">
                                    {viewComment.username?.charAt(0).toUpperCase()}
                                </div>
                            )}
                            <div>
                                <p className="text-sm font-semibold text-white">{viewComment.username}</p>
                                <p className="text-[10px] text-white/40">{formatDate(viewComment.created_at)}</p>
                            </div>
                            {viewComment.title && (
                                <Badge variant="secondary" className="ml-auto text-[10px]">
                                    {viewComment.content_type === 'movie' ? <Film className="h-3 w-3 mr-1" /> : <Tv className="h-3 w-3 mr-1" />}
                                    {viewComment.title}
                                </Badge>
                            )}
                        </div>

                        {/* Moderation info */}
                        {viewComment.moderation_reason && (
                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-2">
                                <div className="flex items-center gap-2">
                                    <Badge variant="rejected" className="bg-red-500/20 text-red-400 border-red-500/30">
                                        {viewComment.moderation_reason}
                                    </Badge>
                                    <span className="text-[10px] text-white/40">{t('admin.generatedByGemini')}</span>
                                </div>
                                {viewComment.moderation_details && (
                                    <p className="text-xs text-white/60">
                                        <Sparkles className="h-3 w-3 inline mr-1 text-amber-400" />
                                        {viewComment.moderation_details}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Full comment */}
                        <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                            <p className="text-sm text-white/90 italic whitespace-pre-wrap break-words">
                                "{viewComment.content}"
                            </p>
                        </div>

                        {/* Actions */}
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    void copyText(viewComment.content).then((copied) => {
                                        if (copied) toast.success(t('admin.copied'));
                                    });
                                }}
                            >
                                <Copy className="h-3.5 w-3.5 mr-1.5" />
                                {t('admin.copy')}
                            </Button>
                            {activeTab === 'moderated' && (
                                <Button
                                    variant="default"
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-500"
                                    onClick={() => {
                                        handleApprove(viewComment);
                                        setViewComment(null);
                                    }}
                                >
                                    <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                                    {t('admin.approve')}
                                </Button>
                            )}
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                    setSelectedComment(viewComment);
                                    setDeleteModalOpen(true);
                                    setViewComment(null);
                                }}
                            >
                                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                                {t('admin.delete')}
                            </Button>
                        </div>
                    </div>
                )}
            </ReusableModal>
        </div>
    );
};

export default AdminComments;
