import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DETAILS_FOCUS } from './layout';
import { DetailsMediaRow, DetailsVideoTile } from './DetailsVideoTile';
import { describeDetailsVideo, detailsVideoThumbnail, type DetailsVideo } from './videos';

export interface DetailsMediaPreviewProps {
  /** Vidéos de l'aperçu (les trois premières). */
  videos: DetailsVideo[];
  loadingVideos: boolean;
  /** Image de la tuile « Toutes les images », déjà dimensionnée. */
  imagesTileUrl: string | null;
  imageTotal: number;
  imageBreakdown: string | null;
  emptyLabel: string;
  onPlay: (video: DetailsVideo) => void;
  onOpenImages: () => void;
}

/** Section « Vidéos et images » repliée : trois vidéos et la tuile des images. */
export function DetailsMediaPreview({
  videos, loadingVideos, imagesTileUrl, imageTotal, imageBreakdown, emptyLabel, onPlay, onOpenImages,
}: DetailsMediaPreviewProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <DetailsMediaRow>
        {videos.map((video) => (
          <DetailsVideoTile
            key={video.id}
            className="w-[252px] flex-none md:w-auto"
            title={video.name}
            subtitle={describeDetailsVideo(video, t)}
            imageUrl={detailsVideoThumbnail(video)}
            onClick={() => onPlay(video)}
          />
        ))}
        <DetailsVideoTile
          className="hidden md:block"
          title={t('details.allImages')}
          subtitle={t('details.allImagesHint')}
          imageUrl={imagesTileUrl}
          overlay={{
            headline: imageTotal > 0 ? t('details.imagesCount', { count: imageTotal }) : t('details.imagesTab'),
            text: imageBreakdown,
          }}
          onClick={onOpenImages}
        />
      </DetailsMediaRow>
      {videos.length === 0 && !loadingVideos && (
        <p className="text-sm text-white/55 md:hidden">{emptyLabel}</p>
      )}
      <button
        type="button"
        onClick={onOpenImages}
        className={`group mt-3.5 inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold text-white md:hidden ${DETAILS_FOCUS}`}
      >
        {imageTotal > 0 ? t('details.imagesToSee', { count: imageTotal }) : t('details.allImages')}
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </>
  );
}
