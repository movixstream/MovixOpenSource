import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  DEFAULT_MONETIZATION_SETTINGS,
  getAdminMonetizationSettings,
  getMonetizationStats,
  updateAdminMonetizationSettings,
  type MonetizationAd,
  type MonetizationPlacement,
  type MonetizationSettings,
  type MonetizationSettingsPayload,
  type MonetizationStatsDay,
  type PlacementId
} from '../services/monetizationAdminService';
import AdsSection from './adminMonetization/AdsSection';
import GeneralSection from './adminMonetization/GeneralSection';
import { FloatingMonetizationSaveBar, MonetizationSaveBar } from './adminMonetization/MonetizationSaveBar';
import { formatInteger } from './adminMonetization/monetizationUiHelpers';
import PlacementsSection from './adminMonetization/PlacementsSection';
import StatsSection, { type StatsLoadState } from './adminMonetization/StatsSection';
import {
  STATS_MONTH_DAYS,
  cloneMonetizationSettings,
  countLiveAds,
  getChangedMonetizationSections,
  normalizeMonetizationForSave,
  summarizeMonetizationStats,
  validateMonetizationSettings
} from './adminMonetization/monetizationForm';
import { Button } from './ui/button';
import ConfirmDialog from './ui/confirm-dialog';
import { Skeleton } from './ui/Skeleton';

type LoadState = 'loading' | 'ready' | 'error';

const SettingsSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div className="space-y-5" aria-busy="true">
    <span className="sr-only" role="status">{label}</span>
    <Skeleton variant="button" height={56} />
    {[0, 1, 2].map((index) => (
      <div key={index} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <Skeleton variant="button" width={40} height={40} />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton variant="text" width="45%" height={16} />
            <Skeleton variant="text" width="75%" height={12} />
          </div>
        </div>
        <div className="mt-5 space-y-3">
          <Skeleton variant="button" height={64} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton variant="button" height={40} />
            <Skeleton variant="button" height={40} />
            <Skeleton variant="button" height={40} />
          </div>
        </div>
      </div>
    ))}
  </div>
);

// « Valeurs par défaut » remet les réglages généraux et les emplacements, mais
// garde la liste des pubs : les défauts du serveur n'en ont aucune.
const withDefaultSettings = (settings: MonetizationSettings): MonetizationSettings => ({
  ...cloneMonetizationSettings(DEFAULT_MONETIZATION_SETTINGS),
  ads: settings.ads
});

const AdminMonetizationSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payload, setPayload] = useState<MonetizationSettingsPayload | null>(null);
  const [draft, setDraft] = useState<MonetizationSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [defaultsConfirmOpen, setDefaultsConfirmOpen] = useState(false);
  const [inlineBarNode, setInlineBarNode] = useState<HTMLDivElement | null>(null);
  const [isInlineBarVisible, setIsInlineBarVisible] = useState(true);
  const [statsState, setStatsState] = useState<StatsLoadState>('loading');
  const [statsDays, setStatsDays] = useState<MonetizationStatsDay[] | null>(null);
  const requestIdRef = useRef(0);
  const statsRequestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoadState('loading');
    setLoadError(null);

    try {
      const result = await getAdminMonetizationSettings();
      if (requestIdRef.current !== requestId) {
        return;
      }
      setPayload(result);
      setDraft(cloneMonetizationSettings(result.settings));
      setLoadState('ready');
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setLoadError(error instanceof Error && error.message ? error.message : null);
      setLoadState('error');
    }
  }, []);

  // Les 30 derniers jours du bandeau et de la liste des pubs se chargent à
  // part : une panne des statistiques ne bloque pas les réglages. La section
  // Statistiques charge elle-même la période qu'on y choisit.
  const loadStats = useCallback(async () => {
    const requestId = statsRequestIdRef.current + 1;
    statsRequestIdRef.current = requestId;
    setStatsState('loading');

    try {
      const result = await getMonetizationStats(STATS_MONTH_DAYS);
      if (statsRequestIdRef.current !== requestId) {
        return;
      }
      setStatsDays(result.days);
      setStatsState('ready');
    } catch {
      if (statsRequestIdRef.current !== requestId) {
        return;
      }
      setStatsState('error');
    }
  }, []);

  useEffect(() => {
    void load();
    void loadStats();
  }, [load, loadStats]);

  const normalizedDraft = useMemo(() => (draft ? normalizeMonetizationForSave(draft) : null), [draft]);
  const errors = useMemo(() => (normalizedDraft ? validateMonetizationSettings(normalizedDraft) : {}), [normalizedDraft]);
  const errorCount = Object.keys(errors).length;
  const changedSections = useMemo(() => (
    normalizedDraft && payload
      ? getChangedMonetizationSections(normalizedDraft, normalizeMonetizationForSave(payload.settings))
      : []
  ), [normalizedDraft, payload]);
  const isDirty = changedSections.length > 0;
  const canSave = isDirty && errorCount === 0 && !isSaving;
  const canApplyDefaults = normalizedDraft !== null
    && getChangedMonetizationSections(normalizedDraft, withDefaultSettings(normalizedDraft)).length > 0;
  const statsSummary = useMemo(() => (statsDays ? summarizeMonetizationStats(statsDays) : null), [statsDays]);

  const patchDraft = useCallback((patch: Partial<MonetizationSettings>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const updatePlacement = useCallback((id: PlacementId, patch: Partial<MonetizationPlacement>) => {
    setDraft((current) => (current
      ? { ...current, placements: { ...current.placements, [id]: { ...current.placements[id], ...patch } } }
      : current));
  }, []);

  const updateAds = useCallback((update: (ads: MonetizationAd[]) => MonetizationAd[]) => {
    setDraft((current) => (current ? { ...current, ads: update(current.ads) } : current));
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft || isSaving) {
      return;
    }

    const submitted = draft;
    const normalized = normalizeMonetizationForSave(submitted);
    if (Object.keys(validateMonetizationSettings(normalized)).length > 0) {
      toast.error(t('admin.monetization.saveBar.fixErrors'));
      return;
    }

    setIsSaving(true);
    try {
      const result = await updateAdminMonetizationSettings(normalized);
      setPayload(result);
      // Modifications faites pendant l'enregistrement : on les garde.
      setDraft((current) => (current === submitted ? cloneMonetizationSettings(result.settings) : current));
      toast.success(t('admin.monetization.saveBar.saveSuccess'));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('admin.monetization.saveBar.saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [draft, isSaving, t]);

  const handleDiscard = useCallback(() => {
    if (!payload || !draft) {
      return;
    }

    const discardedDraft = draft;
    setDraft(cloneMonetizationSettings(payload.settings));
    toast(t('admin.monetization.saveBar.discarded'), {
      action: {
        label: t('admin.monetization.saveBar.undo'),
        onClick: () => setDraft(discardedDraft)
      }
    });
  }, [draft, payload, t]);

  const handleApplyDefaults = () => {
    setDraft((current) => (current ? withDefaultSettings(current) : current));
    setDefaultsConfirmOpen(false);
    toast.info(t('admin.monetization.saveBar.defaultsApplied'));
  };

  // La barre flottante n'apparaît que si celle du formulaire est hors écran.
  useEffect(() => {
    if (!inlineBarNode || typeof IntersectionObserver === 'undefined') {
      setIsInlineBarVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsInlineBarVisible(entry.isIntersecting);
    });
    observer.observe(inlineBarNode);
    return () => observer.disconnect();
  }, [inlineBarNode]);

  // Fermeture ou rechargement de l'onglet avec des modifications en cours.
  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Ctrl/Cmd + S enregistre tant qu'il y a des modifications.
  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') {
        return;
      }
      event.preventDefault();
      if (errorCount > 0) {
        toast.error(t('admin.monetization.saveBar.fixErrors'));
        return;
      }
      void handleSave();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [errorCount, handleSave, isDirty, t]);

  if (loadState === 'loading' && !draft) {
    return <SettingsSkeleton label={t('admin.monetization.loading')} />;
  }

  if (loadState === 'error' || !draft || !payload || !normalizedDraft) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-6 py-10 text-center">
        <AlertTriangle className="h-8 w-8 text-red-300" aria-hidden="true" />
        <div>
          <p className="font-semibold text-white">{t('admin.monetization.loadError')}</p>
          {loadError && <p className="mt-1 text-sm text-white/55">{loadError}</p>}
        </div>
        <Button type="button" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('admin.monetization.retry')}
        </Button>
      </div>
    );
  }

  const saved = payload.settings;
  const savedLiveAds = countLiveAds(saved);
  const saveBarState = {
    isDirty,
    isSaving,
    errorCount,
    canSave,
    onSave: () => void handleSave(),
    onDiscard: handleDiscard
  };

  return (
    <div className="space-y-5">
      {/* Bandeau : ce qui tourne en ce moment (réglages enregistrés, pas le brouillon). */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs">
        <span className="font-semibold uppercase tracking-wider text-white/40">{t('admin.monetization.overview.liveLabel')}</span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold',
            saved.enabled
              ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-400/40 bg-amber-500/15 text-amber-200'
          )}
        >
          <span
            className={cn('h-1.5 w-1.5 rounded-full', saved.enabled ? 'bg-emerald-300' : 'bg-amber-300')}
            aria-hidden="true"
          />
          {saved.enabled ? t('admin.monetization.overview.online') : t('admin.monetization.overview.off')}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/70">
          {t('admin.monetization.overview.liveAds', { count: savedLiveAds })}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/70">
          {statsSummary
            ? t('admin.monetization.overview.openingsToday', {
              count: statsSummary.today.served,
              value: formatInteger(locale, statsSummary.today.served)
            })
            : statsState === 'error'
              ? t('admin.monetization.overview.openingsTodayUnknown')
              : t('admin.monetization.overview.openingsTodayLoading')}
        </span>
      </div>

      <GeneralSection settings={draft} modified={changedSections.includes('general')} onChange={patchDraft} />
      <PlacementsSection
        settings={draft}
        previewSettings={normalizedDraft}
        errors={errors}
        errorCount={errorCount}
        modified={changedSections.includes('placements')}
        onPlacementChange={updatePlacement}
      />
      <AdsSection
        settings={draft}
        errors={errors}
        modified={changedSections.includes('ads')}
        statsPerAd={statsSummary?.perAd ?? null}
        onAdsChange={updateAds}
      />

      <MonetizationSaveBar
        {...saveBarState}
        barRef={setInlineBarNode}
        updatedAt={payload.updatedAt}
        updatedBy={payload.updatedBy}
        canApplyDefaults={canApplyDefaults}
        onApplyDefaults={() => setDefaultsConfirmOpen(true)}
      />

      <StatsSection ads={draft.ads} savedAds={saved.ads} onRefresh={() => void loadStats()} />

      <FloatingMonetizationSaveBar {...saveBarState} visible={isDirty && !isInlineBarVisible} />

      <ConfirmDialog
        isOpen={defaultsConfirmOpen}
        title={t('admin.monetization.saveBar.defaultsConfirmTitle')}
        message={t('admin.monetization.saveBar.defaultsConfirmMessage')}
        confirmLabel={t('admin.monetization.saveBar.defaultsConfirm')}
        onConfirm={handleApplyDefaults}
        onCancel={() => setDefaultsConfirmOpen(false)}
      />
    </div>
  );
};

export default AdminMonetizationSettings;
