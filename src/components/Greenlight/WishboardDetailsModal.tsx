import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
    Calendar, Film, Tv, ExternalLink, ArrowBigUp,
    Clock
} from 'lucide-react';
import ReusableModal from '../ui/reusable-modal';
import Counter from '../ui/counter';
import { getTmdbLanguage } from '../../i18n';

export interface WishboardNote {
    id: number;
    note: string;
    is_public: number | boolean;
    created_at: string;
}

export interface WishboardRequest {
    id: number;
    tmdb_id: number;
    media_type: 'movie' | 'tv';
    season_number: number | null;
    status: 'pending' | 'not_found' | 'not_found_recent' | 'searching' | 'added' | 'rejected';
    vote_count: number;
    has_voted: boolean;
    created_at: string;
    updated_at?: string;
    notes?: WishboardNote[];
    title?: string;
    year?: string;
    poster_path?: string | null;
    overview?: string;
    statusHistory?: WishboardStatusHistory[];
}

export interface WishboardStatusHistory {
    status: string;
    reason: string | null;
    changed_at: string;
}

interface WishboardDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    request: WishboardRequest | null;
    onVote: (id: number) => void;
    onUnvote: (id: number) => void;
}

const statusLabels: Record<string, string> = {
    pending: 'greenlight.underReview',
    not_found: 'greenlight.notFoundStatus',
    not_found_recent: 'greenlight.tooRecent',
    searching: 'greenlight.scouting',
    added: 'greenlight.greenlighted',
    rejected: 'greenlight.rejectedStatus',
};

const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500',
    not_found: 'bg-red-500',
    not_found_recent: 'bg-orange-500',
    searching: 'bg-blue-500',
    added: 'bg-green-500',
    rejected: 'bg-red-500',
};

// ReusableBadge to match user's custom style
const ReusableBadge: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <span className={`inline-flex items-center rounded-full font-medium px-2 py-0.5 text-xs ${className}`}>
        {children}
    </span>
);

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

