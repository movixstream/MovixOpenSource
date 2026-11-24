import { useState } from 'react';
import { Bell, BellOff, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CommentItemProps } from '@/components/comments/commentItem';
import { useComments } from '@/components/comments/useComments';
import { cn } from '@/lib/utils';
import { TURNSTILE_SITE_KEY } from '@/utils/turnstileKeys';
import { DetailsConfirmDialog } from '../DetailsConfirmDialog';
import { DetailsSectionHeader } from '../DetailsSection';
import { DETAILS_FOCUS } from '../layout';
import { CommentBox } from './CommentBox';
import { CommentReportDialog } from './CommentReportDialog';
import { CommentRow } from './CommentRow';
import { COMMENTS_FORM_COLUMN, COMMENTS_GRID, CommentsHiddenNotice, CommentsLoginCard, CommentsNote } from './CommentsParts';
import { COMMENTS_COLLAPSED_COUNT, CommentLimitsSkeleton, CommentRowsSkeleton } from './CommentsSkeleton';

export interface DetailsCommentsProps {
  contentType: 'movie' | 'tv';
  /** Identifiant TMDB du film ou de la série. */
  contentId: string;
  /** Titre de la section, le même que dans la barre de sections. */
  title: string;
}

/** Lien discret avec icône : « Me prévenir… » dans l'en-tête, « Voir les autres… » sous la liste. */
const QUIET_LINK = cn(
  'group inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-md text-[13px] font-medium text-white md:text-sm',
  'disabled:pointer-events-none disabled:opacity-60',
  DETAILS_FOCUS,
);
const QUIET_LINK_TEXT = 'truncate text-white/70 transition-colors duration-200 group-hover:text-white motion-reduce:transition-none';
const QUIET_LINK_ICON = 'size-[15px] flex-none text-white opacity-70 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none md:size-4';

function LimitCount({ label, count, limit }: { label: string; count: number; limit: number }) {
  const reached = count >= limit;
  return (
    <span className={reached ? 'text-red-400' : undefined}>
      {label} <b className={cn('font-semibold tabular-nums', !reached && 'text-white/80')}>{count}/{limit}</b>
    </span>
  );
}

/**
 * Commentaires d'une fiche film ou série, avec leur en-tête de section : champ
 * de saisie à gauche et liste à droite dès 1024 px, l'un sous l'autre avant.
 * La liste montre les premiers commentaires, puis se déplie sur place.
 */
