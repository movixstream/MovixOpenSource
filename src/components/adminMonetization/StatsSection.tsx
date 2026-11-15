import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, BarChart3, Loader2, RefreshCw } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '@/lib/utils';
import {
  MONETIZATION_PLACEMENT_IDS,
  getMonetizationStats,
  type MonetizationAd,
  type MonetizationStatsResult
} from '../../services/monetizationAdminService';
import { SettingsNotice, SettingsSection } from '../adminVipDonations/SettingsUi';
import { Button } from '../ui/button';
import DateRangePicker, { type DateRange } from '../ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Skeleton } from '../ui/Skeleton';
import {
  STATS_DEFAULT_PERIOD,
  STATS_MAX_RANGE_DAYS,
  STATS_PERIOD_PRESETS,
  buildMonetizationPeriodStats,
  getParisDateKey,
  getStatsCustomRange,
  getStatsPeriodRange,
  resolveStatsGranularity,
  type MonetizationStatsBucket,
  type StatsPeriodPreset,
  type StatsPeriodRange,
  type StatsPlacementFilter
} from './monetizationForm';
import { AdBadge } from './MonetizationUi';
import {
  AD_NEUTRAL_COLOR,
  AD_SERIES_COLORS,
  PLACEMENT_ICONS,
  formatInteger,
  getAdColor,
  useMonetizationText
} from './monetizationUiHelpers';

export type StatsLoadState = 'loading' | 'ready' | 'error';

interface StatsSectionProps {
  // Pubs du brouillon (couleurs et noms affichés) puis pubs enregistrées (noms de secours).
  ads: MonetizationAd[];
  savedAds: MonetizationAd[];
  // Prévient le parent d'un « Actualiser » : son bandeau et la liste des pubs suivent.
  onRefresh?: () => void;
}

// Encre et traits du graphique : texte en tons neutres, jamais à la couleur
// d'une série ; grille en filet discret.
const INK_MUTED = 'rgba(255,255,255,0.45)';
const GRID_COLOR = 'rgba(255,255,255,0.07)';
const AXIS_COLOR = 'rgba(255,255,255,0.18)';
// « Sans pub dispo » n'est pas une pub : un gris plus sombre que « Autres pubs ».
const NONE_COLOR = '#3b3b38';
const SEGMENT_GAP = 2;
const SEGMENT_RADIUS = 4;

// Une période déjà chargée reste valable une minute : passer d'une période à
// l'autre ne relance pas d'appel ; « Actualiser » passe outre.
const STATS_CACHE_TTL_MS = 60_000;
const STATS_CACHE_MAX_ENTRIES = 12;
const DETAIL_ROWS_COLLAPSED = 12;

type SeriesKey = string;

interface ChartSeries {
  key: SeriesKey;
  label: string;
  color: string;
}

interface ChartRow {
  key: string;
  [series: SeriesKey]: number | string;
}

interface SegmentShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: ChartRow;
}

interface ShownStats {
  range: StatsPeriodRange;
  result: MonetizationStatsResult;
}

const isSameRange = (a: StatsPeriodRange, b: StatsPeriodRange) => (
  a.from === b.from && a.to === b.to && a.previousFrom === b.previousFrom && a.previousTo === b.previousTo
);

const dateFromKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatDate = (locale: string, key: string, options: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(dateFromKey(key));
  } catch {
    return key;
  }
};

type RangeFormatter = Intl.DateTimeFormat & { formatRange?: (start: Date, end: Date) => string };

// « 24–27 sept. », « 24 sept. – 23 oct. 2026 » : formatRange quand le
// navigateur le connaît, sinon deux dates séparées par un tiret.
const formatDateRange = (locale: string, from: string, to: string, options: Intl.DateTimeFormatOptions) => {
  if (from === to) {
    return formatDate(locale, from, options);
  }
  try {
    const formatter: RangeFormatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    if (typeof formatter.formatRange === 'function') {
      return formatter.formatRange(dateFromKey(from), dateFromKey(to));
    }
  } catch {
    // Repli ci-dessous.
  }
  return `${formatDate(locale, from, options)} – ${formatDate(locale, to, options)}`;
};

const formatCompact = (locale: string, value: number) => {
  try {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  } catch {
    return String(value);
  }
};

const formatDecimal = (locale: string, value: number) => {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  } catch {
    return String(Math.round(value * 10) / 10);
  }
};

