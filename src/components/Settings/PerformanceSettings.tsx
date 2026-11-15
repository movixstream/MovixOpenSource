import { useEffect, useState } from 'react';
import { Check, Gauge, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLightMode } from '@/context/LightModeContext';
import { setImageQuality, useImageQuality } from '@/hooks/useImageQuality';
import { isLowLatencyEnabled, setLowLatencyEnabled, LOW_LATENCY_CHANGED_EVENT, type LowLatencyScope } from '@/utils/lowLatencyPref';

const ANIMATION_ROWS = [
  { key: 'bgAnimations', title: 'animBgTitle', description: 'animBgDesc' },
  { key: 'loadingAnimations', title: 'animLoadingTitle', description: 'animLoadingDesc' },
  { key: 'carouselAutoplay', title: 'animCarouselTitle', description: 'animCarouselDesc' },
  { key: 'blurEffects', title: 'animBlurTitle', description: 'animBlurDesc' },
  { key: 'transitions', title: 'animTransTitle', description: 'animTransDesc' },
] as const;

const MODE_OPTIONS = [
  { value: 'auto', title: 'lightModeAuto', description: 'lightModeAutoDesc' },
  { value: 'on', title: 'lightModeOn', description: 'lightModeOnDesc' },
  { value: 'off', title: 'lightModeOff', description: 'lightModeOffDesc' },
] as const;

const IMAGE_QUALITY_OPTIONS = [
  { value: 'auto', title: 'imageQualityAuto', description: 'imageQualityAutoDesc' },
  { value: 'economy', title: 'imageQualityEconomy', description: 'imageQualityEconomyDesc' },
  { value: 'high', title: 'imageQualityHigh', description: 'imageQualityHighDesc' },
] as const;

function readHidden(key: string) {
  try { return localStorage.getItem(key) === 'true'; } catch { return false; }
}