export function DetailsComments({ contentType, contentId, title }: DetailsCommentsProps) {
  const { t } = useTranslation();
  const {
    comments, total, loading, loadingMore, hasMore, loadMoreComments, areCommentsHidden, lastCommentRef, formatDate,
    isAuthenticated, isAdmin, profileId, commentLimits, limitsPending,
    newComment, setNewComment, isSpoiler, setIsSpoiler, commentTextareaRef, handlePostComment,
    replies, expandedReplies, repliesHasMore, repliesTotalCount, toggleReplies, loadMoreReplies,
    replyingTo, setReplyingTo, replyContent, setReplyContent, isReplySpoiler, setIsReplySpoiler,
    replyTextareaRef, handlePostReply,
    editingComment, setEditingComment, editingReply, setEditingReply, editContent, setEditContent,
    editIsSpoiler, setEditIsSpoiler, editTextareaRef, handleEditComment, handleEditReply,
    handleReaction, revealedSpoilers, revealSpoiler,
    deletingIds, deletedIds, deleteConfirm, setDeleteConfirm, requestDeleteComment, requestDeleteReply,
    executeDelete,
    reportModal, setReportModal, reportReason, setReportReason, reportDetails, setReportDetails,
    reportSubmitting, reportedIds, handleReport, REPORT_REASONS,
    followingComments, followingBusy, handleToggleFollowComments,
    turnstileToken, turnstileRef, turnstileBypass,
  } = useComments(contentType, contentId);

  const [expanded, setExpanded] = useState(false);
  // Cible gardée pendant la fermeture de la fenêtre : son titre ne change pas en plein fondu.
  const [deleteTarget, setDeleteTarget] = useState(deleteConfirm);
  if (deleteConfirm && deleteConfirm !== deleteTarget) setDeleteTarget(deleteConfirm);

  if (areCommentsHidden) {
    return (
      <>
        <DetailsSectionHeader title={title} />
        <CommentsHiddenNotice />
      </>
    );
  }

  const limitReached = !!commentLimits && !commentLimits.isAdmin && (
    (commentLimits.movieLimit !== null && commentLimits.movieCount >= commentLimits.movieLimit)
    || (commentLimits.hourLimit !== null && commentLimits.hourCount >= commentLimits.hourLimit)
  );

  const visible = expanded ? comments : comments.slice(0, COMMENTS_COLLAPSED_COUNT);
  const hiddenLoaded = comments.length - visible.length;
  const remaining = total === null ? 0 : Math.max(0, total - visible.length);
  const canShowMore = hiddenLoaded > 0 || hasMore;

  /** Déplie d'abord les commentaires déjà chargés, puis charge la page suivante. */
  const showMore = () => {
    if (!expanded) {
      setExpanded(true);
      if (hiddenLoaded > 0) return;
    }
    void loadMoreComments();
  };

  const closeReport = () => {
    setReportModal(null);
    setReportReason('');
    setReportDetails('');
  };

  const FollowIcon = followingComments ? BellOff : Bell;
  const followAction = isAuthenticated && profileId ? (
    <button
      type="button"
      onClick={handleToggleFollowComments}
      disabled={followingBusy}
      aria-pressed={followingComments}
      title={followingComments ? t('comments.unfollowHint') : t('comments.followHint')}
      className={cn(QUIET_LINK, '-my-2')}
    >
      <FollowIcon aria-hidden="true" className={QUIET_LINK_ICON} />
      <span className={QUIET_LINK_TEXT}>
        {followingComments ? t('comments.unfollow') : (
          <>
            <span className="md:hidden">{t('comments.followShort')}</span>
            <span className="hidden md:inline">{t('comments.follow')}</span>
          </>
        )}
      </span>
    </button>
  ) : undefined;

  // Tout ce que les lignes partagent ; chacune reçoit en plus son commentaire et son fil.
  const rowProps: Omit<CommentItemProps, 'comment' | 'replies' | 'expanded' | 'repliesHasMore' | 'repliesTotalCount'> = {
    isLast: false,
    lastCommentRef,
    isAuthenticated,
    isAdmin,
    profileId,
    editingComment,
    editContent,
    editIsSpoiler,
    editingReply,
    editTextareaRef,
    replyingTo,
    replyContent,
    isReplySpoiler,
    replyTextareaRef,
    deletingIds,
    deletedIds,
    revealedSpoilers,
    reportedIds,
    turnstileToken,
    turnstileSiteKey: TURNSTILE_SITE_KEY,
    t: t as CommentItemProps['t'],
    formatDate,
    onReaction: handleReaction,
    onToggleReplies: toggleReplies,
    onRevealSpoiler: revealSpoiler,
    onRequestDeleteComment: requestDeleteComment,
    onRequestDeleteReply: requestDeleteReply,
    onPostReply: handlePostReply,
    onEditComment: handleEditComment,
    onEditReply: handleEditReply,
    onLoadMoreReplies: loadMoreReplies,
    setEditingComment,
    setEditContent,
    setEditIsSpoiler,
    setEditingReply,
    setReplyingTo,
    setReplyContent,
    setIsReplySpoiler,
    setReportModal,
  };

  return (
    <>
      <DetailsSectionHeader title={title} count={total || null} action={followAction} />

      <div className={COMMENTS_GRID}>
        <div className={COMMENTS_FORM_COLUMN}>
          {isAuthenticated ? (
            <>
              <CommentBox
                textareaRef={commentTextareaRef}
                value={newComment}
                onChange={setNewComment}
                placeholder={contentType === 'movie' ? t('comments.moviePlaceholder') : t('comments.seriesPlaceholder')}
                label={t('comments.yourComment')}
                spoiler={isSpoiler}
                onSpoilerChange={setIsSpoiler}
                submitLabel={t('comments.publish')}
                onSubmit={handlePostComment}
                disabled={(!!TURNSTILE_SITE_KEY && !turnstileToken) || limitReached}
              >
                {/* Vérification anti-robot ; rien pour les comptes dispensés. */}
                {TURNSTILE_SITE_KEY && turnstileBypass === 'challenge' && (
                  <div className="mt-2.5">
                    <p className="mb-2 text-xs leading-relaxed text-white/55">{t('comments.turnstileNotice')}</p>
                    <div className="overflow-hidden">
                      <div ref={turnstileRef} className="origin-left scale-[0.85] sm:scale-100" />
                    </div>
                  </div>
                )}
              </CommentBox>
              {/* Les limites arrivent avec leur propre requête : leur ligne est gardée en attendant. */}
              {!commentLimits && limitsPending && <CommentLimitsSkeleton />}
              {commentLimits && (
                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-white/55">
                  {commentLimits.isAdmin ? t('comments.adminNoLimit') : (
                    <>
                      <span>{t('comments.limit')}</span>
                      {commentLimits.movieLimit !== null && (
                        <LimitCount
                          label={contentType === 'movie' ? t('comments.onThisMovie') : t('comments.onThisSeries')}
                          count={commentLimits.movieCount}
                          limit={commentLimits.movieLimit}
                        />
                      )}
                      {commentLimits.movieLimit !== null && commentLimits.hourLimit !== null && <span aria-hidden="true">·</span>}
                      {commentLimits.hourLimit !== null && (
                        <LimitCount label={t('comments.thisHour')} count={commentLimits.hourCount} limit={commentLimits.hourLimit} />
                      )}
                    </>
                  )}
                </p>
              )}
            </>
          ) : <CommentsLoginCard />}
          <CommentsNote />
        </div>

        <div className="min-w-0">
          {loading && comments.length === 0 && <CommentRowsSkeleton signedIn={isAuthenticated} />}
          {!loading && comments.length === 0 && (
            <p className="text-[15px] leading-relaxed text-white/55">{t('comments.noComments')}</p>
          )}
          {comments.length > 0 && (
            <>
              {/* Sans lien « voir plus » dessous, le dernier filet ne sépare plus rien. */}
              <ul className={cn(!canShowMore && '[&>li:last-child]:border-b-0 [&>li:last-child]:pb-0')}>
                {visible.map((comment) => (
                  <CommentRow
                    key={comment.id}
                    comment={comment}
                    replies={replies[comment.id]}
                    expanded={expandedReplies.has(comment.id)}
                    repliesHasMore={!!repliesHasMore[comment.id]}
                    repliesTotalCount={repliesTotalCount[comment.id] || 0}
                    {...rowProps}
                  />
                ))}
              </ul>
              {canShowMore && (
                <button type="button" onClick={showMore} disabled={loadingMore} className={cn(QUIET_LINK, 'mt-2 md:mt-3')}>
                  <span className={QUIET_LINK_TEXT}>
                    {loadingMore && t('common.loading')}
                    {!loadingMore && (remaining > 0 ? t('comments.seeMore', { count: remaining }) : t('comments.loadMore'))}
                  </span>
                  <ChevronRight aria-hidden="true" className={QUIET_LINK_ICON} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <DetailsConfirmDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}
        title={deleteTarget?.type === 'reply' ? t('comments.deleteReplyConfirm') : t('comments.deleteConfirm')}
        description={t('comments.deleteIrreversible')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        onConfirm={executeDelete}
      />
      <CommentReportDialog
        open={reportModal !== null}
        onClose={closeReport}
        reasons={REPORT_REASONS}
        reason={reportReason}
        onReasonChange={setReportReason}
        details={reportDetails}
        onDetailsChange={setReportDetails}
        submitting={reportSubmitting}
        onSubmit={handleReport}
      />
    </>
  );
}

export default DetailsComments;