// 0,12 → « 12 % » ; avec `signed`, « +12 % » / « −12 % ». Une décimale sous 10 %.
const formatPercent = (locale: string, value: number, signed = false) => {
  const digits = value !== 0 && Math.abs(value) < 0.1 ? 1 : 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: digits,
      signDisplay: signed ? 'exceptZero' : 'auto'
    }).format(value);
  } catch {
    const text = `${(Math.abs(value) * 100).toFixed(digits)} %`;
    return signed && value !== 0 ? `${value > 0 ? '+' : '−'}${text}` : text;
  }
};

// Segment d'une colonne empilée : 2 px de vide sous chaque segment posé sur un
// autre, et coins arrondis seulement en haut de la colonne.
const StackSegment: React.FC<SegmentShapeProps & { isTop: boolean; isBottom: boolean }> = ({
  x = 0, y = 0, width = 0, height = 0, fill, isTop, isBottom
}) => {
  const visibleHeight = height - (isBottom ? 0 : SEGMENT_GAP);
  if (width <= 0 || visibleHeight <= 0) {
    return <g />;
  }
  const radius = isTop ? Math.min(SEGMENT_RADIUS, visibleHeight, width / 2) : 0;
  const bottom = y + visibleHeight;
  const path = radius > 0
    ? `M${x},${bottom} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + width - radius} `
      + `Q${x + width},${y} ${x + width},${y + radius} V${bottom} Z`
    : `M${x},${bottom} V${y} H${x + width} V${bottom} Z`;
  return <path d={path} fill={fill} />;
};

// Variation : flèche + signe + texte, en vert ou en rouge selon que la hausse
// est une bonne nouvelle ; jamais la couleur seule.
const ChangeText: React.FC<{
  change: number | null;
  upIsGood: boolean;
  t: TFunction;
  locale: string;
  context?: string;
  emptyText?: string;
  className?: string;
}> = ({ change, upIsGood, t, locale, context, emptyText, className }) => {
  if (change === null) {
    return emptyText
      ? <span className={cn('text-white/35', className)}>{emptyText}</span>
      : (
        <span className={cn('text-white/30', className)}>
          <span aria-hidden="true">—</span>
          <span className="sr-only">{t('admin.monetization.stats.delta.none')}</span>
        </span>
      );
  }

  if (Math.abs(change) < 0.0005) {
    return (
      <span className={cn('text-white/50', className)}>
        {t('admin.monetization.stats.delta.flat')}
        {context && <span className="text-white/35"> {context}</span>}
      </span>
    );
  }

  const up = change > 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const spoken = t(up ? 'admin.monetization.stats.delta.up' : 'admin.monetization.stats.delta.down', {
    value: formatPercent(locale, Math.abs(change))
  });

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-1', className)}>
      <span
        aria-hidden="true"
        className={cn('inline-flex items-center gap-0.5 font-semibold tabular-nums', good ? 'text-emerald-300' : 'text-red-300')}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {formatPercent(locale, change, true)}
      </span>
      {context && <span aria-hidden="true" className="text-white/40">{context}</span>}
      <span className="sr-only">{context ? `${spoken} ${context}` : spoken}</span>
    </span>
  );
};

const tileClass = 'min-w-0 rounded-xl border border-white/10 bg-black/20 px-3.5 py-3';
const tableHeadClass = 'text-[11px] font-semibold uppercase tracking-wider text-white/40';
const numberCellClass = 'min-w-[3rem] text-right tabular-nums';
const detailGridClass = 'grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-2 sm:gap-x-4';

// ─── Statistiques : filtres, chiffres clés, colonnes, détail, pubs, emplacements ───

