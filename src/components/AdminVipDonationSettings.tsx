import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, HeartHandshake, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  DEFAULT_VIP_DONATION_SETTINGS,
  getAdminVipDonationSettings,
  updateAdminVipDonationSettings,
  type VipDonationSettings,
  type VipDonationSettingsPayload
} from '../services/vipDonationsService';
import {
  AmountsSection,
  ContactsSection,
  GiftCardsSection,
  GiftOptionSection,
  MethodsSection,
  RateSection,
  StatusSection
} from './adminVipDonations/DonationSettingsSections';
import { FloatingSaveBar, SettingsSaveBar } from './adminVipDonations/SettingsSaveBar';
import ThankYouKeyTool from './adminVipDonations/ThankYouKeyTool';
import {
  cloneVipDonationSettings,
  formatEuroAmount,
  getChangedVipSettingsSections,
  getVisibleVipMethods,
  normalizeVipSettingsForSave,
  validateVipDonationSettings
} from './adminVipDonations/vipDonationSettingsForm';
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

const AdminVipDonationSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payload, setPayload] = useState<VipDonationSettingsPayload | null>(null);
  const [draft, setDraft] = useState<VipDonationSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [defaultsConfirmOpen, setDefaultsConfirmOpen] = useState(false);
  const [inlineBarNode, setInlineBarNode] = useState<HTMLDivElement | null>(null);
  const [isInlineBarVisible, setIsInlineBarVisible] = useState(true);
  const requestIdRef = useRef(0);
  const thankYouRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoadState('loading');
    setLoadError(null);

    try {
      const result = await getAdminVipDonationSettings();
      if (requestIdRef.current !== requestId) {
        return;
      }
      setPayload(result);
      setDraft(cloneVipDonationSettings(result.settings));
      setLoadState('ready');
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setLoadError(error instanceof Error && error.message ? error.message : null);
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const normalizedDraft = useMemo(() => (draft ? normalizeVipSettingsForSave(draft) : null), [draft]);
  const errors = useMemo(() => (normalizedDraft ? validateVipDonationSettings(normalizedDraft) : {}), [normalizedDraft]);
  const errorCount = Object.keys(errors).length;
  const changedSections = useMemo(() => (
    normalizedDraft && payload
      ? getChangedVipSettingsSections(normalizedDraft, normalizeVipSettingsForSave(payload.settings))
      : []
  ), [normalizedDraft, payload]);
  const isDirty = changedSections.length > 0;
  const canSave = isDirty && errorCount === 0 && !isSaving;
  const canApplyDefaults = normalizedDraft !== null
    && getChangedVipSettingsSections(normalizedDraft, DEFAULT_VIP_DONATION_SETTINGS).length > 0;

  const patchDraft = useCallback((patch: Partial<VipDonationSettings>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft || isSaving) {
      return;
    }

    const submitted = draft;
    const normalized = normalizeVipSettingsForSave(submitted);
    if (Object.keys(validateVipDonationSettings(normalized)).length > 0) {
      toast.error(t('vipDonations.settings.saveBar.fixErrors'));
      return;
    }

    setIsSaving(true);
    try {
      const result = await updateAdminVipDonationSettings(normalized);
      setPayload(result);
      // Modifications faites pendant l'enregistrement : on les garde.
      setDraft((current) => (current === submitted ? cloneVipDonationSettings(result.settings) : current));
      toast.success(t('vipDonations.settings.saveBar.saveSuccess'));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('vipDonations.settings.saveBar.saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [draft, isSaving, t]);

  const handleDiscard = useCallback(() => {
    if (!payload || !draft) {
      return;
    }

    const discardedDraft = draft;
    setDraft(cloneVipDonationSettings(payload.settings));
    toast(t('vipDonations.settings.saveBar.discarded'), {
      action: {
        label: t('vipDonations.settings.saveBar.undo'),
        onClick: () => setDraft(discardedDraft)
      }
    });
  }, [draft, payload, t]);

  const handleApplyDefaults = () => {
    setDraft(cloneVipDonationSettings(DEFAULT_VIP_DONATION_SETTINGS));
    setDefaultsConfirmOpen(false);
    toast.info(t('vipDonations.settings.saveBar.defaultsApplied'));
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
        toast.error(t('vipDonations.settings.saveBar.fixErrors'));
        return;
      }
      void handleSave();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [errorCount, handleSave, isDirty, t]);

  if (loadState === 'loading' && !draft) {
    return <SettingsSkeleton label={t('vipDonations.settings.loading')} />;
  }

  if (loadState === 'error' || !draft || !payload) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-6 py-10 text-center">
        <AlertTriangle className="h-8 w-8 text-red-300" aria-hidden="true" />
        <div>
          <p className="font-semibold text-white">{t('vipDonations.settings.loadError')}</p>
          {loadError && <p className="mt-1 text-sm text-white/55">{loadError}</p>}
        </div>
        <Button type="button" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('vipDonations.settings.retry')}
        </Button>
      </div>
    );
  }

  const saved = payload.settings;
  const savedVisibleCount = getVisibleVipMethods(saved, payload.availability).length;
  const sectionProps = { settings: draft, errors, onChange: patchDraft };
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
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-white/40">{t('vipDonations.settings.overview.liveLabel')}</span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold',
              saved.donationsEnabled
                ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                : 'border-amber-400/40 bg-amber-500/15 text-amber-200'
            )}
          >
            <span
              className={cn('h-1.5 w-1.5 rounded-full', saved.donationsEnabled ? 'bg-emerald-300' : 'bg-amber-300')}
              aria-hidden="true"
            />
            {saved.donationsEnabled ? t('vipDonations.settings.overview.open') : t('vipDonations.settings.overview.paused')}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/70">
            {t('vipDonations.settings.overview.visibleMethods', { count: savedVisibleCount })}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/70">
            {t('vipDonations.settings.overview.rate', { amount: formatEuroAmount(locale, saved.eurosPerVipYear) })}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-300/30 text-amber-100 hover:bg-amber-300/10"
          onClick={() => thankYouRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <HeartHandshake className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t('vipDonations.settings.overview.thankYouShortcut')}
        </Button>
      </div>

      <StatusSection {...sectionProps} modified={changedSections.includes('status')} />
      <RateSection {...sectionProps} modified={changedSections.includes('rate')} />
      <AmountsSection {...sectionProps} modified={changedSections.includes('amounts')} />
      <MethodsSection
        {...sectionProps}
        modified={changedSections.includes('methods')}
        availability={payload.availability}
      />
      <GiftOptionSection {...sectionProps} modified={changedSections.includes('giftOption')} />
      <GiftCardsSection {...sectionProps} modified={changedSections.includes('giftCards')} />
      <ContactsSection {...sectionProps} modified={changedSections.includes('contacts')} />

      <SettingsSaveBar
        {...saveBarState}
        barRef={setInlineBarNode}
        updatedAt={payload.updatedAt}
        updatedBy={payload.updatedBy}
        canApplyDefaults={canApplyDefaults}
        onApplyDefaults={() => setDefaultsConfirmOpen(true)}
      />

      <div ref={thankYouRef} className="scroll-mt-24 pt-3">
        <ThankYouKeyTool
          eurosPerVipYear={saved.eurosPerVipYear}
          hasPendingRateChange={changedSections.includes('rate')}
        />
      </div>

      <FloatingSaveBar {...saveBarState} visible={isDirty && !isInlineBarVisible} />

      <ConfirmDialog
        isOpen={defaultsConfirmOpen}
        title={t('vipDonations.settings.saveBar.defaultsConfirmTitle')}
        message={t('vipDonations.settings.saveBar.defaultsConfirmMessage')}
        confirmLabel={t('vipDonations.settings.saveBar.defaultsConfirm')}
        onConfirm={handleApplyDefaults}
        onCancel={() => setDefaultsConfirmOpen(false)}
      />
    </div>
  );
};

export default AdminVipDonationSettings;
