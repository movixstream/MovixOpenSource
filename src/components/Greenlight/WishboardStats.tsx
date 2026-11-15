import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { BarChart3, Film, Tv, Clock, CheckCircle } from 'lucide-react';
import Counter from '../ui/counter';

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

interface WishboardStatsProps {
    totalRequests: number;
    pendingRequests: number;
    addedThisMonth: number;
    movieCount: number;
    tvCount: number;
}

export const WishboardStats: React.FC<WishboardStatsProps> = ({
    totalRequests,
    pendingRequests,
    addedThisMonth,
    movieCount,
    tvCount,
}) => {
    const { t } = useTranslation();
    const moviePercentage = totalRequests > 0 ? (movieCount / totalRequests) * 100 : 50;
    const tvPercentage = totalRequests > 0 ? (tvCount / totalRequests) * 100 : 50;

    return (
        <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="w-full shrink-0 lg:w-80"
        >
            <div className="space-y-4">
                {/* Header */}
                <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                    <BarChart3 className="h-5 w-5 text-green-500" />
                    {t('greenlight.statistics')}
                </h3>

                {/* Stats cards */}
                <div className="grid grid-cols-2 gap-3">
                    <motion.div
                        whileHover={{ scale: 1.02 }}
                        className="rounded-lg bg-white/15"
                    >
                        <div className="p-4">
                            <Counter
                                value={pendingRequests}
                                fontSize={24}
                                padding={0}
                                places={getPlacesForValue(Math.max(pendingRequests, 1))}
                                gap={0}
                                borderRadius={0}
                                horizontalPadding={0}
                                textColor="white"
                                fontWeight="bold"
                                gradientHeight={0}
                            />
                            <p className="text-xs text-white/50 flex items-center gap-1">
                                <Clock className="h-3 w-3 text-white opacity-50" /> {t('greenlight.underReview')}
                            </p>
                        </div>
                    </motion.div>

                    <motion.div
                        whileHover={{ scale: 1.02 }}
                        className="rounded-lg bg-white/15"
                    >
                        <div className="p-4">
                            <Counter
                                value={addedThisMonth}
                                fontSize={24}
                                padding={0}
                                places={getPlacesForValue(Math.max(addedThisMonth, 1))}
                                gap={0}
                                borderRadius={0}
                                horizontalPadding={0}
                                textColor="white"
                                fontWeight="bold"
                                gradientHeight={0}
                            />
                            <p className="text-xs text-white/50 flex items-center gap-1">
                                <CheckCircle className="h-3 w-3 text-white opacity-50" /> {t('greenlight.greenlightedThisMonth')}
                            </p>
                        </div>
                    </motion.div>
                </div>

                {/* Distribution chart */}
                <motion.div
                    whileHover={{ scale: 1.01 }}
                    className="rounded-lg bg-white/15"
                >
                    <div className="p-6 pb-2">
                        <p className="text-sm font-medium text-white/70">{t('greenlight.movieSeriesDistribution')}</p>
                    </div>
                    <div className="p-6 pt-0">
                        {/* Legend */}
                        <div className="mb-3 flex items-center justify-between text-sm">
                            <span className="flex items-center gap-1 text-green-400">
                                <Film className="h-4 w-4" />
                                {t('admin.movies')} (
                                <Counter
                                    value={movieCount}
                                    fontSize={14}
                                    padding={0}
                                    places={getPlacesForValue(Math.max(movieCount, 1))}
                                    gap={0}
                                    borderRadius={0}
                                    horizontalPadding={1}
                                    textColor="currentColor"
                                    fontWeight="500"
                                    gradientHeight={0}
                                />
                                )
                            </span>
                            <span className="flex items-center gap-1 text-cyan-400">
                                <Tv className="h-4 w-4" />
                                {t('admin.tvShows')} (
                                <Counter
                                    value={tvCount}
                                    fontSize={14}
                                    padding={0}
                                    places={getPlacesForValue(Math.max(tvCount, 1))}
                                    gap={0}
                                    borderRadius={0}
                                    horizontalPadding={1}
                                    textColor="currentColor"
                                    fontWeight="500"
                                    gradientHeight={0}
                                />
                                )
                            </span>
                        </div>

                        {/* Progress bar */}
                        <div className="h-3 overflow-hidden rounded-full bg-white/10">
                            <div className="flex h-full">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${moviePercentage}%` }}
                                    transition={{ duration: 0.8, delay: 0.5 }}
                                    className="bg-green-500"
                                />
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${tvPercentage}%` }}
                                    transition={{ duration: 0.8, delay: 0.6 }}
                                    className="bg-cyan-500"
                                />
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Total */}
                <div className="text-center text-sm text-white/40 flex items-center justify-center gap-1">
                    <Counter
                        value={totalRequests}
                        fontSize={14}
                        padding={0}
                        places={getPlacesForValue(Math.max(totalRequests, 1))}
                        gap={0}
                        borderRadius={0}
                        horizontalPadding={0}
                        textColor="currentColor"
                        gradientHeight={0}
                    />
                    {t('greenlight.totalProjects')}
                </div>
            </div>
        </motion.aside>
    );
};

export default WishboardStats;