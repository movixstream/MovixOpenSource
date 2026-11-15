import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Megaphone, Plus } from 'lucide-react';

import {
  createEmptyAd,
  generateMonetizationAdId,
  type MonetizationAd,
  type MonetizationSettings
} from '../../services/monetizationAdminService';
import { SettingsNotice, SettingsSection } from '../adminVipDonations/SettingsUi';
import ConfirmDialog from '../ui/confirm-dialog';
import AdEditor from './AdEditor';
import {
  AD_NAME_MAX_LENGTH,
  MONETIZATION_MAX_ADS,
  cloneMonetizationAd,
  moveItem,
  type MonetizationErrors,
  type MonetizationStatsSummary
} from './monetizationForm';
import { useMonetizationText } from './monetizationUiHelpers';

interface AdsSectionProps {
  settings: MonetizationSettings;
  errors: MonetizationErrors;
  modified: boolean;
  statsPerAd: MonetizationStatsSummary['perAd'] | null;
  onAdsChange: (update: (ads: MonetizationAd[]) => MonetizationAd[]) => void;
}

// ─── Pubs : liste ordonnée = ordre du cycle en séquence ────────────────────

const AdsSection: React.FC<AdsSectionProps> = ({ settings, errors, modified, statsPerAd, onAdsChange }) => {
  const { t, issueText, modifiedLabel } = useMonetizationText();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [focusAdId, setFocusAdId] = useState<string | null>(null);
  const ads = settings.ads;
  const isFull = ads.length >= MONETIZATION_MAX_ADS;
  const listError = issueText(errors.ads);
  const pendingDelete = pendingDeleteId ? ads.find((ad) => ad.id === pendingDeleteId) ?? null : null;

  // Nouvelle pub ou copie : on l'amène à l'écran et on place le curseur sur son nom.
  useEffect(() => {
    if (!focusAdId) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const input = document.getElementById(`monetization-ad-${focusAdId}-name`);
      if (input instanceof HTMLInputElement) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus({ preventScroll: true });
        input.select();
      }
      setFocusAdId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusAdId]);

  const handleAdd = () => {
    if (isFull) {
      return;
    }
    const ad = createEmptyAd();
    onAdsChange((current) => [...current, ad]);
    setFocusAdId(ad.id);
  };

  const handleDuplicate = (index: number) => {
    const source = ads[index];
    if (!source || isFull) {
      return;
    }
    const suffix = ` ${t('admin.monetization.ads.duplicateSuffix')}`;
    const baseName = source.name.trim().slice(0, Math.max(0, AD_NAME_MAX_LENGTH - suffix.length));
    const copy: MonetizationAd = {
      ...cloneMonetizationAd(source),
      id: generateMonetizationAdId(),
      name: `${baseName}${suffix}`.trim()
    };
    onAdsChange((current) => {
      const next = [...current];
      next.splice(Math.min(index + 1, next.length), 0, copy);
      return next;
    });
    setFocusAdId(copy.id);
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) {
      setPendingDeleteId(null);
      return;
    }
    const removed = pendingDelete;
    const removedIndex = ads.findIndex((ad) => ad.id === removed.id);
    onAdsChange((current) => current.filter((ad) => ad.id !== removed.id));
    setPendingDeleteId(null);
    toast(t('admin.monetization.ads.deleted', { name: removed.name.trim() || t('admin.monetization.ads.unnamed') }), {
      action: {
        label: t('admin.monetization.ads.undo'),
        onClick: () => onAdsChange((current) => {
          if (current.some((ad) => ad.id === removed.id)) {
            return current;
          }
          const next = [...current];
          next.splice(Math.min(Math.max(removedIndex, 0), next.length), 0, removed);
          return next;
        })
      }
    });
  };

  return (
    <SettingsSection
      id="monetization-ads"
      icon={Megaphone}
      title={t('admin.monetization.ads.title')}
      description={t('admin.monetization.ads.description')}
      modifiedLabel={modifiedLabel(modified)}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs tabular-nums text-white/45">
            {t('admin.monetization.ads.count', { count: ads.length, limit: MONETIZATION_MAX_ADS })}
          </span>
          <button
            type="button"
            onClick={handleAdd}
            disabled={isFull}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 disabled:pointer-events-none disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('admin.monetization.ads.add')}
          </button>
        </div>

        {listError && <SettingsNotice tone="danger">{listError}</SettingsNotice>}
        {isFull && <p className="text-xs text-white/40">{t('admin.monetization.ads.full', { limit: MONETIZATION_MAX_ADS })}</p>}

        {ads.length === 0 ? (
          <SettingsNotice tone="info">{t('admin.monetization.ads.empty')}</SettingsNotice>
        ) : (
          <ol className="space-y-3">
            {ads.map((ad, index) => (
              <AdEditor
                key={ad.id}
                ad={ad}
                index={index}
                total={ads.length}
                settings={settings}
                errors={errors}
                stats={statsPerAd ? statsPerAd[ad.id] ?? { today: 0, week: 0 } : null}
                canDuplicate={!isFull}
                onChange={(next) => onAdsChange((current) => current.map((entry) => (entry.id === ad.id ? next : entry)))}
                onMove={(delta) => onAdsChange((current) => {
                  const from = current.findIndex((entry) => entry.id === ad.id);
                  return moveItem(current, from, from + delta);
                })}
                onDuplicate={() => handleDuplicate(index)}
                onDelete={() => setPendingDeleteId(ad.id)}
              />
            ))}
          </ol>
        )}

        {ads.length > 2 && !isFull && (
          <button
            type="button"
            onClick={handleAdd}
            className="group flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 px-3 py-3 text-sm font-medium text-white/60 transition-colors hover:border-amber-300/40 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
          >
            {/* Couleur pleine + opacité : les deux traits du « + » ne se cumulent pas. */}
            <Plus
              className="h-4 w-4 text-white opacity-60 transition-opacity group-hover:text-amber-100 group-hover:opacity-100"
              aria-hidden="true"
            />
            {t('admin.monetization.ads.add')}
          </button>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        variant="destructive"
        title={t('admin.monetization.ads.deleteConfirmTitle')}
        message={t('admin.monetization.ads.deleteConfirmMessage', {
          name: pendingDelete?.name.trim() || t('admin.monetization.ads.unnamed')
        })}
        confirmLabel={t('admin.monetization.ads.deleteConfirm')}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </SettingsSection>
  );
};

export default AdsSection;
