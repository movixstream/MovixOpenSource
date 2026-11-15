import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Trash2, Loader2, RefreshCw, List, AlertCircle, CheckCircle, Sparkles, ExternalLink, Globe
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import ReusableModal from './ui/reusable-modal';

interface SharedListItem {
    id: number;
    type: 'movie' | 'tv' | 'collection';
    title?: string;
    name?: string;
    poster_path?: string;
}

interface SharedList {
    id: number;
    shareCode: string;
    userId: string;
    userType: string;
    profileId: string;
    listId: string;
    createdAt: number;
    updatedAt: number;
    moderatedAt?: number;
    moderationReason?: string;
    moderationDetails?: string;
    username: string;
    avatar: string | null;
    isVip?: boolean;
    listName: string;
    itemCount: number;
    items: SharedListItem[];
}

interface AdminStats {
    total: number;
    publicCount: number;
    moderatedCount: number;
}

const AdminSharedLists: React.FC = () => {
    const { t, i18n } = useTranslation();
    const [lists, setLists] = useState<SharedList[]>([]);
    const [stats, setStats] = useState<AdminStats>({ total: 0, publicCount: 0, moderatedCount: 0 });
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'public' | 'moderated'>('public');
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Modal states
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [selectedList, setSelectedList] = useState<SharedList | null>(null);

    const API_URL = import.meta.env.VITE_MAIN_API || '';

    const fetchLists = useCallback(async (isNewSearch = false) => {
        setLoading(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const currentPage = isNewSearch ? 1 : page;
            const params = new URLSearchParams();
            params.append('page', currentPage.toString());
            params.append('limit', '50');

            const endpoint = activeTab === 'public'
                ? `${API_URL}/api/shared-lists/admin/public`
                : `${API_URL}/api/shared-lists/admin/moderated`;

            const response = await fetch(`${endpoint}?${params}`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
            });

            if (response.ok) {
                const data = await response.json();
                const fetchedLists = data.lists || [];

                if (isNewSearch) {
                    setLists(fetchedLists);
                    setPage(1);
                } else {
                    setLists(prev => [...prev, ...fetchedLists]);
                }

                if (data.stats) {
                    setStats(data.stats);
                }

                setHasMore(data.hasMore || false);
            }
        } catch (error) {
            console.error('Error fetching admin shared lists:', error);
        } finally {
            setLoading(false);
        }
    }, [API_URL, page, activeTab]);

    useEffect(() => {
        fetchLists(true);
    }, [activeTab]);

    // Approve moderated list
    const handleApprove = async (list: SharedList) => {
        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const response = await fetch(`${API_URL}/api/shared-lists/admin/moderated/${list.id}/approve`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${authToken}` },
            });

            if (response.ok) {
                setLists(prev => prev.filter(l => l.id !== list.id));
                setStats(prev => ({ ...prev, moderatedCount: Math.max(0, prev.moderatedCount - 1), publicCount: prev.publicCount + 1 }));
            }
        } catch (error) {
            console.error('Error approving list:', error);
        } finally {
            setSubmitting(false);
        }
    };

    // Delete list (from public tab)
    const handleDelete = async () => {
        if (!selectedList) return;
        setSubmitting(true);
        try {
            const authToken = localStorage.getItem('auth_token');
            const endpoint = activeTab === 'moderated'
                ? `${API_URL}/api/shared-lists/admin/moderated/${selectedList.id}`
                : `${API_URL}/api/shared-lists/admin/public/${selectedList.id}`;

            const response = await fetch(endpoint, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` },
            });

            if (response.ok) {
                setLists(prev => prev.filter(l => l.id !== selectedList.id));
                setDeleteModalOpen(false);
                if (activeTab === 'public') {
                    setStats(prev => ({ ...prev, publicCount: Math.max(0, prev.publicCount - 1), total: Math.max(0, prev.total - 1) }));
                } else {
                    setStats(prev => ({ ...prev, moderatedCount: Math.max(0, prev.moderatedCount - 1), total: Math.max(0, prev.total - 1) }));
                }
            }
        } catch (error) {
            console.error('Error deleting list:', error);
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

    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                    { label: t('admin.totalSharedLists'), value: stats.total, color: 'text-white' },
                    { label: t('admin.publicCatalog'), value: stats.publicCount, color: 'text-green-400' },
                    { label: t('admin.geminiModeration'), value: stats.moderatedCount, color: 'text-amber-400' },
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
                    onClick={() => setActiveTab('public')}
                    className={`group/icon px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'public'
                        ? 'bg-green-600 text-white shadow-lg'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <Globe className={`h-4 w-4 transition-[color,opacity] ${(activeTab === 'public' ? "text-white opacity-100" : "text-white opacity-60 group-hover/icon:opacity-100")}`} />
                        {t('admin.publicLists')}
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
                        {stats.moderatedCount > 0 && (
                            <span className="bg-white/20 text-white px-1.5 py-0.5 rounded-full text-[10px]">
                                {stats.moderatedCount}
                            </span>
                        )}
                    </div>
                </button>
            </div>

            {/* Refresh */}
            <div className="flex items-center gap-4">
                <Button variant="secondary" onClick={() => fetchLists(true)} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    {t('admin.refresh')}
                </Button>
            </div>

            {/* Table */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="bg-white/5 rounded-lg border border-white/10 overflow-hidden"
            >
                {loading && lists.length === 0 ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    </div>
                ) : lists.length === 0 ? (
                    <div className="text-center py-20">
                        <List className="h-12 w-12 text-white opacity-20 mx-auto mb-4" />
                        <p className="text-white/50">
                            {activeTab === 'public' ? t('admin.noPublicLists') : t('admin.noListsPendingModeration')}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px]">
                            <thead>
                                <tr className="border-b border-white/10 bg-white/5">
                                    <th className="text-left p-4 text-sm font-medium text-white/70">{t('admin.user')}</th>
                                    <th className="text-left p-4 text-sm font-medium text-white/70">{t('admin.list')}</th>
                                    <th className="text-left p-4 text-sm font-medium text-white/70">{t('admin.preview')}</th>
                                    {activeTab === 'moderated' && (
                                        <th className="text-left p-4 text-sm font-medium text-white/70">{t('admin.reason')}</th>
                                    )}
                                    <th className="text-left p-4 text-sm font-medium text-white/70">{t('admin.date')}</th>
                                    <th className="text-right p-4 text-sm font-medium text-white/70">{t('admin.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <AnimatePresence mode='popLayout'>
                                    {lists.map((list, index) => (
                                        <motion.tr
                                            key={list.id}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20 }}
                                            transition={{ duration: 0.2, delay: index * 0.02 }}
                                            className="border-b border-white/5 hover:bg-white/5 transition-colors group"
                                        >
                                            {/* User */}
                                            <td className="p-4">
                                                <div className="flex items-center gap-3">
                                                    {list.avatar ? (
                                                        <img
                                                            src={list.avatar}
                                                            alt={list.username}
                                                            className="w-10 h-10 object-cover rounded-full border border-white/10 shadow-md"
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center border border-white/10">
                                                            <span className="text-xs">{list.username[0]}</span>
                                                        </div>
                                                    )}
                                                    <div>
                                                        <div className="flex items-center gap-1">
                                                            <p className="font-medium text-white">{list.username}</p>
                                                            {list.isVip && <span title={t('admin.vipLabel')} className="text-amber-400 text-xs">⭐</span>}
                                                        </div>
                                                        <p className="text-[10px] text-white/30 truncate max-w-[100px]" title={list.userId}>
                                                            {t('admin.idLabel')}: {list.userId.substring(0, 8)}...
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* List name & count */}
                                            <td className="p-4">
                                                <div className="space-y-1">
                                                    <p className="text-sm font-medium text-white">{list.listName}</p>
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant="secondary" className="text-[10px] py-0 h-4">
                                                            {t('lists.itemsInList', { count: list.itemCount })}
                                                        </Badge>
                                                        <span className="text-[10px] text-white/30">{t('watchParty.code')}: {list.shareCode}</span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Preview posters */}
                                            <td className="p-4">
                                                <div className="flex items-center gap-1">
                                                    {list.items.slice(0, 4).map((item, i) => (
                                                        item.poster_path ? (
                                                            <img
                                                                key={i}
                                                                src={`https://image.tmdb.org/t/p/w92${item.poster_path}`}
                                                                alt={item.title || item.name}
                                                                className="w-7 h-10 object-cover rounded shadow-md"
                                                            />
                                                        ) : (
                                                            <div key={i} className="w-7 h-10 bg-white/10 rounded flex items-center justify-center">
                                                                <List className="h-3 w-3 text-white opacity-30" />
                                                            </div>
                                                        )
                                                    ))}
                                                    {list.itemCount > 4 && (
                                                        <span className="text-[10px] text-white/40 ml-1">+{list.itemCount - 4}</span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Moderation reason (only for moderated tab) */}
                                            {activeTab === 'moderated' && (
                                                <td className="p-4">
                                                    <div className="space-y-1">
                                                        {list.moderationReason && (
                                                            <div className="flex flex-col gap-1">
                                                                <Badge variant="rejected" className="bg-red-500/20 text-red-400 border-red-500/30 w-fit">
                                                                    {list.moderationReason}
                                                                </Badge>
                                                                <span className="text-[10px] text-white/40">{t('admin.generatedByGemini')}</span>
                                                                {list.moderationDetails && (
                                                                    <p className="text-xs text-white/60 bg-white/5 p-2 rounded border border-white/5">
                                                                        <Sparkles className="h-3 w-3 inline mr-1 text-amber-400" />
                                                                        {list.moderationDetails}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            )}

                                            {/* Date */}
                                            <td className="p-4">
                                                {activeTab === 'public' ? (
                                                    <span className="text-white/50 text-xs">{formatDate(list.updatedAt || list.createdAt)}</span>
                                                ) : (
                                                    <div className="space-y-1">
                                                        <span className="text-white/50 text-xs line-through">{formatDate(list.createdAt)}</span>
                                                        <p className="text-amber-400/80 text-[10px]">
                                                            {t('admin.moderatedOn')} {list.moderatedAt ? formatDate(list.moderatedAt) : t('common.notAvailable')}
                                                        </p>
                                                    </div>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td className="p-4">
                                                <div className="flex items-center justify-end gap-2">
                                                    {/* View link */}
                                                    <a
                                                        href={`/list/${list.shareCode}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
                                                        title={t('admin.viewList')}
                                                    >
                                                        <ExternalLink className="h-4 w-4 text-blue-400" />
                                                    </a>

                                                    {activeTab === 'moderated' ? (
                                                        <>
                                                            <motion.button
                                                                whileHover={{ scale: 1.1 }}
                                                                whileTap={{ scale: 0.9 }}
                                                                onClick={() => handleApprove(list)}
                                                                className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 transition-colors"
                                                                title={t('admin.approveCatalog')}
                                                                disabled={submitting}
                                                            >
                                                                <CheckCircle className="h-4 w-4 text-green-400" />
                                                            </motion.button>
                                                            <motion.button
                                                                whileHover={{ scale: 1.1 }}
                                                                whileTap={{ scale: 0.9 }}
                                                                onClick={() => {
                                                                    setSelectedList(list);
                                                                    setDeleteModalOpen(true);
                                                                }}
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
                                                                setSelectedList(list);
                                                                setDeleteModalOpen(true);
                                                            }}
                                                            className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
                                                            title={t('admin.delete')}
                                                        >
                                                            <Trash2 className="h-4 w-4 text-red-400" />
                                                        </motion.button>
                                                    )}
                                                </div>
                                            </td>
                                        </motion.tr>
                                    ))}
                                </AnimatePresence>
                            </tbody>
                        </table>
                    </div>
                )}

                {hasMore && (
                    <div className="p-4 flex justify-center border-t border-white/10">
                        <Button className="group/icon"
                            variant="ghost"
                            onClick={() => {
                                setPage(prev => prev + 1);
                                fetchLists(false);
                            }}
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2 text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" /> : null}
                            {t('admin.loadMoreLists')}
                        </Button>
                    </div>
                )}
            </motion.div>

            {/* Delete Modal */}
            <ReusableModal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title={t('admin.deleteSharedList')}
            >
                <div className="space-y-6">
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm text-red-200 font-medium">{t('admin.irreversibleAction')}</p>
                            <p className="text-xs text-red-100/70">
                                {t('admin.deleteSharedListWarning')}
                            </p>
                        </div>
                    </div>

                    {selectedList && (
                        <div className="bg-white/5 p-3 rounded-lg border border-white/10 space-y-2">
                            <p className="text-xs text-white/50">{t('admin.listBy')} <span className="text-white font-medium">{selectedList.username}</span></p>
                            <p className="text-sm font-medium text-white">"{selectedList.listName}"</p>
                            <p className="text-xs text-white/40">{t('lists.itemsInList', { count: selectedList.itemCount })} · {t('watchParty.code')}: {selectedList.shareCode}</p>
                            {selectedList.moderationReason && (
                                <div className="flex items-center gap-2 mt-2">
                                    <Badge variant="rejected" className="bg-red-500/20 text-red-400 border-red-500/30">
                                        {selectedList.moderationReason}
                                    </Badge>
                                    {selectedList.moderationDetails && (
                                        <span className="text-[10px] text-white/50">{selectedList.moderationDetails}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

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
        </div>
    );
};

export default AdminSharedLists;
