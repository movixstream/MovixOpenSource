import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, SlidersHorizontal, LayoutGrid, List, Loader2, Film, Tv, ChevronDown, X } from 'lucide-react';
import SEO from '../components/SEO';
import { SquareBackground } from '../components/ui/square-background';
import { SearchGridCard, SearchListCard } from '../components/SearchCard';
import GridSkeleton from '../components/skeletons/GridSkeleton';
import { getTmdbLanguage } from '../i18n';
import { getLanguages } from '../data/languages';
import { getCountries } from '../data/countries';
import {
    DEFAULT_CATALOG_FILTERS, GENRE_IDS, PROVIDER_NAMES, STUDIOS,
    fetchProviderCatalog, getCatalogGenre, readCatalogFilters,
    type CatalogFilters, type CatalogMediaType, type CatalogResult,
} from '../services/providerCatalog';

interface FilterOption { value: string; label: string }

// Native selects keep keyboard navigation and the mobile picker without a
// portal measuring its position while the filter panel is opening.
const CatalogSelect = ({ label, value, options, onChange }: {
    label: string;
    value: string;
    options: FilterOption[];
    onChange: (value: string) => void;
}) => (
    <label className="block min-w-0">
        <span className="mb-2 block text-sm font-medium text-white/70">{label}</span>
        <span className="relative block">
            <select value={value} onChange={event => onChange(event.target.value)}
                className="min-h-11 w-full min-w-0 appearance-none truncate rounded-xl border border-white/15 bg-[#171717] py-2.5 pl-3 pr-10 text-base text-white transition-colors hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:text-sm [color-scheme:dark]">
                {!options.some(option => option.value === value) && <option value={value}>{value}</option>}
                {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white opacity-60" />
        </span>
    </label>
);

const buttonClass = 'min-h-11 rounded-xl border border-white/15 px-3 py-2 text-sm font-medium transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-default disabled:opacity-40';

const getScreenColumns = () => {
    const width = window.innerWidth;
    return width < 640 ? 2 : width < 768 ? 3 : width < 1024 ? 4 : width < 1280 ? 6 : width < 1536 ? 8 : 10;
};

const GRID_CLASSES: Record<number, string> = {
    2: 'grid-cols-2',
    3: 'grid-cols-2 sm:grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4',
    6: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6',
    8: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8',
    10: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10',
};

const ProviderCatalogPage: React.FC = () => {
    const { providerId = '', type, genreId } = useParams<{ providerId: string; type: string; genreId?: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const isMovie = type === 'movies';
    const mediaType: CatalogMediaType = isMovie ? 'movie' : 'tv';
    const genre = getCatalogGenre(genreId, mediaType);
    const providerName = PROVIDER_NAMES[Number(providerId)] || t('filter.provider');
    const isStudio = Boolean(STUDIOS[Number(providerId)]);
    const genreName = genre ? t(`providerCatalog.genres.${genre}`) : null;
    const filters = useMemo(() => readCatalogFilters(searchParams), [searchParams]);
    const rawPage = Number(searchParams.get('page') || 1);
    const currentPage = Number.isInteger(rawPage) ? Math.min(500, Math.max(1, rawPage)) : 1;
    const language = getTmdbLanguage();
    const query = useMemo(() => ({ providerId, mediaType, genre, page: currentPage, filters, language }),
        [providerId, mediaType, genre, currentPage, filters, language]);
    const requestKey = JSON.stringify(query);
    const [data, setData] = useState<CatalogResult | null>(null);
    const [request, setRequest] = useState<{ key: string; status: 'loading' | 'success' | 'error' }>({ key: '', status: 'loading' });
    const [retry, setRetry] = useState(0);
    const loading = request.key !== requestKey || request.status === 'loading';
    const error = request.key === requestKey && request.status === 'error';
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [viewType, setViewType] = useState<'grid' | 'list'>('grid');
    const [resultsPerRow, setResultsPerRow] = useState(6);
    const [screenCols, setScreenCols] = useState(getScreenColumns);
    const resultsRef = useRef<HTMLDivElement>(null);
    const effectivePerRow = Math.min(resultsPerRow, screenCols);
    const gridClasses = GRID_CLASSES[effectivePerRow];

    useEffect(() => {
        const update = () => setScreenCols(getScreenColumns());
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    // Canonicalize incompatible legacy genre links, without resetting their page.
    useEffect(() => {
        if (genreId && genreId !== genre) {
            navigate({ pathname: `/provider/${providerId}/${type}${genre ? `/${genre}` : ''}`, search: searchParams.toString() }, { replace: true });
        }
    }, [genreId, genre, providerId, type, searchParams, navigate]);

    useEffect(() => {
        const controller = new AbortController();
        setRequest({ key: requestKey, status: 'loading' });
        fetchProviderCatalog(query, controller.signal).then(result => {
            if (controller.signal.aborted) return;
            if (currentPage > result.totalPages) {
                setSearchParams(previous => {
                    const next = new URLSearchParams(previous);
                    next.set('page', String(result.totalPages));
                    return next;
                }, { replace: true });
                return;
            }
            setData(result);
            setRequest({ key: requestKey, status: 'success' });
        }).catch(() => {
            if (!controller.signal.aborted) setRequest({ key: requestKey, status: 'error' });
        });
        return () => controller.abort();
    }, [query, requestKey, retry, currentPage, setSearchParams]);

    const updateFilter = (key: keyof CatalogFilters, value: string) => {
        setSearchParams(previous => {
            const next = new URLSearchParams(previous);
            if (value === DEFAULT_CATALOG_FILTERS[key]) next.delete(key);
            else next.set(key, value);
            next.set('page', '1');
            return next;
        });
    };

    const catalogLink = (nextType: 'movies' | 'tv', nextGenre: string) => {
        const next = new URLSearchParams(searchParams);
        if (nextType !== type || nextGenre !== genre) next.set('page', '1');
        return { pathname: `/provider/${providerId}/${nextType}${nextGenre ? `/${nextGenre}` : ''}`, search: next.toString() };
    };
    const updateGenre = (value: string) => navigate(catalogLink(isMovie ? 'movies' : 'tv', value));
    const resetFilters = () => {
        const next = new URLSearchParams(searchParams);
        Object.keys(DEFAULT_CATALOG_FILTERS).forEach(key => next.delete(key));
        next.set('page', '1');
        navigate({ pathname: `/provider/${providerId}/${type}`, search: next.toString() });
    };

    const sortOptions = useMemo(() => [
        { value: 'popularity.desc', label: t('genres.popularityDesc') },
        { value: 'popularity.asc', label: t('genres.popularityAsc') },
        { value: 'vote_average.desc', label: t('genres.ratingDesc') },
        { value: 'vote_average.asc', label: t('genres.ratingAsc') },
        { value: 'release_date.desc', label: t('genres.releaseDateDesc') },
        { value: 'release_date.asc', label: t('genres.releaseDateAsc') },
        { value: 'vote_count.desc', label: t('providerCatalog.votesDesc') },
        { value: 'vote_count.asc', label: t('providerCatalog.votesAsc') },
        { value: 'title.asc', label: t('providerCatalog.titleAsc') },
        { value: 'title.desc', label: t('providerCatalog.titleDesc') },
    ], [t]);
    const genreOptions = useMemo(() => [
        { value: '', label: t('filter.allGenres') },
        ...GENRE_IDS[mediaType].map(id => ({ value: String(id), label: t(`providerCatalog.genres.${id}`) })),
    ], [mediaType, t]);
    const filterFields = useMemo(() => {
        const currentYear = new Date().getFullYear();
        const fields: { key: keyof CatalogFilters; label: string; options: FilterOption[] }[] = [
            { key: 'year', label: t('filter.year'), options: [
                { value: '', label: t('filter.allYears') },
                ...Array.from({ length: currentYear - 1869 }, (_, i) => ({ value: String(currentYear - i), label: String(currentYear - i) })),
            ] },
            { key: 'rating', label: t('filter.minRating'), options: [
                { value: '', label: t('providerCatalog.anyRating') },
                ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(value => ({ value: String(value), label: `${value} / 10` })),
            ] },
            { key: 'votes', label: t('providerCatalog.minVotes'), options: [0, 5, 50, 100, 500, 1000].map(value => ({
                value: String(value), label: value === 0 ? t('providerCatalog.anyVotes') : t('providerCatalog.votesAtLeast', { count: value }),
            })) },
            { key: 'language', label: t('providerCatalog.originalLanguage'), options: [
                { value: '', label: t('filter.allLanguages') }, ...getLanguages(i18n.language),
            ] },
            { key: 'runtime', label: t(isMovie ? 'providerCatalog.runtime' : 'providerCatalog.episodeRuntime'), options: [
                { value: '', label: t('providerCatalog.anyRuntime') },
                { value: 'short', label: t('providerCatalog.runtimeUpTo', { count: isMovie ? 90 : 30 }) },
                { value: 'medium', label: t('providerCatalog.runtimeBetween', { min: isMovie ? 91 : 31, max: isMovie ? 120 : 50 }) },
                { value: 'long', label: t('providerCatalog.runtimeOver', { count: isMovie ? 120 : 50 }) },
            ] },
        ];
        if (!isStudio) fields.push(
            { key: 'region', label: t('providerCatalog.watchRegion'), options: getCountries(i18n.language) },
            { key: 'offer', label: t('providerCatalog.offerType'), options: [
                { value: '', label: t('providerCatalog.anyOffer') },
                ...['flatrate', 'free', 'ads', 'rent', 'buy'].map(value => ({ value, label: t(`providerCatalog.offers.${value}`) })),
            ] },
        );
        return fields;
    }, [isMovie, isStudio, i18n.language, t]);
    const activeFilters = [...filterFields, { key: 'sort' as const, label: t('genres.sort'), options: sortOptions }]
        .filter(field => filters[field.key] !== DEFAULT_CATALOG_FILTERS[field.key]);
    const activeCount = activeFilters.length + (genre ? 1 : 0);
    const gridOptions = [2, 3, 4, 6, 8, 10].filter(n => n <= screenCols).map(n => ({ value: String(n), label: `${n} ${t('search.perRow')}` }));
    const totalPages = data?.totalPages || 1;
    const pageNumbers = [...new Set([1, ...Array.from({ length: 5 }, (_, i) => currentPage - 2 + i), totalPages])]
        .filter(page => page > 0 && page <= totalPages).sort((a, b) => a - b);
    const handlePageChange = (page: number) => {
        if (loading || error || page === currentPage || page < 1 || page > totalPages) return;
        setSearchParams(previous => {
            const next = new URLSearchParams(previous);
            next.set('page', String(page));
            return next;
        });
        resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    };

    return (
        <SquareBackground squareSize={48} borderColor="rgba(239, 68, 68, 0.10)" mode="combined">
            <div className="min-h-screen px-4 pb-16 pt-24 md:px-8">
                <SEO title={`${genreName ? `${genreName} - ` : ''}${t(isMovie ? 'providerCatalog.films' : 'providerCatalog.series')} ${providerName}`}
                    description={`${t('providerCatalog.discover')} ${t(isMovie ? 'providerCatalog.films' : 'providerCatalog.series').toLowerCase()} ${providerName}`} />
                <div className="mx-auto max-w-screen-xl">
                    <header className="mb-6 flex flex-col gap-5">
                        <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                                <Link to={`/provider/${providerId}`} aria-label={t('common.back')}
                                    className={`${buttonClass} flex w-11 shrink-0 items-center justify-center`}>
                                    <ArrowLeft aria-hidden="true" className="h-5 w-5" />
                                </Link>
                                <div className="min-w-0">
                                    <h1 className="break-words text-2xl font-bold leading-tight md:text-3xl">{providerName}</h1>
                                    {genreName && <p className="mt-1 text-sm text-white/70">{genreName}</p>}
                                </div>
                            </div>
                            <nav aria-label={t('providerCatalog.contentType')} className="grid grid-cols-2 gap-2 md:shrink-0">
                                {(['movies', 'tv'] as const).map(nextType => {
                                    const active = nextType === type;
                                    const Icon = nextType === 'movies' ? Film : Tv;
                                    return <Link key={nextType} to={catalogLink(nextType, getCatalogGenre(genre, nextType === 'movies' ? 'movie' : 'tv'))}
                                        aria-current={active ? 'page' : undefined}
                                        className={`${buttonClass} flex min-w-0 items-center justify-center gap-2 ${active ? 'border-red-600 bg-red-600 text-white hover:bg-red-500' : 'bg-white/5 text-white/70'}`}>
                                        <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 text-white ${active ? '' : 'opacity-70'}`} />
                                        {t(nextType === 'movies' ? 'providerCatalog.films' : 'providerCatalog.series')}
                                    </Link>;
                                })}
                            </nav>
                        </div>

                        <div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                            <CatalogSelect label={t('filter.genre')} value={genre} options={genreOptions} onChange={updateGenre} />
                            <CatalogSelect label={t('filter.sortBy')} value={filters.sort} options={sortOptions} onChange={value => updateFilter('sort', value)} />
                            <button type="button" aria-expanded={isFilterOpen} aria-controls="provider-catalog-filters"
                                className={`${buttonClass} flex items-center justify-center gap-2 ${isFilterOpen ? 'border-red-500/60 bg-red-600/20' : 'bg-white/5'}`}
                                onClick={() => setIsFilterOpen(open => !open)}>
                                <SlidersHorizontal aria-hidden="true" className="h-4 w-4 shrink-0" />
                                {t('filter.title')}
                                {activeCount > 0 && <span className="text-white/70">({activeCount})</span>}
                            </button>
                        </div>

                        <div id="provider-catalog-filters" hidden={!isFilterOpen} className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
                            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {filterFields.map(field => <CatalogSelect key={field.key} label={field.label} value={filters[field.key]}
                                    options={field.options} onChange={value => updateFilter(field.key, value)} />)}
                            </div>
                            {!isStudio && <p className="mt-4 text-sm text-white/60">{t('providerCatalog.availabilityHint')}</p>}
                        </div>

                        {activeCount > 0 && <div className="flex flex-wrap items-center gap-2">
                            {genre && <button type="button" onClick={() => updateGenre('')} aria-label={t('providerCatalog.removeFilter', { filter: genreName })}
                                className={`${buttonClass} flex max-w-full items-center gap-2 bg-white/5`}>
                                <span className="min-w-0 break-words">{genreName}</span><X aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                            </button>}
                            {activeFilters.map(field => <button key={field.key} type="button" onClick={() => updateFilter(field.key, DEFAULT_CATALOG_FILTERS[field.key])}
                                aria-label={t('providerCatalog.removeFilter', { filter: field.label })} className={`${buttonClass} flex max-w-full items-center gap-2 bg-white/5`}>
                                <span className="min-w-0 break-words">{field.label} : {field.options.find(option => option.value === filters[field.key])?.label || filters[field.key]}</span>
                                <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                            </button>)}
                            <button type="button" onClick={resetFilters} className={`${buttonClass} border-transparent text-white/70`}>{t('filter.reset')}</button>
                        </div>}
                    </header>

                    <div ref={resultsRef} className="scroll-mt-24">
                        <div className="mb-5 flex min-h-11 flex-wrap items-center justify-between gap-3">
                            <p role="status" className="flex items-center gap-2 text-sm text-white/70">
                                {loading && <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 text-white opacity-70 animate-spin motion-reduce:animate-none" />}
                                {loading ? t('providerCatalog.updating') : error ? (data ? t('providerCatalog.previousResults') : t('common.error'))
                                    : t('providerCatalog.resultsAvailable', { total: (data?.totalResults || 0).toLocaleString(i18n.language) })}
                            </p>
                            <div className="flex flex-wrap items-end gap-2">
                                {viewType === 'grid' && screenCols > 2 && <CatalogSelect label={t('genres.itemsPerRow')} value={String(effectivePerRow)} options={gridOptions} onChange={value => setResultsPerRow(Number(value))} />}
                                <div role="group" aria-label={t('genres.displayType')} className="flex gap-1">
                                    <button type="button" aria-label={t('genres.grid')} aria-pressed={viewType === 'grid'} onClick={() => setViewType('grid')}
                                        className={`${buttonClass} ${viewType === 'grid' ? 'bg-red-600' : 'bg-white/5 text-white/70'}`}><LayoutGrid aria-hidden="true" className={`h-4 w-4 text-white ${viewType === 'grid' ? '' : 'opacity-70'}`} /></button>
                                    <button type="button" aria-label={t('genres.listView')} aria-pressed={viewType === 'list'} onClick={() => setViewType('list')}
                                        className={`${buttonClass} ${viewType === 'list' ? 'bg-red-600' : 'bg-white/5 text-white/70'}`}><List aria-hidden="true" className={`h-4 w-4 text-white ${viewType === 'list' ? '' : 'opacity-70'}`} /></button>
                                </div>
                            </div>
                        </div>

                        {error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-950/40 p-4">
                            <p className="text-sm text-white/90">{t('errors.contentLoadError')}</p>
                            <button type="button" onClick={() => setRetry(value => value + 1)} className={`${buttonClass} bg-white/5`}>{t('common.retry')}</button>
                        </div>}

                        <div aria-busy={loading} aria-label={t('providerCatalog.catalogResults')}>
                            {!data && loading ? <GridSkeleton gridClassName={gridClasses} viewType={viewType} />
                                : data && data.items.length > 0 ? <div className={`transition-opacity duration-150 motion-reduce:transition-none ${loading ? 'opacity-50' : 'opacity-100'}`}>
                                    {viewType === 'grid' ? <div className={`grid ${gridClasses} gap-3`}>
                                        {data.items.map((item, index) => <SearchGridCard key={`${item.media_type}-${item.id}`} item={item} index={index}
                                            animateEntrance={false} movieLabel={t('filter.movies')} serieLabel={t('filter.series')} />)}
                                    </div> : <div className="flex flex-col gap-3">
                                        {data.items.map((item, index) => <SearchListCard key={`${item.media_type}-${item.id}`} item={item} index={index}
                                            animateEntrance={false} movieLabel={t('filter.movies')} serieLabel={t('filter.series')}
                                            watchlistLabel={t('search.watchlist')} removeLabel={t('genres.remove')} noDescLabel={t('providerCatalog.noDescription')} />)}
                                    </div>}
                                </div> : !loading && !error && <div className="py-16 text-center">
                                    <p className="text-lg font-medium">{t('providerCatalog.noContent')}</p>
                                    <p className="mt-2 text-sm text-white/60">{t('providerCatalog.tryOtherFilters')}</p>
                                    {activeCount > 0 && <button type="button" onClick={resetFilters} className={`${buttonClass} mt-5 bg-white/5`}>{t('filter.reset')}</button>}
                                </div>}
                        </div>

                        {data && totalPages > 1 && <nav aria-label={t('providerCatalog.pagination')} className="my-8 flex flex-wrap items-center justify-center gap-1.5">
                            {pageNumbers.map((page, index) => <React.Fragment key={page}>
                                {index > 0 && page - pageNumbers[index - 1] > 1 && <span aria-hidden="true" className="px-1 text-white/50">…</span>}
                                <button type="button" onClick={() => handlePageChange(page)} disabled={loading || error || page === currentPage}
                                    aria-label={t('providerCatalog.pageNumber', { page })} aria-current={page === currentPage ? 'page' : undefined}
                                    className={`${buttonClass} min-w-11 ${page === currentPage ? 'border-red-600 bg-red-600 text-white disabled:opacity-100' : 'bg-white/5 text-white/70'}`}>
                                    {page}
                                </button>
                            </React.Fragment>)}
                        </nav>}
                    </div>
                </div>
            </div>
        </SquareBackground>
    );
};

export default ProviderCatalogPage;
