import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Filter, X, Film, Tv, FolderOpen, SortAsc, SortDesc, Type, Monitor, Share2, CalendarDays } from 'lucide-react';
import InputMask from 'react-input-mask';
import { useTranslation } from 'react-i18next';
import CustomDropdown from './CustomDropdown';
import CustomDatePicker from './CustomDatePicker';

export type FilterItemType = 'all' | 'movie' | 'tv' | 'collection' | 'shared-list' | 'live-tv';

export interface FilterOptions {
  searchTerm: string;
  typeFilter: FilterItemType;
  sortBy: 'date' | 'name';
  sortOrder: 'asc' | 'desc';
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

interface FilterSystemProps {
  onFiltersChange: (filters: FilterOptions) => void;
  totalItems: number;
  filteredItems: number;
  isSorting?: boolean;
  className?: string;
  availableTypeFilters?: FilterItemType[];
}

const FilterSystem: React.FC<FilterSystemProps> = ({
  onFiltersChange,
  totalItems,
  filteredItems,
  isSorting = false,
  className = '',
  availableTypeFilters = ['all', 'movie', 'tv', 'collection']
}) => {
  const { t, i18n } = useTranslation();
  const [filters, setFilters] = useState<FilterOptions>({
    searchTerm: '',
    typeFilter: 'all',
    sortBy: 'date',
    sortOrder: 'desc'
  });
  const [searchInput, setSearchInput] = useState('');

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isTextMode, setIsTextMode] = useState(false);
  const [textStartDate, setTextStartDate] = useState('');
  const [textEndDate, setTextEndDate] = useState('');

  const typeFilterButtons = useMemo(() => ([
    { value: 'all' as const, label: t('filter.all') },
    { value: 'movie' as const, label: t('filter.movies'), icon: Film },
    { value: 'tv' as const, label: t('filter.series'), icon: Tv },
    { value: 'collection' as const, label: t('filter.collections'), icon: FolderOpen },
    { value: 'shared-list' as const, label: t('filter.sharedLists'), icon: Share2 },
    { value: 'live-tv' as const, label: t('filter.liveTV'), icon: Monitor },
  ]), [t]);

  const visibleTypeFilterButtons = useMemo(
    () => typeFilterButtons.filter((button) => availableTypeFilters.includes(button.value)),
    [availableTypeFilters, typeFilterButtons]
  );

  // Fonction pour valider et parser une date au format JJ/MM/AAAA
  const parseDateFromMask = (maskedValue: string): Date | null => {
    if (!maskedValue || maskedValue.length !== 10) return null;
    
    const parts = maskedValue.split('/');
    if (parts.length !== 3) return null;
    
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1; // Les mois commencent à 0
    const year = parseInt(parts[2]);
    
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (day < 1 || day > 31 || month < 0 || month > 11 || year < 1900 || year > 2100) return null;
    
    const date = new Date(year, month, day);
    return isNaN(date.getTime()) ? null : date;
  };

  const areFiltersEqual = useCallback((current: FilterOptions, next: FilterOptions) => {
    const currentStart = current.dateRange?.start?.getTime() ?? null;
    const currentEnd = current.dateRange?.end?.getTime() ?? null;
    const nextStart = next.dateRange?.start?.getTime() ?? null;
    const nextEnd = next.dateRange?.end?.getTime() ?? null;

    return (
      current.searchTerm === next.searchTerm &&
      current.typeFilter === next.typeFilter &&
      current.sortBy === next.sortBy &&
      current.sortOrder === next.sortOrder &&
      currentStart === nextStart &&
      currentEnd === nextEnd
    );
  }, []);

  const applyFilterUpdate = useCallback(
    (updater: (prev: FilterOptions) => FilterOptions) => {
      setFilters((prev) => {
        const next = updater(prev);
        if (areFiltersEqual(prev, next)) {
          return prev;
        }

        onFiltersChange(next);
        return next;
      });
    },
    [areFiltersEqual, onFiltersChange]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      applyFilterUpdate((prev) => ({
        ...prev,
        searchTerm: searchInput
      }));
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [searchInput, applyFilterUpdate]);