const StatsSection: React.FC<StatsSectionProps> = ({ ads, savedAds, onRefresh }) => {
  const { t, locale } = useMonetizationText();
  // Raccourci choisi, ou null quand les dates ont été prises à la main dans le calendrier.
  const [preset, setPreset] = useState<StatsPeriodPreset | null>(STATS_DEFAULT_PERIOD);
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [placement, setPlacement] = useState<StatsPlacementFilter>('all');
  const [showAllRows, setShowAllRows] = useState(false);
  const [localToday, setLocalToday] = useState(() => getParisDateKey());
  // Jour de Paris et premier jour en base selon le serveur (null tant qu'il ne les a pas donnés).
  const [serverDates, setServerDates] = useState<{ today: string | null; firstDate: string | null }>({
    today: null,
    firstDate: null
  });
  const [status, setStatus] = useState<StatsLoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  // Dernières données reçues, avec la période qu'elles couvrent : affichées
  // (atténuées) pendant le chargement d'une autre période.
  const [shown, setShown] = useState<ShownStats | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const cacheRef = useRef(new Map<string, { result: MonetizationStatsResult; fetchedAt: number }>());
  const forceReloadRef = useRef(false);
  const number = (value: number) => formatInteger(locale, value);

  const today = serverDates.today ?? localToday;
  const firstDateForRange = preset === 'all' ? serverDates.firstDate : null;
  const range = useMemo(
    () => (preset || !customRange
      ? getStatsPeriodRange(preset ?? STATS_DEFAULT_PERIOD, { today, firstDate: firstDateForRange })
      : getStatsCustomRange(customRange.from, customRange.to)),
    [customRange, firstDateForRange, preset, today]
  );
  // Raccourcis du calendrier, recalculés quand le jour change.
  const pickerPresets = useMemo(() => STATS_PERIOD_PRESETS.map((id) => {
    const presetRange = getStatsPeriodRange(id, { today });
    return {
      id,
      label: t(`admin.monetization.stats.periods.${id}`),
      range: { from: presetRange.from, to: presetRange.to }
    };
  }), [t, today]);
  // Un seul appel couvre la période et celle d'avant : les variations n'en demandent pas d'autre.
  const fetchFrom = range.previousFrom ?? range.from;
  const fetchKey = `${fetchFrom}|${range.to}`;

  useEffect(() => {
    const force = forceReloadRef.current;
    forceReloadRef.current = false;
    const cache = cacheRef.current;
    const cached = cache.get(fetchKey);
    if (cached && !force && Date.now() - cached.fetchedAt < STATS_CACHE_TTL_MS) {
      setShown({ range, result: cached.result });
      setStatus('ready');
      setError(null);
      return undefined;
    }

    const controller = new AbortController();
    setStatus('loading');
    setError(null);
    getMonetizationStats({ from: fetchFrom, to: range.to }, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        cache.delete(fetchKey);
        cache.set(fetchKey, { result, fetchedAt: Date.now() });
        while (cache.size > STATS_CACHE_MAX_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        setServerDates((current) => (
          current.today === result.today && current.firstDate === result.firstDate
            ? current
            : { today: result.today, firstDate: result.firstDate }
        ));
        setShown({ range, result });
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(reason instanceof Error && reason.message ? reason.message : null);
        setStatus('error');
      });

    return () => controller.abort();
  }, [fetchFrom, fetchKey, range, reloadToken]);

  const refresh = () => {
    forceReloadRef.current = true;
    setLocalToday(getParisDateKey());
    setReloadToken((value) => value + 1);
    onRefresh?.();
  };

  const chooseRange = (next: DateRange, presetId: string | null) => {
    if (presetId) {
      setPreset(presetId as StatsPeriodPreset);
      setCustomRange(null);
    } else {
      setPreset(null);
      setCustomRange(next);
    }
    setShowAllRows(false);
  };

  // Regroupement choisi tout seul : jour jusqu'à 31 jours, semaine jusqu'à 92, mois au-delà.
  const selectedGranularity = resolveStatsGranularity(null, range.from, range.to);

  const view = useMemo(() => {
    if (!shown) {
      return null;
    }
    const { range: shownRange, result } = shown;
    return buildMonetizationPeriodStats(result.days, {
      ...shownRange,
      granularity: resolveStatsGranularity(null, shownRange.from, shownRange.to),
      placement,
      today: result.today ?? localToday,
      firstDate: result.firstDate
    });
  }, [localToday, placement, shown]);

  // Une ligne par pub de la liste, puis les pubs supprimées qui ont encore des
  // chiffres. La couleur suit la place de la pub dans la liste, jamais son rang.
  const adRows = useMemo(() => {
    if (!view) {
      return [];
    }
    const draftIds = new Set(ads.map((ad) => ad.id));
    const savedNames = new Map(savedAds.map((ad) => [ad.id, ad.name.trim()]));
    const rows = ads.map((ad, index) => ({
      id: ad.id,
      index,
      name: ad.name.trim() || savedNames.get(ad.id) || t('admin.monetization.ads.unnamed'),
      deleted: false,
      counts: view.perAd[ad.id] ?? { period: 0, today: 0 }
    }));
    const removed = Object.entries(view.perAd)
      .filter(([id]) => !draftIds.has(id))
      .sort(([, a], [, b]) => b.period - a.period)
      .map(([id, counts]) => ({
        id,
        index: -1,
        name: savedNames.get(id) || t('admin.monetization.stats.deletedAd', { id }),
        deleted: true,
        counts
      }));
    return [...rows, ...removed];
  }, [ads, savedAds, t, view]);

  // Séries du graphique, de bas en haut : les 8 premières pubs de la liste
  // gardent leur couleur ; les suivantes et les pubs supprimées sont regroupées
  // dans « Autres pubs » ; « Sans pub dispo » ferme la colonne.
  const { series, adSeries, rows, rowByKey, edges } = useMemo(() => {
    const empty = {
      series: [] as ChartSeries[],
      adSeries: [] as ChartSeries[],
      rows: [] as ChartRow[],
      rowByKey: new Map<string, ChartRow>(),
      edges: new Map<string, { top: string; bottom: string }>()
    };
    if (!view) {
      return empty;
    }
    const ownSeries = new Map<string, string>();
    adRows.forEach((row) => {
      if (row.index >= 0 && row.index < AD_SERIES_COLORS.length && row.counts.period > 0) {
        ownSeries.set(row.id, `ad_${row.id}`);
      }
    });
    const hasOther = adRows.some((row) => !ownSeries.has(row.id) && row.counts.period > 0);
    const adList: ChartSeries[] = [
      ...adRows
        .filter((row) => ownSeries.has(row.id))
        .map((row) => ({ key: ownSeries.get(row.id)!, label: row.name, color: getAdColor(row.index) })),
      ...(hasOther ? [{ key: 'other', label: t('admin.monetization.stats.legendOther'), color: AD_NEUTRAL_COLOR }] : [])
    ];
    const list: ChartSeries[] = [
      ...adList,
      ...(view.current.none > 0 ? [{ key: 'none', label: t('admin.monetization.stats.legendNone'), color: NONE_COLOR }] : [])
    ];

    const chartRows: ChartRow[] = [];
    const byKey = new Map<string, ChartRow>();
    const stackEdges = new Map<string, { top: string; bottom: string }>();
    for (const bucket of view.buckets) {
      const row: ChartRow = { key: bucket.key };
      for (const entry of list) row[entry.key] = 0;
      for (const [adId, count] of Object.entries(bucket.byAd)) {
        const key = ownSeries.get(adId) ?? 'other';
        row[key] = Number(row[key] ?? 0) + count;
      }
      if (bucket.none > 0) row.none = bucket.none;
      const filled = list.filter((entry) => Number(row[entry.key]) > 0);
      if (filled.length > 0) {
        stackEdges.set(bucket.key, { bottom: filled[0].key, top: filled[filled.length - 1].key });
      }
      chartRows.push(row);
      byKey.set(bucket.key, row);
    }
    return { series: list, adSeries: adList, rows: chartRows, rowByKey: byKey, edges: stackEdges };
  }, [adRows, t, view]);

  const bucketByKey = useMemo(
    () => new Map((view?.buckets ?? []).map((bucket) => [bucket.key, bucket])),
    [view]
  );

  // ─── Libellés selon le regroupement affiché ───

  const granularity = view?.granularity ?? selectedGranularity;
  const shortDate = (key: string) => formatDate(locale, key, { day: 'numeric', month: 'short' });
  const tickLabel = (key: string) => {
    if (granularity === 'week') {
      return t('admin.monetization.stats.weekTick', { date: shortDate(key) });
    }
    return granularity === 'month' ? formatDate(locale, key, { month: 'short', year: 'numeric' }) : shortDate(key);
  };
  const tooltipTitle = (bucket: MonetizationStatsBucket) => {
    if (granularity === 'week') {
      return t('admin.monetization.stats.weekOf', { date: formatDate(locale, bucket.key, { day: 'numeric', month: 'long' }) });
    }
    return granularity === 'month'
      ? formatDate(locale, bucket.key, { month: 'long', year: 'numeric' })
      : formatDate(locale, bucket.key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  const realDates = (bucket: MonetizationStatsBucket) => (
    formatDateRange(locale, bucket.from, bucket.to, { day: 'numeric', month: 'short' })
  );
  // Première ou dernière semaine (ou mois) coupée par la période : ses vraies dates.
  const partialText = (bucket: MonetizationStatsBucket) => (
    bucket.partial ? t('admin.monetization.stats.partialRange', { range: realDates(bucket) }) : null
  );
  const rowLabel = (bucket: MonetizationStatsBucket) => {
    if (granularity === 'week') {
      return shortDate(bucket.key);
    }
    return granularity === 'month'
      ? formatDate(locale, bucket.key, { month: 'short', year: 'numeric' })
      : formatDate(locale, bucket.key, { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const shareLabel = (row: ChartRow | undefined, served: number) => (
    row && served > 0
      ? adSeries
        .filter((entry) => Number(row[entry.key]) > 0)
        .map((entry) => t('admin.monetization.stats.detail.shareItem', {
          name: entry.label,
          value: formatPercent(locale, Number(row[entry.key]) / served)
        }))
        .join(', ')
      : t('admin.monetization.stats.tooltipEmpty')
  );

  const total = view ? view.current.served + view.current.none : 0;
  const placementMax = view
    ? Math.max(1, ...MONETIZATION_PLACEMENT_IDS.map((id) => view.perPlacement[id].served))
    : 1;
  const isStale = !shown || !isSameRange(shown.range, range);
  const isDimmed = Boolean(view) && (status === 'loading' || isStale);
  const detailRows = view ? [...view.buckets].reverse() : [];
  const visibleDetailRows = showAllRows ? detailRows : detailRows.slice(0, DETAIL_ROWS_COLLAPSED);
  const previous = view?.previous ?? null;
  const tileEmptyText = previous && !previous.complete
    ? t('admin.monetization.stats.delta.noHistory')
    : t('admin.monetization.stats.delta.noPrevious');
  const vsPrevious = t('admin.monetization.stats.delta.vsPrevious');

  const renderTileChange = (change: number | null, upIsGood: boolean) => (
    previous
      ? (
        <ChangeText
          change={change}
          upIsGood={upIsGood}
          t={t}
          locale={locale}
          context={vsPrevious}
          emptyText={tileEmptyText}
          className="mt-1.5 text-xs"
        />
      )
      : null
  );

  return (
    <SettingsSection
      id="monetization-stats"
      icon={BarChart3}
      title={t('admin.monetization.stats.title')}
      description={t('admin.monetization.stats.description')}
    >
      <div className="space-y-5">
        {/* Filtres : deux menus déroulants, au-dessus de tout ce qu'ils filtrent.
            Le regroupement (jour, semaine, mois) suit la période tout seul. */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:max-w-2xl sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="min-w-0">
              <span className={cn(tableHeadClass, 'mb-1.5 block')}>{t('admin.monetization.stats.periodLabel')}</span>
              <DateRangePicker
                value={{ from: range.from, to: range.to }}
                activePresetId={preset}
                presets={pickerPresets}
                onChange={chooseRange}
                maxDate={today}
                maxSpanDays={STATS_MAX_RANGE_DAYS}
                locale={locale}
                labels={{
                  trigger: t('admin.monetization.stats.periodLabel'),
                  previousMonth: t('admin.monetization.stats.datePicker.previousMonth'),
                  nextMonth: t('admin.monetization.stats.datePicker.nextMonth'),
                  pickEnd: t('admin.monetization.stats.datePicker.pickEnd')
                }}
              />
            </div>
            <label className="min-w-0">
              <span className={cn(tableHeadClass, 'mb-1.5 block')}>{t('admin.monetization.stats.placementLabel')}</span>
              <Select value={placement} onValueChange={(value) => setPlacement(value as StatsPlacementFilter)}>
                <SelectTrigger aria-label={t('admin.monetization.stats.placementLabel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.monetization.stats.placementAll')}</SelectItem>
                  {MONETIZATION_PLACEMENT_IDS.map((id) => (
                    <SelectItem key={id} value={id}>{t(`admin.monetization.placements.names.${id}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={status === 'loading'}>
            {status === 'loading'
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            {t('admin.monetization.stats.refresh')}
          </Button>
        </div>

        {status === 'error' && (
          <SettingsNotice tone="danger">
            <p>{t('admin.monetization.stats.error')}</p>
            {error && <p className="mt-1 text-xs opacity-80">{error}</p>}
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={refresh}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t('admin.monetization.stats.retry')}
            </Button>
          </SettingsNotice>
        )}

        {status === 'loading' && !view && (
          <div className="space-y-3" aria-busy="true">
            <span className="sr-only" role="status">{t('admin.monetization.stats.loading')}</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((index) => <Skeleton key={index} variant="button" height={88} />)}
            </div>
            <Skeleton variant="button" height={300} />
          </div>
        )}

        {view && (
          // Pendant un chargement, l'affichage précédent reste en place, atténué.
          <div className={cn('space-y-5 transition-opacity', isDimmed && 'opacity-60')} aria-busy={status === 'loading'}>
            {/* Dates exactes de la période et de celle qui sert de comparaison. */}
            <p className="text-xs leading-5 text-white/50">
              <span className="font-medium text-white/75">
                {formatDateRange(locale, view.current.from, view.current.to, { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              {' · '}
              {t('admin.monetization.stats.dayCount', { count: view.current.days })}
              {previous && ' · '}
              {previous && (previous.complete
                ? t('admin.monetization.stats.comparedTo', {
                  range: formatDateRange(locale, previous.from, previous.to, { day: 'numeric', month: 'short', year: 'numeric' })
                })
                : t('admin.monetization.stats.comparisonIncomplete', {
                  date: formatDate(locale, shown?.result.firstDate ?? previous.to, { day: 'numeric', month: 'long', year: 'numeric' })
                }))}
            </p>

            {/* Chiffres clés de la période, avec la variation par rapport à la précédente. */}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className={tileClass}>
                <dt className="text-xs text-white/50">{t('admin.monetization.stats.tiles.openings')}</dt>
                <dd className="mt-1">
                  <span className="block text-2xl font-semibold text-white">{number(view.current.served)}</span>
                  {renderTileChange(view.changes.served, true)}
                </dd>
              </div>
              <div className={tileClass}>
                <dt className="text-xs text-white/50">{t('admin.monetization.stats.tiles.perDay')}</dt>
                <dd className="mt-1">
                  <span className="block text-2xl font-semibold text-white">{formatDecimal(locale, view.current.average)}</span>
                  {renderTileChange(view.changes.average, true)}
                </dd>
              </div>
              <div className={tileClass}>
                <dt className="text-xs text-white/50">{t('admin.monetization.stats.tiles.bestDay')}</dt>
                <dd className="mt-1">
                  <span className={cn('block text-2xl font-semibold', view.current.bestDay ? 'text-white' : 'text-white/40')}>
                    {view.current.bestDay ? number(view.current.bestDay.count) : '—'}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-white/55">
                    {view.current.bestDay
                      ? formatDate(locale, view.current.bestDay.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
                      : t('admin.monetization.stats.tiles.bestDayNone')}
                  </span>
                  {renderTileChange(view.changes.bestDay, true)}
                </dd>
              </div>
              <div className={tileClass}>
                <dt className="text-xs text-white/50">{t('admin.monetization.stats.tiles.none')}</dt>
                <dd className="mt-1">
                  <span className={cn('block text-2xl font-semibold', view.current.none > 0 ? 'text-white' : 'text-white/40')}>
                    {number(view.current.none)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-white/55">
                    {t('admin.monetization.stats.tiles.noneShare', {
                      value: formatPercent(locale, total > 0 ? view.current.none / total : 0)
                    })}
                  </span>
                  {/* Plus de « sans pub », c'est moins de pubs servies : la hausse est en rouge. */}
                  {renderTileChange(view.changes.none, false)}
                </dd>
              </div>
            </dl>

            {total === 0 && <SettingsNotice tone="info">{t('admin.monetization.stats.empty')}</SettingsNotice>}

            {/* Colonnes empilées par jour, semaine ou mois, une couleur par pub. */}
            <div className="rounded-xl border border-white/10 bg-black/20 p-3.5 sm:p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                <p className="text-sm font-semibold text-white">{t(`admin.monetization.stats.chartTitle.${granularity}`)}</p>
                {series.length > 0 && (
                  <ul className="flex min-w-0 flex-wrap gap-x-3.5 gap-y-1.5">
                    {series.map((entry) => (
                      <li key={entry.key} className="inline-flex min-w-0 items-center gap-1.5 text-xs text-white/70">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                        <span className="max-w-[10rem] truncate">{entry.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4 h-64 w-full" role="img" aria-label={t('admin.monetization.stats.chartAria')}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ top: 4, right: 4, left: -12, bottom: 0 }} barCategoryGap="22%">
                    <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                    <XAxis
                      dataKey="key"
                      tickFormatter={(value: string) => tickLabel(value)}
                      tick={{ fill: INK_MUTED, fontSize: 11 }}
                      axisLine={{ stroke: AXIS_COLOR }}
                      tickLine={false}
                      tickMargin={8}
                      minTickGap={18}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      allowDecimals={false}
                      tickFormatter={(value: number) => formatCompact(locale, value)}
                      tick={{ fill: INK_MUTED, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      isAnimationActive={false}
                      content={({ active, payload }) => {
                        const row = active ? (payload?.[0]?.payload as ChartRow | undefined) : undefined;
                        const bucket = row ? bucketByKey.get(String(row.key)) : undefined;
                        if (!row || !bucket) {
                          return null;
                        }
                        const lines = adSeries.filter((entry) => Number(row[entry.key]) > 0).reverse();
                        const subtitle = granularity === 'week' ? (partialText(bucket) ?? realDates(bucket)) : partialText(bucket);
                        return (
                          <div className="min-w-[11rem] max-w-[16rem] rounded-xl border border-white/10 bg-neutral-950/95 px-3 py-2.5 text-xs shadow-xl">
                            <p className="font-semibold text-white/80">{tooltipTitle(bucket)}</p>
                            {subtitle && <p className="mt-0.5 text-white/45">{subtitle}</p>}
                            {lines.length === 0 && bucket.none === 0 ? (
                              <p className="mt-1.5 text-white/45">{t('admin.monetization.stats.tooltipEmpty')}</p>
                            ) : (
                              <ul className="mt-1.5 space-y-1">
                                {lines.map((entry) => (
                                  <li key={entry.key} className="flex items-center gap-2">
                                    <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                                    <span className="font-semibold tabular-nums text-white">{number(Number(row[entry.key]))}</span>
                                    <span className="min-w-0 truncate text-white/55">{entry.label}</span>
                                  </li>
                                ))}
                                {lines.length > 1 && (
                                  <li className="mt-1 flex items-center gap-2 border-t border-white/10 pt-1.5">
                                    <span className="w-3 shrink-0" aria-hidden="true" />
                                    <span className="font-semibold tabular-nums text-white">{number(bucket.served)}</span>
                                    <span className="text-white/55">{t('admin.monetization.stats.tooltipTotal')}</span>
                                  </li>
                                )}
                                {bucket.none > 0 && (
                                  <li className={cn('flex items-center gap-2', lines.length > 0 && 'mt-1 border-t border-white/10 pt-1.5')}>
                                    <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: NONE_COLOR }} aria-hidden="true" />
                                    <span className="font-semibold tabular-nums text-white">{number(bucket.none)}</span>
                                    <span className="min-w-0 truncate text-white/55">{t('admin.monetization.stats.legendNone')}</span>
                                  </li>
                                )}
                              </ul>
                            )}
                          </div>
                        );
                      }}
                    />
                    {series.map((entry) => (
                      <Bar
                        key={entry.key}
                        dataKey={entry.key}
                        name={entry.label}
                        stackId="openings"
                        fill={entry.color}
                        maxBarSize={24}
                        isAnimationActive={false}
                        shape={(props: SegmentShapeProps) => {
                          const stack = props.payload ? edges.get(String(props.payload.key)) : undefined;
                          return (
                            <StackSegment
                              {...props}
                              isTop={stack?.top === entry.key}
                              isBottom={stack?.bottom === entry.key}
                            />
                          );
                        }}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Détail : la vue tableau du graphique, du plus récent au plus ancien. */}
            <div className="min-w-0">
              <p className="mb-2 text-sm font-semibold text-white">{t(`admin.monetization.stats.detail.title.${granularity}`)}</p>
              <div className="overflow-hidden rounded-xl border border-white/10">
                <div className={cn(detailGridClass, 'border-b border-white/10 bg-white/[0.03] px-3 py-2', tableHeadClass)}>
                  <span className="min-w-0 truncate">{t(`admin.monetization.stats.detail.col.${granularity}`)}</span>
                  <span className="min-w-[2.75rem] text-right">
                    <span className="sm:hidden">{t('admin.monetization.stats.detail.colOpeningsShort')}</span>
                    <span className="hidden sm:inline">{t('admin.monetization.stats.detail.colOpenings')}</span>
                  </span>
                  <span className="min-w-[2.75rem] text-right">{t('admin.monetization.stats.detail.colNone')}</span>
                  <span className="min-w-[3.5rem] text-right">{t('admin.monetization.stats.detail.colChange')}</span>
                </div>
                <ul className="divide-y divide-white/5">
                  {visibleDetailRows.map((bucket) => {
                    const row = rowByKey.get(bucket.key);
                    const partial = partialText(bucket);
                    return (
                      <li key={bucket.key} className="px-3 py-2.5 text-[13px] sm:text-sm">
                        <div className={detailGridClass}>
                          <span className="min-w-0">
                            <span className="block text-white/85">{rowLabel(bucket)}</span>
                            {partial && <span className="block text-[11px] leading-4 text-white/40">{partial}</span>}
                          </span>
                          <span className="min-w-[2.75rem] text-right font-semibold tabular-nums text-white">{number(bucket.served)}</span>
                          <span className={cn('min-w-[2.75rem] text-right tabular-nums', bucket.none > 0 ? 'text-white/75' : 'text-white/30')}>
                            {number(bucket.none)}
                          </span>
                          <ChangeText
                            change={bucket.change}
                            upIsGood
                            t={t}
                            locale={locale}
                            className="min-w-[3.5rem] justify-end text-right text-xs"
                          />
                        </div>
                        {/* Part de chaque pub dans les ouvertures du groupe. */}
                        <div
                          role="img"
                          aria-label={shareLabel(row, bucket.served)}
                          title={shareLabel(row, bucket.served)}
                          className="mt-1.5 flex h-1 gap-[2px] overflow-hidden rounded-full bg-white/[0.06]"
                        >
                          {row && bucket.served > 0 && adSeries
                            .filter((entry) => Number(row[entry.key]) > 0)
                            .map((entry) => (
                              <span
                                key={entry.key}
                                className="h-full min-w-[2px]"
                                style={{ flexGrow: Number(row[entry.key]), flexBasis: 0, backgroundColor: entry.color }}
                              />
                            ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs leading-5 text-white/40">{t('admin.monetization.stats.detail.changeHint')}</p>
                {detailRows.length > DETAIL_ROWS_COLLAPSED && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setShowAllRows((value) => !value)}>
                    {showAllRows
                      ? t('admin.monetization.stats.detail.showLess')
                      : t('admin.monetization.stats.detail.showAll', { count: detailRows.length })}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              {/* Par pub : total de la période, et du jour quand la période le contient. */}
              <div className="min-w-0">
                <p className="mb-2 text-sm font-semibold text-white">{t('admin.monetization.stats.perAdTitle')}</p>
                {adRows.length === 0 ? (
                  <p className="text-sm text-white/40">{t('admin.monetization.stats.noAds')}</p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-white/10">
                    <div
                      className={cn(
                        'grid items-center gap-x-3 border-b border-white/10 bg-white/[0.03] px-3 py-2',
                        view.includesToday ? 'grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto]',
                        tableHeadClass
                      )}
                    >
                      <span>{t('admin.monetization.stats.colAd')}</span>
                      {view.includesToday && <span className={numberCellClass}>{t('admin.monetization.stats.colToday')}</span>}
                      <span className={cn(numberCellClass, 'min-w-[4.5rem]')}>{t('admin.monetization.stats.colPeriod')}</span>
                    </div>
                    <ul className="divide-y divide-white/5">
                      {adRows.map((row) => {
                        const share = view.current.served > 0 ? row.counts.period / view.current.served : 0;
                        return (
                          <li key={row.id} className="px-3 py-2.5 text-sm">
                            <div
                              className={cn(
                                'grid items-center gap-x-3',
                                view.includesToday ? 'grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto]'
                              )}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <AdBadge index={row.index} size="sm" />
                                <span className={cn('truncate', row.deleted ? 'text-white/45' : 'text-white/85')}>{row.name}</span>
                              </span>
                              {view.includesToday && (
                                <span className={cn(numberCellClass, 'text-white/75')}>{number(row.counts.today)}</span>
                              )}
                              <span className={cn(numberCellClass, 'min-w-[4.5rem] font-semibold text-white')}>{number(row.counts.period)}</span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                                <span
                                  className="block h-full rounded-full"
                                  style={{ width: `${share * 100}%`, backgroundColor: getAdColor(row.index) }}
                                />
                              </span>
                              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-white/45">
                                {formatPercent(locale, share)}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>

              {/* Par emplacement : toutes les pubs de la période ; une ligne filtre le reste. */}
              <div className="min-w-0">
                <p className="mb-2 text-sm font-semibold text-white">{t('admin.monetization.stats.perPlacementTitle')}</p>
                <ul className="space-y-1.5">
                  {MONETIZATION_PLACEMENT_IDS.map((id) => {
                    const Icon = PLACEMENT_ICONS[id];
                    const counts = view.perPlacement[id];
                    const selected = placement === id;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setPlacement(selected ? 'all' : id)}
                          className={cn(
                            'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50',
                            selected ? 'border-amber-300/45 bg-amber-300/[0.07]' : 'border-white/10 bg-black/20 hover:border-white/20'
                          )}
                        >
                          <span className="flex items-center gap-2 text-sm">
                            <Icon className="h-4 w-4 shrink-0 text-white opacity-60" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-white/85">{t(`admin.monetization.placements.names.${id}`)}</span>
                            <span className="font-semibold tabular-nums text-white">{number(counts.served)}</span>
                          </span>
                          <span className="mt-1.5 flex items-center gap-2">
                            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                              <span
                                className="block h-full rounded-full bg-white/40"
                                style={{ width: `${(counts.served / placementMax) * 100}%` }}
                              />
                            </span>
                            <span className={cn('shrink-0 text-[11px] tabular-nums', counts.none > 0 ? 'text-amber-200/90' : 'text-white/35')}>
                              {t('admin.monetization.stats.noneCount', { value: number(counts.none) })}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-xs leading-5 text-white/40">{t('admin.monetization.stats.noneHint')}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  );
};

export default StatsSection;
