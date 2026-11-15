import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  cancelAdminReferral,
  getAdminReferral,
  listAdminReferrals,
  updateAdminReferral,
  type ReferralAdminItem,
  type ReferralAdminStats,
  type ReferralSettings,
  type ReferralStatus
} from '@/services/referralService';
import { Button } from './ui/button';
import ConfirmDialog from './ui/confirm-dialog';
import { Input } from './ui/input';
import { Switch } from './ui/switch';

// Onglet « Parrainage » du panneau admin : interrupteur, récompense et
// conditions, chiffres, puis les derniers parrainages avec annulation (en
// attente ou validés).

type NumberField = Exclude<keyof ReferralSettings, 'enabled'>;

// Mêmes bornes que API/Mainapi/utils/referralSettings.js.
const NUMBER_FIELDS: { key: NumberField; min: number; max: number }[] = [
  { key: 'rewardDays', min: 1, max: 30 },
  { key: 'requiredMinutes', min: 1, max: 600 },
  { key: 'requiredDays', min: 1, max: 14 },
  { key: 'claimWindowDays', min: 1, max: 30 },
  { key: 'maxRewardsPerMonth', min: 1, max: 100 },
  { key: 'minReferrerAccountDays', min: 0, max: 90 }
];

type ListFilter = ReferralStatus | 'all';
const FILTERS: ListFilter[] = ['all', 'pending', 'rewarded', 'cancelled'];

const STATUS_STYLES: Record<ReferralStatus, string> = {
  pending: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  rewarded: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  cancelled: 'border-white/10 bg-white/5 text-white/55'
};

function sameSettings(a: ReferralSettings, b: ReferralSettings): boolean {
  return a.enabled === b.enabled && NUMBER_FIELDS.every(({ key }) => a[key] === b[key]);
}

function accountLabel(person: ReferralAdminItem['referrer']): string {
  return person.name || `${person.userType}:${person.userId.slice(0, 10)}`;
}

const AdminReferralSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [saved, setSaved] = useState<ReferralSettings | null>(null);
  const [draft, setDraft] = useState<ReferralSettings | null>(null);
  const [stats, setStats] = useState<ReferralAdminStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<ListFilter>('all');
  const [items, setItems] = useState<ReferralAdminItem[] | null>(null);
  const [toCancel, setToCancel] = useState<ReferralAdminItem | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const payload = await getAdminReferral();
      setSaved(payload.settings);
      setDraft(payload.settings);
      setStats(payload.stats || null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const loadList = useCallback(async (status: ListFilter) => {
    setItems(null);
    try {
      setItems(await listAdminReferrals(status));
    } catch (error) {
      setItems([]);
      toast.error(error instanceof Error ? error.message : t('referral.admin.listError'));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadList(filter); }, [filter, loadList]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-6 py-10 text-center">
        <AlertTriangle className="h-8 w-8 text-red-300" aria-hidden="true" />
        <div>
          <p className="font-semibold text-white">{t('referral.admin.loadError')}</p>
          <p className="mt-1 text-sm text-white/55">{loadError}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('referral.admin.retry')}
        </Button>
      </div>
    );
  }

  if (!draft || !saved) {
    return <p className="py-10 text-center text-sm text-white/50" role="status">{t('referral.admin.loading')}</p>;
  }

  const invalidFields = NUMBER_FIELDS.filter(({ key, min, max }) => (
    !Number.isInteger(draft[key]) || draft[key] < min || draft[key] > max
  ));
  const minutesTooLow = draft.requiredMinutes < draft.requiredDays;
  const dirty = !sameSettings(draft, saved);
  const canSave = dirty && invalidFields.length === 0 && !minutesTooLow && !saving;

  const save = async (next: ReferralSettings) => {
    setSaving(true);
    try {
      const payload = await updateAdminReferral(next);
      setSaved(payload.settings);
      setDraft(payload.settings);
      toast.success(t('referral.admin.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('referral.admin.saveError'));
    } finally {
      setSaving(false);
    }
  };

  // L'interrupteur s'enregistre tout de suite (avec le reste du brouillon s'il est valable).
  const toggle = (enabled: boolean) => {
    const base = invalidFields.length === 0 && !minutesTooLow ? draft : saved;
    const next = { ...base, enabled };
    setDraft(next);
    void save(next);
  };

  const confirmCancel = async () => {
    if (!toCancel) return;
    setCancelling(true);
    try {
      await cancelAdminReferral(toCancel.id);
      toast.success(t('referral.admin.cancelled'));
      setToCancel(null);
      void loadList(filter);
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('referral.admin.cancelError'));
    } finally {
      setCancelling(false);
    }
  };

  const formatDate = (value: string | null) => {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
    } catch {
      return value;
    }
  };

  return (
    <div className="space-y-6">
      <div
        className={cn(
          'flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors',
          saved.enabled ? 'border-emerald-400/25 bg-emerald-400/[0.06]' : 'border-amber-400/35 bg-amber-400/[0.08]'
        )}
      >
        <div className="min-w-0">
          <label htmlFor="referral-enabled" className="cursor-pointer text-base font-semibold text-white">
            {t('referral.admin.enabled')}
          </label>
          <p className="mt-1 text-sm leading-6 text-white/60">
            {saved.enabled ? t('referral.admin.enabledHint') : t('referral.admin.disabledHint')}
          </p>
        </div>
        <Switch id="referral-enabled" checked={draft.enabled} disabled={saving} onCheckedChange={toggle} />
      </div>

      <section aria-labelledby="referral-rules-title" className="rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5">
        <h3 id="referral-rules-title" className="text-base font-semibold text-white">{t('referral.admin.rulesTitle')}</h3>
        <p className="mt-1 text-sm text-white/55">{t('referral.admin.rulesHint')}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {NUMBER_FIELDS.map(({ key, min, max }) => {
            const invalid = invalidFields.some((field) => field.key === key) || (key === 'requiredMinutes' && minutesTooLow);
            return (
              <div key={key}>
                <label htmlFor={`referral-${key}`} className="block text-sm font-medium text-white/80">
                  {t(`referral.admin.fields.${key}`)}
                </label>
                <Input
                  id={`referral-${key}`}
                  type="number"
                  inputMode="numeric"
                  min={min}
                  max={max}
                  step={1}
                  value={Number.isFinite(draft[key]) ? draft[key] : ''}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value === '' ? Number.NaN : Number(event.target.value) })}
                  aria-invalid={invalid || undefined}
                  className={cn('mt-1.5 bg-black/30', invalid && 'border-red-400/60')}
                />
                <p className={cn('mt-1 text-xs', invalid ? 'text-red-300' : 'text-white/40')}>
                  {key === 'requiredMinutes' && minutesTooLow
                    ? t('referral.admin.minutesTooLow')
                    : t('referral.admin.range', { min, max })}
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" disabled={!canSave} onClick={() => void save(draft)}>
            {saving ? t('referral.admin.saving') : t('referral.admin.save')}
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setDraft(saved)}>
              {t('referral.admin.discard')}
            </Button>
          )}
        </div>
      </section>

      {stats && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {([
            ['pending', stats.pending],
            ['rewarded', stats.rewarded],
            ['cancelled', stats.cancelled],
            ['daysGranted', stats.daysGranted],
            ['daysRedeemed', stats.daysRedeemed]
          ] as const).map(([key, value]) => (
            <div key={key} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <dt className="text-xs text-white/50">{t(`referral.admin.stats.${key}`)}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-white">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section aria-labelledby="referral-list-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="referral-list-title" className="text-base font-semibold text-white">{t('referral.admin.listTitle')}</h3>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('referral.admin.filterLabel')}>
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                  filter === value ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70 hover:bg-white/10 hover:text-white'
                )}
              >
                {t(`referral.admin.filters.${value}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-white/[0.03] text-xs text-white/50">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">{t('referral.admin.columns.referrer')}</th>
                <th scope="col" className="px-4 py-2.5 font-medium">{t('referral.admin.columns.referee')}</th>
                <th scope="col" className="px-4 py-2.5 font-medium">{t('referral.admin.columns.progress')}</th>
                <th scope="col" className="px-4 py-2.5 font-medium">{t('referral.admin.columns.status')}</th>
                <th scope="col" className="px-4 py-2.5 font-medium">{t('referral.admin.columns.date')}</th>
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">{t('referral.admin.columns.actions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {items === null && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-white/45">{t('referral.admin.loading')}</td></tr>
              )}
              {items?.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-white/45">{t('referral.admin.empty')}</td></tr>
              )}
              {items?.map((item) => (
                <tr key={item.id} className="text-white/80">
                  <td className="px-4 py-3">
                    <span className="block max-w-[12rem] truncate" title={`${item.referrer.userType}:${item.referrer.userId}`}>{accountLabel(item.referrer)}</span>
                    <span className="text-xs tabular-nums text-white/40">{item.code}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="block max-w-[12rem] truncate" title={`${item.referee.userType}:${item.referee.userId}`}>{accountLabel(item.referee)}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {t('referral.admin.progressValue', {
                      minutes: item.watchMinutes,
                      requiredMinutes: item.requiredMinutes,
                      days: item.watchDays,
                      requiredDays: item.requiredDays
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium', STATUS_STYLES[item.status])}>
                      {t(`referral.admin.statuses.${item.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/55">{formatDate(item.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {/* Un parrainage validé s'annule aussi : ses jours de VIP sont repris. */}
                    {item.status !== 'cancelled' && (
                      <Button type="button" size="sm" variant="ghost" className="text-red-300 hover:text-red-200" onClick={() => setToCancel(item)}>
                        {t('referral.admin.cancel')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        isOpen={Boolean(toCancel)}
        title={t('referral.admin.cancelTitle')}
        message={t(
          toCancel?.status === 'rewarded' ? 'referral.admin.cancelRewardedMessage' : 'referral.admin.cancelMessage',
          { name: toCancel ? accountLabel(toCancel.referee) : '' }
        )}
        confirmLabel={t('referral.admin.cancel')}
        cancelLabel={t('referral.admin.keep')}
        variant="destructive"
        busy={cancelling}
        onConfirm={() => void confirmCancel()}
        onCancel={() => setToCancel(null)}
      />
    </div>
  );
};

export default AdminReferralSettings;
