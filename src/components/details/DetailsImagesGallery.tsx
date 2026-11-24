import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Archive, CheckCircle, Download, Image as ImageIcon, Loader } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useImageQuality, useImageViewport } from '@/hooks/useImageQuality';
import { useImageSlot } from '@/hooks/useImageSlot';
import { getTmdbImageProps, getTmdbImageUrl } from '@/utils/tmdbImages';
import { cn } from '@/lib/utils';
import { detailsLanguageName } from './languageNames';
import { DetailsLanguageSelect, type DetailsLanguageOption } from './DetailsLanguageSelect';
import { DETAILS_FOCUS, DETAILS_PRESS } from './layout';
import { DetailsSwap } from './motion';

/** Image TMDB telle que renvoyée par `/images`. */
export interface DetailsTmdbImage {
  aspect_ratio: number;
  file_path: string;
  height: number;
  iso_639_1: string | null;
  vote_average: number;
  vote_count: number;
  width: number;
}

/** Réponse TMDB `/movie/:id/images` ou `/tv/:id/images`. */
export interface DetailsImageSet {
  backdrops: DetailsTmdbImage[];
  logos: DetailsTmdbImage[];
  posters: DetailsTmdbImage[];
}

type ImageCategory = 'backdrops' | 'posters' | 'logos';
type ZipStatus = 'idle' | 'downloading' | 'zipping' | 'complete' | 'error';

const CATEGORIES: readonly ImageCategory[] = ['backdrops', 'posters', 'logos'];
const PENDING_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const INITIAL_IMAGE_COUNT = 24;
/** Lissage des notes d'images : 3 votes fictifs à 5/10 pour chaque image. */
const IMAGE_PRIOR_VOTES = 3;
const IMAGE_PRIOR_SCORE = 5;

/** Image chargée seulement à l'approche de l'écran, avec un fond d'attente. */
function LazyImage({ src, srcSet, sizes, alt, ratio, contain = false, className }: {
  src: string;
  srcSet?: string;
  sizes?: string;
  alt: string;
  /** Largeur / hauteur de l'image : réserve sa place avant le chargement. */
  ratio?: number;
  /** Image posée en entier dans sa boîte (logos) au lieu de suivre la largeur. */
  contain?: boolean;
  className: string;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setIsInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.1, rootMargin: '50px' });
    if (holderRef.current) observer.observe(holderRef.current);
    return () => observer.disconnect();
  }, []);

  const placeholder = (
    <div className={cn('flex items-center justify-center bg-gray-800', isInView ? 'absolute inset-0' : 'h-full min-h-8 w-full')}>
      <ImageIcon aria-hidden="true" className="size-8 text-white opacity-25" />
    </div>
  );

  return (
    <div ref={holderRef} className={className} style={ratio && ratio > 0 ? { aspectRatio: String(ratio) } : undefined}>
      {!isInView ? placeholder : (
        <>
          {!isLoaded && placeholder}
          <img
            src={src}
            srcSet={srcSet}
            sizes={sizes}
            alt={alt}
            className={cn(
              contain ? 'absolute inset-0 size-full object-contain' : 'h-auto w-full object-cover',
              'transition-opacity duration-300 motion-reduce:transition-none',
              isLoaded ? 'opacity-100' : 'opacity-0',
            )}
            onLoad={() => setIsLoaded(true)}
            loading="lazy"
          />
        </>
      )}
    </div>
  );
}

export interface DetailsImagesGalleryProps {
  mediaType: 'movie' | 'tv';
  /** Identifiant TMDB, repris dans le nom des fichiers téléchargés. */
  mediaId: string;
  /** Images du titre ; `null` tant qu'elles ne sont pas chargées. */
  images: DetailsImageSet | null;
  loading: boolean;
  /** Titre du bloc (« Images »). */
  title: string;
  className?: string;
}

/**
 * Galerie complète des images d'un titre : arrière-plans, affiches et logos,
 * filtre par langue, téléchargement une par une ou de la catégorie en ZIP.
 */
