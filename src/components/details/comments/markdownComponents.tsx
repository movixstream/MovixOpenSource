import type { ReactNode } from 'react';
import type { Components } from 'react-markdown';

/** Un titre Markdown reste une ligne de texte en gras. */
const heading = ({ children }: { children?: ReactNode }) => (
  <p className="mb-1 font-semibold text-white">{children}</p>
);

/**
 * Rendu du Markdown d'un commentaire dans les fiches : blanc et filets, sans
 * bleu. Les images ne sont jamais affichées et les titres restent du texte.
 */
export const commentMarkdownComponents: Components = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children, className }) => (className?.includes('language-') ? (
    <pre className="my-1.5 overflow-x-auto rounded-lg bg-white/[.06] p-2.5 text-xs">
      <code className={className}>{children}</code>
    </pre>
  ) : (
    <code className="rounded bg-white/10 px-1 py-0.5 text-[0.85em] text-white">{children}</code>
  )),
  pre: ({ children }) => <>{children}</>,
  a: ({ href, children }) => {
    if (!href || !/^https?:\/\//i.test(href)) return <span className="break-all">{children}</span>;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-white underline decoration-white/40 underline-offset-2 transition-colors duration-200 hover:decoration-white motion-reduce:transition-none"
      >
        {children}
      </a>
    );
  },
  ul: ({ children }) => <ul className="my-1 ml-5 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 ml-5 list-decimal">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-white/25 pl-3 text-white/70">{children}</blockquote>
  ),
  del: ({ children }) => <del className="text-white/50 line-through">{children}</del>,
  img: () => null,
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
};
