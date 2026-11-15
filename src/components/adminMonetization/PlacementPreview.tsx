import React, { useEffect, useMemo, useState } from 'react';
import { Eye, Loader2, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  MONETIZATION_DEVICES,
  MONETIZATION_OS_IDS,
  MONETIZATION_PLACEMENT_IDS,
  previewMonetization,
  type MonetizationApiError,
  type MonetizationDevice,
  type MonetizationOs,
  type MonetizationPreviewOpening,
  type MonetizationSettings,
  type PlacementId
} from '../../services/monetizationAdminService';
import { SettingsField, SettingsNotice, settingsInputClass } from '../adminVipDonations/SettingsUi';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PREVIEW_OPENINGS_COUNT, getAdLetter } from './monetizationForm';
import { AdBadge, FieldGroup, SegmentedChoice } from './MonetizationUi';
import { getAdColorStyle, useMonetizationText } from './monetizationUiHelpers';

type PreviewStatus = 'loading' | 'ready' | 'invalid' | 'error';

interface PreviewState {
  status: PreviewStatus;
  openings: MonetizationPreviewOpening[];
  message: string | null;
}

const PREVIEW_DEBOUNCE_MS = 400;

interface PlacementPreviewProps {
  settings: MonetizationSettings;
  errorCount: number;
}

