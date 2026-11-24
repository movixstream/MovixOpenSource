import type React from 'react';
import type { Comment, CommentReplyTarget, CommentReportTarget, Reply } from './types';

/** Ce que le hook `useComments` donne à la ligne d'un commentaire, quel que soit son habillage. */
export interface CommentItemProps {
  comment: Comment;
  isLast: boolean;
  lastCommentRef: React.RefObject<HTMLDivElement>;
  // user identity
  isAuthenticated: boolean;
  isAdmin: boolean;
  profileId: string | null;
  // shared edit state
  editingComment: number | null;
  editContent: string;
  editIsSpoiler: boolean;
  editingReply: number | null;
  editTextareaRef: React.RefObject<HTMLTextAreaElement>;
  // shared reply state
  replyingTo: CommentReplyTarget | null;
  replyContent: string;
  isReplySpoiler: boolean;
  replyTextareaRef: React.RefObject<HTMLTextAreaElement>;
  // replies data for this comment
  replies: Reply[] | undefined;
  expanded: boolean;
  repliesHasMore: boolean;
  repliesTotalCount: number;
  // delete/reveal/report sets
  deletingIds: Set<number>;
  deletedIds: Set<number>;
  revealedSpoilers: Set<string>;
  reportedIds: Set<string>;
  // turnstile
  turnstileToken: string;
  turnstileSiteKey: string | undefined;
  // i18n + helpers
  t: (key: string, opts?: unknown) => string;
  formatDate: (timestamp: number) => string;
  // callbacks
  onReaction: (targetType: 'comment' | 'reply', targetId: number) => void;
  onToggleReplies: (commentId: number) => void;
  onRevealSpoiler: (type: 'comment' | 'reply', id: number) => void;
  onRequestDeleteComment: (commentId: number) => void;
  onRequestDeleteReply: (replyId: number, commentId: number) => void;
  onPostReply: (commentId: number, parentReplyId?: number, replyToUsername?: string) => void;
  onEditComment: (commentId: number) => void;
  onEditReply: (replyId: number, commentId: number) => void;
  onLoadMoreReplies: (commentId: number) => void;
  setEditingComment: React.Dispatch<React.SetStateAction<number | null>>;
  setEditContent: React.Dispatch<React.SetStateAction<string>>;
  setEditIsSpoiler: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingReply: React.Dispatch<React.SetStateAction<number | null>>;
  setReplyingTo: React.Dispatch<React.SetStateAction<CommentReplyTarget | null>>;
  setReplyContent: React.Dispatch<React.SetStateAction<string>>;
  setIsReplySpoiler: React.Dispatch<React.SetStateAction<boolean>>;
  setReportModal: React.Dispatch<React.SetStateAction<CommentReportTarget | null>>;
}

/**
 * Comparateur de `React.memo` pour une ligne de commentaire : la ligne ne se
 * redessine que si son propre état change, pas à chaque frappe dans un champ.
 */
export function areCommentItemPropsEqual(prev: CommentItemProps, next: CommentItemProps): boolean {
  // Bail-out: skip render if neither this comment's state nor any of the
  // shared parent state that affects ITS rendering changed.
  if (prev.isLast !== next.isLast) return false;
  // comment identity / mutation
  if (prev.comment.id !== next.comment.id) return false;
  if (prev.comment.updated_at !== next.comment.updated_at) return false;
  if (prev.comment.reactions !== next.comment.reactions) return false;
  if (prev.comment.userReaction !== next.comment.userReaction) return false;
  if (prev.comment.repliesCount !== next.comment.repliesCount) return false;
  if (prev.comment.content !== next.comment.content) return false;
  if (prev.comment.is_spoiler !== next.comment.is_spoiler) return false;
  if (prev.comment.is_edited !== next.comment.is_edited) return false;
  if (prev.comment.is_admin !== next.comment.is_admin) return false;
  // user identity
  if (prev.profileId !== next.profileId) return false;
  if (prev.isAdmin !== next.isAdmin) return false;
  if (prev.isAuthenticated !== next.isAuthenticated) return false;
  // edit state — only relevant if WE are the one being edited (prev or next)
  const editingMatters =
    prev.editingComment === prev.comment.id ||
    next.editingComment === next.comment.id ||
    (prev.editingReply !== null && (prev.replies?.some(r => r.id === prev.editingReply))) ||
    (next.editingReply !== null && (next.replies?.some(r => r.id === next.editingReply)));
  if (editingMatters) {
    if (prev.editingComment !== next.editingComment) return false;
    if (prev.editingReply !== next.editingReply) return false;
    if (prev.editContent !== next.editContent) return false;
    if (prev.editIsSpoiler !== next.editIsSpoiler) return false;
  }
  // reply form state — only relevant if replyingTo targets this comment
  const replyingMatters =
    prev.replyingTo?.commentId === prev.comment.id ||
    next.replyingTo?.commentId === next.comment.id;
  if (replyingMatters) {
    if (prev.replyingTo !== next.replyingTo) return false;
    if (prev.replyContent !== next.replyContent) return false;
    if (prev.isReplySpoiler !== next.isReplySpoiler) return false;
  }
  // replies array reference
  if (prev.replies !== next.replies) return false;
  if (prev.expanded !== next.expanded) return false;
  if (prev.repliesHasMore !== next.repliesHasMore) return false;
  if (prev.repliesTotalCount !== next.repliesTotalCount) return false;
  // sets — these mutate by reference on every parent change, but we only
  // care if WE have an entry in them
  const myKey = `comment-${prev.comment.id}`;
  if (prev.deletingIds.has(prev.comment.id) !== next.deletingIds.has(next.comment.id)) return false;
  if (prev.deletedIds.has(prev.comment.id) !== next.deletedIds.has(next.comment.id)) return false;
  if (prev.revealedSpoilers.has(myKey) !== next.revealedSpoilers.has(myKey)) return false;
  if (prev.reportedIds.has(myKey) !== next.reportedIds.has(myKey)) return false;
  // for replies' membership in those sets, only check if we have replies
  if (prev.replies && prev.replies.length > 0) {
    for (const r of prev.replies) {
      if (prev.deletingIds.has(r.id) !== next.deletingIds.has(r.id)) return false;
      if (prev.deletedIds.has(r.id) !== next.deletedIds.has(r.id)) return false;
      const rk = `reply-${r.id}`;
      if (prev.revealedSpoilers.has(rk) !== next.revealedSpoilers.has(rk)) return false;
      if (prev.reportedIds.has(rk) !== next.reportedIds.has(rk)) return false;
    }
  }
  // turnstile only matters if reply form is open for this comment
  if (replyingMatters) {
    if (prev.turnstileToken !== next.turnstileToken) return false;
  }
  return true;
}
