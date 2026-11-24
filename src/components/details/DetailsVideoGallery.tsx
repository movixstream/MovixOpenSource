import { ArrowLeft, Film, Languages, Loader, Video, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { DetailsMediaRow, DetailsVideoTile } from './DetailsVideoTile';
import { detailsLanguageName } from './languageNames';
import { DETAILS_FOCUS, DETAILS_PRESS } from './layout';
import { DetailsLabelSwap, DetailsSwap } from './motion';
import { describeDetailsVideo, detailsVideoThumbnail, sortDetailsVideos, type DetailsVideo } from './videos';

/** Groupe titré de la vue normale (« Bandes-annonces », « Extraits »…). */
export interface DetailsVideoGroup {
  key: string;
  title: string;
  videos: DetailsVideo[];
}

export interface DetailsVideoGalleryProps {
  /** Titre du bloc (« Vidéos et bandes-annonces »). */
  title: string;
  /** Vidéos dans la langue du site. */
  videos: DetailsVideo[];
  /** Vidéos de toutes les langues, chargées à la première bascule. */
  multiLangVideos: DetailsVideo[];
  loading: boolean;
  /** Vue « Multi-langues » active. */
  showMultiLang: boolean;
  onToggleMultiLang: () => void;
  onPlay: (video: DetailsVideo) => void;
  emptyLabel: string;
  emptyMultiLangLabel: string;
  /**
   * Découpe la vue normale en groupes titrés (vidéos d'une série classées par
   * type) ; les groupes vides sont ignorés. Sans elle : une seule grille.
   */
  groups?: DetailsVideoGroup[];
  /** Niveau du titre : `h4` pour un bloc placé sous un autre titre (vidéos d'une saison). */
  titleAs?: 'h3' | 'h4';
  /** Liste vide : une ligne de texte au lieu du bloc avec icône (blocs répétés par saison). */
  compactEmpty?: boolean;
  className?: string;
}

/** Toutes les vidéos d'un titre, avec la bascule vers les vidéos des autres langues. */
export function DetailsVideoGallery({
  title, videos, multiLangVideos, loading, showMultiLang, onToggleMultiLang, onPlay, emptyLabel, emptyMultiLangLabel,
  groups, titleAs = 'h3', compactEmpty = false, className,
}: DetailsVideoGalleryProps) {
  const { t } = useTranslation();
  const Title = titleAs;
  const GroupTitle = titleAs === 'h4' ? 'h5' : 'h4';

  const tiles = (list: DetailsVideo[]) => (
    <DetailsMediaRow layout="grid">
      {sortDetailsVideos(list).map((video) => (
        <DetailsVideoTile
          key={video.id}
          title={video.name}
          subtitle={[describeDetailsVideo(video, t), video.size ? `${video.size}p` : ''].filter(Boolean).join(' · ')}
          imageUrl={detailsVideoThumbnail(video)}
          onClick={() => onPlay(video)}
        />
      ))}
    </DetailsMediaRow>
  );

  const empty = (label: string, Icon: LucideIcon) => (compactEmpty ? (
    <p className="text-sm text-white/55">{label}</p>
  ) : (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-white/60">
      <Icon aria-hidden="true" className="size-8 text-white opacity-40" />
      <p>{label}</p>
    </div>
  ));

  const grouped = (list: Array<{ key: string; title: string; videos: DetailsVideo[] }>) => (
    <div className="space-y-8">
      {list.map((group) => (
        <div key={group.key}>
          <GroupTitle className="mb-4 border-b border-white/[.12] pb-2 text-base font-semibold text-white">
            {group.title}
          </GroupTitle>
          {tiles(group.videos)}
        </div>
      ))}
    </div>
  );

  let body;
  if (loading) {
    body = (
      <div className="flex h-40 items-center justify-center">
        <Loader aria-hidden="true" className="size-8 animate-spin text-red-600 motion-reduce:animate-none" />
      </div>
    );
  } else if (showMultiLang) {
    const byLanguage = new Map<string, DetailsVideo[]>();
    for (const video of multiLangVideos) {
      const language = video.iso_639_1 || 'unknown';
      byLanguage.set(language, [...(byLanguage.get(language) ?? []), video]);
    }
    body = byLanguage.size === 0 ? empty(emptyMultiLangLabel, Video) : grouped(
      Array.from(byLanguage.entries()).map(([language, list]) => ({
        key: language,
        title: detailsLanguageName(language, t),
        videos: list,
      })),
    );
  } else if (videos.length === 0) {
    body = empty(emptyLabel, Film);
  } else {
    const shownGroups = groups?.filter((group) => group.videos.length > 0) ?? [];
    body = shownGroups.length > 0 ? grouped(shownGroups) : tiles(videos);
  }

  return (
    <div className={className}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Title className={cn('font-semibold text-white', titleAs === 'h4' ? 'text-base' : 'text-lg')}>{title}</Title>
        <button
          type="button"
          onClick={onToggleMultiLang}
          aria-pressed={showMultiLang}
          className={cn(
            'relative inline-flex h-11 items-center overflow-hidden rounded-[10px] border border-white/[.22] bg-white/[.14] px-3.5 text-sm font-medium text-white hover:bg-white/[.22]',
            DETAILS_PRESS,
            DETAILS_FOCUS,
          )}
        >
          <DetailsLabelSwap swapKey={showMultiLang ? 'back' : 'multi'} className="inline-flex items-center gap-2 whitespace-nowrap">
            {showMultiLang ? <ArrowLeft aria-hidden="true" className="size-4" /> : <Languages aria-hidden="true" className="size-4" />}
            {showMultiLang ? t('details.back') : t('details.multiLanguages')}
          </DetailsLabelSwap>
        </button>
      </div>
      <DetailsSwap swapKey={loading ? 'loading' : showMultiLang ? 'multi' : 'normal'}>{body}</DetailsSwap>
    </div>
  );
}

export default DetailsVideoGallery;
