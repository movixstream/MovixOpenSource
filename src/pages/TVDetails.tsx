import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Bookmark, Check, Download, EyeOff, Heart, ListPlus, Loader, Play, Share, Star, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MotionConfig } from 'framer-motion';
import AddToListMenu from '../components/AddToListMenu';
import DetailsSkeleton from '../components/skeletons/DetailsSkeleton';
import { DetailsSelect } from '@/components/details/DetailsSelect';
import ShareButtons from '../components/ShareButtons';
import { useAdFreePopup } from '../context/AdFreePopupContext';
import CharactersSection from '../components/CharactersSection';
import DetailExtraMetadata from '../components/DetailExtraMetadata';
import { DetailsCollapse, DetailsSwap } from '../components/details/motion';
import EmblaCarousel from '../components/EmblaCarousel';
import { encodeId, getTmdbId } from '../utils/idEncoder';
import AntiSpoilerSettingsModal from '../components/AntiSpoilerSettings';
import { useAntiSpoilerSettings } from '../hooks/useAntiSpoilerSettings';
import { buildSiteUrl } from '../config/runtime';
import { DetailsComments, DetailsCommentsPlaceholder } from '@/components/details/comments';
import LikeDislikeButton, { calculateLikeDislikeRating, type LikeDislikeStats } from '../components/LikeDislikeButton';
import MovixRatingInfoModal from '../components/MovixRatingInfoModal';
import { useWrappedTracker } from '../hooks/useWrappedTracker';
import LazySection from '../components/LazySection';
import SEO from '../components/SEO';
import i18n from '../i18n';
import { useProfile } from '../context/ProfileContext';
import { getClassificationLabel, isContentAllowed } from '../utils/certificationUtils';
import { useTvAiringSchedule } from '@/hooks/useTvAiringSchedule';
import { formatAiringDate, getAiringLabel, getEpisodeTimeline, resolveEpisodeAiring, resolveShowAiring } from '@/utils/tvAiring';
import { genreSearchHref } from '@/utils/genreSearchLink';
import type { TvEpisodeDate } from '@/types/tvAiring';
import { useImageSlot } from '../hooks/useImageSlot';
import { useTmdbImages } from '../hooks/useTmdbImages';
import { readLocalStorage, writeLocalStorage } from '../utils/browserStorage';
import { seedProgress } from '../utils/titleHistoryMerge';
import {
  DETAILS_FOCUS, DETAILS_GRID,
  DetailsActionButton, DetailsActionRow, DetailsAgeBlocked, DetailsBarIconButton, DetailsButton, DetailsConfirmDialog,
  DetailsFacts, DetailsHero, DetailsImagesGallery, DetailsInlineLinks, DetailsKeyFigures, DetailsMediaPreview,
  DetailsMetaLine, DetailsMovixRatingValue, DETAILS_CAROUSEL_ALIGN, DetailsCarouselTitle,
  DetailsPeopleList, DetailsPeopleRow, DetailsPill, DetailsSection, DetailsSectionHeader, DetailsSectionNav,
  DetailsStickyBar, DetailsSynopsis, DetailsSynopsisBlock, DetailsTitle, DetailsTmdbNote, DetailsVideoGallery, sortDetailsVideos,
  DetailsVideoModal,
  detailsClassificationPill, detailsHeroImages, detailsImageStats, formatDetailsClock, formatDetailsCount,
  formatDetailsLongDate, formatDetailsRating, pickDetailsCertification, scrollToDetailsSection, toDetailsPeople,
  useDetailsImageSizing, useDetailsModal, useExpandableSections,
  type DetailsSectionLink, type DetailsVideo, type DetailsVideoGroup,
} from '@/components/details';
import {
  TvEpisodeList, TvEpisodeViewSwitch, TvEpisodesToolbar, TvFullDetails, TvSeasonPills,
  animeLanguageLabel, animeSeasonNumber, toAnimeEpisodeItem, toTvEpisodeItem, tvEpisodeCardWidth,
  tvEpisodeRowThumbWidth, tvEpisodeWatchState, tvRuntimeText,
  useTvAnime, useTvEpisodeLists, useTvImagesAndTrailer, useTvMultiLangVideos, useTvResume, useTvShowDetails,
  useTvWatchStatus,
  type TvEpisode, type TvEpisodeItem, type TvEpisodeView, type TvSeasonOption,
} from '@/components/details/tv';

// Constante pour activer/désactiver la vérification VIP pour le bouton download
const ENABLE_VIP_DOWNLOAD_CHECK = false;

const getSeasonDisplayName = (seasonNumber: number, t: TFunction, originalName?: string) =>
  originalName || `${t('details.season')} ${seasonNumber}`;

/** Ancres des sections : cibles de la barre de sections. */
const SECTION = {
  episodes: 'episodes',
  overview: 'apropos',
  cast: 'distribution',
  media: 'videos',
  images: 'videos-images',
  details: 'details',
  comments: 'commentaires',
} as const;

const PREVIEW_CAST_COUNT = 8;
const PREVIEW_VIDEO_COUNT = 3;
/** Épisodes rendus d'un coup en grille ou en liste ; la suite vient par tranches. */
const EPISODE_PAGE_SIZE = 60;
/** Types de vidéos TMDB qui ont leur propre groupe, dans l'ordre d'affichage. */
const VIDEO_TYPES = ['Trailer', 'Teaser', 'Clip', 'Behind the Scenes', 'Featurette'];

