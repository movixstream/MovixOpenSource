import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Bookmark, Check, Download, Film, Heart, Info, ListPlus, Play, Share, Star, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MotionConfig } from 'framer-motion';
import AddToListMenu from '../components/AddToListMenu';
import DetailsSkeleton from '../components/skeletons/DetailsSkeleton';
import ShareButtons from '../components/ShareButtons';
import { useAdFreePopup } from '../context/AdFreePopupContext';
import EmblaCarousel from '../components/EmblaCarousel';
import { encodeId, getTmdbId } from '../utils/idEncoder';
import { buildWatchMoviePath, getMovieVersions, getVersionForRetiredId } from '../config/movieVersions';
import { DetailsComments, DetailsCommentsPlaceholder } from '@/components/details/comments';
import LikeDislikeButton, { calculateLikeDislikeRating, type LikeDislikeStats } from '../components/LikeDislikeButton';
import MovixRatingInfoModal from '../components/MovixRatingInfoModal';
import { useWrappedTracker } from '../hooks/useWrappedTracker';
import { buildSiteUrl } from '../config/runtime';
import LazySection from '../components/LazySection';
import SEO from '../components/SEO';
import i18n from '../i18n';
import { useProfile } from '../context/ProfileContext';
import { getClassificationLabel, isContentAllowed } from '../utils/certificationUtils';
import CharactersSection from '../components/CharactersSection';
import DetailExtraMetadata from '../components/DetailExtraMetadata';
import { DetailsCollapse, DetailsSwap } from '../components/details/motion';
import { formatMovieReleaseDate, getMovieReleaseLabel, isMovieReleaseDatePending, needsMovieReleaseWarning } from '@/utils/movieRelease';
import { genreSearchHref } from '@/utils/genreSearchLink';
import { useMovieReleaseWarnings } from '@/hooks/useMovieReleaseWarnings';
import { useNearViewport } from '@/hooks/useNearViewport';
import { useTmdbImages } from '../hooks/useTmdbImages';
import { readLocalStorage } from '../utils/browserStorage';
import { EstimateInfoDialog } from '../components/profile/EstimateInfo';
import {
  DETAILS_FOCUS, DETAILS_GRID, DETAILS_PRESS,
  DetailsActionButton, DetailsActionNote, DetailsActionRow, DetailsAgeBlocked, DetailsBarIconButton, DetailsButton, DetailsConfirmDialog,
  DetailsFacts, DetailsHero, DetailsImagesGallery, DetailsInlineLinks, DetailsKeyFigures, DetailsMediaPreview,
  DetailsMetaLine, DetailsMovixRatingValue, DETAILS_CAROUSEL_ALIGN, DetailsCarouselTitle,
  DetailsPeopleList, DetailsPeopleRow, DetailsPill, DetailsSection, DetailsSectionHeader, DetailsSectionNav,
  DetailsStickyBar, DetailsSynopsis, DetailsSynopsisBlock, DetailsTitle, DetailsTmdbNote, DetailsVideoGallery, sortDetailsVideos,
  DetailsVideoModal,
  detailsClassificationPill, detailsHeroImages, detailsImageStats, formatDetailsClock, formatDetailsCompactMoney,
  formatDetailsCount, formatDetailsLongDate, formatDetailsRating, pickDetailsCertification, toDetailsPeople,
  useDetailsImageSizing, useDetailsModal, useExpandableSections,
  type DetailsSectionLink, type DetailsVideo,
} from '@/components/details';
import {
  MovieFullDetails, MovieSagaBanner,
  useMovieCollection, useMovieDetails, useMovieImages, useMovieVideos, useMovieWatchState, useReleaseNow,
} from '@/components/details/movie';

// Constante pour activer/désactiver la vérification VIP pour le bouton download
const ENABLE_VIP_DOWNLOAD_CHECK = false;

/** Métiers retenus pour la ligne « Scénario » de la fiche. */
const WRITING_JOBS = ['Screenplay', 'Writer', 'Story', 'Novel'];

/** Ancres des sections : cibles de la barre de sections. */
const SECTION = {
  overview: 'apropos',
  cast: 'distribution',
  media: 'videos',
  images: 'videos-images',
  details: 'details',
  comments: 'commentaires',
} as const;

const PREVIEW_CAST_COUNT = 8;
const PREVIEW_VIDEO_COUNT = 3;