  useEffect(() => {
    if (availableTypeFilters.includes(filters.typeFilter)) {
      return;
    }

    applyFilterUpdate((prev) => ({
      ...prev,
      typeFilter: 'all'
    }));
  }, [availableTypeFilters, filters.typeFilter, applyFilterUpdate]);

  const handleFilterChange = useCallback(<K extends keyof FilterOptions>(key: K, value: FilterOptions[K]) => {
    applyFilterUpdate((prev) => ({
      ...prev,
      [key]: value
    }));
  }, [applyFilterUpdate]);

  const handleDateRangeChange = useCallback((newDateRange: FilterOptions['dateRange']) => {
    applyFilterUpdate((prev) => ({
      ...prev,
      dateRange: newDateRange
    }));
  }, [applyFilterUpdate]);

  // Synchroniser les états texte avec les dates quand on bascule de mode
  const syncTextStates = useCallback(() => {
    if (filters.dateRange?.start) {
      const startDate = filters.dateRange.start;
      setTextStartDate(`${startDate.getDate().toString().padStart(2, '0')}/${(startDate.getMonth() + 1).toString().padStart(2, '0')}/${startDate.getFullYear()}`);
    } else {
      setTextStartDate('');
    }
    
    if (filters.dateRange?.end) {
      const endDate = filters.dateRange.end;
      setTextEndDate(`${endDate.getDate().toString().padStart(2, '0')}/${(endDate.getMonth() + 1).toString().padStart(2, '0')}/${endDate.getFullYear()}`);
    } else {
      setTextEndDate('');
    }
  }, [filters.dateRange]);

  const clearFilters = useCallback(() => {
    const defaultFilters: FilterOptions = {
      searchTerm: '',
      typeFilter: 'all',
      sortBy: 'date',
      sortOrder: 'desc'
    };
    setSearchInput('');
    setTextStartDate('');
    setTextEndDate('');
    setFilters(defaultFilters);
    onFiltersChange(defaultFilters);
  }, [onFiltersChange]);

  const hasActiveFilters = useMemo(() => {
    return searchInput !== '' || 
           filters.typeFilter !== 'all' || 
           filters.sortBy !== 'date' || 
           filters.sortOrder !== 'desc' ||
           filters.dateRange?.start ||
           filters.dateRange?.end;
  }, [filters, searchInput]);

  return (
    <div className={`mb-6 relative z-10 ${className}`}>
      {/* Barre principale : recherche, types, tri — posée à plat sur la page */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search Input */}
        <div className="relative w-full sm:w-64 lg:w-72">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white opacity-45 w-4 h-4" aria-hidden="true" />
          <input
            type="text"
            placeholder={t('filter.searchByName')}
            aria-label={t('filter.searchByName')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full h-10 pl-10 pr-10 bg-gray-900 rounded-full text-[15px] text-white placeholder:text-white/45 focus:outline-none focus:ring-2 focus:ring-white/60"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              aria-label={t('filter.clear')}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/10 group"
            >
              <X className="w-4 h-4 opacity-55 group-hover:opacity-100" />
            </button>
          )}
        </div>

        {/* Type Filter */}
        <div className="flex gap-2 flex-wrap">
          {visibleTypeFilterButtons.map((button) => {
            const Icon = button.icon;
            const isActive = filters.typeFilter === button.value;

            return (
              <button
                key={button.value}
                onClick={() => handleFilterChange('typeFilter', button.value)}
                type="button"
                aria-pressed={isActive}
                className={`group h-10 px-3.5 rounded-full text-sm font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
                  Icon ? 'flex items-center gap-1.5' : ''
                } ${
                  isActive
                    ? 'bg-white text-black'
                    : 'bg-gray-900 text-white/70 hover:bg-gray-800 hover:text-white'
                }`}
              >
                {/* Couleur pleine + opacity sur l'icône : une couleur transparente ferait foncer les croisements de traits */}
                {Icon ? <Icon className={`w-4 h-4 ${isActive ? 'text-black' : 'text-white opacity-70 group-hover:opacity-100'}`} aria-hidden="true" /> : null}
                {button.label}
              </button>
            );
          })}
        </div>

