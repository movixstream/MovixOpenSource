/**
 * Briques communes des fiches film et série (`/movie/:id`, `/tv/:id`).
 *
 * Squelette d'une fiche :
 *
 *   <DetailsHero                      image du haut, sous l'en-tête fixe
 *     backdropUrl pills={<DetailsPill/>…} title={<DetailsTitle/>}
 *     meta={<DetailsMetaLine/>} synopsis={<DetailsSynopsis/>}
 *     actions={<DetailsButton variant="primary" ref={watchRef}/>…}
 *     secondaryActions={<DetailsActionRow><DetailsActionButton/>…</DetailsActionRow>}
 *     votes={<LikeDislikeButton/>} />
 *   <DetailsSectionNav sections={[{ id, label }]} />      barre collante
 *   <div className={DETAILS_GRID}>
 *     <DetailsSection id="…">
 *       <DetailsSectionHeader title expanded onToggle />   « Tout voir / Réduire »
 *       <DetailsFacts/> | <DetailsKeyFigures/> | <DetailsPeopleRow/> |
 *       <DetailsMediaRow><DetailsVideoTile/></DetailsMediaRow>
 *     </DetailsSection>
 *   </div>
 *   <DetailsStickyBar watch={watchRef}>…</DetailsStickyBar>   téléphone
 *
 * Règles : la route n'a pas de marge haute (l'image passe sous l'en-tête),
 * donc les écrans sans image ajoutent `pt-20`. Les identifiants passés à
 * `DetailsSectionNav` sont ceux des `DetailsSection`. Pour ouvrir une section
 * depuis le code : déplier, puis `scrollToDetailsSection(id)`.
 * Rien ici ne dépend du type de contenu ; ce qui est propre au film vit dans
 * `./movie`, ce qui est propre à la série (saisons, épisodes) dans `./tv`,
 * et la page d'une personne (filmographie, « Connu pour ») dans `./person`.
 */
export {
  DETAILS_FOCUS, DETAILS_GRID, DETAILS_HEADER_HEIGHT, DETAILS_PHONE_SCROLL, DETAILS_PRESS,
  type DetailsFalsy,
} from './layout';
export { DetailsHero, type DetailsHeroProps } from './DetailsHero';
export { DetailsPill, type DetailsPillProps } from './DetailsPill';
export { DetailsTitle, type DetailsTitleProps } from './DetailsTitle';
export { DetailsMetaLine, type DetailsMetaItem, type DetailsMetaLineProps } from './DetailsMetaLine';
export { DetailsSynopsis, type DetailsSynopsisProps } from './DetailsSynopsis';
export { DetailsButton, DetailsLinkButton, type DetailsButtonProps, type DetailsLinkButtonProps } from './DetailsButton';
export {
  DetailsActionButton, DetailsActionLink, DetailsActionNote, DetailsActionRow, DetailsBarIconButton,
  type DetailsActionButtonProps, type DetailsActionLinkProps, type DetailsActionRowProps, type DetailsBarIconButtonProps,
} from './DetailsActionButton';
export {
  DetailsSectionNav, type DetailsSectionLink, type DetailsSectionNavBanner, type DetailsSectionNavProps,
} from './DetailsSectionNav';
export { scrollToDetailsSection, useActiveSection } from './useActiveSection';
export {
  DETAILS_CAROUSEL_ALIGN, DetailsCarouselTitle, DetailsSection, DetailsSectionHeader,
  type DetailsSectionHeaderProps, type DetailsSectionProps,
} from './DetailsSection';
export { DetailsFacts, type DetailsFact, type DetailsFactsProps } from './DetailsFacts';
export { DetailsKeyFigures, type DetailsKeyFigure, type DetailsKeyFiguresProps } from './DetailsKeyFigures';
export {
  DetailsPeopleList, DetailsPeopleRow,
  type DetailsPeopleListProps, type DetailsPeopleRowProps, type DetailsPerson,
} from './DetailsPeopleRow';
export { DetailsMediaRow, DetailsVideoTile, type DetailsMediaRowProps, type DetailsVideoTileProps } from './DetailsVideoTile';
export { DetailsVideoGallery, type DetailsVideoGalleryProps, type DetailsVideoGroup } from './DetailsVideoGallery';
export { describeDetailsVideo, detailsVideoThumbnail, sortDetailsVideos, type DetailsVideo } from './videos';
export {
  DetailsImagesGallery,
  type DetailsImageSet, type DetailsImagesGalleryProps, type DetailsTmdbImage,
} from './DetailsImagesGallery';
export { DetailsVideoModal, type DetailsVideoModalProps } from './DetailsVideoModal';
export { DetailsConfirmDialog, type DetailsConfirmDialogProps } from './DetailsConfirmDialog';
export { DetailsStickyBar, type DetailsStickyBarProps } from './DetailsStickyBar';
export { useIsOffscreen } from './useIsOffscreen';
export { detailsLanguageName } from './languageNames';
export { detailsJobLabel } from './jobs';
export {
  formatDetailsClock, formatDetailsCompactMoney, formatDetailsCount,
  formatDetailsLongDate, formatDetailsMoney, formatDetailsRating,
} from './format';
export {
  groupDetailsCrew, toDetailsPeople,
  type DetailsCastMember, type DetailsCrewMember, type DetailsGroupedCrewMember, type DetailsProfileUrl,
} from './credits';
export {
  detailsClassificationPill, pickDetailsCertification, type DetailsCertifications,
} from './certification';
export { detailsHeroImages, detailsImageStats, useDetailsImageSizing, type DetailsImageSizing } from './images';
export { readStoredMediaList, updateStoredMediaList, type DetailsStoredMedia } from './storedLists';
export { useExpandableSections, type DetailsExpandableSection } from './useExpandableSections';
export { useDetailsModal } from './useDetailsModal';
export { useDetailCharacters } from './useDetailCharacters';
export { DetailsAgeBlocked, type DetailsAgeBlockedProps } from './DetailsAgeBlocked';
export {
  DetailsInlineLinks, DetailsMovixRatingValue, DetailsSynopsisBlock, DetailsTmdbNote,
  type DetailsInlineLink, type DetailsMovixRatingValueProps, type DetailsSynopsisBlockProps, type DetailsTmdbNoteProps,
} from './DetailsOverview';
export { DetailsMediaPreview, type DetailsMediaPreviewProps } from './DetailsMediaPreview';