const TVDetails = (): JSX.Element => {
  const { t } = useTranslation();
  const sizing = useDetailsImageSizing();
  const { viewportWidth } = sizing;
  const { id: encodedId } = useParams<{ id: string }>();
  const id = encodedId ? getTmdbId(encodedId) : null;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentProfile } = useProfile();
  const { resetVipStatus } = useAdFreePopup();

  // Track page visit for Movix Wrapped
  useWrappedTracker({
    mode: 'page',
    pageData: id ? { pageName: 'tv-details', contentId: id } : undefined,
  });

  // Reset VIP status when the TV show ID changes
  useEffect(() => {
    resetVipStatus();
  }, [id, resetVipStatus]);

  const details = useTvShowDetails(id);
  const { tvShow, loading, error, certifications, videos, seasonVideos, cast, crew, recommendations, characters } = details;
  const airing = useTvAiringSchedule(id, String(tvShow?.id) === id ? tvShow?.external_ids : undefined);
  const { schedule: airingSchedule, now: airingNow } = airing;
  const lists = useTvEpisodeLists(id, tvShow, details.tmdbSeasonsDetails, airing);
  const { seasonsDetails, seasonCards, availableEpisodes, availableSeasons, defaultStartSeason, episodeListKind } = lists;
  const { watchStatus, toggleSeries, toggleEpisode } = useTvWatchStatus(id, tvShow);
  const anime = useTvAnime({
    id,
    tvShow,
    looksLikeAnime: details.looksLikeAnime,
    englishName: details.tmdbEnglishName,
    alternativeTitles: details.tmdbAlternativeTitles,
  });
  const { animeMode, animeData } = anime;
  const { resumeData, serverEpisodes, seriesMarked } = useTvResume(id, { animeMode, availableSeasons, defaultStartSeason });
  const media = useTvImagesAndTrailer(id);
  const { images, loadingImages } = media;
  const multiLang = useTvMultiLangVideos(id, details.autoMultiLangVideos);
  const antiSpoiler = useAntiSpoilerSettings();
  const { settings: antiSpoilerSettings, shouldHide, getMaskedContent } = antiSpoiler;
  const { expanded, setSectionExpanded } = useExpandableSections();
  // Logo TMDB du titre, par le même cache que le HeroSlider.
  const { logoUrl } = useTmdbImages('tv', id ? Number(id) : undefined);

  const [movixVoteStats, setMovixVoteStats] = useState<LikeDislikeStats>({ likes: 0, dislikes: 0 });
  const [showMovixRatingInfo, setShowMovixRatingInfo] = useState(false);
  const [showAntiSpoilerModal, setShowAntiSpoilerModal] = useState(false);
  const [showAddToList, setShowAddToList] = useState(false);
  const [financialStatsMode, setFinancialStatsMode] = useState<'simple' | 'advanced'>('simple');
  const trailerModal = useDetailsModal();
  const videoModal = useDetailsModal<DetailsVideo>();

  // Une saison est choisie d'office à l'arrivée ; l'URL (`?season=&episode=`)
  // ou un clic la fixe, et le choix automatique ne la remplace plus.
  const urlSeason = searchParams.get('season');
  const urlEpisode = searchParams.get('episode');
  const fromUrl = Boolean(urlSeason && urlEpisode);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(fromUrl ? Number(urlSeason) : null);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(fromUrl ? Number(urlEpisode) : null);
  const seasonPinRef = useRef<'url' | 'user' | null>(fromUrl ? 'url' : null);
  useEffect(() => {
    if (!urlSeason || !urlEpisode) return;
    seasonPinRef.current = 'url';
    setSelectedSeason(Number(urlSeason));
    setSelectedEpisode(Number(urlEpisode));
  }, [urlSeason, urlEpisode]);

  // Épisode à venir : confirmation avant de lancer le lecteur. Radix garde le
  // contenu monté pendant la fermeture : l'épisode affiché est conservé.
  const [pendingEpisode, setPendingEpisode] = useState<{ season: number; episode: number } | null>(null);
  const [isEpisodeWarningOpen, setEpisodeWarningOpen] = useState(false);
  // Vue des épisodes choisie à la main ; `null` : vue par défaut selon le nombre d'épisodes.
  const [episodeView, setEpisodeView] = useState<TvEpisodeView | null>(null);
  // Nombre d'épisodes rendus en grille ou en liste (une longue saison vient par tranches).
  const [episodeLimit, setEpisodeLimit] = useState(EPISODE_PAGE_SIZE);
  // Résumés d'épisode dépliés, par clé d'épisode
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  // Conteneur des épisodes : sa largeur donne la taille des vignettes.
  const seasonsSectionRef = useRef<HTMLDivElement | null>(null);
  const episodesSlot = useImageSlot(seasonsSectionRef, !loading && Boolean(tvShow));
  // Bouton principal du haut : quand il sort de l'écran, la barre du téléphone prend le relais.
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  // Numéros des saisons affichées en pastilles : celles d'Anime-Sama en mode
  // anime, sinon celles de TMDB (ou les parties Netflix).
  const animeSeasons = animeMode && animeData?.seasons?.length ? animeData.seasons : null;
  const seasonNumbers = animeSeasons
    ? animeSeasons.map((season, index) => animeSeasonNumber(season, index))
    : seasonCards.map((season) => season.season_number).sort((a, b) => a - b);
  const seasonNumbersKey = seasonNumbers.join(',');

  // Saison ouverte à l'arrivée : celle de l'épisode à reprendre, sinon la
  // première saison normale (les épisodes spéciaux, saison 0, passent après).
  const resumeSeason = resumeData.hasProgress || resumeData.fromServer ? resumeData.seasonNumber : null;
  const autoSeason = seasonNumbers.length === 0 ? null
    : resumeSeason !== null && seasonNumbers.includes(resumeSeason) ? resumeSeason
      : seasonNumbers.find((season) => season > 0) ?? seasonNumbers[0];

  // Choix automatique de la saison, sans défilement. Il cède devant l'URL et
  // devant un clic, tant que la saison cliquée existe encore (le passage en
  // mode anime change la numérotation).
  useEffect(() => {
    if (loading || !tvShow || String(tvShow.id) !== id || autoSeason === null) return;
    if (seasonPinRef.current === 'url') return;
    const numbers = seasonNumbersKey.split(',').map(Number);
    if (seasonPinRef.current === 'user' && selectedSeason !== null && numbers.includes(selectedSeason)) return;
    if (selectedSeason === autoSeason) return;
    seasonPinRef.current = null;
    setSelectedSeason(autoSeason);
    setSelectedEpisode(null);
    setEpisodeView(null);
  }, [loading, tvShow, id, autoSeason, selectedSeason, seasonNumbersKey]);

  // Une autre saison ou une autre liste repart de la première tranche d'épisodes.
  useEffect(() => {
    setEpisodeLimit(EPISODE_PAGE_SIZE);
  }, [selectedSeason, animeMode, episodeListKind]);

  const handleSeasonChange = (season: number) => {
    seasonPinRef.current = 'user';
    setSelectedSeason(season);
    setSelectedEpisode(null);
    // Revenir à la vue par défaut, basée sur le nombre d'épisodes de la saison
    setEpisodeView(null);
    // Au clic seulement : ramener le haut des épisodes sous la barre de
    // sections. Le choix automatique de l'arrivée ne fait pas défiler la page.
    setTimeout(() => scrollToDetailsSection(SECTION.episodes), 100);
  };

  const getEpisodeAiring = (season: number, episode: number, now = airingNow) => {
    const data = seasonsDetails[season]?.episodes?.find((item) => item.episode_number === episode);
    return resolveEpisodeAiring({ season_number: season, episode_number: episode, air_date: data?.air_date }, airingSchedule, now);
  };

  const watchTvPath = (season: number, episode: number) => `/watch/tv/${encodeId(id ?? '')}/s/${season}/e/${episode}`;
  const handleEpisodeChange = (episodeNumber: number, season = selectedSeason) => {
    if (!id || season === null) return;
    if (getEpisodeAiring(season, episodeNumber, Date.now()).needsWarning) {
      setPendingEpisode({ season, episode: episodeNumber });
      setEpisodeWarningOpen(true);
      return;
    }
    navigate(watchTvPath(season, episodeNumber));
  };

  // Bouton principal : reprendre (local, à défaut serveur) ou commencer.
  const handleContinueWatching = () => {
    let seasonToWatch = resumeData.hasProgress || resumeData.fromServer ? resumeData.seasonNumber : defaultStartSeason;
    let episodeToWatch = resumeData.hasProgress || resumeData.fromServer ? resumeData.episodeNumber : 1;

    // Saison absente de la liste affichée : la première disponible. En mode
    // anime on valide contre la numérotation d'Anime-Sama, qui peut compter
    // des saisons ou cours absents de TMDB.
    const animeSeasonNumbers = animeMode && animeData?.seasons
      ? animeData.seasons.map((season, index) => animeSeasonNumber(season, index))
      : null;
    if (animeSeasonNumbers && animeSeasonNumbers.length > 0) {
      if (!animeSeasonNumbers.includes(seasonToWatch)) {
        seasonToWatch = animeSeasonNumbers[0];
        episodeToWatch = 1;
      }
    } else if (availableSeasons.length > 0 && !availableSeasons.includes(seasonToWatch)) {
      seasonToWatch = defaultStartSeason;
      episodeToWatch = 1;
    }

    setSelectedSeason(seasonToWatch);
    setSelectedEpisode(episodeToWatch);

    // Reprise venue du serveur : le lecteur ne lit que progress_tv_ local, on
    // y recopie la position exacte de cet épisode (jamais un estimé).
    if (id && resumeData.fromServer && seasonToWatch === resumeData.seasonNumber && episodeToWatch === resumeData.episodeNumber) {
      const progressKey = `progress_tv_${id}_s${seasonToWatch}_e${episodeToWatch}`;
      const seed = seedProgress(resumeData, new Date().toISOString());
      // Stockage plein ou refusé : writeLocalStorage rend false, le lecteur repartira du début.
      if (seed && !readLocalStorage(progressKey)) writeLocalStorage(progressKey, seed);
    }

    if (!id) return;
    if (animeMode) {
      navigate(`/watch/anime/${encodeId(id)}/season/${seasonToWatch}/episode/${episodeToWatch}`);
    } else {
      handleEpisodeChange(episodeToWatch, seasonToWatch);
    }
  };

  const handleAnimeModeToggle = async () => {
    if (!animeMode) {
      await anime.enableAnimeMode();
      return;
    }
    anime.setAnimeMode(false);
    // Saison anime absente de TMDB : revenir sur une saison et un épisode
    // valides, plutôt que « Pas d'épisodes disponibles pour cette saison ».
    if (availableSeasons.length > 0 && (selectedSeason === null || !availableSeasons.includes(selectedSeason))) {
      setSelectedSeason(defaultStartSeason);
      const firstEpisode = availableEpisodes.filter((episode) => episode.sa === defaultStartSeason)[0];
      setSelectedEpisode(firstEpisode ? firstEpisode.epi : 1);
    }
  };

  // La route n'a plus de marge haute (l'image passe sous l'en-tête) : les
  // écrans sans image la remettent eux-mêmes (`pt-20`).
  if (loading) {
    return <DetailsSkeleton mediaType="tv" />;
  }
  if (error) return <div className="min-h-screen bg-black px-4 pt-32 text-center text-red-500">{error}</div>;
  if (!tvShow) return <div className="min-h-screen bg-black px-4 pt-32 text-center text-white">{t('details.tvNotFound')}</div>;

  // Restriction d'âge du profil
  const contentCert = pickDetailsCertification(certifications);
  const profileAgeRestriction = currentProfile?.ageRestriction ?? 0;
  if (contentCert && profileAgeRestriction > 0 && !isContentAllowed(contentCert, profileAgeRestriction)) {
    return <DetailsAgeBlocked certification={contentCert} ageRestriction={profileAgeRestriction} />;
  }

  const language = i18n.language;
  const showId = id ?? '';
  const yearOf = (date: string | null | undefined) => (date && !isNaN(new Date(date).getTime()) ? Number(date.slice(0, 4)) : null);

  const tvYear = yearOf(tvShow.first_air_date);
  const lastYear = yearOf(tvShow.last_air_date);
  const yearsLabel = tvYear === null ? null : lastYear !== null && lastYear !== tvYear ? `${tvYear} – ${lastYear}` : String(tvYear);
  const showAiring = resolveShowAiring(tvShow.first_air_date, airingSchedule, airingNow);
  const pendingAiring = pendingEpisode ? getEpisodeAiring(pendingEpisode.season, pendingEpisode.episode) : null;
  const timelineEpisodes: Array<TvEpisodeDate & { name: string }> = Object.entries(seasonsDetails).flatMap(([season, seasonDetails]) =>
    (seasonDetails.episodes ?? []).map((episode) => ({ ...episode, season_number: Number(season) })),
  );
  if (tvShow.last_episode_to_air) timelineEpisodes.push(tvShow.last_episode_to_air);
  if (tvShow.next_episode_to_air) timelineEpisodes.push(tvShow.next_episode_to_air);
  const { last: lastBroadcastEpisode, next: nextBroadcastEpisode } = getEpisodeTimeline(timelineEpisodes, airingSchedule, airingNow);
  const lastBroadcastAiring = lastBroadcastEpisode ? resolveEpisodeAiring(lastBroadcastEpisode, airingSchedule, airingNow) : null;
  const nextBroadcastAiring = nextBroadcastEpisode ? resolveEpisodeAiring(nextBroadcastEpisode, airingSchedule, airingNow) : null;
  const tvTitle = tvYear ? `${tvShow.name} (${tvYear}) - Movix` : `${tvShow.name} - Movix`;
  const tvCanonicalUrl = buildSiteUrl(`/tv/${encodedId || id}`);
  const tvSocialImage = tvShow.backdrop_path || tvShow.poster_path
    ? `https://image.tmdb.org/t/p/original${tvShow.backdrop_path || tvShow.poster_path}`
    : undefined;
  const tvDescription = tvShow.overview?.trim() || `Découvrez ${tvShow.name} sur Movix.`;

  const hero = detailsHeroImages(sizing, {
    backdrop: tvShow.backdrop_path, bestBackdrop: media.bestBackdrop?.file_path, poster: tvShow.poster_path, logo: logoUrl,
  });

  // Pastilles et faits
  const genres = tvShow.genres ?? [];
  const networks = tvShow.networks ?? [];
  const creators = tvShow.created_by ?? [];
  const seasonTotal = tvShow.number_of_seasons ?? 0;
  const episodeTotal = tvShow.number_of_episodes ?? 0;
  const tmdbRating = tvShow.vote_average > 0 ? formatDetailsRating(tvShow.vote_average, language) : null;
  const movixRating = calculateLikeDislikeRating(movixVoteStats);
  const movixRatingLabel = movixRating != null ? formatDetailsRating(movixRating, language) : null;
  const classificationPill = detailsClassificationPill(contentCert, t);
  const showAiringLabel = showAiring.kind !== 'unconfirmed' || showAiring.date
    ? getAiringLabel(showAiring, t, language, airingNow)
    : null;
  const statusLabel = !tvShow.status ? null
    : tvShow.status === 'Returning Series' ? t('details.seriesOngoing')
      : tvShow.status === 'Ended' ? t('details.ended')
        : tvShow.status === 'Canceled' ? t('details.cancelled')
          : tvShow.status === 'In Production' ? t('details.inProductionStatus')
            : tvShow.status === 'Planned' ? t('details.tvStatus.planned')
              : tvShow.status === 'Pilot' ? t('details.tvStatus.pilot')
                : tvShow.status;
  const statusWithProduction = statusLabel === null ? null : [
    statusLabel,
    tvShow.in_production === true && t('details.inProductionNote'),
    tvShow.in_production === false && tvShow.status !== 'Ended' && tvShow.status !== 'Canceled' && t('details.productionEndedNote'),
  ].filter(Boolean).join(' ');
  const firstAirDateLong = formatDetailsLongDate(tvShow.first_air_date, language);
  const synopsisText = shouldHide('episodeOverviews')
    ? getMaskedContent(tvShow.overview || t('details.noSynopsis'), 'episodeOverviews')
    : (tvShow.overview || t('details.noSynopsis'));

  // Bouton principal : reprendre, continuer ou commencer, avec le temps de reprise.
  const resumeNames = { episode: resumeData.episodeNumber, season: getSeasonDisplayName(resumeData.seasonNumber, t) };
  const resumeNumbers = { episode: resumeData.episodeNumber, season: resumeData.seasonNumber };
  const primaryAction = resumeData.hasProgress
    ? {
      // Estimé seul : le lecteur repartira du début de l'épisode, donc « Regarder ».
      label: resumeData.estimated ? t('details.watchBtn') : t('details.resumeEpisodeShort', resumeNumbers),
      title: resumeData.estimated ? t('details.watchBtn') : t('details.resumeEpisode', resumeNames),
      detail: resumeData.estimated
        ? t('profilePage.progress.estimated', { percent: Math.round((resumeData.position / resumeData.duration) * 100), defaultValue: '≈ {{percent}} % · estimé' })
        : `${formatDetailsClock(resumeData.position)}/${formatDetailsClock(resumeData.duration)}`,
      progress: resumeData.duration > 0 ? resumeData.position / resumeData.duration : null,
    }
    : (availableSeasons.length > 0 && resumeData.seasonNumber !== defaultStartSeason) || resumeData.episodeNumber !== 1
      ? {
        label: t('details.continueEpisodeShort', resumeNumbers),
        title: t('details.continueEpisode', resumeNames),
        detail: null,
        progress: null,
      }
      : {
        label: t('details.startEpisodeShort', { season: defaultStartSeason }),
        title: t('details.startEpisode', { season: getSeasonDisplayName(defaultStartSeason, t) }),
        detail: null,
        progress: null,
      };
  const playIcon = <Play aria-hidden="true" className="fill-current" />;
  const showDownload = !ENABLE_VIP_DOWNLOAD_CHECK || readLocalStorage('is_vip') === 'true';

  // Saisons en pastilles. Anti-spoil : le nom d'une saison peut en dire trop,
  // on affiche alors son numéro.
  const hideNames = shouldHide('episodeNames');
  const plainSeasonName = (season: number) => (season === 0 ? t('details.specialSeason') : `${t('details.season')} ${season}`);
  const seasonOption = (season: number, name: string, count: number): TvSeasonOption => ({
    number: season,
    name: hideNames ? plainSeasonName(season) : name,
    episodeCount: count,
    episodeCountLabel: t('details.episodesCount', { count }),
  });
  const seasonOptions: TvSeasonOption[] = animeSeasons
    ? animeSeasons.map((season, index) => seasonOption(animeSeasonNumber(season, index), season.name, season.episodes.length))
    : [...seasonCards]
      // Les épisodes spéciaux (saison 0) passent après les saisons normales.
      .sort((a, b) => Number(a.season_number === 0) - Number(b.season_number === 0) || a.season_number - b.season_number)
      .map((meta) => {
        const seasonDetails = seasonsDetails[meta.season_number] || meta;
        return seasonOption(
          meta.season_number,
          getSeasonDisplayName(meta.season_number, t, seasonDetails.name),
          seasonDetails.episodes?.length ?? seasonDetails.episode_count ?? 0,
        );
      });

  // Épisodes de la saison affichée
  const currentAnimeSeason = animeSeasons && selectedSeason !== null
    ? animeSeasons.find((season, index) => animeSeasonNumber(season, index) === selectedSeason) ?? null
    : null;
  const animeEpisodes = currentAnimeSeason
    ? currentAnimeSeason.episodes.filter((episode) => episode && episode.streaming_links && episode.streaming_links.length > 0)
    : [];
  const standardEpisodes: TvEpisode[] = !animeSeasons && selectedSeason !== null ? seasonsDetails[selectedSeason]?.episodes ?? [] : [];
  const episodeCount = animeSeasons ? animeEpisodes.length : standardEpisodes.length;

  // Vue par défaut selon le nombre d'épisodes : une saison de plusieurs
  // centaines d'épisodes ne rend pas autant de cartes. Sous 768 px la grille
  // n'existe pas : liste ou menu.
  const isPhone = viewportWidth < 768;
  const defaultView: TvEpisodeView = episodeCount <= 24 ? 'grid' : episodeCount <= 100 ? 'list' : 'dropdown';
  const chosenView = episodeView ?? defaultView;
  const effectiveView: TvEpisodeView = isPhone && chosenView === 'grid' ? 'list' : chosenView;
  const viewOptions: TvEpisodeView[] = isPhone ? ['list', 'dropdown'] : ['grid', 'list', 'dropdown'];

  const watchStates = new Map(standardEpisodes.map((episode) => [
    episode.episode_number,
    tvEpisodeWatchState(id, selectedSeason, episode.episode_number, watchStatus, serverEpisodes, seriesMarked),
  ]));
  const seenCount = Array.from(watchStates.values()).filter((state) => state.seen).length;

  // En grille, la taille de la vignette attend la mesure du conteneur.
  const thumbCssWidth = effectiveView !== 'grid' ? tvEpisodeRowThumbWidth(viewportWidth)
    : episodesSlot.width > 0 ? tvEpisodeCardWidth(episodesSlot.width, viewportWidth) : null;
  const episodeName = (episode: TvEpisode) => (hideNames
    ? getMaskedContent(episode.name, 'episodeNames', undefined, episode.episode_number)
    : `${episode.episode_number}. ${episode.name}`);

  const episodeItems: TvEpisodeItem[] = effectiveView === 'dropdown' ? []
    : animeSeasons
      ? animeEpisodes.slice(0, episodeLimit).map((episode) => toAnimeEpisodeItem(episode, selectedSeason, selectedEpisode, t))
      : standardEpisodes.slice(0, episodeLimit).map((episode) => toTvEpisodeItem(episode, {
        id,
        showName: tvShow.name,
        season: selectedSeason ?? 0,
        selectedEpisode,
        watchState: watchStates.get(episode.episode_number)!,
        watchStatus,
        airing: getEpisodeAiring(selectedSeason ?? 0, episode.episode_number),
        airingNow,
        antiSpoiler,
        sizing,
        thumbCssWidth,
        language,
        t,
      }));
  const dropdownOptions = effectiveView !== 'dropdown' ? []
    : animeSeasons
      ? animeEpisodes.map((episode) => {
        const allLanguages = episode.streaming_links.map((link) => animeLanguageLabel(link.language, t)).join(', ');
        return {
          value: episode.index.toString(),
          label: `${episode.name || episode.index} ${allLanguages ? `(${allLanguages})` : ''}`,
        };
      })
      : standardEpisodes.map((episode) => {
        const episodeAiring = getEpisodeAiring(selectedSeason ?? 0, episode.episode_number);
        const name = episodeName(episode);
        return {
          value: episode.episode_number.toString(),
          label: episodeAiring.kind !== 'aired' && (episodeAiring.date || episodeAiring.timestamp !== null)
            ? `${name} — ${getAiringLabel(episodeAiring, t, language, airingNow)}` : name,
        };
      });

  // Lance un épisode : page de lecture anime ou série, ou la fenêtre « Épisode à venir ».
  const playEpisode = (episodeNumber: number) => {
    if (!animeSeasons) {
      handleEpisodeChange(episodeNumber);
      return;
    }
    const episode = animeEpisodes.find((item) => item.index === episodeNumber);
    if (!episode) return;
    setSelectedEpisode(episode.index);
    if (id && selectedSeason) {
      navigate(`/watch/anime/${encodeId(id)}/season/${selectedSeason}/episode/${episode.index}`);
    }
  };

  const selectedSeasonOption = seasonOptions.find((option) => option.number === selectedSeason) ?? null;
  const selectedSeasonYear = !animeSeasons && selectedSeason !== null
    ? yearOf(seasonsDetails[selectedSeason]?.air_date ?? seasonCards.find((season) => season.season_number === selectedSeason)?.air_date)
    : null;
  const seasonInfo = selectedSeasonOption
    ? [
      selectedSeasonOption.name,
      selectedSeasonYear,
      t('details.episodesCount', { count: episodeCount }),
      seenCount > 0 && t('details.episodesSeenCount', { count: seenCount }),
    ].filter(Boolean).join(' · ')
    : null;
  const showEpisodeListToggle = !animeSeasons && lists.episodeListOptions.length > 0 && Boolean(id);

  // Personnes
  const { castPeople, crewPeople } = toDetailsPeople(cast, crew, sizing.profileUrl, t);
  const hasCastSection = cast.length > 0 || crew.length > 0;

  // Vidéos et images
  const playVideo = (video: DetailsVideo) => videoModal.open(video);
  const allSeasonVideos = Object.values(seasonVideos).flat();
  const previewVideos = sortDetailsVideos(videos.length > 0 ? videos : allSeasonVideos).slice(0, PREVIEW_VIDEO_COUNT);
  const videoTotal = videos.length + allSeasonVideos.length;
  // Une saison sans aucune vidéo ne s'affiche pas (ni bloc vide « Aucune vidéo… »).
  const seasonsWithVideos = availableSeasons.filter(
    (seasonNum) => (seasonVideos[seasonNum]?.length ?? 0) > 0 || (multiLang.seasonVideos[seasonNum]?.length ?? 0) > 0,
  );
  const videoGroups: DetailsVideoGroup[] = [
    ...VIDEO_TYPES.map((type) => ({
      key: type,
      title: type === 'Trailer' ? t('details.videoTrailers')
        : type === 'Teaser' ? 'Teasers'
          : type === 'Clip' ? t('details.videoClips')
            : type === 'Behind the Scenes' ? t('details.videoBehindScenes')
              : t('details.videoMakingOf'),
      videos: videos.filter((video) => video.type === type),
    })),
    { key: 'other', title: t('details.otherVideos'), videos: videos.filter((video) => !VIDEO_TYPES.includes(video.type ?? '')) },
  ];
  const { total: imageTotal, breakdown: imageBreakdown } = detailsImageStats(images, t);
  const mediaSummary = [
    videoTotal > 0 && t('details.videosCount', { count: videoTotal }),
    imageTotal > 0 && t('details.imagesCount', { count: imageTotal }),
  ].filter(Boolean).join(', ');
  const hasMedia = videoTotal > 0 || imageTotal > 0 || loadingImages;
  // Remplacent les anciens onglets Vidéos et Images : déplient la section et y défilent.
  const openVideos = (anchor: string = SECTION.media) => setSectionExpanded('media', true, anchor);
  const openImages = () => openVideos(SECTION.images);

  // Détails
  const episodeRuntimes = Object.entries(seasonsDetails)
    .filter(([season]) => Number(season) > 0)
    .flatMap(([, seasonDetails]) => (seasonDetails.episodes ?? []).map((episode) => episode.runtime))
    .filter((runtime): runtime is number => typeof runtime === 'number' && runtime > 0);
  const averageRuntime = tvShow.episode_run_time?.[0]
    || (episodeRuntimes.length > 0 ? Math.round(episodeRuntimes.reduce((sum, runtime) => sum + runtime, 0) / episodeRuntimes.length) : 0);
  const averageRuntimeLabel = averageRuntime > 0 ? tvRuntimeText(averageRuntime, t) : null;
  const mainNetwork = networks[0]?.name ?? null;
  // Dernier épisode diffusé et prochain épisode, masqués par l'anti-spoil.
  const broadcastValue = (episode: TvEpisodeDate & { name: string }, date: string | null) => (hideNames
    ? getMaskedContent(t('details.maskedInfo'), 'episodeNames')
    : (
      <>
        S{episode.season_number} E{episode.episode_number} - {episode.name}
        {date && <span className="ml-2 text-xs font-normal text-white/55">({date})</span>}
      </>
    ));

  // Barre de sections : seules les sections présentes y figurent.
  const sections: DetailsSectionLink[] = [
    { id: SECTION.episodes, label: t('details.episodesLabel') },
    { id: SECTION.overview, label: t('details.overviewTab') },
    ...(hasCastSection ? [{ id: SECTION.cast, label: t('details.castTab') }] : []),
    ...(hasMedia ? [{ id: SECTION.media, label: t('details.mediaSection'), shortLabel: t('details.videosTab') }] : []),
    { id: SECTION.details, label: t('details.detailsTab') },
    { id: SECTION.comments, label: t('details.commentsTab') },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <SEO
        title={tvTitle}
        description={tvDescription}
        ogType="video.tv_show"
        ogUrl={tvCanonicalUrl}
        ogImage={tvSocialImage}
        canonical={tvCanonicalUrl}
      />

      <div className="relative min-h-screen bg-black pb-24 text-white animate-skeleton-fade motion-reduce:animate-none">
        <DetailsHero
          backdropUrl={hero.backdropUrl}
          pills={(
            <>
              <DetailsPill uppercase>{t('search.serieLabel')}</DetailsPill>
              {yearsLabel && <DetailsPill>{yearsLabel}</DetailsPill>}
              {/* Sous 640 px, la rangée de pastilles d'une série passait à la
                  ligne : la classification reste dans la fiche, plus bas. */}
              {classificationPill && <DetailsPill className="hidden sm:inline-flex">{classificationPill}</DetailsPill>}
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
              {showAiringLabel && (
                <DetailsPill
                  dot={showAiring.kind === 'aired' ? 'on' : showAiring.kind === 'upcoming' ? 'pending' : undefined}
                  className="h-auto min-h-[26px] whitespace-normal rounded-xl py-1 md:h-auto md:min-h-7"
                >
                  {showAiringLabel}
                </DetailsPill>
              )}
            </>
          )}
          title={<DetailsTitle title={tvShow.name} logoUrl={hero.logoUrl} />}
          meta={(
            <DetailsMetaLine
              items={[
                seasonTotal > 0 && { key: 'seasons', content: t('details.seasonsCount', { count: seasonTotal }) },
                episodeTotal > 0 && { key: 'episodes', content: t('details.episodesCount', { count: episodeTotal }) },
                genres.length > 0 && {
                  key: 'genres',
                  content: <DetailsInlineLinks links={genres.slice(0, 2).map((genre) => ({ id: genre.id, name: genre.name, to: genreSearchHref('tv', genre.id) }))} />,
                  desktopOnly: true,
                },
                mainNetwork && { key: 'network', content: mainNetwork, desktopOnly: true },
                statusLabel && { key: 'status', content: statusLabel, phoneOnly: true },
              ]}
            />
          )}
          note={airingSchedule ? (
            <p className="text-xs text-white/60">
              {t('details.airing.source')}{' '}
              <a
                href={airingSchedule.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`rounded-sm text-white underline underline-offset-4 hover:text-red-400 ${DETAILS_FOCUS}`}
              >
                TVmaze
              </a>
            </p>
          ) : null}
          synopsis={tvShow.overview ? (
            <DetailsSynopsis
              text={synopsisText}
              tagline={tvShow.tagline}
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
                title={primaryAction.title}
                onClick={handleContinueWatching}
                className="w-full md:w-auto"
              >
                {primaryAction.label}
              </DetailsButton>
              <div className={`grid gap-2.5 md:contents ${showDownload ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <DetailsButton icon={<Video aria-hidden="true" />} onClick={() => trailerModal.open()} disabled={!media.trailer}>
                  {t('details.bandeAnnonce')}
                </DetailsButton>
                {showDownload && (
                  <DetailsButton icon={<Download aria-hidden="true" />} onClick={() => navigate(`/download/tv/${tvShow.id}`)}>
                    {t('details.downloadBtn')}
                  </DetailsButton>
                )}
              </div>
            </div>
          )}
          secondaryActions={(
            <DetailsActionRow columns={6}>
              <DetailsActionButton
                icon={Bookmark}
                label={t('details.toWatchBtn')}
                active={watchStatus.watchlist}
                fillWhenActive
                aria-pressed={watchStatus.watchlist}
                onClick={() => toggleSeries('watchlist')}
              />
              <DetailsActionButton
                icon={Heart}
                label={t('details.favoritesBtn')}
                active={watchStatus.favorite}
                fillWhenActive
                aria-pressed={watchStatus.favorite}
                onClick={() => toggleSeries('favorite')}
              />
              <DetailsActionButton
                icon={Check}
                label={t('details.watchedBtn')}
                active={watchStatus.watched}
                aria-pressed={watchStatus.watched}
                onClick={() => toggleSeries('watched')}
              />
              <DetailsActionButton
                icon={ListPlus}
                label={t('details.addToAList')}
                shortLabel={t('details.listShort')}
                aria-haspopup="dialog"
                onClick={() => setShowAddToList(true)}
              />
              <DetailsActionButton
                icon={EyeOff}
                label={t('details.antiSpoil')}
                active={Boolean(antiSpoilerSettings.enabled)}
                title={t('details.antiSpoilConfig')}
                aria-haspopup="dialog"
                onClick={() => setShowAntiSpoilerModal(true)}
              />
              <ShareButtons
                title={tvShow.name || ''}
                description={tvShow.overview || ''}
                imageUrl={tvShow.poster_path ? `https://image.tmdb.org/t/p/original${tvShow.poster_path}` : undefined}
                url={buildSiteUrl(`/tv/${encodedId || id}`)}
                renderTrigger={(open) => (
                  <DetailsActionButton icon={Share} label={t('common.share')} aria-haspopup="dialog" onClick={open} />
                )}
              />
            </DetailsActionRow>
          )}
          votes={(
            <LikeDislikeButton
              contentType="tv"
              contentId={showId}
              onStatsChange={setMovixVoteStats}
            />
          )}
        />

        <DetailsSectionNav
          sections={sections}
          ariaLabel={t('details.sectionsNav')}
          backdropUrl={hero.backdropUrl}
          banner={{
            title: tvShow.name || '',
            actions: (
              <>
                <DetailsButton
                  variant="primary"
                  size="bar"
                  icon={playIcon}
                  detail={primaryAction.detail}
                  title={primaryAction.title}
                  onClick={handleContinueWatching}
                >
                  {primaryAction.label}
                </DetailsButton>
                <LikeDislikeButton contentType="tv" contentId={showId} compact />
                <DetailsBarIconButton
                  icon={Bookmark}
                  label={t('details.toWatchBtn')}
                  active={watchStatus.watchlist}
                  fillWhenActive
                  aria-pressed={watchStatus.watchlist}
                  onClick={() => toggleSeries('watchlist')}
                />
                <DetailsBarIconButton
                  icon={Heart}
                  label={t('details.favoritesBtn')}
                  active={watchStatus.favorite}
                  fillWhenActive
                  aria-pressed={watchStatus.favorite}
                  onClick={() => toggleSeries('favorite')}
                />
              </>
            ),
          }}
        />

        {/* Positionné : passe au-dessus de la coulure de la grande image, qui
            descend sous la barre de sections. */}
        <div className={`${DETAILS_GRID} relative`}>
          {/* Épisodes, en premier : saisons en pastilles, barre d'outils, puis la saison choisie.
              Moins d'espace au-dessus que les autres sections, donc une marge de
              défilement plus grande : les pastilles s'arrêtent sous la barre de sections. */}
          <DetailsSection id={SECTION.episodes} className="pt-5 md:scroll-mt-24 md:pt-9 2xl:scroll-mt-24 2xl:pt-9">
            <div ref={seasonsSectionRef}>
              <h2 className="sr-only">{t('details.episodesLabel')}</h2>
              <div className="md:mb-3 md:flex md:flex-wrap md:items-center md:justify-between md:gap-4">
                <TvSeasonPills
                  seasons={seasonOptions}
                  selected={selectedSeason}
                  onSelect={handleSeasonChange}
                  ariaLabel={t('details.seasonsLabel')}
                />
                <TvEpisodesToolbar
                  className="mt-3.5 md:mt-0"
                  seasonLayout={lists.hasNetflixLayout && !animeMode && id ? { netflix: lists.usesNetflixLayout, onChange: lists.chooseSeasonLayout } : null}
                  episodeList={showEpisodeListToggle ? {
                    options: lists.episodeListOptions,
                    value: episodeListKind,
                    onChange: lists.chooseEpisodeList,
                    hint: episodeListKind === 'tvmaze' && lists.tvmazeSeasons && selectedSeason !== null ? t('details.episodeListTvmazeHint', {
                      count: lists.tvmazeSeasons[selectedSeason]?.length ?? 0,
                      tmdb: details.tmdbSeasonsDetails[selectedSeason]?.episodes?.length ?? 0,
                    }) : undefined,
                  } : null}
                  animeMode={details.looksLikeAnime ? { active: animeMode, loading: anime.loadingAnimeData, onToggle: handleAnimeModeToggle } : null}
                  view={episodeCount > 0 ? { options: viewOptions, value: effectiveView, onChange: setEpisodeView } : null}
                />
              </div>
              {seasonInfo && (
                <div className="mb-1 mt-3.5 flex items-center justify-between gap-3 md:mb-[22px] md:mt-0">
                  <p className="min-w-0 text-[13px] text-white/55 md:text-sm">{seasonInfo}</p>
                  {/* Sous 768 px le choix de la vue se range à côté du résumé de la saison. */}
                  {episodeCount > 0 && (
                    <TvEpisodeViewSwitch className="md:hidden" options={viewOptions} value={effectiveView} onChange={setEpisodeView} />
                  )}
                </div>
              )}

              {selectedSeason !== null && (episodeCount === 0 ? (
                <p className="mt-3 rounded-xl border border-white/10 bg-white/[.04] p-4 text-center text-sm text-white/70">
                  {t('details.noEpisodesForSeason')}
                </p>
              ) : (
                // Changement de vue : l'ancienne part, la nouvelle entre en fondu et ses épisodes en cascade.
                <DetailsSwap swapKey={effectiveView}>
                {effectiveView === 'dropdown' ? (
                // data-reveal-grid : le titre puis le menu montent en cascade, comme les épisodes.
                <div data-reveal-grid className="mt-3 max-w-md">
                  <p className="mb-2 text-sm font-medium text-white/60">{t('details.selectEpisode')}</p>
                  <DetailsSelect
                    options={dropdownOptions}
                    value={selectedEpisode ? selectedEpisode.toString() : ''}
                    onChange={(value) => playEpisode(Number(value))}
                    placeholder={t('details.chooseEpisode')}
                    searchLabel={t('details.searchEpisode')}
                    emptyLabel={t('details.noEpisodeFound')}
                    className="w-full"
                  />
                </div>
              ) : (
                <TvEpisodeList
                  view={effectiveView}
                  episodes={episodeItems}
                  expanded={expandedCards}
                  onExpandedChange={(key, open) => setExpandedCards((previous) => ({ ...previous, [key]: open }))}
                  onPlay={(episode) => playEpisode(episode.number)}
                  onToggleWatched={(episode) => toggleEpisode('episodeWatched', episode.key)}
                  onToggleWatchlist={(episode) => toggleEpisode('episodeWatchlist', episode.key)}
                  remaining={Math.max(0, episodeCount - episodeLimit)}
                  onShowMore={() => setEpisodeLimit((limit) => limit + EPISODE_PAGE_SIZE)}
                  backdropUrl={hero.backdropUrl}
                />
                )}
                </DetailsSwap>
              ))}

              {(showEpisodeListToggle || animeMode) && (
                <div className="mt-4 space-y-1.5 text-xs text-white/55 md:mt-[26px] md:text-[13px]">
                  {showEpisodeListToggle && <p>{t('details.episodeListSwitchHint')}</p>}
                  {/* Note du mode anime : le mode standard reste là si des épisodes manquent */}
                  {animeMode && <p>{t('details.standardModeAvailable')}</p>}
                </div>
              )}
            </div>
          </DetailsSection>

          {/* Aperçu */}
          <DetailsSection id={SECTION.overview}>
            <div className="grid gap-9 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start lg:gap-[72px]">
              <DetailsSynopsisBlock mediaType="tv" id={id} tagline={tvShow.tagline} text={synopsisText} />
              <div>
                <DetailsSectionHeader title={t('details.overviewTab')} className="md:hidden" />
                <DetailsFacts
                  items={[
                    creators.length > 0 && {
                      key: 'creation',
                      label: t('details.creationLabel'),
                      value: <DetailsInlineLinks links={creators.map((person) => ({ id: person.id, name: person.name, to: `/person/${person.id}` }))} />,
                    },
                    genres.length > 0 && {
                      key: 'genres',
                      label: t('details.genresLabel'),
                      className: 'md:hidden',
                      value: <DetailsInlineLinks links={genres.map((genre) => ({ id: genre.id, name: genre.name, to: genreSearchHref('tv', genre.id) }))} />,
                    },
                    networks.length > 0 && {
                      key: 'network',
                      label: t('details.broadcasterLabel'),
                      value: networks.map((network) => network.name).join(', '),
                    },
                    {
                      key: 'firstAir',
                      label: t('details.firstAirDate'),
                      value: firstAirDateLong ?? t('details.dateNotAvailable'),
                    },
                    statusLabel && { key: 'status', label: t('details.statusLabel'), value: statusLabel },
                    { key: 'seasons', label: t('details.seasonsLabel'), value: seasonTotal },
                    { key: 'episodes', label: t('details.episodesLabel'), value: episodeTotal },
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
                        tvShow.vote_count ? t('details.votesCount', { count: tvShow.vote_count, formatted: formatDetailsCount(tvShow.vote_count, language) }) : null,
                      ].filter(Boolean).join(' · '),
                    },
                    movixRatingLabel && {
                      key: 'movix',
                      label: t('details.movixRatingLabel'),
                      value: <DetailsMovixRatingValue rating={movixRatingLabel} onInfo={() => setShowMovixRatingInfo(true)} />,
                    },
                  ]}
                />
                <DetailsTmdbNote mediaType="tv" id={id} className="mt-3 md:hidden" />
              </div>
            </div>
          </DetailsSection>

          {/* Distribution : 8 premiers, puis tout le générique, l'équipe et les personnages */}
          {hasCastSection && (
            <DetailsSection id={SECTION.cast}>
              <DetailsSectionHeader
                title={t('details.castTab')}
                expanded={expanded.cast}
                onToggle={cast.length > PREVIEW_CAST_COUNT || crew.length > 0 || details.hasCharactersTab
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
                {(crewPeople.length > 0 || details.hasCharactersTab) && (
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
                      {details.hasCharactersTab && <CharactersSection data={characters} loading={details.charactersLoading} />}
                    </div>
                  </DetailsCollapse>
                )}
              </div>
            </DetailsSection>
          )}

          {/* Vidéos et images : 3 vidéos et la tuile images, puis tout */}
          {hasMedia && (
            <DetailsSection id={SECTION.media}>
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
                    {/* Vidéos générales, classées par type */}
                    <div data-reveal>
                      <DetailsVideoGallery
                        title={t('details.videosAndTrailers')}
                        videos={videos}
                        groups={videoGroups}
                        multiLangVideos={multiLang.videos}
                        loading={multiLang.loading}
                        showMultiLang={multiLang.show}
                        onToggleMultiLang={multiLang.toggle}
                        onPlay={playVideo}
                        emptyLabel={t('details.noGeneralVideoFound')}
                        emptyMultiLangLabel={t('details.noMultiLangVideo')}
                      />
                    </div>

                    {/* Vidéos par saison, chacune avec sa bascule multi-langues */}
                    {seasonsWithVideos.length > 0 && (
                    <div data-reveal>
                      <h3 className="mb-5 border-t border-white/[.12] pt-6 text-lg font-semibold text-white">{t('details.videosBySeason')}</h3>
                        <div className="space-y-8">
                          {seasonsWithVideos.map((seasonNum) => (
                            <DetailsVideoGallery
                              key={`season-videos-${seasonNum}`}
                              titleAs="h4"
                              compactEmpty
                              title={plainSeasonName(seasonNum)}
                              videos={seasonVideos[seasonNum] ?? []}
                              multiLangVideos={multiLang.seasonVideos[seasonNum] ?? []}
                              loading={Boolean(multiLang.seasonLoading[seasonNum])}
                              showMultiLang={Boolean(multiLang.seasonShown[seasonNum])}
                              onToggleMultiLang={() => multiLang.toggleSeason(seasonNum)}
                              onPlay={playVideo}
                              emptyLabel={t('details.noVideoForSeason', { season: seasonNum })}
                              emptyMultiLangLabel={t('details.noMultiLangVideoForSeason', { season: seasonNum })}
                            />
                          ))}
                        </div>
                    </div>
                    )}

                    <div data-reveal id={SECTION.images} className="scroll-mt-[136px] md:scroll-mt-36">
                      <DetailsImagesGallery
                        mediaType="tv"
                        mediaId={showId}
                        images={images}
                        loading={loadingImages}
                        title={t('details.imagesTab')}
                      />
                    </div>
                  </div>
                ) : (
                  <DetailsMediaPreview
                    videos={previewVideos}
                    loadingVideos={false}
                    imagesTileUrl={sizing.cardBackdropUrl(images?.backdrops?.[0]?.file_path || hero.heroBackdropPath, 320)}
                    imageTotal={imageTotal}
                    imageBreakdown={imageBreakdown}
                    emptyLabel={t('details.noGeneralVideoFound')}
                    onPlay={playVideo}
                    onOpenImages={openImages}
                  />
                )}
              </div>
              </DetailsSwap>
            </DetailsSection>
          )}

          {/* Détails : ligne de chiffres, puis tout l'ancien onglet Détails */}
          <DetailsSection id={SECTION.details}>
            <DetailsSectionHeader
              title={t('details.detailsTab')}
              expanded={expanded.details}
              onToggle={() => setSectionExpanded('details', !expanded.details, SECTION.details)}
              moreLabel={t('details.detailsMoreTv')}
              controls="details-contenu"
            />
            <DetailsKeyFigures
              items={[
                { key: 'seasons', label: t('details.seasonsLabel'), value: seasonTotal },
                { key: 'episodes', label: t('details.episodesLabel'), value: episodeTotal },
                averageRuntimeLabel && { key: 'runtime', label: t('details.averageDuration'), value: averageRuntimeLabel },
                statusLabel && { key: 'status', label: t('details.statusLabel'), value: statusLabel, longText: true },
                mainNetwork && {
                  key: 'network',
                  label: t('details.broadcasterLabel'),
                  value: mainNetwork,
                  longText: true,
                  className: averageRuntimeLabel && statusLabel ? 'hidden md:block' : undefined,
                },
              ]}
            />
            <div id="details-contenu">
              <DetailsCollapse open={expanded.details}>
                <div className="pt-8">
                  <TvFullDetails
                    show={tvShow}
                    firstAirDate={formatAiringDate(showAiring, language) ?? t('details.dateNotAvailable')}
                    averageRuntime={averageRuntimeLabel}
                    statusLabel={statusWithProduction}
                    lastEpisode={lastBroadcastEpisode && lastBroadcastAiring ? {
                      label: t(lastBroadcastAiring.kind === 'aired' ? 'details.lastEpisodeAired' : 'details.airing.lastAnnouncedEpisode'),
                      value: broadcastValue(lastBroadcastEpisode, formatAiringDate(lastBroadcastAiring, language)),
                    } : null}
                    nextEpisode={nextBroadcastEpisode && nextBroadcastAiring ? {
                      label: t('details.nextEpisodeLabel'),
                      value: broadcastValue(nextBroadcastEpisode, getAiringLabel(nextBroadcastAiring, t, language, airingNow)),
                    } : null}
                    seasons={Array.from({ length: seasonTotal }, (_, index) => index + 1).map((season) => ({
                      number: season,
                      name: `${t('details.season')} ${season}`,
                      episodeCount: seasonsDetails[season]?.episodes?.length ?? null,
                    }))}
                    financialStatsMode={financialStatsMode}
                    onFinancialStatsModeChange={setFinancialStatsMode}
                  />
                  {/* En fin de section Détails : thèmes, titres alternatifs et
                      mots-clés relèvent de la fiche technique, pas de la
                      galerie de personnages. */}
                  <DetailExtraMetadata
                    variant="details"
                    themes={characters?.themes ?? []}
                    alternateTitles={details.alternateTitles}
                    keywords={details.keywords}
                  />
                </div>
              </DetailsCollapse>
            </div>
          </DetailsSection>

          {/* Séries similaires : la rangée du site (EmblaCarousel applique son
              propre -mx-3 md:-mx-4 interne). */}
          <DetailsSection>
            <LazySection
              index={0}
              immediateLoadCount={0}
              rootMargin="300px"
              minHeight="320px"
            >
              {details.loadingSimilar ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader aria-hidden="true" className="size-8 animate-spin text-red-600 motion-reduce:animate-none" />
                </div>
              ) : recommendations.length > 0 ? (
                <div className={DETAILS_CAROUSEL_ALIGN}>
                  <EmblaCarousel
                    title={<DetailsCarouselTitle>{t('details.similarSeries')}</DetailsCarouselTitle>}
                    items={recommendations.map(show => ({
                      id: Number(show.id),
                      title: show.name,
                      name: show.name,
                      poster_path: show.poster_path,
                      backdrop_path: show.backdrop_path || '',
                      overview: show.overview,
                      vote_average: show.vote_average,
                      first_air_date: show.first_air_date,
                      media_type: 'tv',
                    }))}
                    mediaType="tv-similar"
                  />
                </div>
              ) : (
                <>
                  <DetailsSectionHeader title={t('details.similarSeries')} />
                  <p className="text-sm text-white/55">{t('details.noSimilarSeriesAvailable')}</p>
                </>
              )}
            </LazySection>
          </DetailsSection>

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
              <DetailsComments contentType="tv" contentId={showId} title={t('details.commentsTab')} />
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
            title={primaryAction.title}
            onClick={handleContinueWatching}
            className="min-w-0 flex-1"
          >
            {primaryAction.label}
          </DetailsButton>
          <DetailsButton
            size="compact"
            aria-label={t('details.toWatchBtn')}
            aria-pressed={watchStatus.watchlist}
            onClick={() => toggleSeries('watchlist')}
            className="w-12 flex-none px-0"
          >
            <Bookmark aria-hidden="true" className={watchStatus.watchlist ? 'fill-current text-red-500' : undefined} />
          </DetailsButton>
        </DetailsStickyBar>

        {showAddToList && (
          <AddToListMenu
            mediaId={Number(id)}
            mediaType="tv"
            title={tvShow.name || ''}
            posterPath={tvShow.poster_path || ''}
            onClose={() => setShowAddToList(false)}
          />
        )}

        {showAntiSpoilerModal && (
          <AntiSpoilerSettingsModal
            isOpen={showAntiSpoilerModal}
            onClose={() => setShowAntiSpoilerModal(false)}
            onSettingsChange={antiSpoiler.updateSettings}
            currentSettings={antiSpoilerSettings}
          />
        )}

        {/* Épisode à venir : confirmation avant de lancer le lecteur. */}
        <DetailsConfirmDialog
          open={isEpisodeWarningOpen && pendingAiring?.needsWarning === true}
          onOpenChange={setEpisodeWarningOpen}
          title={t(pendingAiring?.kind === 'aired' ? 'details.airing.aired' : 'details.airing.warningTitle')}
          highlight={pendingAiring ? getAiringLabel(pendingAiring, t, language, airingNow) : undefined}
          description={t(pendingAiring?.kind === 'aired' ? 'details.airing.availabilityNote' : 'details.airing.warningDescription')}
          cancelLabel={t('details.cancel')}
          confirmLabel={t('details.continueAnyway')}
          onConfirm={() => {
            if (pendingEpisode && id) navigate(watchTvPath(pendingEpisode.season, pendingEpisode.episode));
          }}
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
          title={`${t('details.bandeAnnonce')} - ${tvShow.name}`}
          videoKey={media.trailer?.key}
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

export default TVDetails;