const WishboardDetailsModal: React.FC<WishboardDetailsModalProps> = ({
    isOpen,
    onClose,
    request,
    onVote,
    onUnvote,
}) => {
    const [overview, setOverview] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [isVoting, setIsVoting] = useState(false);
    const { t, i18n } = useTranslation();

    useEffect(() => {
        if (isOpen && request && !overview) {
            const fetchOverview = async () => {
                setLoading(true);
                try {
                    const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
                    const response = await fetch(
                        `https://api.themoviedb.org/3/${request.media_type}/${request.tmdb_id}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
                    );
                    if (response.ok) {
                        const data = await response.json();
                        setOverview(data.overview);
                    }
                } catch (error) {
                    console.error('Error fetching TMDB overview:', error);
                } finally {
                    setLoading(false);
                }
            };
            fetchOverview();
        } else if (!isOpen) {
            setOverview(null);
        }
    }, [isOpen, request]);

    if (!request) return null;

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString(i18n.language, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    const handleVoteAction = async () => {
        if (isVoting) return;
        setIsVoting(true);
        try {
            if (request.has_voted) {
                await onUnvote(request.id);
            } else {
                await onVote(request.id);
            }
        } finally {
            setIsVoting(false);
        }
    };

    return (
        <ReusableModal
            isOpen={isOpen}
            onClose={onClose}
            title={request.title}
            className="max-w-2xl !p-0"
        >
            <div className="p-10">
                <div className="flex flex-col space-y-1.5 text-center sm:text-left">
                    <h2 className="text-lg font-semibold leading-none tracking-tight light:text-black sr-only">
                        {request.title}
                    </h2>
                </div>

                <div className="flex flex-col sm:flex-row gap-6">
                    {/* Poster section */}
                    <div className="flex-shrink-0 mx-auto sm:mx-0">
                        {request.poster_path ? (
                            <img
                                src={`https://image.tmdb.org/t/p/w342${request.poster_path}`}
                                alt={request.title}
                                className="h-48 w-32 sm:h-64 sm:w-44 rounded-lg object-cover shadow-lg"
                            />
                        ) : (
                            <div className="h-48 w-32 sm:h-64 sm:w-44 rounded-lg bg-gray-800 flex items-center justify-center border border-white/10">
                                {request.media_type === 'movie' ? <Film className="w-12 h-12 opacity-20" /> : <Tv className="w-12 h-12 opacity-20" />}
                            </div>
                        )}
                    </div>

                    {/* Info section */}
                    <div className="flex-1 min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <ReusableBadge className={`${statusColors[request.status]} text-white`}>
                                {t(statusLabels[request.status])}
                            </ReusableBadge>
                            <span className="inline-flex items-center gap-1 rounded-md bg-pantone-100/10 px-2 py-1 text-xs font-medium text-pantone-100/70">
                                {request.media_type === 'movie' ? <Film className="h-3 w-3 text-pantone-100 opacity-70" /> : <Tv className="h-3 w-3 text-pantone-100 opacity-70" />}
                                {request.media_type === 'movie' ? t('admin.movie') : t('admin.tvShow')}
                                {request.season_number && ` • S${request.season_number}`}
                            </span>
                        </div>

                        <h2 className="mb-1 text-xl sm:text-2xl font-bold text-white">{request.title}</h2>
                        <p className="mb-3 flex items-center gap-2 text-sm text-pantone-100/60">
                            <Calendar className="h-4 w-4 text-pantone-100 opacity-60" />
                            {request.year}
                        </p>

                        <div className="mb-4 text-sm text-pantone-100/70 relative">
                            {loading ? (
                                <div className="h-20 flex items-center justify-center">
                                    <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : (
                                <p className="line-clamp-3">
                                    {overview || t('greenlight.noOverview')}
                                </p>
                            )}
                        </div>

                        <div className="flex items-center gap-3 mb-5">
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={handleVoteAction}
                                disabled={isVoting}
                                className={`flex items-center justify-center font-bold h-8 px-3 rounded-lg transition-all backdrop-blur-sm ${request.has_voted
                                    ? 'bg-white text-black shadow-lg shadow-white/20'
                                    : 'bg-white/20 text-white hover:bg-white/30 border border-white/10'
                                    }`}
                            >
                                <motion.div
                                    animate={request.has_voted ? { scale: [1, 1.3, 1] } : {}}
                                    transition={{ duration: 0.3 }}
                                    className="flex items-center"
                                >
                                    <ArrowBigUp className={`w-4 h-4 mr-1 ${request.has_voted ? 'fill-black' : ''}`} />
                                </motion.div>
                                <div className="relative overflow-hidden flex items-center justify-center ml-0.5" style={{ minWidth: '1ch' }}>
                                    <Counter
                                        value={request.vote_count}
                                        fontSize={13}
                                        places={getPlacesForValue(Math.max(request.vote_count, 1))}
                                        textColor="currentColor"
                                        fontWeight="700"
                                        padding={0}
                                        gap={0}
                                        borderRadius={0}
                                        horizontalPadding={0}
                                        gradientHeight={0}
                                    />
                                </div>
                            </motion.button>
                        </div>

                        <a
                            href={`https://www.themoviedb.org/${request.media_type}/${request.tmdb_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-pantone-500 hover:underline"
                        >
                            {t('greenlight.viewOnTmdb')}
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    </div>
                </div>

                {/* Rejection Reason */}
                {request.status === 'rejected' && (() => {
                    const rejectedHistory = request.statusHistory?.find(h => h.status === 'rejected');
                    const reason = rejectedHistory?.reason || request.notes?.find(n => n.is_public)?.note || request.notes?.[0]?.note;
                    return reason ? (
                        <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
                            <p className="text-sm font-medium text-red-400">{t('greenlight.rejectionReason')}</p>
                            <p className="mt-1 text-sm text-red-300">
                                {reason}
                            </p>
                        </div>
                    ) : null;
                })()}

                {/* Team Notes */}
                {request.notes && request.notes.filter(n => n.is_public).length > 0 && (
                    <div className="mt-4 rounded-lg bg-blue-500/10 border border-blue-500/20 p-4">
                        <p className="text-sm font-medium text-blue-400">{t('greenlight.teamNote')}</p>
                        {request.notes.filter(n => n.is_public).map((note, idx) => (
                            <p key={note.id || idx} className="mt-1 text-sm text-blue-300">
                                {note.note}
                            </p>
                        ))}
                    </div>
                )}

                {/* History section */}
                <div className="mt-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-pantone-100/70 mb-3">
                        <Clock className="h-4 w-4 text-pantone-100 opacity-70" />
                        {t('greenlight.history')}
                    </p>
                    <div className="relative space-y-3">
                        <div className="absolute bottom-2 left-[5.5px] top-2 w-[1px] bg-pantone-100/20"></div>

                        {request.statusHistory && request.statusHistory.length > 0 ? (
                            request.statusHistory.map((step, idx) => (
                                <div key={idx} className="relative flex items-start gap-3">
                                    <div className={`relative z-10 h-3 w-3 flex-shrink-0 rounded-full mt-1 ${step.status === 'pending' ? 'bg-amber-600' :
                                        step.status === 'rejected' ? 'bg-red-500' :
                                            statusColors[step.status] || 'bg-pantone-100'
                                        }`}></div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-white">{t(statusLabels[step.status]) || step.status}</p>
                                        <p className="text-xs text-pantone-100/50">{formatDate(step.changed_at)}</p>
                                        {step.reason && (
                                            <p className="mt-0.5 text-xs text-pantone-100/60 italic">
                                                {step.reason}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="relative flex items-start gap-3">
                                <div className="relative z-10 h-3 w-3 flex-shrink-0 rounded-full mt-1 bg-amber-600"></div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-white">{t('greenlight.pending')}</p>
                                    <p className="text-xs text-pantone-100/50">{formatDate(request.created_at)}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ReusableModal>
    );
};

// ReusableModal handles the layout, but we use ReusableBadge for local styles
export default WishboardDetailsModal;