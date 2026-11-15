import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Check, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Media } from '@/components/EmblaCarousel';
import { MEDIA_COLOR_EXAMPLES } from '@/config/mediaColorExamples';
import { getTmdbLanguage } from '@/i18n';
import { type MediaColorMode, type MediaColorTarget } from '@/hooks/useMediaColorSettings';
import { useNearViewport } from '@/hooks/useNearViewport';
import { clearMediaColorPreviewCache, getMediaColorPreviewSource, getMediaColorSource, type MediaColorPreviewImage } from '@/services/mediaColorService';
import { getMediaColorExampleDetails, type MediaColorExampleDetails } from '@/services/mediaColorExampleService';
import { MEDIA_COLOR_ALGORITHMS, type MediaColorAlgorithm } from '@/utils/mediaColors';
import { MediaColorPreview } from './MediaColorPreview';
import { SettingsDisclosure } from './SettingsDisclosure';

const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_FILE_MB = 10;
type FileError = 'fileInvalid' | 'fileTooLarge' | 'fileMultiple' | 'fileUnreadable';

interface AlgorithmOptionProps {
  algorithm: MediaColorAlgorithm;
  selected: boolean;
  target: MediaColorTarget;
  image: string;
  title: string;
  item: Media;
  enabled: boolean;
  customImage: boolean;
  localImage: boolean;
  retryKey: number;
  onSelect: (algorithm: MediaColorAlgorithm) => void;
}

