import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, GalleryHorizontalEnd, Plus, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  MAX_HERO_PROMOS,
  createEmptyHeroPromo,
  generateHeroPromoId,
  getAdminHeroPromos,
  updateAdminHeroPromos,
  type HeroPromo,
  type HeroPromoAdminPayload,
  type HeroPromoSettings
} from '../services/heroPromoService';
import { FloatingMonetizationSaveBar, MonetizationSaveBar } from './adminMonetization/MonetizationSaveBar';
import HeroPromoCarouselsSection from './adminHeroPromos/HeroPromoCarouselsSection';
import HeroPromoEditor from './adminHeroPromos/HeroPromoEditor';
import {
  cloneHeroPromoSettings,
  countLiveHeroPromos,
  isSameHeroPromoSettings,
  normalizeHeroPromoForSave,
  validateHeroPromoSettings
} from './adminHeroPromos/heroPromoForm';
import { SettingsSection, ToggleRow } from './adminVipDonations/SettingsUi';
import { Button } from './ui/button';
import ConfirmDialog from './ui/confirm-dialog';
import { Skeleton } from './ui/Skeleton';

// Onglet « Promos du carrousel » du panneau admin : slides de pub ajoutées au
// grand carrousel du haut des pages (jeu, appli, partenaire…), avec image,
// textes FR/EN, lien, mention « Pub », pages, place, dates et clics.

type LoadState = 'loading' | 'ready' | 'error';

