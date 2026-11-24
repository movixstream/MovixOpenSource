import { Fragment, memo, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, Heart, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { areCommentItemPropsEqual, type CommentItemProps } from '@/components/comments/commentItem';
import { cn } from '@/lib/utils';
import { CommentAvatar } from './CommentAvatar';
import { CommentBox } from './CommentBox';
import { CommentMarkdown } from './CommentMarkdown';

/** Action sous un commentaire : texte discret, zone tactile de 44 px sans grossir la ligne. */
const ACTION = cn(
  'group relative inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 font-medium text-white/60',
  "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
  'transition-colors duration-200 hover:bg-white/10 hover:text-white motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none',
);

const BADGES = {
  admin: 'border-red-500/40 bg-red-600/25 text-red-200',
  vip: 'border-yellow-500/30 bg-yellow-500/25 text-yellow-300',
} as const;

function AuthorBadge({ tone, children }: { tone: keyof typeof BADGES; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-[18px] flex-none items-center rounded-full border px-1.5 text-[10px] font-bold uppercase tracking-[0.06em]', BADGES[tone])}>
      {children}
    </span>
  );
}

/** Date au format ISO pour `<time>` ; rien si l'horodatage est illisible. */
const isoDate = (timestamp: number) => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

interface EntryProps {
  /** `md` : commentaire. `sm` : réponse dans un fil. */
  size: 'md' | 'sm';
  username: string;
  avatar: string | null;
  createdAt: number;
  date: string;
  admin: boolean;
  vip: boolean;
  edited: boolean;
  /** Pseudo auquel répond une réponse à une autre réponse. */
  mention?: string | null;
  content: string;
  /** Spoiler encore masqué : le texte est flouté jusqu'au clic. */
  spoilerHidden: boolean;
  /** Spoiler repéré par l'IA : l'étiquette le dit. */
  spoilerAuto?: boolean;
  onReveal: () => void;
  /** `pending` : envoi en cours, les actions attendent l'identifiant du serveur. */
  state: 'idle' | 'pending' | 'deleting' | 'deleted';
  deletedLabel: string;
  reactions: number;
  reacted: boolean;
  onReact?: () => void;
  repliesCount?: number;
  repliesExpanded?: boolean;
  onToggleReplies?: () => void;
  onReply?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
  reported: boolean;
  /** Fil des réponses, sous les actions. */
  children?: ReactNode;
}

/** Un commentaire ou une réponse : vignette, auteur, texte, actions. */
function Entry({
  size, username, avatar, createdAt, date, admin, vip, edited, mention, content, spoilerHidden, spoilerAuto = false, onReveal,
  state, deletedLabel, reactions, reacted, onReact, repliesCount = 0, repliesExpanded = false,
  onToggleReplies, onReply, onDelete, onReport, reported, children,
}: EntryProps) {
  const { t } = useTranslation();
  const small = size === 'sm';

  const revealOnKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onReveal();
  };

  return (
    <div
      aria-busy={state === 'deleting' || undefined}
      className={cn(
        'flex transition-opacity duration-200 motion-reduce:transition-none',
        small ? 'gap-2.5 md:gap-3' : 'gap-3 md:gap-3.5',
        state === 'deleting' && 'pointer-events-none opacity-50',
      )}
    >
      <CommentAvatar name={username} src={avatar} size={size} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <b className="max-w-full truncate text-sm font-semibold leading-5 text-white">{username}</b>
          {admin && <AuthorBadge tone="admin">Admin</AuthorBadge>}
          {vip && <AuthorBadge tone="vip">VIP</AuthorBadge>}
          <time dateTime={isoDate(createdAt)} className="whitespace-nowrap text-xs text-white/55 md:text-[13px]">{date}</time>
          {mention && (
            <span className="max-w-full truncate text-xs text-white/55 md:text-[13px]">
              <span aria-hidden="true">→ </span>
              <span className="font-medium text-white/80">@{mention}</span>
            </span>
          )}
          {edited && <span className="whitespace-nowrap text-xs text-white/45">{t('comments.edited')}</span>}
        </div>

        {state === 'deleted' ? (
          <p className="mt-1 text-sm italic text-white/55">{deletedLabel}</p>
        ) : (
          <>
            {/* Le flou est sur le bloc intérieur : l'anneau de focus reste net. */}
            <div
              role={spoilerHidden ? 'button' : undefined}
              tabIndex={spoilerHidden ? 0 : undefined}
              aria-label={spoilerHidden ? t('comments.revealSpoiler') : undefined}
              title={spoilerHidden ? t('comments.clickToReveal') : undefined}
              onClick={spoilerHidden ? onReveal : undefined}
              onKeyDown={spoilerHidden ? revealOnKey : undefined}
              className={cn(
                'max-w-[62ch] rounded-md',
                small ? 'mt-0.5' : 'mt-[3px] md:mt-1',
                spoilerHidden && 'group/spoiler cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
              )}
            >
              <div
                className={cn(
                  'break-words text-sm leading-[1.55] text-white/[.88] transition-[filter] duration-300 motion-reduce:transition-none',
                  !small && 'md:text-[15px]',
                  spoilerHidden && 'blur-[7px] group-hover/spoiler:blur-[5px] [&_a]:pointer-events-none',
                )}
              >
                <CommentMarkdown>{content}</CommentMarkdown>
              </div>
            </div>
            {spoilerHidden && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-white/60">
                <AlertTriangle aria-hidden="true" className="size-3.5 flex-none text-red-400" />
                {t(spoilerAuto ? 'comments.spoilerAutoContent' : 'comments.spoilerContent')}
              </p>
            )}

            <div
              className={cn(
                '-ml-2 mt-1 flex flex-wrap items-center gap-x-0.5 text-xs md:mt-1.5 md:text-[13px]',
                state === 'pending' && 'pointer-events-none opacity-50',
              )}
            >
              <button
                type="button"
                onClick={onReact}
                disabled={!onReact}
                aria-pressed={reacted}
                aria-label={t('comments.reactionsCount', { count: reactions })}
                className={cn(ACTION, reacted && 'text-white')}
              >
                <Heart
                  aria-hidden="true"
                  className={cn(
                    'size-[15px] transition-[opacity,transform] duration-200 group-active:scale-90 motion-reduce:transition-none motion-reduce:group-active:scale-100',
                    reacted ? 'fill-current text-red-500' : 'text-white opacity-60 group-hover:opacity-100',
                  )}
                />
                <span className="tabular-nums">{reactions}</span>
              </button>
              {onToggleReplies && repliesCount > 0 && (
                <button type="button" onClick={onToggleReplies} aria-expanded={repliesExpanded} className={cn(ACTION, repliesExpanded && 'text-white')}>
                  {t('comments.repliesCount', { count: repliesCount })}
                </button>
              )}
              {onReply && (
                <button type="button" onClick={onReply} className={ACTION}>{t('comments.reply')}</button>
              )}
              {onDelete && (
                <button type="button" onClick={onDelete} className={cn(ACTION, 'hover:text-red-400')}>{t('common.delete')}</button>
              )}
              {onReport && !reported && (
                <button type="button" onClick={onReport} className={ACTION}>{t('comments.report')}</button>
              )}
              {reported && (
                <span className="inline-flex h-8 items-center px-2 font-medium text-white/40">{t('comments.reported')}</span>
              )}
            </div>
            {children}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Ligne d'un commentaire des fiches, avec son fil de réponses. Mêmes données
 * que l'ancien habillage (`CommentItemProps`) ; mémorisée de la même façon.
 */
export const CommentRow = memo(function CommentRow({
  comment, isAuthenticated, isAdmin, profileId, replyingTo, replyContent, isReplySpoiler, replyTextareaRef,
  replies, expanded, repliesHasMore, repliesTotalCount, deletingIds, deletedIds, revealedSpoilers, reportedIds,
  turnstileToken, turnstileSiteKey, formatDate, onReaction, onToggleReplies, onRevealSpoiler,
  onRequestDeleteComment, onRequestDeleteReply, onPostReply, onLoadMoreReplies, setReplyingTo, setReplyContent,
  setIsReplySpoiler, setReportModal,
}: CommentItemProps) {
  const { t } = useTranslation();
  const target = replyingTo?.commentId === comment.id ? replyingTo : null;
  const deleted = deletedIds.has(comment.id);
  const shownReplies = replies ?? [];

  const stateOf = (id: number) => {
    if (deletedIds.has(id)) return 'deleted' as const;
    if (deletingIds.has(id)) return 'deleting' as const;
    return id < 0 ? 'pending' as const : 'idle' as const;
  };

  /** Ouvre le champ de réponse sur ce commentaire ou l'une de ses réponses ; un second clic le referme. */
  const toggleReplyBox = (username: string, replyId?: number) => {
    if (target && target.replyId === replyId) {
      setReplyingTo(null);
      return;
    }
    setReplyingTo({ commentId: comment.id, replyId, username });
    if (!expanded) onToggleReplies(comment.id);
  };

  const replyBox = target && (
    <CommentBox
      variant="reply"
      textareaRef={replyTextareaRef}
      value={replyContent}
      onChange={setReplyContent}
      placeholder={t('comments.writeReply')}
      label={t('comments.writeReply')}
      spoiler={isReplySpoiler}
      onSpoilerChange={setIsReplySpoiler}
      submitLabel={t('comments.reply')}
      onSubmit={() => onPostReply(comment.id, target.replyId, target.username)}
      disabled={!!turnstileSiteKey && !turnstileToken}
      header={(
        <div className="mb-2 flex items-center justify-between gap-3 text-[13px] text-white/60">
          <span className="min-w-0 truncate">
            {t('comments.replyTo')} <b className="font-semibold text-white">@{target.username}</b>
          </span>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            aria-label={t('common.close')}
            className="group -m-2 flex size-9 flex-none items-center justify-center rounded-full transition-colors duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
          >
            <X aria-hidden="true" className="size-4 text-white opacity-60 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none" />
          </button>
        </div>
      )}
    />
  );

  return (
    <li className="border-b border-white/[.12] py-4 duration-300 animate-in fade-in-0 first:pt-0 motion-reduce:animate-none md:py-[18px]">
      <Entry
        size="md"
        username={comment.username}
        avatar={comment.avatar}
        createdAt={comment.created_at}
        date={formatDate(comment.created_at)}
        admin={comment.is_admin === 1}
        vip={comment.is_vip === 1}
        edited={comment.is_edited === 1}
        content={comment.content}
        spoilerHidden={comment.is_spoiler === 1 && !revealedSpoilers.has(`comment-${comment.id}`)}
        spoilerAuto={comment.spoiler_auto === 1}
        onReveal={() => onRevealSpoiler('comment', comment.id)}
        state={stateOf(comment.id)}
        deletedLabel={t('comments.commentDeleted')}
        reactions={comment.reactions}
        reacted={comment.userReaction === true}
        onReact={isAuthenticated ? () => onReaction('comment', comment.id) : undefined}
        repliesCount={comment.repliesCount}
        repliesExpanded={expanded}
        onToggleReplies={() => onToggleReplies(comment.id)}
        onReply={isAuthenticated ? () => toggleReplyBox(comment.username) : undefined}
        onDelete={isAdmin || (profileId && profileId === comment.profile_id) ? () => onRequestDeleteComment(comment.id) : undefined}
        onReport={isAuthenticated && profileId !== comment.profile_id
          ? () => setReportModal({ targetType: 'comment', targetId: comment.id })
          : undefined}
        reported={reportedIds.has(`comment-${comment.id}`)}
      >
        {expanded && !deleted && (target || shownReplies.length > 0) && (
          <div className="mt-2 space-y-3.5 border-l border-white/[.12] pl-3.5 duration-200 animate-in fade-in-0 slide-in-from-top-1 motion-reduce:animate-none md:mt-2.5 md:space-y-4 md:pl-4">
            {target && !target.replyId && replyBox}
            {shownReplies.map((reply) => (
              <Fragment key={reply.id}>
                <Entry
                  size="sm"
                  username={reply.username}
                  avatar={reply.avatar}
                  createdAt={reply.created_at}
                  date={formatDate(reply.created_at)}
                  admin={reply.is_admin === 1}
                  vip={reply.is_vip === 1}
                  edited={reply.is_edited === 1}
                  mention={reply.parent_reply_id ? reply.reply_to_username : null}
                  content={reply.content}
                  spoilerHidden={reply.is_spoiler === 1 && !revealedSpoilers.has(`reply-${reply.id}`)}
                  spoilerAuto={reply.spoiler_auto === 1}
                  onReveal={() => onRevealSpoiler('reply', reply.id)}
                  state={stateOf(reply.id)}
                  deletedLabel={t('comments.replyDeleted')}
                  reactions={reply.reactions}
                  reacted={reply.userReaction === true}
                  onReact={isAuthenticated ? () => onReaction('reply', reply.id) : undefined}
                  onReply={isAuthenticated ? () => toggleReplyBox(reply.username, reply.id) : undefined}
                  onDelete={isAdmin || (profileId && profileId === reply.profile_id) ? () => onRequestDeleteReply(reply.id, comment.id) : undefined}
                  onReport={isAuthenticated && profileId !== reply.profile_id
                    ? () => setReportModal({ targetType: 'reply', targetId: reply.id })
                    : undefined}
                  reported={reportedIds.has(`reply-${reply.id}`)}
                />
                {target && target.replyId === reply.id && replyBox}
              </Fragment>
            ))}
            {repliesHasMore && (
              <button type="button" onClick={() => onLoadMoreReplies(comment.id)} className={cn(ACTION, '-ml-2 text-xs md:text-[13px]')}>
                {t('comments.showMore', { count: Math.max(0, repliesTotalCount - shownReplies.length) })}
              </button>
            )}
          </div>
        )}
      </Entry>
    </li>
  );
}, areCommentItemPropsEqual);

export default CommentRow;