        {/* Sort Controls */}
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
           <CustomDropdown
             options={[
               { value: 'date', label: t('filter.addedDate') },
               { value: 'name', label: t('filter.name') }
             ]}
             value={filters.sortBy}
             onChange={(value) => handleFilterChange('sortBy', value as 'date' | 'name')}
             disabled={isSorting}
             className="min-w-[140px]"
             position="bottom"
           />
           
           <button
             onClick={() => handleFilterChange('sortOrder', filters.sortOrder === 'asc' ? 'desc' : 'asc')}
             disabled={isSorting}
             type="button"
             aria-label={`${filters.sortOrder === 'asc' ? t('filter.sortOrderDesc') : t('filter.sortOrderAsc')}`}
             className={`inline-flex h-10 w-10 items-center justify-center bg-gray-900 rounded-full text-white hover:bg-gray-800 transition-colors ${
               isSorting ? 'opacity-50 cursor-not-allowed' : ''
             }`}
             title={`${filters.sortOrder === 'asc' ? t('filter.sortOrderDesc') : t('filter.sortOrderAsc')}`}
           >
             {isSorting ? (
               <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
             ) : filters.sortOrder === 'asc' ? (
               <SortAsc className="w-4 h-4" />
             ) : (
               <SortDesc className="w-4 h-4" />
             )}
           </button>
        </div>

