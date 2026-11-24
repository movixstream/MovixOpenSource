import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMovieReleaseWarnings } from '@/hooks/useMovieReleaseWarnings';

interface DetailsSkeletonProps {
  mediaType?: 'movie' | 'tv';
}

const DetailsSkeleton = ({ mediaType = 'movie' }: DetailsSkeletonProps) => {
  const { t } = useTranslation();
  const releaseWarnings = useMovieReleaseWarnings();
  const isTV = mediaType === 'tv';
  const tabs = ['overviewTab', 'detailsTab', 'videosTab', 'imagesTab', 'castTab', 'crewTab', 'commentsTab'];
  const actions = ['details.bandeAnnonce', isTV ? 'details.watchlistBtn' : 'details.toWatchBtn', 'details.favoritesBtn', 'details.watchedBtn', 'lists.addToList', 'common.share'];

  const textPlaceholder = (label: string) => (
    <span className="relative inline-block">
      <span className="invisible">{t(label)}</span>
      <span className="absolute inset-x-0 inset-y-1"><Skeleton height="100%" /></span>
    </span>
  );

  const infoField = (label: string, width = 100) => (
    <div>
      <h3 className="text-lg font-semibold mb-2">{textPlaceholder(label)}</h3>
      <Skeleton width={width} height={24} />
    </div>
  );

  const genres = (
    <div>
      <h3 className="text-lg font-semibold mb-2">{textPlaceholder('details.genresLabel')}</h3>
      <div className="flex flex-wrap gap-2">
        {[88, 106, 78].map(width => <Skeleton key={width} width={width} height={38} className="!rounded-lg" />)}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white px-4 md:px-8 lg:px-16 py-6 animate-skeleton-fade" aria-hidden="true">
      <div className="mb-8">
        {/* Même line-height et même baseline que h1.section-title, y compris
            sa pastille inline : une rangée flex changeait la hauteur. */}
        <h1 className="inline-block text-4xl md:text-5xl font-bold pb-2" style={{ fontSize: '1.5rem' }}>
          <span className="relative inline-block w-40 sm:w-80">
            <span className="invisible">M</span>
            <span className="absolute inset-x-0 inset-y-1"><Skeleton height="100%" /></span>
          </span>
          {!isTV && !releaseWarnings && (
            <span className="relative inline-block ml-2 align-middle text-sm font-medium px-2 py-1 rounded-md">
              <span className="invisible">{t('details.releasedBadge')}</span>
              <span className="absolute inset-0"><Skeleton height="100%" /></span>
            </span>
          )}
        </h1>
        {(isTV || releaseWarnings) && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Skeleton width={180} height={28} />
            {!isTV && <Skeleton width={160} height={28} />}
          </div>
        )}
        {!isTV && releaseWarnings && <p className="mt-2 text-xs text-gray-400">{textPlaceholder('details.movieRelease.availabilityNote')}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <Skeleton variant="poster" />
          <div className="mt-6 flex flex-col gap-4">
            <div className="flex flex-wrap gap-3 w-full min-w-0">
              {[0, 1].map(index => (
                <div key={index} className="flex-1 min-w-0">
                  <Skeleton className="h-[76px] sm:h-[92px] !rounded-lg" />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {actions.map(action => (
                <div key={action} className="relative flex items-center gap-2 px-4 py-2 rounded-lg">
                  <span className="invisible w-4 h-4" />
                  <span className="invisible">{t(action)}</span>
                  <div className="absolute inset-0"><Skeleton height="100%" className="!rounded-lg" /></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="md:col-span-2 min-w-0">
          <div className="flex overflow-hidden border-b border-gray-700 mb-6">
            {tabs.map(tab => (
              <div key={tab} className="px-6 py-3 font-medium text-sm flex-shrink-0 relative">
                <span className="invisible">{t(`details.${tab}`)}</span>
                <div className="absolute inset-x-6 inset-y-3"><Skeleton height="100%" /></div>
              </div>
            ))}
          </div>

          <div className="mb-6">
            <div className="flex gap-3 mb-4">
              <Skeleton width={80} height={40} className="!rounded-lg" />
              <Skeleton width={80} height={40} className="!rounded-lg" />
            </div>
            <div className="relative mb-6 p-4 border border-transparent rounded-lg">
              <p className="invisible pl-8 text-sm">
                {t('details.tmdbInfoNote')} TMDB. {t('details.tmdbInfoDiffNote')}
              </p>
              <div className="absolute inset-0"><Skeleton height="100%" className="!rounded-lg" /></div>
            </div>
            <h2 className="text-xl font-bold mb-2">{textPlaceholder('details.synopsisTitle')}</h2>
            {[100, 100, 70].map((width, index) => (
              <div key={index} className="h-6 flex items-center">
                <Skeleton variant="text" height={16} width={`${width}%`} containerClassName="w-full" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {isTV ? <>
              {infoField('details.seasonsLabel', 32)}
              {infoField('details.episodesLabel', 48)}
            </> : infoField('details.durationLabel', 88)}
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {infoField('details.ratingLabel', 96)}
              {infoField('details.movixRatingLabel', 96)}
            </div>
            {isTV && genres}
            {infoField('details.classificationLabel', 80)}
            {!isTV && infoField('details.directorLabel', 160)}
          </div>
          {!isTV ? <div className="mb-6">{genres}</div> : (
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-4">{textPlaceholder('details.seasonsLabel')}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-8">
                {[0, 1, 2].map(index => (
                  <div key={index} className="rounded-lg overflow-hidden border-2 border-gray-800">
                    <div className="relative pb-[150%] bg-gray-900">
                      <div className="absolute inset-0"><Skeleton height="100%" className="!rounded-none" /></div>
                      <div className="absolute bottom-0 inset-x-0 p-3">
                        <Skeleton height={24} width="75%" baseColor="#2a2a2a" />
                        <div className="mt-1"><Skeleton height={16} width="60%" baseColor="#2a2a2a" /></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DetailsSkeleton;