function AlgorithmOption({
  algorithm,
  selected,
  target,
  image,
  title,
  item,
  enabled,
  customImage,
  localImage,
  retryKey,
  onSelect,
}: AlgorithmOptionProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const id = `media-algorithm-${target}-${algorithm}`;

  return (
    <div className="relative isolate min-w-0" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <input
        type="radio"
        name={`media-algorithm-${target}`}
        value={algorithm}
        checked={selected}
        onChange={() => onSelect(algorithm)}
        onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
        onKeyDown={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="peer absolute inset-0 z-50 h-full w-full cursor-pointer appearance-none opacity-0"
      />
      <div className={`min-w-0 rounded-xl border p-3 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-white ${selected
        ? 'border-red-500/30 bg-red-600/10'
        : 'border-gray-700/40 bg-gray-700/20'
      }`}>
        <div className="flex min-h-11 items-start justify-between gap-2 rounded-lg px-1 py-1.5">
          <span className="min-w-0">
            <span id={`${id}-title`} className="block text-xs font-semibold text-white">
              {t(`settings.mediaColors.algorithms.${algorithm}`)}
            </span>
            <span id={`${id}-description`} className="mt-1 block text-xs leading-relaxed text-gray-300">
              {t(`settings.mediaColors.algorithms.${algorithm}Description`)}
            </span>
          </span>
          <span className="h-4 w-4 shrink-0">
            {selected && <Check aria-hidden="true" className="h-4 w-4 text-red-400" />}
          </span>
        </div>
        <div className="mt-3 min-w-0">
          <MediaColorPreview
            id={`${id}-preview`}
            target={target}
            mode="auto"
            fixedColor="#000000"
            algorithm={algorithm}
            image={image}
            title={title}
            item={item}
            enabled={enabled}
            customImage={customImage}
            localImage={localImage}
            retryKey={retryKey}
            detailsVisible={focused || hovered}
          />
        </div>
      </div>
    </div>
  );
}

interface MediaColorAlgorithmSettingsProps {
  target: MediaColorTarget;
  value: MediaColorAlgorithm;
  mode: MediaColorMode;
  fixedColor: string;
  previewImage: MediaColorPreviewImage | null;
  onPreviewImageChange: (image: string | File | null) => void;
  onChange: (algorithm: MediaColorAlgorithm) => void;
  children?: ReactNode;
}

export function MediaColorAlgorithmSettings({
  target,
  value,
  mode,
  fixedColor,
  previewImage,
  onPreviewImageChange,
  onChange,
  children,
}: MediaColorAlgorithmSettingsProps) {
  const { t } = useTranslation();
  const [exampleIndex, setExampleIndex] = useState(0);
  const [draftUrl, setDraftUrl] = useState(previewImage?.fileName === undefined ? previewImage?.url ?? '' : '');
  const [urlInvalid, setUrlInvalid] = useState(false);
  const [fileError, setFileError] = useState<FileError | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [customImageOpen, setCustomImageOpen] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const { ref, isNearViewport } = useNearViewport<HTMLElement>();
  const example = MEDIA_COLOR_EXAMPLES[exampleIndex];
  const title = t(previewImage ? 'settings.mediaColors.customPreviewTitle' : `settings.mediaColors.examples.${example.id}`);
  const image = previewImage?.url ?? (target === 'hero'
    ? `https://image.tmdb.org/t/p/w500${example.backdrop}`
    : `https://image.tmdb.org/t/p/w342${example.poster}`);
  const id = `media-algorithms-${target}`;
  const language = getTmdbLanguage();
  const tmdbId = target === 'cards' && !previewImage ? example.tmdbId : null;
  const detailsKey = tmdbId ? `${tmdbId}:${language}` : null;
  const [detailsEntry, setDetailsEntry] = useState<{ key: string; details: MediaColorExampleDetails | null } | null>(null);
  const details = detailsEntry?.key === detailsKey ? detailsEntry.details : undefined;
  const customImage = Boolean(previewImage);
  const localImage = previewImage?.fileName !== undefined;

  useEffect(() => {
    if (previewImage?.fileName === undefined) setDraftUrl(previewImage?.url ?? '');
  }, [previewImage]);

  useEffect(() => {
    if (mode === 'auto') return;
    setCompareOpen(false);
    setCustomImageOpen(false);
  }, [mode]);

  useEffect(() => {
    if (!tmdbId || !detailsKey || !isNearViewport) return;
    let cancelled = false;
    setDetailsEntry(null);
    getMediaColorExampleDetails(tmdbId, language).then(
      (result) => { if (!cancelled) setDetailsEntry({ key: detailsKey, details: result }); },
      () => { if (!cancelled) setDetailsEntry({ key: detailsKey, details: null }); },
    );
    return () => { cancelled = true; };
  }, [tmdbId, detailsKey, language, isNearViewport, previewAttempt]);

  const item = useMemo<Media>(() => ({
    id: tmdbId ?? 0,
    title: details?.title || title,
    poster_path: previewImage ? '' : example.poster,
    backdrop_path: previewImage ? '' : example.backdrop,
    media_type: 'movie',
    overview: details?.overview ?? '',
    vote_average: details?.vote_average ?? 0,
    release_date: details?.release_date,
  }), [tmdbId, title, details, previewImage, example]);

  const selectFile = (files: FileList | null) => {
    if (!files?.length) return;
    if (files.length !== 1) return setFileError('fileMultiple');
    const file = files[0];
    const supported = file.type ? FILE_TYPES.includes(file.type) : /\.(jpe?g|png|webp|avif)$/i.test(file.name);
    if (!supported || file.size === 0) return setFileError('fileInvalid');
    if (file.size > MAX_FILE_MB * 1024 * 1024) return setFileError('fileTooLarge');
    try {
      onPreviewImageChange(file);
      setPreviewAttempt((attempt) => attempt + 1);
      setFileError(null);
      setUrlInvalid(false);
    } catch {
      setFileError('fileUnreadable');
    }
  };

  const resetDrag = () => {
    dragDepth.current = 0;
    setIsDragging(false);
  };

  const dropFile = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resetDrag();
    if (!event.dataTransfer.files.length) return setFileError('fileInvalid');
    selectFile(event.dataTransfer.files);
  };

  const testImage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const source = getMediaColorPreviewSource(draftUrl);
    setUrlInvalid(!source);
    if (!source) return;
    setFileError(null);
    clearMediaColorPreviewCache(source);
    setDraftUrl(source);
    setPreviewAttempt((attempt) => attempt + 1);
    onPreviewImageChange(source);
  };

  const selectExample = (index: number) => {
    if (!previewImage && index === exampleIndex) {
      const source = getMediaColorSource(image);
      if (source) clearMediaColorPreviewCache(source);
    }
    setExampleIndex(index);
    setPreviewAttempt((attempt) => attempt + 1);
    setUrlInvalid(false);
    setFileError(null);
    onPreviewImageChange(null);
  };

  const currentAlgorithmName = value === 'legacy'
    ? t('settings.mediaColors.algorithms.legacyRecommended')
    : t(`settings.mediaColors.algorithms.${value}`);

  return (
    <section ref={ref} aria-labelledby={`${id}-preview-title`} className="mt-5 min-w-0 border-t border-gray-700/40 pt-4">
      <div className="min-w-0">
        <h5 id={`${id}-preview-title`} className="text-sm font-medium text-white">
          {t('settings.mediaColors.previewTitle')}
        </h5>
        <p className="mt-1 text-xs leading-relaxed text-gray-300">
          {t(target === 'hero' ? 'settings.mediaColors.heroPreviewHint' : 'settings.mediaColors.cardsPreviewHint')}
        </p>

        <div role="group" aria-label={t('settings.mediaColors.exampleImage')} className="my-3 flex min-w-0 flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-gray-400">{t('settings.mediaColors.exampleImage')}</span>
          {MEDIA_COLOR_EXAMPLES.map((exampleItem, index) => (
            <button
              key={exampleItem.id}
              type="button"
              aria-pressed={!previewImage && exampleIndex === index}
              onClick={() => selectExample(index)}
              className={`min-h-11 rounded-lg px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${!previewImage && exampleIndex === index
                ? 'bg-gray-700 font-semibold text-white'
                : 'text-gray-300 hover:bg-gray-700/40 hover:text-white'
              }`}
            >
              {t(`settings.mediaColors.examples.${exampleItem.id}`)}
            </button>
          ))}
          {previewImage && (
            <span aria-current="true" className="flex min-h-11 items-center rounded-lg bg-red-600/10 px-3 py-2 text-xs font-semibold text-red-100">
              {t('settings.mediaColors.customPreviewTitle')}
            </span>
          )}
        </div>

        {tmdbId && !details && (
          <p role="status" className="mb-3 text-xs text-gray-300">
            {t(details === null ? 'settings.mediaColors.exampleDetailsUnavailable' : 'settings.mediaColors.exampleDetailsLoading')}
          </p>
        )}

        <MediaColorPreview
          key={`main-${image}-${previewAttempt}`}
          id={`${id}-main-preview`}
          align="start"
          target={target}
          mode={mode}
          fixedColor={fixedColor}
          algorithm={value}
          image={image}
          title={title}
          item={item}
          enabled={isNearViewport}
          customImage={customImage}
          localImage={localImage}
          retryKey={previewAttempt}
          detailsVisible={target === 'cards'}
          announceResult
        />
      </div>

      {children}

      {mode === 'auto' && (
        <div className="mt-4 min-w-0 border-t border-gray-700/40 pt-4">
          <p className="text-xs text-gray-400">
            {t('settings.mediaColors.currentAlgorithm')}
            <span className="ml-2 font-semibold text-white">{currentAlgorithmName}</span>
          </p>

          <SettingsDisclosure
            title={t('settings.mediaColors.compareAlgorithms')}
            className="mt-2 min-w-0"
            triggerClassName="px-2 text-white hover:bg-gray-700/30"
            open={compareOpen}
            onOpenChange={setCompareOpen}
            onClosed={() => setCustomImageOpen(false)}
          >
            <div className="min-w-0 pt-2">
              <p className="text-xs leading-relaxed text-gray-300">
                {t('settings.mediaColors.algorithmDescription')}
              </p>

              <SettingsDisclosure
                title={t('settings.mediaColors.testCustomImage')}
                className="mt-3 min-w-0 rounded-xl border border-gray-700/40 bg-gray-800/30"
                triggerClassName="rounded-xl px-3 py-2 text-white hover:bg-gray-700/30"
                open={customImageOpen}
                onOpenChange={setCustomImageOpen}
              >
                <div className="min-w-0 border-t border-gray-700/40 p-3">
                  <p className="mb-3 text-xs leading-relaxed text-gray-300">
                    {t('settings.mediaColors.previewOnlyHint')}
                  </p>
                  <div>
                    <input
                      ref={fileInput}
                      id={`${id}-file`}
                      type="file"
                      accept={`${FILE_TYPES.join(',')},.jpg,.jpeg,.png,.webp,.avif`}
                      className="hidden"
                      onChange={(event) => {
                        selectFile(event.currentTarget.files);
                        event.currentTarget.value = '';
                      }}
                    />
                    <button
                      type="button"
                      aria-controls={`${id}-file`}
                      aria-describedby={`${id}-file-hint${fileError ? ` ${id}-file-error` : ''}`}
                      onClick={() => fileInput.current?.click()}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!event.dataTransfer.types.includes('Files')) return;
                        dragDepth.current++;
                        setIsDragging(true);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') ? 'copy' : 'none';
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        dragDepth.current = Math.max(0, dragDepth.current - 1);
                        if (!dragDepth.current) setIsDragging(false);
                      }}
                      onDragEnd={resetDrag}
                      onDrop={dropFile}
                      className={`flex min-h-24 w-full items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${isDragging
                        ? 'border-red-400 bg-red-600/10'
                        : 'border-gray-600 bg-gray-800/30 hover:border-gray-400 hover:bg-gray-700/30'
                      }`}
                    >
                      <Upload aria-hidden="true" className="pointer-events-none h-5 w-5 shrink-0 text-gray-300" />
                      <span className="pointer-events-none min-w-0">
                        <span className="block text-sm font-medium text-white">
                          {t(isDragging ? 'settings.mediaColors.fileDropActive' : 'settings.mediaColors.fileDropTitle')}
                        </span>
                        <span className="mt-1 block text-xs text-gray-300">{t('settings.mediaColors.fileChoose')}</span>
                      </span>
                    </button>
                    <p id={`${id}-file-hint`} className="mt-2 text-xs leading-relaxed text-gray-400">
                      {t('settings.mediaColors.fileHint', { maxSize: MAX_FILE_MB })}
                    </p>
                    {previewImage?.fileName !== undefined && (
                      <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
                        <span role="status" title={previewImage.fileName} className="min-w-0 truncate text-xs text-gray-300">
                          {previewImage.fileName}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onPreviewImageChange(null);
                            setPreviewAttempt((attempt) => attempt + 1);
                            setFileError(null);
                          }}
                          className="min-h-11 shrink-0 rounded-lg px-3 py-2 text-xs text-gray-300 hover:bg-gray-700/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                        >
                          {t('settings.mediaColors.fileRemove')}
                        </button>
                      </div>
                    )}
                    {fileError && (
                      <p id={`${id}-file-error`} role="alert" className="mt-2 text-xs text-red-300">
                        {t(`settings.mediaColors.${fileError}`, { maxSize: MAX_FILE_MB })}
                      </p>
                    )}
                  </div>

                  <form noValidate onSubmit={testImage} className="mt-4">
                    <label htmlFor={`${id}-url`} className="block text-xs font-medium text-white">
                      {t('settings.mediaColors.customUrlLabel')}
                    </label>
                    <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
                      <input
                        id={`${id}-url`}
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        maxLength={4096}
                        value={draftUrl}
                        onChange={(event) => {
                          setDraftUrl(event.target.value);
                          setUrlInvalid(false);
                        }}
                        placeholder={t('settings.mediaColors.customUrlPlaceholder')}
                        aria-invalid={urlInvalid}
                        aria-describedby={`${id}-url-hint${urlInvalid ? ` ${id}-url-error` : ''}`}
                        className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-700/60 bg-gray-800/60 px-3 py-2 text-sm text-white placeholder:text-gray-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                      />
                      <button type="submit" className="min-h-11 shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                        {t('settings.mediaColors.customUrlTest')}
                      </button>
                    </div>
                    <p id={`${id}-url-hint`} className="mt-2 text-xs leading-relaxed text-gray-400">
                      {t('settings.mediaColors.customUrlHint')}
                    </p>
                    {urlInvalid && (
                      <p id={`${id}-url-error`} role="alert" className="mt-2 text-xs text-red-300">
                        {t('settings.mediaColors.customUrlInvalid')}
                      </p>
                    )}
                  </form>
                </div>
              </SettingsDisclosure>

              <fieldset className="mt-3 min-w-0 p-1">
                <legend className="sr-only">{t('settings.mediaColors.algorithmTitle')}</legend>
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                  {MEDIA_COLOR_ALGORITHMS.map((algorithm) => (
                    <AlgorithmOption
                      key={`${image}-${customImage}-${previewAttempt}-${algorithm}`}
                      algorithm={algorithm}
                      selected={value === algorithm}
                      target={target}
                      image={image}
                      title={title}
                      item={item}
                      enabled={isNearViewport}
                      customImage={customImage}
                      localImage={localImage}
                      retryKey={previewAttempt}
                      onSelect={onChange}
                    />
                  ))}
                </div>
              </fieldset>
            </div>
          </SettingsDisclosure>
        </div>
      )}
    </section>
  );
}