const MovieDetails = (): JSX.Element => {
  const { t } = useTranslation();
  const sizing = useDetailsImageSizing();
  const { id: encodedId } = useParams<{ id: string }>();
  const id = encodedId ? getTmdbId(encodedId) : null;
  const navigate = useNavigate();
  const { resetVipStatus } = useAdFreePopup();
  const { currentProfile } = useProfile();

  // Track page visit for Movix Wrapped
  useWrappedTracker({
    mode: 'page',
    pageData: id ? { pageName: 'movie-details', contentId: id } : undefined,
  });

  // Réinitialiser le statut VIP quand l'ID du film change
  useEffect(() => {
    resetVipStatus();
  }, [id, resetVipStatus]);

  const {
    movie, loading, error, cast, crew, alternateTitles, keywords, movieReleases, certifications,
    bestBackdrop, recommendations, characters, charactersLoading, hasCharactersTab,
  } = useMovieDetails(id);
  const { watchStatus, toggleWatchStatus, localResume, serverResume, watchedView, seedServerResume } = useMovieWatchState(id, movie);
  const videoState = useMovieVideos(id);
  const { videos, loadingVideos, trailerVideoId } = videoState;
  const { images, loadingImages, loadImages } = useMovieImages(id);
  const releaseNow = useReleaseNow();
  const movieReleaseWarningsEnabled = useMovieReleaseWarnings();
  const { expanded, setSectionExpanded } = useExpandableSections();
  // Logo TMDB du titre, par le même cache que le HeroSlider.
  const { logoUrl } = useTmdbImages('movie', id ? Number(id) : undefined);

  const [movixVoteStats, setMovixVoteStats] = useState<LikeDislikeStats>({ likes: 0, dislikes: 0 });
  const [showMovixRatingInfo, setShowMovixRatingInfo] = useState(false);
  const [financialStatsMode, setFinancialStatsMode] = useState<'simple' | 'advanced'>('simple');
  const [estimateInfoOpen, setEstimateInfoOpen] = useState(false);
  const [showAddToList, setShowAddToList] = useState(false);
  // Fenêtre « date de sortie indicative » ; garde la version demandée au clic.
  const [releaseWarning, setReleaseWarning] = useState<{ open: boolean; versionKey?: string }>({ open: false });
  const trailerModal = useDetailsModal();
  const videoModal = useDetailsModal<DetailsVideo>();

  // Bouton principal du haut : quand il sort de l'écran, la barre du téléphone prend le relais.
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  // Saga et images ne se chargent qu'à l'approche de leur section (ou au dépliage).
  const pageReady = !loading && !error && movie !== null;
  const { ref: sagaSectionRef, isNearViewport: sagaNearViewport } = useNearViewport<HTMLDivElement>(false, pageReady);
  const { ref: mediaSectionRef, isNearViewport: mediaNearViewport } = useNearViewport<HTMLDivElement>(false, pageReady);
  const collectionId = movie?.belongs_to_collection?.id ?? null;
  const saga = useMovieCollection(collectionId, sagaNearViewport);

  useEffect(() => {
    if (mediaNearViewport) loadImages();
  }, [mediaNearViewport, loadImages]);

  // Remplacent les anciens onglets Vidéos et Images : déplient la section et y défilent.
  const openVideos = (anchor: string = SECTION.media) => setSectionExpanded('media', true, anchor);
  const openImages = () => {
    openVideos(SECTION.images);
    loadImages();
  };

  // Lance la lecture, sans avertissement. `versionKey` : version alternative
  // (ex. Encore), voir config/movieVersions.
  const proceedToWatch = (versionKey?: string) => {
    if (!id) return;
    seedServerResume();
    navigate(buildWatchMoviePath(encodeId(id), versionKey));
  };

  const startWatching = (versionKey?: string) => {
    if (!id) return;
    // Film pas encore sorti hors cinéma : la fenêtre demande confirmation.
    if (movieReleaseWarningsEnabled && needsMovieReleaseWarning(movieReleases, Date.now())) {
      setReleaseWarning({ open: true, versionKey });
      return;
    }
    proceedToWatch(versionKey);
  };

  const handleWatchClick = () => startWatching();
  const playVideo = (video: DetailsVideo) => videoModal.open(video);

  // La route n'a plus de marge haute (l'image passe sous l'en-tête) : les
  // écrans sans image la remettent eux-mêmes (`pt-20`).
  if (loading) {
    return <DetailsSkeleton />;
  }
  if (error) return <div className="min-h-screen bg-black px-4 pt-32 text-center text-red-500">{error}</div>;
  if (!movie) return <div className="min-h-screen bg-black px-4 pt-32 text-center text-white">{t('details.movieNotFound')}</div>;

  // Restriction d'âge du profil
  const contentCert = pickDetailsCertification(certifications);
  const profileAgeRestriction = currentProfile?.ageRestriction ?? 0;
  if (contentCert && profileAgeRestriction > 0 && !isContentAllowed(contentCert, profileAgeRestriction)) {
    return <DetailsAgeBlocked certification={contentCert} ageRestriction={profileAgeRestriction} />;
  }

  const language = i18n.language;
  const movieId = id ?? '';
  const directors = crew.filter(member => member.jobs.includes('Director'));
  const director = directors[0];
  const writers = crew.filter(member => member.jobs.some(job => WRITING_JOBS.includes(job))).slice(0, 4);
  const personLinks = (people: typeof crew) => people.map((person) => ({ id: person.id, name: person.name, to: `/person/${person.id}` }));
  const movieYear = movie.release_date && !isNaN(new Date(movie.release_date).getTime())
    ? Number(movie.release_date.slice(0, 4))
    : null;
  const movieIsReleased = movieReleases.referenceDate !== null
    && !isMovieReleaseDatePending(movieReleases.referenceDate, releaseNow);
  const movieTitle = movieYear ? `${movie.title} (${movieYear}) - Movix` : `${movie.title} - Movix`;
  const movieCanonicalUrl = buildSiteUrl(`/movie/${encodedId || id}`);
  const movieSocialImage = movie.backdrop_path || movie.poster_path
    ? `https://image.tmdb.org/t/p/original${movie.backdrop_path || movie.poster_path}`
    : undefined;
  const movieDescription = movie.overview?.trim() || `Découvrez ${movie.title} sur Movix.`;

  const hero = detailsHeroImages(sizing, {
    backdrop: movie.backdrop_path, bestBackdrop: bestBackdrop?.file_path, poster: movie.poster_path, logo: logoUrl,
  });

  // Pastilles et faits
  const tmdbRating = movie.vote_average > 0 ? formatDetailsRating(movie.vote_average, language) : null;
  const movixRating = calculateLikeDislikeRating(movixVoteStats);
  const movixRatingLabel = movixRating != null ? formatDetailsRating(movixRating, language) : null;
  const classificationPill = detailsClassificationPill(contentCert, t);
  const runtimeLabel = movie.runtime > 0
    ? (movie.runtime >= 60
      ? t('details.runtimeHours', {
        hours: Math.floor(movie.runtime / 60),
        paddedMinutes: String(movie.runtime % 60).padStart(2, '0'),
      })
      : t('details.runtimeMinutes', { minutes: movie.runtime }))
    : null;
  const releaseDateLong = formatDetailsLongDate(movieReleases.referenceDate, language);
  const statusLabel = !movie.status ? null
    : movie.status === 'Released' ? t('details.statusReleased')
      : movie.status === 'Post Production' ? t('details.statusPostProd')
        : movie.status === 'In Production' ? t('details.statusInProd')
          : movie.status === 'Planned' ? t('details.statusPlanned')
            : movie.status;

  // Bouton principal : « Regarder » ou « Continuer », avec le temps de reprise.
  const primaryAction = localResume
    ? {
      label: t('details.continueBtn'),
      detail: `${formatDetailsClock(localResume.position)}/${formatDetailsClock(localResume.duration)}`,
      progress: localResume.duration > 0 ? localResume.position / localResume.duration : null,
    }
    : serverResume
      ? {
        // Estimé seul : le lecteur repartira du début, donc « Regarder ».
        label: serverResume.estimated ? t('details.watchBtn') : t('details.continueBtn'),
        detail: serverResume.estimated
          ? t('profilePage.progress.estimated', { percent: Math.round((serverResume.position / serverResume.duration) * 100), defaultValue: '≈ {{percent}} % · estimé' })
          : `${formatDetailsClock(serverResume.position)}/${formatDetailsClock(serverResume.duration)}`,
        progress: serverResume.duration > 0 ? serverResume.position / serverResume.duration : null,
      }
      : { label: t('details.watchBtn'), detail: null, progress: null };
  const playIcon = <Play aria-hidden="true" className="fill-current" />;
  const showDownload = !ENABLE_VIP_DOWNLOAD_CHECK || readLocalStorage('is_vip') === 'true';
  const movieVersions = getMovieVersions(id);

  const { castPeople, crewPeople } = toDetailsPeople(cast, crew, sizing.profileUrl, t);

  // Vidéos et images
  const previewVideos = sortDetailsVideos(videos).slice(0, PREVIEW_VIDEO_COUNT);
  const { total: imageTotal, breakdown: imageBreakdown } = detailsImageStats(images, t);
  const mediaSummary = [
    videos.length > 0 && t('details.videosCount', { count: videos.length }),
    imageTotal > 0 && t('details.imagesCount', { count: imageTotal }),
  ].filter(Boolean).join(', ');
  const hasMedia = videos.length > 0 || loadingVideos || imageTotal > 0 || loadingImages || images === null;

  // Détails
  const budget = movie.budget && movie.budget > 0 ? movie.budget : 0;
  const revenue = movie.revenue && movie.revenue > 0 ? movie.revenue : 0;
  const profit = budget > 0 && revenue > 0 ? revenue - budget : null;
  const profitPercent = profit !== null ? Math.round((revenue / budget - 1) * 100) : 0;
  const mainCompany = movie.production_companies?.[0]?.name ?? null;

  // Barre de sections : seules les sections présentes y figurent.
  const hasCastSection = cast.length > 0 || crew.length > 0;
  const sections: DetailsSectionLink[] = [
    { id: SECTION.overview, label: t('details.overviewTab') },
    ...(hasCastSection ? [{ id: SECTION.cast, label: t('details.castTab') }] : []),
    ...(hasMedia ? [{ id: SECTION.media, label: t('details.mediaSection'), shortLabel: t('details.videosTab') }] : []),
    { id: SECTION.details, label: t('details.detailsTab') },
    { id: SECTION.comments, label: t('details.commentsTab') },
  ];

  const releaseBadge = 'h-auto min-h-[26px] whitespace-normal rounded-xl py-1 md:h-auto md:min-h-7';

  return (
    <MotionConfig reducedMotion="user">
      <SEO
        title={movieTitle}
        description={movieDescription}
        ogType="video.movie"
        ogUrl={movieCanonicalUrl}
        ogImage={movieSocialImage}
        canonical={movieCanonicalUrl}
      />

      <div className="relative min-h-screen bg-black pb-24 text-white animate-skeleton-fade motion-reduce:animate-none">
        <DetailsHero
          backdropUrl={hero.backdropUrl}
          pills={(
            <>
              <DetailsPill uppercase>{t('search.movieLabel')}</DetailsPill>
              {movieYear && <DetailsPill>{movieYear}</DetailsPill>}
              {classificationPill && <DetailsPill>{classificationPill}</DetailsPill>}
              {tmdbRating && (
                <DetailsPill tone="rating" icon={<Star aria-hidden="true" className="fill-current" />} title={t('details.ratingLabel')}>
                  {tmdbRating}<span className="hidden md:inline">&nbsp;TMDB</span>
                </DetailsPill>
              )}
              {movixRatingLabel && (
                <DetailsPill icon={<Star aria-hidden="true" className="fill-current text-red-400" />} title={t('details.movixRatingLabel')}>
                  {movixRatingLabel} Movix
                </DetailsPill>
              )}
              {!movieReleaseWarningsEnabled ? (
                <DetailsPill dot={movieIsReleased ? 'on' : 'pending'}>
                  {t(movieIsReleased ? 'details.releasedBadge' : 'details.notReleasedBadge')}
                </DetailsPill>
              ) : (
                <>
                  <DetailsPill
                    data-halloween-frame="orange"
                    tone={movieReleases.homeVideo && isMovieReleaseDatePending(movieReleases.homeVideo.date, releaseNow) ? 'rating' : 'neutral'}
                    className={releaseBadge}
                  >
                    {getMovieReleaseLabel(movieReleases.homeVideo, 'homeVideo', t, language, releaseNow)}
                  </DetailsPill>
                  {movieReleases.theatrical ? (
                    <DetailsPill data-halloween-frame="green" className={releaseBadge}>
                      {getMovieReleaseLabel(movieReleases.theatrical, 'theatrical', t, language, releaseNow)}
                    </DetailsPill>
                  ) : movieReleases.referenceDate && (
                    <DetailsPill data-halloween-frame="green" className={releaseBadge}>
                      {t('details.movieRelease.announcedDate', { date: formatMovieReleaseDate(movieReleases.referenceDate, language) })}
                    </DetailsPill>
                  )}
                  {/* La note CAM ne sert que tant que la sortie hors cinéma est à
                      venir. Le `div` prend toute la ligne : posé sur le `p`,
                      `max-w-[58ch]` l'emportait sur `basis-full` et la note se
                      glissait à côté du dernier badge. */}
                  {needsMovieReleaseWarning(movieReleases, releaseNow) && (
                    <div className="basis-full">
                      <p className="max-w-[58ch] text-xs text-white/60">{t('details.movieRelease.availabilityNote')}</p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          title={<DetailsTitle title={movie.title} logoUrl={hero.logoUrl} />}
          meta={(
            <DetailsMetaLine
              items={[
                runtimeLabel && { key: 'runtime', content: runtimeLabel },
                movie.genres.length > 0 && {
                  key: 'genres',
                  content: <DetailsInlineLinks links={movie.genres.slice(0, 3).map((genre) => ({ id: genre.id, name: genre.name, to: genreSearchHref('movie', genre.id) }))} />,
                },
                director && { key: 'director', content: <DetailsInlineLinks links={personLinks([director])} />, desktopOnly: true },
              ]}
            />
          )}
          synopsis={movie.overview ? (
            <DetailsSynopsis
              text={movie.overview}
              tagline={movie.tagline}
              moreLabel={t('details.readMore')}
              lessLabel={t('details.collapse')}
            />
          ) : null}
          actions={(
            <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:gap-3">
              <DetailsButton
                ref={primaryButtonRef}
                variant="primary"
                size="hero"
                icon={playIcon}
                detail={primaryAction.detail}
                progress={primaryAction.progress}
                onClick={handleWatchClick}
                className="w-full md:w-auto"
              >
                {primaryAction.label}
              </DetailsButton>
              <div className={`grid gap-2.5 md:contents ${showDownload ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <DetailsButton icon={<Video aria-hidden="true" />} onClick={() => trailerModal.open()} disabled={!trailerVideoId}>
                  {t('details.bandeAnnonce')}
                </DetailsButton>
                {showDownload && (
                  <DetailsButton icon={<Download aria-hidden="true" />} onClick={() => navigate(`/download/movie/${id}`)}>
                    {t('details.downloadBtn')}
                  </DetailsButton>
                )}
              </div>
              {/* Versions alternatives (ex. Encore) : TMDB n'a qu'une fiche par film */}
              {movieVersions.map((version) => (
                <DetailsButton
                  key={version.key}
                  icon={<Film aria-hidden="true" />}
                  onClick={() => startWatching(version.key)}
                  className="w-full whitespace-normal text-left leading-tight md:w-auto"
                >
                  <span>
                    {t('movieVersions.watchVersion', { version: t(version.labelKey) })}
                    {version.runtime ? ` · ${t('movieVersions.runtime', { minutes: version.runtime })}` : ''}
                  </span>
                </DetailsButton>
              ))}
            </div>
          )}
          secondaryActions={(
            <DetailsActionRow>
              <DetailsActionButton
                icon={Bookmark}
                label={t('details.toWatchBtn')}
                active={watchStatus.watchlist}
                fillWhenActive
                aria-pressed={watchStatus.watchlist}
                onClick={() => toggleWatchStatus('watchlist')}
              />
              <DetailsActionButton
                icon={Heart}
                label={t('details.favoritesBtn')}
                active={watchStatus.favorite}
                fillWhenActive
                aria-pressed={watchStatus.favorite}
                onClick={() => toggleWatchStatus('favorite')}
              />
              <DetailsActionButton
                icon={Check}
                label={t('details.watchedBtn')}
                active={watchedView.toggleOn}
                aria-pressed={watchedView.toggleOn}
                onClick={() => toggleWatchStatus('watched')}
              />
              {/* « Vu » connu du serveur seulement : indication à côté, le bouton
                  ne pose et ne retire que la marque locale. */}
              {watchedView.serverWatched === 'estimated' && (
                <DetailsActionNote>
                  <button
                    type="button"
                    onClick={() => setEstimateInfoOpen(true)}
                    aria-haspopup="dialog"
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-3 text-sm text-white hover:bg-white/10 ${DETAILS_PRESS} ${DETAILS_FOCUS}`}
                  >
                    <span className="text-white/75 underline decoration-dotted underline-offset-4">{t('details.watchedEstimatedBtn', 'Vu (estimé)')}</span>
                    <Info className="h-4 w-4 text-white opacity-60" aria-hidden="true" />
                  </button>
                </DetailsActionNote>
              )}
              {watchedView.serverWatched === 'otherDevice' && (
                <DetailsActionNote>
                  <span className="inline-flex min-h-11 items-center gap-1.5 px-3 text-sm text-white">
                    <Check className="h-4 w-4 text-white opacity-60" aria-hidden="true" />
                    <span className="text-white/75">{t('details.watchedOtherDevice', 'Vu sur un autre appareil')}</span>
                  </span>
                </DetailsActionNote>
              )}
              <DetailsActionButton
                icon={ListPlus}
                label={t('lists.addToList')}
                shortLabel={t('details.listShort')}
                aria-haspopup="dialog"
                onClick={() => setShowAddToList(true)}
              />
              <ShareButtons
                title={movie.title || ''}
                description={movie.overview || ''}
                imageUrl={movie.poster_path ? `https://image.tmdb.org/t/p/original${movie.poster_path}` : undefined}
                url={buildSiteUrl(`/movie/${encodedId || id}`)}
                renderTrigger={(open) => (
                  <DetailsActionButton icon={Share} label={t('common.share')} aria-haspopup="dialog" onClick={open} />
                )}
              />
            </DetailsActionRow>
          )}
          votes={(
            <LikeDislikeButton
              contentType="movie"
              contentId={movieId}
              onStatsChange={setMovixVoteStats}
            />
          )}
        />

        <DetailsSectionNav
          sections={sections}
          ariaLabel={t('details.sectionsNav')}
          backdropUrl={hero.backdropUrl}
          banner={{
            title: movie.title || '',
            actions: (
              <>
                <DetailsButton variant="primary" size="bar" icon={playIcon} detail={primaryAction.detail} onClick={handleWatchClick}>
                  {primaryAction.label}
                </DetailsButton>
                <LikeDislikeButton contentType="movie" contentId={movieId} compact />
                <DetailsBarIconButton
                  icon={Bookmark}
                  label={t('details.toWatchBtn')}
                  active={watchStatus.watchlist}
                  fillWhenActive
                  aria-pressed={watchStatus.watchlist}
                  onClick={() => toggleWatchStatus('watchlist')}
                />
                <DetailsBarIconButton
                  icon={Heart}
                  label={t('details.favoritesBtn')}
                  active={watchStatus.favorite}
                  fillWhenActive
                  aria-pressed={watchStatus.favorite}
                  onClick={() => toggleWatchStatus('favorite')}
                />
              </>
            ),
          }}
        />

        {/* Positionné : passe au-dessus de la coulure de la grande image, qui
            descend sous la barre de sections. */}
        <div className={`${DETAILS_GRID} relative`}>
          {/* Aperçu */}
          <DetailsSection id={SECTION.overview} className="pt-[22px]">
            <div className="grid gap-9 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start lg:gap-[72px]">
              <DetailsSynopsisBlock
                mediaType="movie"
                id={id}
                tagline={movie.tagline}
                text={movie.overview || t('details.noSynopsis')}
              />
              <div>
                <DetailsFacts
                  items={[
                    directors.length > 0 && { key: 'direction', label: t('details.directionLabel'), value: <DetailsInlineLinks links={personLinks(directors)} /> },
                    writers.length > 0 && { key: 'screenplay', label: t('details.screenplayLabel'), value: <DetailsInlineLinks links={personLinks(writers)} /> },
                    movie.genres.length > 0 && {
                      key: 'genres',
                      label: t('details.genresLabel'),
                      className: 'md:hidden',
                      value: <DetailsInlineLinks links={movie.genres.map((genre) => ({ id: genre.id, name: genre.name, to: genreSearchHref('movie', genre.id) }))} />,
                    },
                    runtimeLabel && {
                      key: 'runtime',
                      label: t('details.durationLabel'),
                      className: 'hidden md:flex',
                      value: movie.runtime >= 60 ? `${runtimeLabel} (${movie.runtime} ${t('details.minutesLabel')})` : runtimeLabel,
                    },
                    {
                      key: 'release',
                      label: t('details.releaseShort'),
                      value: releaseDateLong ?? t('details.dateNotAvailable'),
                    },
                    {
                      key: 'classification',
                      label: t('details.classificationLabel'),
                      value: contentCert ? getClassificationLabel(contentCert, t) : t('details.notClassified'),
                    },
                    tmdbRating && {
                      key: 'tmdb',
                      label: t('details.ratingLabel'),
                      value: [
                        `${tmdbRating} / 10`,
                        movie.vote_count ? t('details.votesCount', { count: movie.vote_count, formatted: formatDetailsCount(movie.vote_count, language) }) : null,
                      ].filter(Boolean).join(' · '),
                    },
                    movixRatingLabel && {
                      key: 'movix',
                      label: t('details.movixRatingLabel'),
                      value: <DetailsMovixRatingValue rating={movixRatingLabel} onInfo={() => setShowMovixRatingInfo(true)} />,
                    },
                  ]}
                />
                <DetailsTmdbNote mediaType="movie" id={id} className="mt-3 md:hidden" />
              </div>
            </div>
          </DetailsSection>

          {/* Saga : seulement si le film appartient à une collection */}
          {movie.belongs_to_collection && (
            <DetailsSection>
              <div ref={sagaSectionRef}>
                <MovieSagaBanner
                  collectionId={movie.belongs_to_collection.id}
                  name={movie.belongs_to_collection.name}
                  parts={saga.parts}
                  loading={saga.loading}
                  currentId={Number(id)}
                />
              </div>
            </DetailsSection>
          )}

          {/* Distribution : 8 premiers, puis tout le générique, l'équipe et les personnages */}
          {hasCastSection && (
            <DetailsSection id={SECTION.cast}>
              <DetailsSectionHeader
                title={t('details.castTab')}
                expanded={expanded.cast}
                onToggle={cast.length > PREVIEW_CAST_COUNT || crew.length > 0 || hasCharactersTab
                  ? () => setSectionExpanded('cast', !expanded.cast, SECTION.cast)
                  : undefined}
                moreLabel={t('details.castMore')}
                controls="distribution-contenu"
              />
              <div id="distribution-contenu">
                {/* Une seule grille : les portraits de l'aperçu restent en place (pas
                    de rechargement), seules les personnes ajoutées apparaissent. */}
                <DetailsPeopleRow
                  layout={expanded.cast ? 'grid' : 'row'}
                  people={expanded.cast ? castPeople : castPeople.slice(0, PREVIEW_CAST_COUNT)}
                  revealFrom={expanded.cast ? PREVIEW_CAST_COUNT : undefined}
                />
                {(crewPeople.length > 0 || hasCharactersTab) && (
                  <DetailsCollapse open={expanded.cast}>
                    <div className="space-y-10 pt-10">
                      {crewPeople.length > 0 && (
                        <div>
                          <h3 className="mb-4 text-lg font-semibold text-white">{t('details.crewTab')}</h3>
                          <DetailsPeopleList people={crewPeople} />
                        </div>
                      )}
                      {/* Réservé à ce qu'AniList apporte : sur du live-action,
                          l'équipe et la distribution disent déjà tout. */}
                      {hasCharactersTab && <CharactersSection data={characters} loading={charactersLoading} />}
                    </div>
                  </DetailsCollapse>
                )}
              </div>
            </DetailsSection>
          )}

          {/* Vidéos et images : 3 vidéos et la tuile images, puis tout */}
          {hasMedia && (
            <DetailsSection id={SECTION.media}>
              <div ref={mediaSectionRef}>
                <DetailsSectionHeader
                  title={t('details.mediaSection')}
                  expanded={expanded.media}
                  onToggle={() => (expanded.media ? setSectionExpanded('media', false, SECTION.media) : openVideos())}
                  moreLabel={mediaSummary || undefined}
                  controls="videos-contenu"
                />
                <DetailsSwap swapKey={expanded.media ? 'all' : 'preview'}>
                <div id="videos-contenu">
                  {expanded.media ? (
                    <div className="space-y-10">
                      <div data-reveal>
                        <DetailsVideoGallery
                          title={t('details.videosAndTrailers')}
                          videos={videos}
                          multiLangVideos={videoState.multiLangVideos}
                          loading={loadingVideos || videoState.loadingMultiLangVideos}
                          showMultiLang={videoState.showMultiLang}
                          onToggleMultiLang={videoState.toggleMultiLang}
                          onPlay={playVideo}
                          emptyLabel={t('details.noVideoAvailableForMovie')}
                          emptyMultiLangLabel={t('details.noMultiLangVideoForMovie')}
                        />
                      </div>
                      <div data-reveal id={SECTION.images} className="scroll-mt-[136px] md:scroll-mt-36">
                        <DetailsImagesGallery
                          mediaType="movie"
                          mediaId={movieId}
                          images={images}
                          loading={loadingImages}
                          title={t('details.imagesTab')}
                        />
                      </div>
                    </div>
                  ) : (
                    <DetailsMediaPreview
                      videos={previewVideos}
                      loadingVideos={loadingVideos}
                      imagesTileUrl={sizing.cardBackdropUrl(images?.backdrops?.[0]?.file_path || hero.heroBackdropPath, 320)}
                      imageTotal={imageTotal}
                      imageBreakdown={imageBreakdown}
                      emptyLabel={t('details.noVideoAvailableForMovie')}
                      onPlay={playVideo}
                      onOpenImages={openImages}
                    />
                  )}
                </div>
                </DetailsSwap>
              </div>
            </DetailsSection>
          )}

          {/* Détails : ligne de chiffres, puis tout l'ancien onglet Détails */}
          <DetailsSection id={SECTION.details}>
            <DetailsSectionHeader
              title={t('details.detailsTab')}
              expanded={expanded.details}
              onToggle={() => setSectionExpanded('details', !expanded.details, SECTION.details)}
              moreLabel={t('details.detailsMore')}
              moreLabelShort={t('details.detailsMoreShort')}
              controls="details-contenu"
            />
            <DetailsKeyFigures
              items={[
                { key: 'budget', label: t('details.budgetLabel'), value: budget > 0 ? formatDetailsCompactMoney(budget, language) : t('details.notDisclosed'), longText: budget <= 0 },
                { key: 'revenue', label: t('details.revenue'), value: revenue > 0 ? formatDetailsCompactMoney(revenue, language) : t('details.notDisclosed'), longText: revenue <= 0 },
                profit !== null && {
                  key: 'profit',
                  label: t(profit >= 0 ? 'details.profit' : 'details.loss'),
                  value: formatDetailsCompactMoney(profit, language, true),
                  hint: t('details.ofBudget', { percent: `${profitPercent > 0 ? '+' : ''}${profitPercent}` }),
                },
                statusLabel && { key: 'status', label: t('details.statusLabel'), value: statusLabel, className: mainCompany && profit !== null ? 'hidden md:block' : undefined },
                mainCompany && { key: 'production', label: t('details.production'), value: mainCompany, longText: true },
              ]}
            />
            <div id="details-contenu">
              <DetailsCollapse open={expanded.details}>
                <div className="pt-8">
                  <MovieFullDetails
                    movie={movie}
                    releaseDateLabel={t(movieReleaseWarningsEnabled ? 'details.movieRelease.referenceDate' : 'details.releaseDateLabel')}
                    releaseDate={formatMovieReleaseDate(movieReleases.referenceDate, language) ?? t('details.dateNotAvailable')}
                    statusLabel={statusLabel}
                    financialStatsMode={financialStatsMode}
                    onFinancialStatsModeChange={setFinancialStatsMode}
                  />
                  {/* En fin de section Détails : thèmes, titres alternatifs et
                      mots-clés relèvent de la fiche technique, pas de la
                      galerie de personnages. */}
                  <DetailExtraMetadata
                    variant="details"
                    themes={characters?.themes ?? []}
                    alternateTitles={alternateTitles}
                    keywords={keywords}
                  />
                </div>
              </DetailsCollapse>
            </div>
          </DetailsSection>

          {/* Films similaires : la rangée du site (EmblaCarousel applique son
              propre -mx-3 md:-mx-4 interne). */}
          {recommendations.length > 0 && (
            <DetailsSection className={DETAILS_CAROUSEL_ALIGN}>
              <LazySection
                index={0}
                immediateLoadCount={0}
                rootMargin="300px"
                minHeight="320px"
              >
                <EmblaCarousel
                  title={<DetailsCarouselTitle>{t('details.similarMovies')}</DetailsCarouselTitle>}
                  items={recommendations.map(similar => ({
                    id: similar.id,
                    title: similar.title,
                    poster_path: similar.poster_path,
                    backdrop_path: similar.backdrop_path,
                    overview: similar.overview,
                    vote_average: similar.vote_average,
                    release_date: similar.release_date,
                    media_type: 'movie',
                  }))}
                  mediaType="movie-similar"
                />
              </LazySection>
            </DetailsSection>
          )}

          {/* Commentaires : chargés à l'approche. L'ancre est sur la section
              (toujours rendue) pour que la barre puisse y défiler avant. Le
              bloc dessine son en-tête (titre, nombre, suivi) : d'ici là, son
              gabarit tient la même place, champ et liste compris. */}
          <DetailsSection id={SECTION.comments}>
            <LazySection
              index={1}
              immediateLoadCount={0}
              rootMargin="200px"
              minHeight="400px"
              placeholder={<DetailsCommentsPlaceholder title={t('details.commentsTab')} />}
            >
              <DetailsComments contentType="movie" contentId={movieId} title={t('details.commentsTab')} />
            </LazySection>
          </DetailsSection>
        </div>

        {/* Téléphone : le bouton principal reste sous le pouce une fois celui du haut sorti de l'écran. */}
        <DetailsStickyBar watch={primaryButtonRef}>
          <DetailsButton
            variant="primary"
            size="compact"
            icon={playIcon}
            detail={primaryAction.detail}
            onClick={handleWatchClick}
            className="min-w-0 flex-1"
          >
            {primaryAction.label}
          </DetailsButton>
          <DetailsButton
            size="compact"
            aria-label={t('details.toWatchBtn')}
            aria-pressed={watchStatus.watchlist}
            onClick={() => toggleWatchStatus('watchlist')}
            className="w-12 flex-none px-0"
          >
            <Bookmark aria-hidden="true" className={watchStatus.watchlist ? 'fill-current text-red-500' : undefined} />
          </DetailsButton>
        </DetailsStickyBar>

        {showAddToList && (
          <AddToListMenu
            mediaId={Number(id)}
            mediaType="movie"
            title={movie.title || ''}
            posterPath={movie.poster_path || ''}
            onClose={() => setShowAddToList(false)}
          />
        )}

        <EstimateInfoDialog open={estimateInfoOpen} onOpenChange={setEstimateInfoOpen} />

        {/* Film pas encore sorti hors cinéma : confirmation avant de lancer le lecteur. */}
        <DetailsConfirmDialog
          open={releaseWarning.open}
          onOpenChange={(open) => setReleaseWarning((previous) => ({ ...previous, open }))}
          title={t('details.movieRelease.warningTitle')}
          highlight={getMovieReleaseLabel(movieReleases.homeVideo, 'homeVideo', t, language, releaseNow)}
          description={t('details.movieRelease.warningDescription')}
          cancelLabel={t('details.cancel')}
          confirmLabel={t('details.continueAnyway')}
          onConfirm={() => proceedToWatch(releaseWarning.versionKey)}
        />

        {/* Fenêtre des vidéos */}
        <DetailsVideoModal
          open={videoModal.isOpen && videoModal.payload !== null}
          closing={videoModal.isClosing}
          title={videoModal.payload?.name ?? ''}
          videoKey={videoModal.payload?.key}
          onClose={videoModal.close}
        />

        {/* Fenêtre de la bande-annonce */}
        <DetailsVideoModal
          open={trailerModal.isOpen}
          closing={trailerModal.isClosing}
          title={`${t('details.bandeAnnonce')} - ${movie.title}`}
          videoKey={trailerVideoId}
          emptyLabel={t('details.noTrailerAvailable')}
          onClose={trailerModal.close}
        />

        <MovixRatingInfoModal
          isOpen={showMovixRatingInfo}
          onClose={() => setShowMovixRatingInfo(false)}
        />
      </div>
    </MotionConfig>
  );
};

// Ancien ID TMDB supprimé (ex. Avengers Endgame: Encore) → fiche du film parent.
const MovieDetailsRoute = (): JSX.Element => {
  const { id: encodedId } = useParams<{ id: string }>();
  const retired = getVersionForRetiredId(encodedId ? getTmdbId(encodedId) : null);
  if (retired) return <Navigate replace to={`/movie/${encodeId(retired.tmdbId)}`} />;
  return <MovieDetails />;
};

export default MovieDetailsRoute;
