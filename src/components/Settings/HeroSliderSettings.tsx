import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLightMode } from '@/context/LightModeContext';
import { useHeroHidden } from '@/hooks/useHeroVisibility';
import { SmoothRange, type SmoothRangeHandle } from '@/components/ui/SmoothRange';
import {
  MORPH_SPEED_MIN, MORPH_SPEED_MAX, MORPH_SPEED_STEP,
  setHeroSliderStyle, useHeroSliderStyle, setHeroMorphSpeed, useHeroMorphSpeed, type HeroSliderStyle,
} from '@/hooks/useHeroSliderStyle';

const STYLES = ['classic', 'morph'] as const;

export function HeroSliderSettings() {
  const { t, i18n } = useTranslation();
  const style = useHeroSliderStyle();
  const speed = useHeroMorphSpeed();
  const formatSpeed = useCallback((value: number) => t('settings.heroSliderSpeedValue', {
    value: new Intl.NumberFormat(i18n.resolvedLanguage || 'fr', { maximumFractionDigits: 2 }).format(value),
  }), [t, i18n.resolvedLanguage]);
  const speedRangeRef = useRef<SmoothRangeHandle>(null);
  const speedOutputRef = useRef<HTMLSpanElement>(null);
  const previewSpeedRef = useRef<number | null>(null);
  const hidden = useHeroHidden();
  const { effectivePrefs } = useLightMode();
  const [saveFailed, setSaveFailed] = useState(false);

  const selectStyle = (next: HeroSliderStyle) => {
    setSaveFailed(!setHeroSliderStyle(next));
  };

  const commitSpeed = () => {
    const next = previewSpeedRef.current;
    if (next === null) return;
    previewSpeedRef.current = null;
    const saved = setHeroMorphSpeed(next);
    setSaveFailed(!saved);
    if (!saved) speedRangeRef.current?.animateTo(speed);
  };

  return (
    <div
      data-settings-search-title
      data-settings-search-keywords="hero,slider,morph,react bits,carrousel,carousel,bandeau,accueil,home,vitesse,rapidité,speed,transition"
      className="rounded-xl border border-gray-700/40 bg-gray-800/30 p-4"
    >
      <h4 id="hero-slider-style-title" className="text-sm font-medium text-white">
        {t('settings.heroSliderStyle')}
      </h4>
      <p id="hero-slider-style-description" className="mt-1 text-xs leading-relaxed text-gray-400">
        {t('settings.heroSliderStyleDesc')}
      </p>
      <div
        role="group"
        aria-labelledby="hero-slider-style-title"
        aria-describedby="hero-slider-style-description"
        className="mt-3 flex flex-wrap gap-2"
      >
        {STYLES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={style === option}
            aria-labelledby={`hero-slider-${option}-title`}
            aria-describedby={`hero-slider-${option}-description`}
            onClick={() => selectStyle(option)}
            className={`flex-1 min-w-[100px] p-3 rounded-xl text-left transition-colors border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none ${style === option
              ? 'bg-red-600/10 border-red-500/30 text-white'
              : 'bg-gray-700/20 border-gray-700/40 text-gray-400 hover:bg-gray-700/40 hover:text-white'
            }`}
          >
            <span id={`hero-slider-${option}-title`} className="block text-xs font-semibold">
              {t(`settings.heroSliderStyles.${option}`)}
            </span>
            <span id={`hero-slider-${option}-description`} className="block text-[10px] text-gray-500 mt-0.5">
              {t(`settings.heroSliderStyles.${option}Desc`)}
            </span>
          </button>
        ))}
      </div>
      {style === 'morph' && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-white">{t('settings.heroSliderSpeed')}</span>
            <span ref={speedOutputRef} className="text-sm font-medium tabular-nums text-white">{formatSpeed(speed)}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">{t('settings.heroSliderSpeedDesc')}</p>
          <SmoothRange
            ref={speedRangeRef}
            label={t('settings.heroSliderSpeed')}
            min={MORPH_SPEED_MIN}
            max={MORPH_SPEED_MAX}
            step={MORPH_SPEED_STEP}
            keyboardStep={MORPH_SPEED_STEP}
            value={speed}
            outputRef={speedOutputRef}
            formatValue={formatSpeed}
            animateExternalValue={effectivePrefs.transitions}
            onPreview={(next) => { previewSpeedRef.current = next; }}
            onCommit={commitSpeed}
          />
          <div className="flex justify-between gap-3 text-xs text-gray-400" aria-hidden="true">
            <span>{t('settings.heroSliderSlower')}</span>
            <span>{t('settings.heroSliderFaster')}</span>
          </div>
        </div>
      )}
      {hidden && <p className="mt-3 text-xs leading-relaxed text-gray-400">{t('settings.heroSliderHiddenHint')}</p>}
      {style === 'morph' && !effectivePrefs.transitions && (
        <p className="mt-3 text-xs leading-relaxed text-gray-400">{t('settings.heroSliderMotionHint')}</p>
      )}
      {saveFailed && <p role="status" className="mt-3 text-sm text-amber-200">{t('settings.performanceStorageError')}</p>}
    </div>
  );
}
