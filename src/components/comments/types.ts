/** Commentaire d'un film ou d'une série, tel que le renvoie `/api/comments`. */
export interface Comment {
  id: number;
  content_type: string;
  content_id: string;
  user_id: string;
  user_type: string;
  profile_id: string | null;
  username: string;
  avatar: string | null;
  content: string;
  is_spoiler: number;
  /** 1 quand c'est l'IA, et non l'auteur, qui a marqué le spoiler. */
  spoiler_auto?: number;
  is_vip: number;
  is_admin: number;
  is_edited: number;
  created_at: number;
  updated_at?: number;
  deleted: number;
  repliesCount: number;
  reactions: number;
  userReaction: boolean | null;
}

/** Réponse à un commentaire ; `parent_reply_id` la rattache à une autre réponse du fil. */
export interface Reply {
  id: number;
  comment_id: number;
  parent_reply_id: number | null;
  user_id: string;
  user_type: string;
  profile_id: string | null;
  username: string;
  avatar: string | null;
  reply_to_username: string | null;
  content: string;
  is_spoiler: number;
  /** 1 quand c'est l'IA, et non l'auteur, qui a marqué le spoiler. */
  spoiler_auto?: number;
  is_vip: number;
  is_admin: number;
  is_edited: number;
  created_at: number;
  updated_at?: number;
  deleted: number;
  reactions: number;
  userReaction: boolean | null;
}

/** Cible du formulaire de réponse : un commentaire, ou une réponse de son fil. */
export interface CommentReplyTarget {
  commentId: number;
  replyId?: number;
  username: string;
}

/** Commentaire ou réponse visé par un signalement. */
export interface CommentReportTarget {
  targetType: 'comment' | 'reply';
  targetId: number;
}
