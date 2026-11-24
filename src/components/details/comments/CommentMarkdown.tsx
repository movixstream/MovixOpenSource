import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkEmoji from 'remark-emoji';
import { useSafeRemarkGfm } from '@/utils/markdownPlugins';
import { commentMarkdownComponents } from './markdownComponents';

/**
 * Texte d'un commentaire ou d'une réponse. Mémorisé : l'analyse du Markdown ne
 * se refait pas quand la ligne se redessine pour une autre raison.
 */
export const CommentMarkdown = memo(function CommentMarkdown({ children }: { children: string }) {
  const safeRemarkGfm = useSafeRemarkGfm();
  const plugins = useMemo(() => (safeRemarkGfm ? [safeRemarkGfm, remarkEmoji] : [remarkEmoji]), [safeRemarkGfm]);
  return (
    <ReactMarkdown remarkPlugins={plugins} components={commentMarkdownComponents}>
      {children}
    </ReactMarkdown>
  );
});

export default CommentMarkdown;
