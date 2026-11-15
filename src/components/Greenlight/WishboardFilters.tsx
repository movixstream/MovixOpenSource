import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Search, Film, Tv, Filter, TrendingUp, Clock } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../ui/select';
import { Input } from '../ui/input';
import AnimatedBorderCard from '../ui/animated-border-card';

interface WishboardFiltersProps {
    searchQuery: string;
    onSearchChange: (value: string) => void;
    mediaType: 'all' | 'movie' | 'tv';
    onMediaTypeChange: (value: 'all' | 'movie' | 'tv') => void;
    status: string;
    onStatusChange: (value: string) => void;
    sortBy: string;
    onSortChange: (value: string) => void;
}

const statusOptions = [
    { value: 'all', label: 'greenlight.allStatuses' },
    { value: 'pending', label: 'greenlight.underReview' },
    { value: 'not_found', label: 'greenlight.notFoundStatus' },
    { value: 'not_found_recent', label: 'greenlight.tooRecent' },
    { value: 'searching', label: 'greenlight.scouting2' },
    { value: 'added', label: 'greenlight.greenlighted' },
    { value: 'rejected', label: 'greenlight.rejectedStatus' },
];

const sortOptions = [
    { value: 'votes_desc', label: 'greenlight.mostRequested', icon: TrendingUp },
    { value: 'votes_asc', label: 'greenlight.leastRequested', icon: TrendingUp },
    { value: 'date_desc', label: 'greenlight.mostRecent', icon: Clock },
    { value: 'date_asc', label: 'greenlight.oldest', icon: Clock },
];

export const WishboardFilters: React.FC<WishboardFiltersProps> = ({
    searchQuery,
    onSearchChange,
    mediaType,
    onMediaTypeChange,
    status,
    onStatusChange,
    sortBy,
    onSortChange,
}) => {
    const { t } = useTranslation();
    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4 mb-6"
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                    <Filter className="h-5 w-5 text-green-500" />
                    {t('greenlight.search')}
                </h3>
            </div>

            {/* Search input */}
            <div className="relative">
                <Input
                    type="text"
                    placeholder={t('greenlight.searchProject')}
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="pl-10 pr-10"
                />
                <Search className="absolute left-3 top-1/2 h-4 w-4 z-20 -translate-y-1/2 text-white opacity-40 pointer-events-none" />
                {searchQuery && (
                    <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        onClick={() => onSearchChange('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                    >
                        ×
                    </motion.button>
                )}
            </div>

            {/* Filter buttons and dropdowns */}
            <div className="flex flex-wrap items-center gap-2">
                {/* Type filters */}
                <div className="flex items-center gap-2">
                    {/* Tous */}
                    {mediaType === 'all' ? (
                        <motion.div
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2 }}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => onMediaTypeChange('all')}
                            className="cursor-pointer"
                        >
                            <AnimatedBorderCard
                                highlightColor="34 197 94"
                                backgroundColor="20 20 20"
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-white rounded-lg"
                            >
                                {t('greenlight.allFilter')}
                            </AnimatedBorderCard>
                        </motion.div>
                    ) : (
                        <motion.button
                            layout
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => onMediaTypeChange('all')}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                        >
                            {t('greenlight.allFilter')}
                        </motion.button>
                    )}

                    {/* Films */}
                    {mediaType === 'movie' ? (
                        <motion.div
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2 }}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => onMediaTypeChange('movie')}
                            className="cursor-pointer"
                        >
                            <AnimatedBorderCard
                                highlightColor="34 197 94"
                                backgroundColor="20 20 20"
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-white rounded-lg"
                            >
                                <Film className="h-4 w-4" />
                                {t('admin.movies')}
                            </AnimatedBorderCard>
                        </motion.div>
                    ) : (
                        <motion.button
                            layout
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => onMediaTypeChange('movie')}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white group/icon"
                        >
                            <Film className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" />
                            {t('admin.movies')}
                        </motion.button>
                    )}

                    {/* Séries */}
                    {mediaType === 'tv' ? (
                        <motion.div
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2 }}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => onMediaTypeChange('tv')}
                            className="cursor-pointer"
                        >
                            <AnimatedBorderCard
                                highlightColor="34 197 94"
                                backgroundColor="20 20 20"
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-white rounded-lg"
                            >
                                <Tv className="h-4 w-4" />
                                {t('admin.tvShows')}
                            </AnimatedBorderCard>
                        </motion.div>
                    ) : (
                        <motion.button
                            layout
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => onMediaTypeChange('tv')}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white group/icon"
                        >
                            <Tv className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" />
                            {t('admin.tvShows')}
                        </motion.button>
                    )}
                </div>

                {/* Divider */}
                <div className="h-6 w-px bg-white/10" />

                {/* Status dropdown */}
                <Select value={status} onValueChange={onStatusChange}>
                    <SelectTrigger className="w-auto min-w-[160px]">
                        <SelectValue placeholder={t('greenlight.allStatuses')} />
                    </SelectTrigger>
                    <SelectContent>
                        {statusOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {t(option.label)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/* Sort dropdown */}
                <Select value={sortBy} onValueChange={onSortChange}>
                    <SelectTrigger className="w-auto min-w-[160px]">
                        <SelectValue placeholder={t('greenlight.sortBy')} />
                    </SelectTrigger>
                    <SelectContent>
                        {sortOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                <div className="flex items-center gap-2">
                                    <option.icon className="h-4 w-4 text-green-500" />
                                    {t(option.label)}
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </motion.div>
    );
};

export default WishboardFilters;