        {/* Advanced Filters Toggle */}
        <button
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          type="button"
          aria-expanded={showAdvancedFilters}
          className={`group h-10 px-3.5 rounded-full text-sm font-medium transition-colors flex items-center gap-2 ${
            showAdvancedFilters
              ? 'bg-white text-black'
              : 'bg-gray-900 text-white/70 hover:bg-gray-800 hover:text-white'
          }`}
        >
          <Filter className={`w-4 h-4 ${showAdvancedFilters ? 'text-black' : 'text-white opacity-70 group-hover:opacity-100'}`} aria-hidden="true" />
          {t('filter.advancedFilters')}
        </button>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="h-10 px-3.5 bg-white/10 text-white rounded-full text-sm font-medium hover:bg-white/[0.16] transition-colors flex items-center gap-1.5"
          >
            <X className="w-4 h-4" />
            {t('filter.clear')}
          </button>
        )}
      </div>

      {/* Advanced Filters Panel */}
      <AnimatePresence mode="wait">
        {showAdvancedFilters && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="mt-3 rounded-xl bg-gray-900 p-4"
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Date Range Filter */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-white/80">
                    {t('filter.addedPeriod')}
                  </label>
                  {(filters.dateRange?.start || filters.dateRange?.end) && (
                    <button
                      onClick={() => handleDateRangeChange({ start: undefined, end: undefined })}
                      type="button"
                      className="text-sm text-white/55 hover:text-white transition-colors"
                    >
                      {t('filter.clearDates')}
                    </button>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  {!isTextMode ? (
                    <>
                      <CustomDatePicker
                        value={filters.dateRange?.start}
                        onChange={(date) => {
                          // Si on sélectionne une date de début, réinitialiser la date de fin si elle est antérieure
                          let newEndDate = filters.dateRange?.end;
                          if (date && filters.dateRange?.end) {
                            const startDateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                            const endDateOnly = new Date(filters.dateRange.end.getFullYear(), filters.dateRange.end.getMonth(), filters.dateRange.end.getDate());
                            if (endDateOnly < startDateOnly) {
                              newEndDate = undefined;
                            }
                          }
                          
                          handleDateRangeChange({
                            start: date,
                            end: newEndDate
                          });
                        }}
                        placeholder={t('filter.startDate')}
                        className="flex-1"
                        position="bottom"
                        maxDate={filters.dateRange?.end}
                      />
                      <CustomDatePicker
                        value={filters.dateRange?.end}
                        onChange={(date) => {
                          handleDateRangeChange({
                            ...filters.dateRange,
                            end: date
                          });
                        }}
                        placeholder={t('filter.endDate')}
                        className="flex-1"
                        position="bottom"
                        minDate={filters.dateRange?.start}
                      />
                    </>
                  ) : (
                    <div className="flex gap-2 flex-1">
                      <InputMask
                        mask="99/99/9999"
                        value={textStartDate}
                        onChange={(e) => {
                          const value = e.target.value;
                          setTextStartDate(value);
                          
                          // Parser la date seulement si le format est complet (JJ/MM/AAAA)
                          if (value === '' || value.includes('_')) {
                            handleDateRangeChange({
                              ...filters.dateRange,
                              start: undefined
                            });
                            return;
                          }
                          
                          const date = parseDateFromMask(value);
                          if (date) {
                            handleDateRangeChange({
                              ...filters.dateRange,
                              start: date
                            });
                          }
                        }}
                        placeholder={t('common.dateInputPlaceholder')}
                        className="flex-1 h-10 px-3 bg-black/40 rounded-lg text-white text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-white/60"
                      />
                      <InputMask
                        mask="99/99/9999"
                        value={textEndDate}
                        onChange={(e) => {
                          const value = e.target.value;
                          setTextEndDate(value);
                          
                          // Parser la date seulement si le format est complet (JJ/MM/AAAA)
                          if (value === '' || value.includes('_')) {
                            handleDateRangeChange({
                              ...filters.dateRange,
                              end: undefined
                            });
                            return;
                          }
                          
                          const date = parseDateFromMask(value);
                          if (date) {
                            handleDateRangeChange({
                              ...filters.dateRange,
                              end: date
                            });
                          }
                        }}
                        placeholder={t('common.dateInputPlaceholder')}
                        className="flex-1 h-10 px-3 bg-black/40 rounded-lg text-white text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-white/60"
                      />
                    </div>
                  )}
                  
                  {/* Bouton de basculement mode texte */}
                  <button
                    onClick={() => {
                      if (!isTextMode) {
                        syncTextStates();
                      }
                      setIsTextMode(!isTextMode);
                    }}
                    type="button"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/[0.16]"
                    title={isTextMode ? t('filter.calendarMode') : t('filter.directInputMode')}
                    aria-label={isTextMode ? t('filter.calendarMode') : t('filter.directInputMode')}
                  >
                    {isTextMode ? <CalendarDays className="w-4 h-4" aria-hidden="true" /> : <Type className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>

                {/* Indicateur de format en mode texte */}
                {isTextMode && (
                  <p className="mt-2 text-sm text-white/55">
                    {t('filter.dateFormatHint')}
                  </p>
                )}
              </div>

              {/* Results Count */}
              <div className="flex flex-col items-end gap-2">
                <div className="text-sm text-white/60 tabular-nums">
                  {t('filter.itemsCount', { filtered: filteredItems, total: totalItems })}
                  {filteredItems !== totalItems && (
                    <span className="ml-2 text-white/80">
                      ({Math.round((filteredItems / totalItems) * 100)}%)
                    </span>
                  )}
                </div>
                {(filters.dateRange?.start || filters.dateRange?.end) && (
                  <div className="text-sm text-white/80 bg-white/10 px-3 py-1 rounded-full">
                    {filters.dateRange?.start && filters.dateRange?.end ? (
                      t('filter.dateRangeFromTo', { start: filters.dateRange.start.toLocaleDateString(i18n.language), end: filters.dateRange.end.toLocaleDateString(i18n.language) })
                    ) : filters.dateRange?.start ? (
                      t('filter.dateRangeFrom', { start: filters.dateRange.start.toLocaleDateString(i18n.language) })
                    ) : (
                      t('filter.dateRangeTo', { end: filters.dateRange?.end?.toLocaleDateString(i18n.language) })
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default React.memo(FilterSystem);