function PerformanceToggle({ id, title, description, checked, disabled = false, saved, onChange }: {
  id: string;
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  saved?: string;
  onChange: () => void;
}) {
  return (
    <div data-settings-search-title className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <h4 id={`${id}-label`} className="text-sm font-medium text-white">{title}</h4>
        {description && <p id={`${id}-description`} className="mt-1 text-sm leading-relaxed text-gray-400">{description}</p>}
        {saved && <p id={`${id}-saved`} className="mt-1 text-xs leading-relaxed text-emerald-200">{saved}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={[description && `${id}-description`, saved && `${id}-saved`].filter(Boolean).join(' ') || undefined}
        disabled={disabled}
        onClick={onChange}
        className="group flex h-11 w-12 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 disabled:cursor-not-allowed"
      >
        <span aria-hidden="true" className={`relative h-7 w-12 rounded-full border transition-colors ${checked ? 'border-emerald-400 bg-emerald-500 group-hover:bg-emerald-400' : 'border-gray-500 bg-gray-700 group-enabled:group-hover:bg-gray-600'}`}>
          <span className={`absolute left-1 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}>
            {checked && <Check className="h-3 w-3 text-emerald-800" strokeWidth={3} />}
          </span>
        </span>
      </button>
    </div>
  );
}

export function PerformanceSettings() {
  const { t } = useTranslation();
  const { lightModeSetting, setLightModeSetting, isLightMode, autoReason, systemReducedMotion, storageUnavailable, prefs, effectivePrefs, setPref, resetPrefs } = useLightMode();
  const { imageQuality } = useImageQuality();
  const [heroHidden, setHeroHidden] = useState(() => readHidden('settings_hide_hero'));
  const [platformsHidden, setPlatformsHidden] = useState(() => readHidden('settings_hide_streaming_platforms'));
  const [lowLatency, setLowLatency] = useState(() => ({ movies: isLowLatencyEnabled('movies'), livetv: isLowLatencyEnabled('livetv') }));
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const sync = () => {
      setHeroHidden(readHidden('settings_hide_hero'));
      setPlatformsHidden(readHidden('settings_hide_streaming_platforms'));
      setLowLatency({ movies: isLowLatencyEnabled('movies'), livetv: isLowLatencyEnabled('livetv') });
    };
    const events = ['storage', 'sync_storage_updated', 'hero_visibility_changed', 'streaming_platforms_visibility_changed', LOW_LATENCY_CHANGED_EVENT];
    events.forEach((event) => window.addEventListener(event, sync));
    return () => events.forEach((event) => window.removeEventListener(event, sync));
  }, []);

  const toggleVisibility = (key: string, event: string, hidden: boolean) => {
    try {
      localStorage.setItem(key, String(!hidden));
      window.dispatchEvent(new Event(event));
      setNotice('');
    } catch { setNotice('performanceStorageError'); }
  };
  const toggleLatency = (scope: LowLatencyScope) => {
    const saved = setLowLatencyEnabled(scope, !lowLatency[scope]);
    setNotice(saved ? '' : 'performanceStorageError');
  };
  const allEnabled = Object.values(prefs).every(Boolean);
  const reasonKey = lightModeSetting === 'auto'
    ? `settings.lightModeReason.${autoReason ?? 'capable'}`
    : lightModeSetting === 'on' ? 'settings.lightModeReason.manual' : 'settings.lightModeReason.custom';

  return (
    <section id="performance" aria-labelledby="performance-title" className="scroll-mt-24">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2"><Gauge aria-hidden="true" className="h-5 w-5 text-emerald-400" /></div>
        <div>
          <h2 id="performance-title" className="text-xl font-semibold text-white">{t('settings.sections.performance')}</h2>
          <p className="mt-1 text-sm text-gray-400">{t('settings.performanceDesc')}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-700/50 bg-gray-800/30 p-4 sm:p-5">
        <div data-settings-search-title>
          <div className="flex flex-wrap items-center gap-3">
            <h3 id="light-mode-title" className="text-base font-semibold text-white">{t('settings.lightMode')}</h3>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${isLightMode ? 'bg-emerald-500/15 text-emerald-200' : 'bg-gray-700/70 text-gray-200'}`}>
              {t(isLightMode ? 'settings.lightModeAutoOn' : 'settings.lightModeAutoOff')}
            </span>
          </div>
          <p id="light-mode-description" className="mt-2 max-w-prose text-sm leading-relaxed text-gray-400">{t('settings.lightModeDesc')}</p>
        </div>

        <fieldset aria-labelledby="light-mode-title" aria-describedby="light-mode-description light-mode-reason" className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
          {MODE_OPTIONS.map((option) => (
            <label key={option.value} className="relative cursor-pointer">
              <input type="radio" name="performance-light-mode" value={option.value} checked={lightModeSetting === option.value} onChange={() => setLightModeSetting(option.value)} aria-labelledby={`light-mode-${option.value}`} aria-describedby={`light-mode-${option.value}-description`} className="peer sr-only" />
              <span className="flex h-full items-start justify-between gap-2 rounded-lg border border-gray-600 bg-gray-900/40 p-3 transition-colors hover:border-gray-400 peer-checked:border-emerald-400 peer-checked:bg-emerald-500/10 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-300">
                <span>
                  <span id={`light-mode-${option.value}`} className="block text-sm font-medium text-white">{t(`settings.${option.title}`)}</span>
                  <span id={`light-mode-${option.value}-description`} className="mt-1 block text-xs leading-relaxed text-gray-300">{t(`settings.${option.description}`)}</span>
                </span>
                <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${lightModeSetting === option.value ? 'border-emerald-300 bg-emerald-400 text-gray-950' : 'border-gray-500'}`}>
                  {lightModeSetting === option.value && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <p id="light-mode-reason" role="status" className="mt-3 text-sm leading-relaxed text-gray-300">{t(reasonKey)}</p>
        {isLightMode && <p className="mt-2 text-sm leading-relaxed text-emerald-200">{t('settings.lightModeSavings')}</p>}
        <p className="mt-2 text-xs leading-relaxed text-gray-400">{t('settings.lightModeAutoHint')}</p>
        {storageUnavailable && <p role="status" className="mt-3 text-sm text-amber-200">{t('settings.performanceSessionOnly')}</p>}
      </div>

      <div className="mt-6 rounded-xl border border-gray-700/50 bg-gray-800/20 p-4 sm:p-5">
        <div data-settings-search-title>
          <h3 id="image-quality-title" className="text-base font-semibold text-white">{t('settings.imageQualityTitle')}</h3>
          <p id="image-quality-description" className="mt-2 max-w-prose text-sm leading-relaxed text-gray-400">{t('settings.imageQualityDesc')}</p>
        </div>
        <fieldset aria-labelledby="image-quality-title" aria-describedby="image-quality-description image-quality-hint" className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <legend className="sr-only">{t('settings.imageQualityTitle')}</legend>
          {IMAGE_QUALITY_OPTIONS.map((option) => (
            <label key={option.value} className="relative cursor-pointer">
              <input type="radio" name="performance-image-quality" value={option.value} checked={imageQuality === option.value} onChange={() => setNotice(setImageQuality(option.value) ? '' : 'performanceStorageError')} aria-labelledby={`image-quality-${option.value}`} aria-describedby={`image-quality-${option.value}-description`} className="peer sr-only" />
              <span className="flex h-full items-start justify-between gap-2 rounded-lg border border-gray-600 bg-gray-900/40 p-3 transition-colors hover:border-gray-400 peer-checked:border-emerald-400 peer-checked:bg-emerald-500/10 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-300">
                <span>
                  <span id={`image-quality-${option.value}`} className="block text-sm font-medium text-white">{t(`settings.${option.title}`)}</span>
                  <span id={`image-quality-${option.value}-description`} className="mt-1 block text-xs leading-relaxed text-gray-300">{t(`settings.${option.description}`)}</span>
                </span>
                <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${imageQuality === option.value ? 'border-emerald-300 bg-emerald-400 text-gray-950' : 'border-gray-500'}`}>
                  {imageQuality === option.value && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <p id="image-quality-hint" className="mt-3 text-xs leading-relaxed text-gray-400">{t('settings.imageQualityHint')}</p>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h3 className="text-base font-semibold text-white">{t('settings.animPrefsTitle')}</h3>
          <button type="button" onClick={() => { resetPrefs(); setNotice('animPrefsResetDone'); }} disabled={allEnabled} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-gray-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:text-gray-500">
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />{t('settings.animPrefsReset')}
          </button>
        </div>
        <p className={`mt-1 text-sm leading-relaxed ${isLightMode || systemReducedMotion ? 'text-emerald-200' : 'text-gray-400'}`}>
          {t(isLightMode ? 'settings.animPrefsHintLightModeOn' : systemReducedMotion ? 'settings.animPrefsSystemHint' : 'settings.animPrefsHint')}
        </p>
        <div className="mt-2 divide-y divide-gray-700/50">
          {ANIMATION_ROWS.map((row) => {
            const forced = isLightMode || (systemReducedMotion && row.key !== 'blurEffects');
            return <PerformanceToggle key={row.key} id={`performance-${row.key}`} title={t(`settings.${row.title}`)} description={t(`settings.${row.description}`)} checked={effectivePrefs[row.key]} disabled={forced} saved={forced ? t(prefs[row.key] ? 'settings.animSavedOn' : 'settings.animSavedOff') : undefined} onChange={() => setPref(row.key, !prefs[row.key])} />;
          })}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-base font-semibold text-white">{t('settings.performanceHomeTitle')}</h3>
        <div className="mt-2 divide-y divide-gray-700/50">
          <PerformanceToggle id="performance-hero" title={t('settings.hideHero')} description={t('settings.hideHeroDesc')} checked={heroHidden} onChange={() => toggleVisibility('settings_hide_hero', 'hero_visibility_changed', heroHidden)} />
          <PerformanceToggle id="performance-platforms" title={t('settings.hideStreamingPlatforms')} description={t('settings.hideStreamingPlatformsDesc')} checked={platformsHidden} onChange={() => toggleVisibility('settings_hide_streaming_platforms', 'streaming_platforms_visibility_changed', platformsHidden)} />
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-700/50 bg-gray-800/20 p-4 sm:p-5">
        <h3 className="text-base font-semibold text-white">{t('settings.lowLatency')}</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">{t('settings.lowLatencyDesc')}</p>
        <p className="mt-3 text-sm leading-relaxed text-amber-200">{t('settings.lowLatencyWarning')}</p>
        <div className="mt-1 divide-y divide-gray-700/50">
          <PerformanceToggle id="performance-latency-movies" title={t('settings.lowLatencyMovies')} checked={lowLatency.movies} onChange={() => toggleLatency('movies')} />
          <PerformanceToggle id="performance-latency-livetv" title={t('settings.lowLatencyLiveTv')} checked={lowLatency.livetv} onChange={() => toggleLatency('livetv')} />
        </div>
        <p className="text-xs leading-relaxed text-gray-400">{t('settings.lowLatencyApplyHint')}</p>
      </div>
      <p role="status" className="mt-2 text-sm text-gray-300">{notice ? t(`settings.${notice}`) : ''}</p>
    </section>
  );
}