const AdminHeroPromos: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payload, setPayload] = useState<HeroPromoAdminPayload | null>(null);
  const [draft, setDraft] = useState<HeroPromoSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [toDelete, setToDelete] = useState<HeroPromo | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [inlineBarNode, setInlineBarNode] = useState<HTMLDivElement | null>(null);
  const [isInlineBarVisible, setIsInlineBarVisible] = useState(true);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoadState('loading');
    setLoadError(null);
    try {
      const result = await getAdminHeroPromos();
      if (requestIdRef.current !== requestId) return;
      setPayload(result);
      setDraft(cloneHeroPromoSettings(result.settings));
      setLoadState('ready');
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setLoadError(error instanceof Error && error.message ? error.message : null);
      setLoadState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const normalizedDraft = useMemo(() => (draft ? normalizeHeroPromoForSave(draft) : null), [draft]);
  const errors = useMemo(() => (normalizedDraft ? validateHeroPromoSettings(normalizedDraft) : {}), [normalizedDraft]);
  const errorCount = Object.keys(errors).length;
  const isDirty = Boolean(draft && payload && !isSameHeroPromoSettings(draft, payload.settings));
  const canSave = isDirty && errorCount === 0 && !isSaving;

  const updatePromos = useCallback((update: (promos: HeroPromo[]) => HeroPromo[]) => {
    setDraft((current) => (current ? { ...current, promos: update(current.promos) } : current));
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft || isSaving) return;
    const submitted = draft;
    const normalized = normalizeHeroPromoForSave(submitted);
    if (Object.keys(validateHeroPromoSettings(normalized)).length > 0) {
      toast.error(t('heroPromo.admin.fixErrors'));
      return;
    }
    setIsSaving(true);
    try {
      const result = await updateAdminHeroPromos(normalized);
      setPayload(result);
      // Modifications faites pendant l'enregistrement : on les garde.
      setDraft((current) => (current === submitted ? cloneHeroPromoSettings(result.settings) : current));
      toast.success(t('heroPromo.admin.saveSuccess'));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('heroPromo.admin.saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [draft, isSaving, t]);

  const handleDiscard = useCallback(() => {
    if (!payload || !draft) return;
    const discardedDraft = draft;
    setDraft(cloneHeroPromoSettings(payload.settings));
    toast(t('heroPromo.admin.discarded'), {
      action: { label: t('heroPromo.admin.undo'), onClick: () => setDraft(discardedDraft) }
    });
  }, [draft, payload, t]);

  // La barre flottante n'apparaît que si celle du formulaire est hors écran.
  useEffect(() => {
    if (!inlineBarNode || typeof IntersectionObserver === 'undefined') {
      setIsInlineBarVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setIsInlineBarVisible(entry.isIntersecting));
    observer.observe(inlineBarNode);
    return () => observer.disconnect();
  }, [inlineBarNode]);

  // Fermeture ou rechargement de l'onglet avec des modifications en cours.
  useEffect(() => {
    if (!isDirty) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Ctrl/Cmd + S enregistre tant qu'il y a des modifications.
  useEffect(() => {
    if (!isDirty) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (errorCount > 0) {
        toast.error(t('heroPromo.admin.fixErrors'));
        return;
      }
      void handleSave();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [errorCount, handleSave, isDirty, t]);

  if (loadState === 'loading' && !draft) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only" role="status">{t('heroPromo.admin.loading')}</span>
        <Skeleton variant="button" height={56} />
        <Skeleton variant="button" height={72} />
        <Skeleton variant="button" height={140} />
      </div>
    );
  }

  if (loadState === 'error' || !draft || !payload) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-6 py-10 text-center">
        <AlertTriangle className="h-8 w-8 text-red-300" aria-hidden="true" />
        <div>
          <p className="font-semibold text-white">{t('heroPromo.admin.loadError')}</p>
          {loadError && <p className="mt-1 text-sm text-white/55">{loadError}</p>}
        </div>
        <Button type="button" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('heroPromo.admin.retry')}
        </Button>
      </div>
    );
  }

  const saved = payload.settings;
  const liveCount = countLiveHeroPromos(saved);
  const clicksToday = payload.stats
    ? saved.promos.reduce((sum, promo) => sum + (payload.stats?.[promo.id]?.today ?? 0), 0)
    : null;
  const savedIds = new Set(saved.promos.map((promo) => promo.id));
  const canAdd = draft.promos.length < MAX_HERO_PROMOS;
  const numberFormat = new Intl.NumberFormat(i18n.language);

  const addPromo = () => {
    if (!canAdd) return;
    const promo = createEmptyHeroPromo();
    setOpenIds((current) => new Set(current).add(promo.id));
    updatePromos((promos) => [...promos, promo]);
  };

  const duplicatePromo = (source: HeroPromo) => {
    if (!canAdd) return;
    const copy: HeroPromo = {
      ...structuredClone(source),
      id: generateHeroPromoId(),
      enabled: false,
      name: `${source.name || source.texts.fr.title} ${t('heroPromo.admin.promo.copySuffix')}`.trim().slice(0, 80)
    };
    setOpenIds((current) => new Set(current).add(copy.id));
    updatePromos((promos) => {
      const index = promos.findIndex((promo) => promo.id === source.id);
      const next = [...promos];
      next.splice(index + 1, 0, copy);
      return next;
    });
  };

  const movePromo = (id: string, delta: -1 | 1) => updatePromos((promos) => {
    const index = promos.findIndex((promo) => promo.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= promos.length) return promos;
    const next = [...promos];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

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
        <span className="font-semibold uppercase tracking-wider text-white/40">{t('heroPromo.admin.overview.liveLabel')}</span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold',
            saved.enabled ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/40 bg-amber-500/15 text-amber-200'
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', saved.enabled ? 'bg-emerald-300' : 'bg-amber-300')} aria-hidden="true" />
          {saved.enabled ? t('heroPromo.admin.overview.online') : t('heroPromo.admin.overview.off')}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/70">
          {t('heroPromo.admin.overview.live', { count: liveCount })}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/70">
          {clicksToday === null
            ? t('heroPromo.admin.overview.clicksUnknown')
            : t('heroPromo.admin.overview.clicksToday', { count: clicksToday, value: numberFormat.format(clicksToday) })}
        </span>
      </div>

      <ToggleRow
        id="hero-promos-enabled"
        label={t('heroPromo.admin.master.label')}
        description={draft.enabled ? t('heroPromo.admin.master.onHint') : t('heroPromo.admin.master.offHint')}
        checked={draft.enabled}
        onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
        className={draft.enabled ? undefined : 'border-amber-400/35 bg-amber-400/[0.08]'}
      />

      <HeroPromoCarouselsSection
        draft={draft}
        onChange={(carousels) => setDraft({ ...draft, carousels })}
      />

      <SettingsSection
        id="hero-promos-list"
        icon={GalleryHorizontalEnd}
        title={t('heroPromo.admin.list.title')}
        description={t('heroPromo.admin.list.hint')}
      >
        {draft.promos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/45">
            {t('heroPromo.admin.list.empty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {draft.promos.map((promo, index) => (
              <HeroPromoEditor
                key={promo.id}
                promo={promo}
                index={index}
                total={draft.promos.length}
                errors={errors}
                stats={savedIds.has(promo.id) ? (payload.stats ? payload.stats[promo.id] ?? { today: 0, week: 0, month: 0, total: 0 } : null) : undefined}
                canDuplicate={canAdd}
                defaultOpen={openIds.has(promo.id) || draft.promos.length === 1}
                onChange={(next) => updatePromos((promos) => promos.map((entry) => (entry.id === promo.id ? next : entry)))}
                onMove={(delta) => movePromo(promo.id, delta)}
                onDuplicate={() => duplicatePromo(promo)}
                onDelete={() => setToDelete(promo)}
              />
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={addPromo} disabled={!canAdd}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('heroPromo.admin.list.add')}
          </Button>
          {!canAdd && <span className="text-xs text-white/45">{t('heroPromo.admin.list.max', { count: MAX_HERO_PROMOS })}</span>}
        </div>
      </SettingsSection>

      <MonetizationSaveBar
        {...saveBarState}
        barRef={setInlineBarNode}
        updatedAt={payload.updatedAt}
        updatedBy={payload.updatedBy}
      />

      <FloatingMonetizationSaveBar {...saveBarState} visible={isDirty && !isInlineBarVisible} />

      <ConfirmDialog
        isOpen={Boolean(toDelete)}
        title={t('heroPromo.admin.promo.deleteTitle')}
        message={t('heroPromo.admin.promo.deleteMessage', {
          name: toDelete ? (toDelete.name || toDelete.texts.fr.title || t('heroPromo.admin.promo.unnamed')) : ''
        })}
        confirmLabel={t('heroPromo.admin.promo.deleteConfirm')}
        cancelLabel={t('heroPromo.admin.promo.keep')}
        variant="destructive"
        onConfirm={() => {
          if (toDelete) updatePromos((promos) => promos.filter((promo) => promo.id !== toDelete.id));
          setToDelete(null);
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
};

export default AdminHeroPromos;
