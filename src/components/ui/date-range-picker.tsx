import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { getOverlayPortalRoot } from '@/utils/overlayPortal';

// Sélecteur de période : raccourcis à gauche, deux mois côte à côte (un seul
// sur téléphone), plage choisie en deux clics. Les dates circulent en texte
// « AAAA-MM-JJ » et sont calculées en UTC : aucun décalage de fuseau possible.

export interface DateRange {
  from: string;
  to: string;
}

export interface DateRangePreset {
  id: string;
  label: string;
  range: DateRange;
}

interface DateRangePickerProps {
  value: DateRange;
  // Raccourci actif (sa plage est `value`), ou null pour des dates choisies à la main.
  activePresetId: string | null;
  presets: DateRangePreset[];
  onChange: (range: DateRange, presetId: string | null) => void;
  // Dernier jour sélectionnable (aujourd'hui).
  maxDate: string;
  // Écart maximal entre les deux dates, bornes comprises.
  maxSpanDays?: number;
  locale: string;
  labels: {
    trigger: string;
    previousMonth: string;
    nextMonth: string;
    pickEnd: string;
  };
  className?: string;
}

const DAY_MS = 86_400_000;
const PANEL_MARGIN = 8;

const keyToUtc = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const utcToKey = (time: number) => new Date(time).toISOString().slice(0, 10);
const shiftDays = (key: string, days: number) => utcToKey(keyToUtc(key) + days * DAY_MS);
const monthOf = (key: string) => key.slice(0, 7);
const shiftMonth = (month: string, delta: number) => {
  const [year, monthIndex] = month.split('-').map(Number);
  return utcToKey(Date.UTC(year, monthIndex - 1 + delta, 1)).slice(0, 7);
};
const orderRange = (a: string, b: string): DateRange => (a <= b ? { from: a, to: b } : { from: b, to: a });

// Cases d'un mois, semaine commençant le lundi : null pour les cases vides.
const buildMonthCells = (month: string): Array<string | null> => {
  const [year, monthIndex] = month.split('-').map(Number);
  const first = Date.UTC(year, monthIndex - 1, 1);
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const leading = (new Date(first).getUTCDay() + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 0; day < daysInMonth; day += 1) cells.push(utcToKey(first + day * DAY_MS));
  return cells;
};

const formatKey = (locale: string, key: string, options: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(keyToUtc(key)));
  } catch {
    return key;
  }
};

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

