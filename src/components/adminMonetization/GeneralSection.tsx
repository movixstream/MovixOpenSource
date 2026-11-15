import React from 'react';
import { PauseCircle, Power } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { MonetizationSettings } from '../../services/monetizationAdminService';
import { SettingsSection, ToggleRow } from '../adminVipDonations/SettingsUi';
import { Switch } from '../ui/switch';
import { useMonetizationText } from './monetizationUiHelpers';

interface GeneralSectionProps {
  settings: MonetizationSettings;
  modified: boolean;
  onChange: (patch: Partial<Pick<MonetizationSettings, 'enabled' | 'adultDefault'>>) => void;
}

// ─── Général : interrupteur et pubs +18 par défaut ─────────────────────────

const GeneralSection: React.FC<GeneralSectionProps> = ({ settings, modified, onChange }) => {
  const { t, modifiedLabel } = useMonetizationText();
  const enabled = settings.enabled;

  return (
    <SettingsSection
      id="monetization-general"
      icon={Power}
      title={t('admin.monetization.general.title')}
      description={t('admin.monetization.general.description')}
      modifiedLabel={modifiedLabel(modified)}
    >
      <div className="space-y-4">
        <div
          className={cn(
            'flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors',
            enabled ? 'border-emerald-400/25 bg-emerald-400/[0.06]' : 'border-amber-400/35 bg-amber-400/[0.08]'
          )}
        >
          <div className="min-w-0">
            <label htmlFor="monetization-enabled" className="cursor-pointer text-base font-semibold text-white">
              {t('admin.monetization.general.enabledLabel')}
            </label>
            <p className="mt-1 text-sm leading-6 text-white/60">
              {enabled ? t('admin.monetization.general.enabledOn') : t('admin.monetization.general.enabledOff')}
            </p>
          </div>
          <Switch id="monetization-enabled" checked={enabled} onCheckedChange={(next) => onChange({ enabled: next })} />
        </div>

        {!enabled && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/45 bg-amber-500/15 p-4 text-amber-50 sm:p-5">
            <PauseCircle className="mt-0.5 h-7 w-7 shrink-0 text-amber-300" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-base font-semibold sm:text-lg">{t('admin.monetization.general.offNoticeTitle')}</p>
              <p className="mt-1 text-sm leading-6 text-amber-50/80">{t('admin.monetization.general.offNoticeText')}</p>
            </div>
          </div>
        )}

        <ToggleRow
          id="monetization-adult-default"
          label={t('admin.monetization.general.adultLabel')}
          description={settings.adultDefault
            ? t('admin.monetization.general.adultOn')
            : t('admin.monetization.general.adultOff')}
          checked={settings.adultDefault}
          onCheckedChange={(next) => onChange({ adultDefault: next })}
        />
      </div>
    </SettingsSection>
  );
};

export default GeneralSection;