// Aperçu des 12 prochaines ouvertures d'un emplacement, calculé par le serveur
// sur le brouillon (rien n'est compté). Une pastille colorée par pub.
const PlacementPreview: React.FC<PlacementPreviewProps> = ({ settings, errorCount }) => {
  const { t } = useMonetizationText();
  const [placement, setPlacement] = useState<PlacementId>('player');
  const [adult, setAdult] = useState<'yes' | 'no'>('yes');
  const [device, setDevice] = useState<MonetizationDevice>('desktop');
  const [os, setOs] = useState<MonetizationOs>('windows');
  const [countryText, setCountryText] = useState('FR');
  const [state, setState] = useState<PreviewState>({ status: 'loading', openings: [], message: null });
  const [selected, setSelected] = useState<number | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const trimmedCountry = countryText.trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(trimmedCountry) ? trimmedCountry : null;
  const blockedReason = errorCount > 0
    ? 'invalid'
    : !settings.enabled
      ? 'disabledAll'
      : !settings.placements[placement].enabled
        ? 'placementOff'
        : settings.ads.length === 0
          ? 'empty'
          : null;

  // Une seule chaîne pour tout ce qui change l'aperçu : l'effet ne repart que
  // si le contenu change vraiment, pas à chaque rendu.
  const requestKey = JSON.stringify({
    settings,
    placement,
    profile: { sfw: adult === 'no', device, os, country },
    count: PREVIEW_OPENINGS_COUNT
  });

  useEffect(() => {
    if (blockedReason) {
      return undefined;
    }

    const controller = new AbortController();
    const request = JSON.parse(requestKey) as Omit<Parameters<typeof previewMonetization>[0], 'signal'>;
    setState((current) => ({ status: 'loading', openings: current.openings, message: null }));

    const timer = window.setTimeout(() => {
      previewMonetization({ ...request, signal: controller.signal })
        .then((openings) => {
          if (controller.signal.aborted) {
            return;
          }
          setState({ status: 'ready', openings, message: null });
          setSelected(null);
        })
        .catch((error: MonetizationApiError) => {
          if (controller.signal.aborted) {
            return;
          }
          setState({
            status: error?.statusCode === 400 ? 'invalid' : 'error',
            openings: [],
            message: error instanceof Error && error.message ? error.message : null
          });
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [blockedReason, requestKey, retryToken]);

  const adIndexById = useMemo(
    () => new Map(settings.ads.map((ad, index) => [ad.id, index])),
    [settings.ads]
  );
  const nameOf = (opening: MonetizationPreviewOpening) => {
    if (!opening.adId) {
      return t('admin.monetization.preview.nothing');
    }
    const draftAd = settings.ads[adIndexById.get(opening.adId) ?? -1];
    return opening.name || draftAd?.name.trim() || t('admin.monetization.ads.unnamed');
  };

  const legend = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const opening of state.openings) {
      counts.set(opening.adId, (counts.get(opening.adId) ?? 0) + 1);
    }
    return Array.from(counts.entries());
  }, [state.openings]);

  const showChips = !blockedReason && state.status !== 'invalid' && state.status !== 'error';
  const isLoading = state.status === 'loading';
  const selectedOpening = selected !== null ? state.openings[selected] : null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3.5 sm:p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg bg-amber-400/10 p-2 ring-1 ring-amber-300/20">
          <Eye className="h-5 w-5 text-amber-300" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white">{t('admin.monetization.preview.title', { total: PREVIEW_OPENINGS_COUNT })}</p>
          <p className="mt-1 text-xs leading-5 text-white/50">{t('admin.monetization.preview.description')}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <FieldGroup id="monetization-preview-placement" legend={t('admin.monetization.preview.placementLabel')}>
          <SegmentedChoice
            ariaLabel={t('admin.monetization.preview.placementLabel')}
            value={placement}
            onChange={setPlacement}
            options={MONETIZATION_PLACEMENT_IDS.map((id) => ({
              value: id,
              label: t(`admin.monetization.placements.names.${id}`)
            }))}
          />
        </FieldGroup>
        <FieldGroup id="monetization-preview-adult" legend={t('admin.monetization.preview.adultLabel')}>
          <SegmentedChoice
            ariaLabel={t('admin.monetization.preview.adultLabel')}
            value={adult}
            onChange={setAdult}
            options={[
              { value: 'yes', label: t('admin.monetization.preview.adultOn') },
              { value: 'no', label: t('admin.monetization.preview.adultOff') }
            ]}
          />
        </FieldGroup>
        <FieldGroup id="monetization-preview-device" legend={t('admin.monetization.preview.deviceLabel')}>
          <SegmentedChoice
            ariaLabel={t('admin.monetization.preview.deviceLabel')}
            value={device}
            onChange={setDevice}
            options={MONETIZATION_DEVICES.map((value) => ({
              value,
              label: t(`admin.monetization.advanced.devices.${value}`)
            }))}
          />
        </FieldGroup>
        <FieldGroup id="monetization-preview-os" legend={t('admin.monetization.preview.osLabel')}>
          <SegmentedChoice
            ariaLabel={t('admin.monetization.preview.osLabel')}
            value={os}
            onChange={setOs}
            options={MONETIZATION_OS_IDS.map((value) => ({
              value,
              label: t(`admin.monetization.advanced.os.${value}`)
            }))}
          />
        </FieldGroup>
        <SettingsField
          id="monetization-preview-country"
          label={t('admin.monetization.preview.countryLabel')}
          hint={t('admin.monetization.preview.countryHint')}
        >
          <Input
            id="monetization-preview-country"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={2}
            value={countryText}
            placeholder={t('admin.monetization.preview.countryPlaceholder')}
            onChange={(event) => setCountryText(event.target.value.toUpperCase())}
            aria-describedby="monetization-preview-country-message"
            className={cn(settingsInputClass, 'w-24 uppercase')}
          />
        </SettingsField>
      </div>

      <div className="mt-5" aria-live="polite">
        {blockedReason === 'invalid' || state.status === 'invalid' ? (
          <SettingsNotice tone="warning">
            <p>{t('admin.monetization.preview.invalid')}</p>
            {!blockedReason && state.message && <p className="mt-1 text-xs opacity-80">{state.message}</p>}
          </SettingsNotice>
        ) : blockedReason ? (
          <SettingsNotice tone="info">{t(`admin.monetization.preview.${blockedReason}`)}</SettingsNotice>
        ) : state.status === 'error' ? (
          <SettingsNotice tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{t('admin.monetization.preview.error')}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setRetryToken((value) => value + 1)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {t('admin.monetization.preview.retry')}
              </Button>
            </div>
          </SettingsNotice>
        ) : null}

        {showChips && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-white/45">
              {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" aria-hidden="true" />}
              <span>{isLoading ? t('admin.monetization.preview.loading') : t('admin.monetization.preview.tapHint')}</span>
            </div>
            <ol className={cn('grid grid-cols-6 gap-1.5 sm:grid-cols-12', isLoading && 'opacity-50')}>
              {state.openings.length === 0
                ? Array.from({ length: PREVIEW_OPENINGS_COUNT }, (_, index) => (
                  <li key={index} className="h-10 animate-pulse rounded-lg bg-white/5" aria-hidden="true" />
                ))
                : state.openings.map((opening, index) => {
                  const adIndex = opening.adId ? adIndexById.get(opening.adId) ?? -1 : null;
                  const name = nameOf(opening);
                  const label = t('admin.monetization.preview.opening', { index: index + 1, name });
                  return (
                    <li key={index}>
                      <button
                        type="button"
                        title={label}
                        aria-label={label}
                        aria-pressed={selected === index}
                        onClick={() => setSelected((current) => (current === index ? null : index))}
                        style={adIndex === null ? undefined : getAdColorStyle(adIndex)}
                        className={cn(
                          'flex h-10 w-full items-center justify-center rounded-lg text-sm font-bold transition-transform',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60',
                          adIndex === null && 'border border-dashed border-white/20 text-white opacity-40',
                          selected === index && 'ring-2 ring-white ring-offset-2 ring-offset-black'
                        )}
                      >
                        <span aria-hidden="true">{adIndex === null ? '–' : getAdLetter(adIndex)}</span>
                      </button>
                    </li>
                  );
                })}
            </ol>

            {selectedOpening && selected !== null && (
              <p className="text-sm text-white/80">
                {t('admin.monetization.preview.opening', { index: selected + 1, name: nameOf(selectedOpening) })}
              </p>
            )}

            {state.openings.length > 0 && (
              <ul className="flex flex-wrap gap-x-4 gap-y-2">
                {legend.map(([adId, count]) => {
                  const adIndex = adId ? adIndexById.get(adId) ?? -1 : null;
                  const name = nameOf({ adId, name: state.openings.find((opening) => opening.adId === adId)?.name ?? null });
                  return (
                    <li key={adId ?? 'none'} className="inline-flex min-w-0 items-center gap-1.5 text-xs text-white/70">
                      {adIndex === null
                        ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-lg border border-dashed border-white/25 text-white/50" aria-hidden="true">–</span>
                        : <AdBadge index={adIndex} size="sm" />}
                      <span className="truncate">{name}</span>
                      <span className="tabular-nums text-white/40">×{count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PlacementPreview;
