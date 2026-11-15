import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, RotateCcw, Save, Undo2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatVipDateTime } from '../../utils/vipDonationsUi';
import { getOverlayPortalRoot } from '../../utils/overlayPortal';
import { Button } from '../ui/button';

export interface SaveBarState {
  isDirty: boolean;
  isSaving: boolean;
  errorCount: number;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

const saveButtonClass = 'bg-amber-400 font-semibold text-black shadow-lg shadow-amber-500/20 hover:bg-amber-300 focus-visible:ring-amber-400/60';

const SaveStatus: React.FC<{ isDirty: boolean; errorCount: number }> = ({ isDirty, errorCount }) => {
  const { t } = useTranslation();

  if (!isDirty) {
    return (
      <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-200">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {t('vipDonations.settings.saveBar.upToDate')}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-amber-100">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.7)]" aria-hidden="true" />
      {t('vipDonations.settings.saveBar.unsaved')}
      {errorCount > 0 && (
        <span className="text-red-300">· {t('vipDonations.settings.saveBar.errorCount', { count: errorCount })}</span>
      )}
    </span>
  );
};

const SaveButton: React.FC<{ isSaving: boolean; canSave: boolean; onSave: () => void; size?: 'sm' | 'default' }> = ({
  isSaving,
  canSave,
  onSave,
  size = 'default'
}) => {
  const { t } = useTranslation();

  return (
    <Button type="button" size={size} onClick={onSave} disabled={!canSave || isSaving} className={saveButtonClass}>
      {isSaving
        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
      {isSaving ? t('vipDonations.settings.saveBar.saving') : t('vipDonations.settings.saveBar.save')}
    </Button>
  );
};

interface SettingsSaveBarProps extends SaveBarState {
  barRef: (node: HTMLDivElement | null) => void;
  updatedAt: string | null;
  updatedBy: string | null;
  canApplyDefaults: boolean;
  onApplyDefaults: () => void;
}

// Barre en fin de formulaire : état, dernière mise à jour et toutes les actions.
export const SettingsSaveBar: React.FC<SettingsSaveBarProps> = ({
  barRef,
  isDirty,
  isSaving,
  errorCount,
  canSave,
  onSave,
  onDiscard,
  updatedAt,
  updatedBy,
  canApplyDefaults,
  onApplyDefaults
}) => {
  const { t, i18n } = useTranslation();
  const lastUpdate = updatedAt
    ? updatedBy
      ? t('vipDonations.settings.saveBar.lastUpdate', { date: formatVipDateTime(i18n.language, updatedAt), user: updatedBy })
      : t('vipDonations.settings.saveBar.lastUpdateNoUser', { date: formatVipDateTime(i18n.language, updatedAt) })
    : t('vipDonations.settings.saveBar.neverUpdated');

  return (
    <div
      ref={barRef}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border p-4 transition-colors sm:p-5 lg:flex-row lg:items-center lg:justify-between',
        isDirty ? 'border-amber-300/30 bg-amber-300/[0.06]' : 'border-white/10 bg-black/20'
      )}
    >
      <div className="min-w-0 space-y-1" aria-live="polite">
        <SaveStatus isDirty={isDirty} errorCount={errorCount} />
        <p className="text-xs leading-5 text-white/45">{lastUpdate}</p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        {/* Variante ghost en blanc translucide : l'icône prend la couleur pleine
            et l'opacité à part (sinon ses tracés se cumulent en plus clair),
            puis suit le survol du bouton via `group-hover`. */}
        <Button
          type="button"
          variant="ghost"
          onClick={onApplyDefaults}
          disabled={!canApplyDefaults || isSaving}
          className="group"
        >
          <RotateCcw
            className="mr-2 h-4 w-4 text-white opacity-70 transition-opacity duration-200 group-hover:opacity-100"
            aria-hidden="true"
          />
          {t('vipDonations.settings.saveBar.defaults')}
        </Button>
        <Button type="button" variant="outline" onClick={onDiscard} disabled={!isDirty || isSaving}>
          <Undo2 className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('vipDonations.settings.saveBar.discard')}
        </Button>
        <SaveButton isSaving={isSaving} canSave={canSave} onSave={onSave} />
      </div>
    </div>
  );
};

interface FloatingSaveBarProps extends SaveBarState {
  visible: boolean;
}

// Copie compacte de la barre, fixée en bas de l'écran quand la barre du
// formulaire n'est pas visible. Rendue en portail : le fond animé de la page
// admin coupe tout débordement, ce qui empêche un simple `position: sticky`.
export const FloatingSaveBar: React.FC<FloatingSaveBarProps> = ({
  visible,
  isDirty,
  isSaving,
  errorCount,
  canSave,
  onSave,
  onDiscard
}) => {
  const { t } = useTranslation();

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          key="vip-settings-floating-save-bar"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[9000] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-4"
        >
          <div
            role="region"
            aria-label={t('vipDonations.settings.saveBar.unsaved')}
            className="pointer-events-auto flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-amber-300/30 bg-neutral-950/95 px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,0.55)] backdrop-blur-md sm:flex-row sm:items-center sm:justify-between"
          >
            <SaveStatus isDirty={isDirty} errorCount={errorCount} />
            <div className="flex gap-2 sm:shrink-0">
              <Button type="button" size="sm" variant="outline" onClick={onDiscard} disabled={isSaving} className="flex-1 sm:flex-none">
                <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {t('vipDonations.settings.saveBar.discardShort')}
              </Button>
              <div className="flex flex-1 sm:flex-none [&>button]:w-full">
                <SaveButton isSaving={isSaving} canSave={canSave} onSave={onSave} size="sm" />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    getOverlayPortalRoot()
  );
};
