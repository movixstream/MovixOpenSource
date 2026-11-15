import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  setMediaColorSettings, useMediaColorSettings,
  type MediaColorMode, type MediaColorSettings as Preferences, type MediaColorTarget,
} from '@/hooks/useMediaColorSettings';
import { useHeroHidden } from '@/hooks/useHeroVisibility';
import { createMediaColorFilePreview, releaseMediaColorFilePreview, type MediaColorPreviewImage } from '@/services/mediaColorService';
import { BgColorPickerPanel } from './BgColorPickerPanel';
import { SettingsToggle } from './SettingsToggle';
import { MediaColorAlgorithmSettings } from './MediaColorAlgorithmSettings';
import { SettingsDisclosure } from './SettingsDisclosure';
import {
  ArrowUpLeft, ArrowUp, ArrowUpRight,
  ArrowLeft, Circle, ArrowRight,
  ArrowDownLeft, ArrowDown, ArrowDownRight,
} from 'lucide-react';
import { HERO_GRADIENT_POSITIONS, type HeroGradientPosition } from '@/utils/mediaColors';

const POSITION_ICONS: Record<HeroGradientPosition, React.ComponentType<{ className?: string }>> = {
  'top-left': ArrowUpLeft,
  'top': ArrowUp,
  'top-right': ArrowUpRight,
  'center-left': ArrowLeft,
  'center': Circle,
  'center-right': ArrowRight,
  'bottom-left': ArrowDownLeft,
  'bottom': ArrowDown,
  'bottom-right': ArrowDownRight,
};

const MODES: MediaColorMode[] = ['auto', 'fixed', 'off'];
const TARGETS: MediaColorTarget[] = ['hero', 'cards'];

