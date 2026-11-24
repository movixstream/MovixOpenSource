/**
 * Commentaires des fiches film et série, dans le style des fiches.
 *
 *   <DetailsSection id="commentaires">
 *     <DetailsComments contentType="movie" contentId={id} title="Commentaires" />
 *   </DetailsSection>
 *
 * `DetailsComments` dessine son en-tête de section (titre, nombre, lien « Me
 * prévenir »), le champ de saisie et la liste. La logique vient de
 * `@/components/comments/useComments`, partagée avec l'ancien habillage
 * (`@/components/CommentsSection`, anciennes fiches).
 *
 * `DetailsCommentsPlaceholder` tient la place de la section avant son
 * chargement, avec la même mise en page.
 */
export { DetailsComments, type DetailsCommentsProps } from './DetailsComments';
export { DetailsCommentsPlaceholder } from './CommentsSkeleton';