export function DetailsImagesGallery({ mediaType, mediaId, images, loading, title, className }: DetailsImagesGalleryProps) {
  const { t } = useTranslation();
  const { effectiveImageQuality } = useImageQuality();
  const { width: viewportWidth, dpr } = useImageViewport();
  const imageDpr = Math.min(dpr, effectiveImageQuality === 'high' ? 3 : 2);
  const [selectedCategory, setSelectedCategory] = useState<ImageCategory>('backdrops');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all');
  // Logos : cases 16/9 identiques, logo centré dedans. Avec la hauteur de
  // chaque logo, la case la plus haute étirait les autres de sa rangée et
  // laissait un trou noir sous leur fond.
  const isLogos = selectedCategory === 'logos';
  const mobileLogoGridRef = useRef<HTMLDivElement | null>(null);
  const desktopLogoGridRef = useRef<HTMLDivElement | null>(null);
  const logoSlotEnabled = !loading && Boolean(images) && selectedCategory === 'logos';
  const mobileLogoGridSlot = useImageSlot(mobileLogoGridRef, logoSlotEnabled && viewportWidth < 768);
  const desktopLogoGridSlot = useImageSlot(desktopLogoGridRef, logoSlotEnabled && viewportWidth >= 768);

  // Téléchargement de la catégorie en ZIP
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [zipStatus, setZipStatus] = useState<ZipStatus>('idle');
  const [downloadedCount, setDownloadedCount] = useState(0);

  const getGalleryImageProps = (image: DetailsTmdbImage) => {
    if (selectedCategory === 'logos') {
      const gridSlot = viewportWidth < 768 ? mobileLogoGridSlot : desktopLogoGridSlot;
      if (gridSlot.width <= 0) return { src: PENDING_IMAGE };
      const columns = viewportWidth < 768 ? 1 : viewportWidth < 1024 ? 3 : 4;
      const cardWidth = viewportWidth < 768
        ? (viewportWidth < 640 ? 256 : 288)
        : (gridSlot.width - 16 * (columns - 1)) / columns;
      const horizontalPadding = viewportWidth < 768 ? 48 : 64;
      const imageWidth = Math.max(1, cardWidth - horizontalPadding);
      return {
        src: getTmdbImageUrl(image.file_path, {
          kind: 'logo',
          quality: effectiveImageQuality,
          width: Math.ceil(imageWidth * imageDpr),
          role: 'card',
        }),
      };
    }

    return getTmdbImageProps(image.file_path, {
      kind: selectedCategory === 'posters' ? 'poster' : 'backdrop',
      quality: effectiveImageQuality,
      sizes: '(max-width: 639px) 16rem, (max-width: 767px) 18rem, (max-width: 1023px) calc(33.333vw - 2.667rem), (max-width: 1919px) calc(25vw - 3.25rem), 428px',
      role: 'card',
      originalWidth: image.width,
    });
  };

  // Les 24 premières images d'abord, le reste quand le navigateur est au repos.
  const [showAllImages, setShowAllImages] = useState(false);
  useEffect(() => {
    if (showAllImages) return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const ric = w.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200) as unknown as number);
    const cic = w.cancelIdleCallback ?? ((id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
    const id = ric(() => setShowAllImages(true));
    return () => cic(id);
  }, [showAllImages]);

  const matchesLanguage = (image: DetailsTmdbImage, language: string) => (
    language === 'no-text' ? image.iso_639_1 === null : image.iso_639_1 === language
  );

  // Les plus appréciées d'abord : note TMDB lissée par le nombre de votes (une
  // image notée 10 par une seule personne ne passe pas devant une image notée
  // 8 par cinquante), puis la plus grande.
  const categoryImages = useMemo(() => {
    const list = images?.[selectedCategory] ?? [];
    const score = (image: DetailsTmdbImage) => (
      (image.vote_average * image.vote_count + IMAGE_PRIOR_SCORE * IMAGE_PRIOR_VOTES) / (image.vote_count + IMAGE_PRIOR_VOTES)
    );
    return [...list].sort((a, b) => score(b) - score(a) || b.vote_count - a.vote_count || b.width - a.width);
  }, [images, selectedCategory]);
  const filteredImages = selectedLanguage === 'all'
    ? categoryImages
    : categoryImages.filter((image) => matchesLanguage(image, selectedLanguage));
  const shownImages = showAllImages ? filteredImages : filteredImages.slice(0, INITIAL_IMAGE_COUNT);
  const availableLanguages = Array.from(new Set(categoryImages.map((image) => image.iso_639_1 ?? 'no-text')));
  // « Toutes les langues », « Sans texte », puis les langues par ordre alphabétique de leur nom.
  const languageOptions: DetailsLanguageOption[] = [
    { code: 'all', label: t('details.allLanguages'), count: categoryImages.length },
    ...availableLanguages
      .map((code) => ({
        code,
        label: detailsLanguageName(code, t),
        count: categoryImages.filter((image) => matchesLanguage(image, code)).length,
      }))
      .sort((a, b) => (a.code === 'no-text' ? -1 : b.code === 'no-text' ? 1 : a.label.localeCompare(b.label))),
  ];

  const downloadImage = async (imagePath: string, filename: string) => {
    try {
      const response = await fetch(`https://image.tmdb.org/t/p/original${imagePath}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading image:', error);
    }
  };

  const downloadAllAsZip = async () => {
    const imagesToDownload = filteredImages;
    if (imagesToDownload.length === 0) return;

    setIsDownloadingZip(true);
    setZipProgress(0);
    setZipStatus('downloading');
    setDownloadedCount(0);

    try {
      // jszip et file-saver ne sont chargés qu'au premier téléchargement groupé.
      const [jszipMod, fileSaverMod] = await Promise.all([
        import('jszip'),
        import('file-saver'),
      ]);
      const JSZip = jszipMod.default;
      const { saveAs } = fileSaverMod;
      const zip = new JSZip();
      const folder = zip.folder(`${mediaType}-${mediaId}-${selectedCategory}`);

      for (let i = 0; i < imagesToDownload.length; i++) {
        const image = imagesToDownload[i];
        try {
          const response = await fetch(`https://image.tmdb.org/t/p/original${image.file_path}`);
          const blob = await response.blob();
          const extension = image.file_path.split('.').pop() || 'jpg';
          const langSuffix = image.iso_639_1 ? `_${image.iso_639_1}` : '';
          folder?.file(`${selectedCategory}_${i + 1}${langSuffix}_${image.width}x${image.height}.${extension}`, blob);
          setDownloadedCount(i + 1);
          setZipProgress(Math.round(((i + 1) / imagesToDownload.length) * 80)); // 80 % pour le téléchargement
        } catch (err) {
          console.error(`Error downloading image ${i + 1}:`, err);
        }
      }

      setZipStatus('zipping');
      setZipProgress(90);

      const content = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      }, (metadata) => {
        setZipProgress(90 + Math.round(metadata.percent * 0.1)); // 10 % pour la compression
      });

      const categoryName = selectedCategory === 'backdrops' ? 'arriere-plans'
        : selectedCategory === 'posters' ? 'affiches' : 'logos';
      saveAs(content, `${mediaType}-${mediaId}-${categoryName}.zip`);

      setZipProgress(100);
      setZipStatus('complete');
      setTimeout(() => {
        setIsDownloadingZip(false);
        setZipProgress(0);
        setZipStatus('idle');
        setDownloadedCount(0);
      }, 3000);
    } catch (error) {
      console.error('Error creating ZIP:', error);
      setZipStatus('error');
      setTimeout(() => {
        setIsDownloadingZip(false);
        setZipProgress(0);
        setZipStatus('idle');
      }, 3000);
    }
  };

  // Changer de catégorie remet le filtre de langue à zéro.
  useEffect(() => {
    setSelectedLanguage('all');
  }, [selectedCategory]);

  const downloadButton = (image: DetailsTmdbImage, index: number) => (
    <button
      type="button"
      aria-label={`${t('details.downloadBtn')} · ${selectedCategory} ${index + 1}`}
      onClick={() => downloadImage(image.file_path, `${mediaType}-${mediaId}-${selectedCategory}-${index + 1}.jpg`)}
      className={cn(
        'absolute right-2 top-2 flex size-11 items-center justify-center rounded-full border border-white/30 bg-black/70 text-white hover:bg-black focus-visible:opacity-100',
        '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100',
        DETAILS_PRESS,
        DETAILS_FOCUS,
      )}
    >
      <Download aria-hidden="true" className="size-[18px]" />
    </button>
  );

  const dimensions = (image: DetailsTmdbImage) => (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
      <p className="text-xs text-white tabular-nums">{image.width} × {image.height}</p>
    </div>
  );

  return (
    <div className={className}>
      <h3 className="mb-4 text-lg font-semibold text-white">{title}</h3>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader aria-hidden="true" className="size-8 animate-spin text-red-600 motion-reduce:animate-none" />
        </div>
      ) : images ? (
        <div>
          {/* Catégories : pastille rouge qui glisse (même motif que les réglages). */}
          <div role="tablist" className="mb-5 flex items-center gap-1 overflow-x-auto rounded-xl bg-white/5 p-1">
            {CATEGORIES.map((category) => {
              const isActive = selectedCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setSelectedCategory(category)}
                  className={cn(
                    'relative flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none sm:px-4',
                    isActive ? 'text-white' : 'text-white/60 hover:text-white',
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId={`${mediaType}-images-tabs-indicator`}
                      className="absolute inset-0 rounded-lg bg-red-600"
                      transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    <span>{t(category === 'backdrops' ? 'details.backgrounds' : `details.${category}`)}</span>
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums', isActive ? 'bg-white/25 text-white' : 'bg-white/10 text-white/70')}>
                      {images[category]?.length ?? 0}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mb-5 flex flex-wrap items-start gap-3">
            {availableLanguages.length > 1 && (
              <DetailsLanguageSelect
                value={selectedLanguage}
                options={languageOptions}
                onChange={setSelectedLanguage}
                className="w-full md:w-72"
              />
            )}

            {filteredImages.length > 0 && (
              <div className="w-full md:w-auto">
                <button
                  type="button"
                  onClick={downloadAllAsZip}
                  disabled={isDownloadingZip}
                  className={cn('relative flex h-12 w-full items-center justify-center gap-2.5 overflow-hidden rounded-[14px] border border-white/[.22] bg-white/[.14] px-4 text-sm font-semibold text-white hover:bg-white/[.22] disabled:cursor-not-allowed md:w-auto', DETAILS_PRESS, DETAILS_FOCUS)}
                >
                  {zipStatus === 'idle' && (
                    <>
                      <Archive aria-hidden="true" className="size-[18px] flex-none" />
                      <span>{t('details.downloadZip')}</span>
                      <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{t('details.imagesCount', { count: filteredImages.length })}</span>
                    </>
                  )}
                  {zipStatus === 'downloading' && (
                    <>
                      <Loader aria-hidden="true" className="size-[18px] flex-none animate-spin motion-reduce:animate-none" />
                      <span className="tabular-nums">{t('details.downloading')} {downloadedCount}/{filteredImages.length}</span>
                      <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs tabular-nums">{zipProgress}%</span>
                    </>
                  )}
                  {zipStatus === 'zipping' && (
                    <>
                      <Loader aria-hidden="true" className="size-[18px] flex-none animate-spin motion-reduce:animate-none" />
                      <span>{t('details.compressing')}</span>
                    </>
                  )}
                  {zipStatus === 'complete' && (
                    <>
                      <CheckCircle aria-hidden="true" className="size-[18px] flex-none" />
                      <span>{t('details.downloadComplete')}</span>
                    </>
                  )}
                  {zipStatus === 'error' && (
                    <>
                      <AlertTriangle aria-hidden="true" className="size-[18px] flex-none text-red-400" />
                      <span>{t('details.downloadError')}</span>
                    </>
                  )}
                  {isDownloadingZip && zipStatus !== 'complete' && (
                    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-black/35">
                      <span className="block h-full bg-red-600 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${zipProgress}%` }} />
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>

          <DetailsSwap swapKey={selectedCategory}>
          {/* Sous 768 px : rangée qui défile. */}
          <div
            ref={mobileLogoGridRef}
            key={`${selectedCategory}-mobile`}
            data-reveal-grid
            className="scrollbar-hide -mr-3 flex snap-x snap-mandatory gap-4 overflow-x-auto py-1 pr-3 sm:-mr-6 sm:pr-6 md:hidden"
          >
            {shownImages.map((image, index) => (
              <div
                key={`mobile-${selectedCategory}-${image.file_path}`}
                className="group relative w-64 flex-shrink-0 snap-center overflow-hidden rounded-xl border border-white/10 sm:w-72"
              >
                <div className={cn('w-full', isLogos ? 'aspect-video bg-white/5 p-6' : 'h-auto')}>
                  <LazyImage
                    {...getGalleryImageProps(image)}
                    alt={`${selectedCategory} ${index + 1}`}
                    ratio={isLogos ? undefined : image.aspect_ratio}
                    contain={isLogos}
                    className={isLogos ? 'relative size-full' : 'relative h-auto w-full'}
                  />
                </div>
                {downloadButton(image, index)}
                {dimensions(image)}
              </div>
            ))}
          </div>

          {/* Dès 768 px : grille. */}
          <div
            ref={desktopLogoGridRef}
            key={`${selectedCategory}-desktop`}
            data-reveal-grid
            className="hidden gap-4 md:grid md:grid-cols-3 lg:grid-cols-4"
          >
            {shownImages.map((image, index) => (
              <div
                key={`desktop-${selectedCategory}-${image.file_path}`}
                className="group relative overflow-hidden rounded-xl border border-white/10"
              >
                <div className={cn('w-full', isLogos ? 'aspect-video bg-white/5 p-8' : 'h-auto')}>
                  <LazyImage
                    {...getGalleryImageProps(image)}
                    alt={`${selectedCategory} ${index + 1}`}
                    ratio={isLogos ? undefined : image.aspect_ratio}
                    contain={isLogos}
                    className={isLogos ? 'relative size-full' : 'relative h-auto w-full'}
                  />
                </div>
                {downloadButton(image, index)}
                {dimensions(image)}
              </div>
            ))}
          </div>

          {filteredImages.length === 0 && (
            <p className="py-8 text-center text-white/60">{t('details.noImageInCategory')}</p>
          )}
          </DetailsSwap>
        </div>
      ) : (
        <p className="py-8 text-center text-white/60">{t('details.imageLoadError')}</p>
      )}
    </div>
  );
}

export default DetailsImagesGallery;