export function MediaColorSettings() {
  const { t } = useTranslation();
  const settings = useMediaColorSettings();
  const heroHidden = useHeroHidden();
  const [activeTarget, setActiveTarget] = useState<MediaColorTarget>('hero');
  // Keep a test image across tabs without saving it as a catalogue preference.
  const [previewImage, setPreviewImage] = useState<MediaColorPreviewImage | null>(null);
  const localPreviewUrl = useRef<string | null>(null);
  const tabs = useRef<Record<MediaColorTarget, HTMLButtonElement | null>>({ hero: null, cards: null });
  const positions = useRef<Partial<Record<HeroGradientPosition, HTMLButtonElement | null>>>({});
  const sharedFixedColor = useRef(settings.sharedFixedColor);
  sharedFixedColor.current = settings.sharedFixedColor;
  const [saveFailed, setSaveFailed] = useState(false);
  const save = useCallback((patch: Partial<Preferences>) => {
    setSaveFailed(!setMediaColorSettings(patch));
  }, []);
  const commitHeroColor = useCallback((hex: string) => save({ heroColor: hex }), [save]);
  const commitCardsColor = useCallback((hex: string) => {
    // A picker update may finish after the two areas have been linked.
    save(sharedFixedColor.current ? { heroColor: hex } : { cardsColor: hex });
  }, [save]);

  const selectPreviewImage = useCallback((image: string | File | null) => {
    const next = typeof image === 'string' ? { url: image } : image ? createMediaColorFilePreview(image) : null;
    const previousUrl = localPreviewUrl.current;
    localPreviewUrl.current = next && image instanceof File ? next.url : null;
    setPreviewImage(next);
    if (previousUrl) releaseMediaColorFilePreview(previousUrl);
  }, []);

  useEffect(() => () => {
    if (localPreviewUrl.current) releaseMediaColorFilePreview(localPreviewUrl.current);
    localPreviewUrl.current = null;
  }, []);

  const selectMode = (target: MediaColorTarget, mode: MediaColorMode) => {
    save(target === 'hero'
      ? { heroMode: mode, sharedFixedColor: false }
      : { cardsMode: mode, sharedFixedColor: false });
  };

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: MediaColorTarget;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = TARGETS[1 - index];
    else if (event.key === 'Home') next = 'hero';
    else if (event.key === 'End') next = 'cards';
    else return;
    event.preventDefault();
    setActiveTarget(next);
    tabs.current[next]?.focus();
  };

  const navigatePositions = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = HERO_GRADIENT_POSITIONS.length - 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const column = (index % 3 + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      nextIndex = Math.floor(index / 3) * 3 + column;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      nextIndex = (index + (event.key === 'ArrowDown' ? 3 : 6)) % HERO_GRADIENT_POSITIONS.length;
    } else return;
    event.preventDefault();
    const next = HERO_GRADIENT_POSITIONS[nextIndex];
    save({ heroGradientPosition: next });
    positions.current[next]?.focus();
  };

  return (
    <div
      data-settings-search-title
      data-settings-search-keywords="couleur,dominante,dominant,color,colour,hero,heroslider,slider,bandeau,carte,cards,affiche,poster,automatique,fixed,fixe,commune,algorithme,algorithm,color thief,oklch,rgb,rvb,exemple,aperçu,url,lien,image,tester,upload,importer,fichier,glisser,déposer,drag,drop,lisibilité,readability,position,beige"
      className="rounded-xl border border-gray-700/40 bg-gray-800/30 p-4"
    >
      <h4 className="text-sm font-medium text-white">{t('settings.mediaColors.title')}</h4>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-gray-300">{t('settings.mediaColors.description')}</p>

      <div role="tablist" aria-label={t('settings.mediaColors.tabsLabel')} className="mt-5 grid max-w-md grid-cols-2 gap-1 rounded-lg bg-white/5 p-1">
        {TARGETS.map((target, index) => (
          <button
            key={target}
            ref={(element) => { tabs.current[target] = element; }}
            type="button"
            role="tab"
            id={`media-color-${target}-tab`}
            aria-selected={activeTarget === target}
            aria-controls={`media-color-${target}-panel`}
            tabIndex={activeTarget === target ? 0 : -1}
            onClick={() => setActiveTarget(target)}
            onKeyDown={(event) => navigateTabs(event, index)}
            className={`min-h-11 min-w-0 rounded-md px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none ${activeTarget === target ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-white/5 hover:text-white'}`}
          >
            <span className="block text-sm font-medium">{t(`settings.mediaColors.${target}Tab`)}</span>
            <span className="mt-0.5 block text-xs text-gray-300">
              {t(`settings.mediaColors.modes.${target === 'hero' ? settings.heroMode : settings.cardsMode}`)}
            </span>
          </button>
        ))}
      </div>

      {TARGETS.map((target) => {
        const mode = target === 'hero' ? settings.heroMode : settings.cardsMode;
        const color = target === 'hero' ? settings.heroColor : settings.cardsColor;
        const id = `media-color-${target}`;
        return (
          <div key={target} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab`} hidden={activeTarget !== target} className="mt-4">
            {activeTarget === target && (
              <>
                {target === 'hero' && heroHidden && (
                  <p className="mb-3 text-xs leading-relaxed text-gray-300">{t('settings.heroSliderHiddenHint')}</p>
                )}
                <fieldset aria-describedby={`${id}-description`} className="min-w-0">
                  <legend className="text-sm font-medium text-white">{t(`settings.mediaColors.${target}`)}</legend>
                  <p id={`${id}-description`} className="mt-1 max-w-prose text-xs leading-relaxed text-gray-300">
                    {t(`settings.mediaColors.${target}Description`)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {MODES.map((option) => (
                      <label key={option} className="relative min-w-[100px] flex-1 cursor-pointer">
                        <input
                          type="radio"
                          name={id}
                          value={option}
                          checked={mode === option}
                          onChange={() => selectMode(target, option)}
                          aria-labelledby={`${id}-${option}-title`}
                          aria-describedby={`${id}-${option}-description`}
                          className="peer sr-only"
                        />
                        <span className={`block h-full min-h-11 rounded-xl border p-3 text-left transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-white motion-reduce:transition-none ${mode === option
                          ? 'border-red-500/30 bg-red-600/10 text-white'
                          : 'border-gray-700/40 bg-gray-700/20 text-gray-300 hover:bg-gray-700/40 hover:text-white'
                        }`}>
                          <span id={`${id}-${option}-title`} className="block text-sm font-medium">{t(`settings.mediaColors.modes.${option}`)}</span>
                          <span id={`${id}-${option}-description`} className="mt-1 block text-xs leading-relaxed text-gray-300">{t(`settings.mediaColors.modes.${option}Description`)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <MediaColorAlgorithmSettings
                  target={target}
                  mode={mode}
                  fixedColor={color}
                  value={target === 'hero' ? settings.heroAlgorithm : settings.cardsAlgorithm}
                  previewImage={previewImage}
                  onPreviewImageChange={selectPreviewImage}
                  onChange={(algorithm) => save(target === 'hero' ? { heroAlgorithm: algorithm } : { cardsAlgorithm: algorithm })}
                >
                  {mode === 'fixed' && (
                    <div className="mt-4">
                      <BgColorPickerPanel
                        key={target}
                        committedHex={color}
                        label={t(`settings.mediaColors.${target}Picker`)}
                        hint={t('settings.mediaColors.pickerHint')}
                        onCommit={target === 'hero' ? commitHeroColor : commitCardsColor}
                      />
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <label htmlFor={`${id}-shared`} className="cursor-pointer text-sm font-medium text-white">
                            {t(target === 'hero' ? 'settings.mediaColors.applyToCards' : 'settings.mediaColors.applyToHero')}
                          </label>
                          <p id={`${id}-shared-description`} className="mt-1 text-xs leading-relaxed text-gray-300">{t('settings.mediaColors.sharedDescription')}</p>
                        </div>
                        <SettingsToggle
                          id={`${id}-shared`}
                          checked={settings.sharedFixedColor}
                          aria-describedby={`${id}-shared-description`}
                          onToggle={() => save({
                            sharedFixedColor: !settings.sharedFixedColor,
                            ...(!settings.sharedFixedColor && target === 'cards' ? { heroColor: settings.cardsColor } : {}),
                          })}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-4 divide-y divide-gray-700/40 border-t border-gray-700/40">
                    {mode === 'auto' && (
                      <div className="flex items-center justify-between gap-3 py-4">
                        <div className="min-w-0">
                          <label htmlFor={`${id}-ignore-light-bg`} className="cursor-pointer text-sm font-medium text-white">{t('settings.mediaColors.ignoreLightBackgrounds')}</label>
                          <p id={`${id}-ignore-light-bg-description`} className="mt-1 max-w-prose text-xs leading-relaxed text-gray-300">{t('settings.mediaColors.ignoreLightBackgroundsDescription')}</p>
                        </div>
                        <SettingsToggle
                          id={`${id}-ignore-light-bg`}
                          checked={target === 'hero' ? settings.heroIgnoreLightBackgrounds : settings.cardsIgnoreLightBackgrounds}
                          aria-describedby={`${id}-ignore-light-bg-description`}
                          onToggle={() => save(target === 'hero'
                            ? { heroIgnoreLightBackgrounds: !settings.heroIgnoreLightBackgrounds }
                            : { cardsIgnoreLightBackgrounds: !settings.cardsIgnoreLightBackgrounds })}
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3 py-4">
                      <div className="min-w-0">
                        <label htmlFor={`${id}-base-gradient`} className="cursor-pointer text-sm font-medium text-white">{t('settings.mediaColors.readability')}</label>
                        <p id={`${id}-base-gradient-description`} className="mt-1 max-w-prose text-xs leading-relaxed text-gray-300">{t(`settings.mediaColors.${target}BaseGradientDescription`)}</p>
                      </div>
                      <SettingsToggle
                        id={`${id}-base-gradient`}
                        checked={target === 'hero' ? settings.heroBaseGradient : settings.cardsBaseGradient}
                        aria-describedby={`${id}-base-gradient-description`}
                        onToggle={() => save(target === 'hero'
                          ? { heroBaseGradient: !settings.heroBaseGradient }
                          : { cardsBaseGradient: !settings.cardsBaseGradient })}
                      />
                    </div>
                  </div>

                  {target === 'hero' && mode !== 'off' && (
                    <SettingsDisclosure
                      title={t('settings.mediaColors.advancedSettings')}
                      className="border-t border-gray-700/40"
                      triggerClassName="py-3 text-gray-300 hover:text-white"
                    >
                      <div className="pb-4 pt-1">
                        <p id="media-hero-position-title" className="text-sm font-medium text-white">{t('settings.mediaColors.positionTitle')}</p>
                        <p id="media-hero-position-description" className="mt-1 text-xs leading-relaxed text-gray-300">{t('settings.mediaColors.positionDescription')}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-4">
                          <div role="radiogroup" aria-labelledby="media-hero-position-title" aria-describedby="media-hero-position-description" className="grid shrink-0 grid-cols-3 gap-1 rounded-xl border border-gray-700/60 bg-gray-900/60 p-1">
                            {HERO_GRADIENT_POSITIONS.map((position, index) => {
                              const selected = settings.heroGradientPosition === position;
                              const Icon = POSITION_ICONS[position];
                              return (
                                <button
                                  key={position}
                                  ref={(element) => { positions.current[position] = element; }}
                                  type="button"
                                  role="radio"
                                  aria-checked={selected}
                                  tabIndex={selected ? 0 : -1}
                                  onClick={() => save({ heroGradientPosition: position })}
                                  onKeyDown={(event) => navigatePositions(event, index)}
                                  title={t(`settings.mediaColors.positions.${position}`)}
                                  aria-label={t(`settings.mediaColors.positions.${position}`)}
                                  className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none ${selected ? 'bg-red-600 text-white' : 'text-gray-300 hover:bg-gray-700/60 hover:text-white'}`}
                                >
                                  <span aria-hidden="true"><Icon className={position === 'center' ? 'h-2.5 w-2.5 fill-current' : 'h-4 w-4'} /></span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white">{t(`settings.mediaColors.positions.${settings.heroGradientPosition}`)}</p>
                            <p className="mt-1 max-w-xs text-xs leading-relaxed text-gray-300">{t(`settings.mediaColors.positionsHelp.${settings.heroGradientPosition}`)}</p>
                          </div>
                        </div>
                      </div>
                    </SettingsDisclosure>
                  )}
                </MediaColorAlgorithmSettings>
              </>
            )}
          </div>
        );
      })}
      {saveFailed && <p role="status" className="mt-3 text-sm text-amber-200">{t('settings.performanceStorageError')}</p>}
    </div>
  );
}