// Libellé compact d'une plage : « 23 oct. 2026 », « 19 – 23 oct. 2026 »,
// « 28 sept. – 4 oct. 2026 » ou « 20 déc. 2025 – 3 janv. 2026 ».
const formatDateRange = (locale: string, range: DateRange) => {
  if (range.from === range.to) {
    return formatKey(locale, range.from, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  const sameMonth = sameYear && monthOf(range.from) === monthOf(range.to);
  const start = formatKey(locale, range.from, sameMonth
    ? { day: 'numeric' }
    : sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${start} – ${formatKey(locale, range.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
};

const useWideScreen = () => {
  const query = '(min-width: 640px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
};

interface MonthGridProps {
  month: string;
  locale: string;
  maxDate: string;
  shown: DateRange | null;
  // Plage provisoire (premier clic fait, pointeur sur une autre date).
  pending: boolean;
  start: string | null;
  today: string;
  onPick: (day: string) => void;
  onHover: (day: string | null) => void;
  header: React.ReactNode;
}

const MonthGrid: React.FC<MonthGridProps> = ({ month, locale, maxDate, shown, pending, start, today, onPick, onHover, header }) => {
  const cells = useMemo(() => buildMonthCells(month), [month]);
  // Initiales des jours, du lundi au dimanche (le 5 janvier 1970 est un lundi).
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => formatKey(locale, utcToKey((4 + index) * DAY_MS), { weekday: 'narrow' })),
    [locale]
  );

  return (
    <div className="w-[17.5rem] shrink-0">
      {header}
      <div className="mt-3 grid grid-cols-7 text-center text-[11px] font-medium uppercase text-white/40" aria-hidden="true">
        {weekdays.map((weekday, index) => <span key={index} className="py-1">{weekday}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7" role="grid" onMouseLeave={() => onHover(null)}>
        {cells.map((day, index) => {
          if (!day) {
            return <span key={`empty-${index}`} aria-hidden="true" />;
          }
          const disabled = day > maxDate;
          const inRange = Boolean(shown && day >= shown.from && day <= shown.to);
          const isFrom = shown?.from === day;
          const isTo = shown?.to === day;
          const isEdge = isFrom || isTo || start === day;
          const single = Boolean(shown && shown.from === shown.to);
          const column = index % 7;
          return (
            <div key={day} className="relative flex h-10 items-center justify-center" role="gridcell">
              {/* Bande de la plage, coupée en deux sous la première et la dernière date. */}
              {inRange && !single && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-y-1',
                    pending ? 'bg-amber-300/10' : 'bg-amber-300/[0.16]',
                    isFrom ? 'left-1/2 right-0' : isTo ? 'left-0 right-1/2' : 'inset-x-0',
                    !isFrom && column === 0 && 'rounded-l-full',
                    !isTo && column === 6 && 'rounded-r-full'
                  )}
                />
              )}
              <button
                type="button"
                disabled={disabled}
                aria-pressed={isEdge}
                aria-label={formatKey(locale, day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                onClick={() => onPick(day)}
                onMouseEnter={() => onHover(day)}
                onFocus={() => onHover(day)}
                className={cn(
                  'relative z-[1] flex h-9 w-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70',
                  disabled
                    ? 'cursor-default text-white/20'
                    : isEdge
                      ? 'bg-amber-300 font-semibold text-neutral-950'
                      : inRange
                        ? 'text-white hover:bg-white/10'
                        : 'text-white/80 hover:bg-white/10 hover:text-white',
                  day === today && !isEdge && !disabled && 'ring-1 ring-inset ring-white/30'
                )}
              >
                {Number(day.slice(8))}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DateRangePicker: React.FC<DateRangePickerProps> = ({
  value,
  activePresetId,
  presets,
  onChange,
  maxDate,
  maxSpanDays,
  locale,
  labels,
  className
}) => {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Mois affiché à droite (ou seul sur téléphone).
  const [viewMonth, setViewMonth] = useState(() => monthOf(value.to));
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const wide = useWideScreen();

  const close = useCallback(() => {
    setOpen(false);
    setStart(null);
    setHover(null);
  }, []);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setViewMonth(monthOf(value.to));
    setOpen(true);
  };

  // Panneau calé sous le bouton, gardé dans l'écran.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const panelWidth = panelRef.current?.offsetWidth ?? 0;
    const viewportWidth = document.documentElement.clientWidth;
    const left = Math.max(PANEL_MARGIN, Math.min(rect.left, viewportWidth - panelWidth - PANEL_MARGIN));
    const top = rect.bottom + 6;
    setPosition({ top, left, maxHeight: Math.max(240, window.innerHeight - top - PANEL_MARGIN) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition, wide]);

  // Fermeture : clic en dehors, Échap (le focus revient au bouton).
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  // Lenis (défilement doux du site) ne doit pas voler la molette du panneau.
  useEffect(() => {
    if (!open) return undefined;
    const lenis = (window as unknown as { lenis?: { stop: () => void; start: () => void } }).lenis;
    lenis?.stop();
    return () => lenis?.start();
  }, [open]);

  const pick = (day: string) => {
    if (!start) {
      setStart(day);
      return;
    }
    let range = orderRange(start, day);
    if (maxSpanDays && (keyToUtc(range.to) - keyToUtc(range.from)) / DAY_MS + 1 > maxSpanDays) {
      range = { from: shiftDays(range.to, -(maxSpanDays - 1)), to: range.to };
    }
    onChange(range, null);
    close();
    triggerRef.current?.focus();
  };

  const choosePreset = (preset: DateRangePreset) => {
    onChange(preset.range, preset.id);
    close();
    triggerRef.current?.focus();
  };

  // Pendant le choix : du premier clic à la date sous le pointeur.
  const shown: DateRange | null = start ? orderRange(start, hover ?? start) : value;
  const months = wide ? [shiftMonth(viewMonth, -1), viewMonth] : [viewMonth];
  const canGoNext = viewMonth < monthOf(maxDate);
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? null;

  const navButtonClass = cn(
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition-colors',
    'hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70',
    'disabled:pointer-events-none disabled:opacity-25'
  );

  const monthHeader = (month: string, index: number) => (
    <div className="flex h-8 items-center justify-between">
      {index === 0 ? (
        <button type="button" className={navButtonClass} aria-label={labels.previousMonth} onClick={() => setViewMonth((current) => shiftMonth(current, -1))}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : <span className="w-8" aria-hidden="true" />}
      <p className="text-sm font-semibold text-white" aria-live="polite">
        {capitalize(formatKey(locale, `${month}-01`, { month: 'long', year: 'numeric' }))}
      </p>
      {index === months.length - 1 ? (
        <button
          type="button"
          className={navButtonClass}
          aria-label={labels.nextMonth}
          disabled={!canGoNext}
          onClick={() => setViewMonth((current) => shiftMonth(current, 1))}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : <span className="w-8" aria-hidden="true" />}
    </div>
  );

  const panel = open ? (
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label={labels.trigger}
      data-lenis-prevent
      style={{
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        maxHeight: position?.maxHeight,
        visibility: position ? 'visible' : 'hidden',
        zIndex: 100000
      }}
      className={cn(
        'flex max-w-[calc(100vw-16px)] flex-col overflow-y-auto overscroll-contain rounded-2xl border border-white/10',
        'bg-neutral-950/95 text-white shadow-2xl shadow-black/60 backdrop-blur-xl sm:flex-row',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:[animation-duration:150ms]'
      )}
    >
      {/* Raccourcis : colonne à gauche, rangée au-dessus sur téléphone. */}
      <div className="flex flex-wrap gap-2 border-b border-white/10 p-3 sm:w-44 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r sm:p-4">
        {presets.map((preset) => {
          const active = preset.id === activePresetId;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => choosePreset(preset)}
              className={cn(
                'self-start rounded-full px-3 py-1.5 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70',
                active ? 'bg-amber-300 font-medium text-neutral-950' : 'bg-white/[0.08] text-white/80 hover:bg-white/[0.14] hover:text-white'
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-col p-3 sm:p-4">
        <div className="flex gap-6">
          {months.map((month, index) => (
            <MonthGrid
              key={month}
              month={month}
              locale={locale}
              maxDate={maxDate}
              shown={shown}
              pending={Boolean(start)}
              start={start}
              today={maxDate}
              onPick={pick}
              onHover={setHover}
              header={monthHeader(month, index)}
            />
          ))}
        </div>
        <p className="mt-2 min-h-5 text-xs text-white/45" aria-live="polite">
          {start ? labels.pickEnd : formatDateRange(locale, value)}
        </p>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={labels.trigger}
        onClick={toggle}
        className={cn(
          'flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-left text-sm text-white',
          'transition-colors hover:border-white/20 hover:bg-white/10',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60',
          open && 'border-white/25 bg-white/10',
          className
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-white opacity-60" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {activePreset ? (
            <>
              <span className="font-medium">{activePreset.label}</span>
              <span className="ml-2 text-white/45">{formatDateRange(locale, value)}</span>
            </>
          ) : formatDateRange(locale, value)}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-white opacity-50 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {panel && createPortal(panel, getOverlayPortalRoot())}
    </>
  );
};

export default DateRangePicker;
