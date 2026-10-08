import { useEffect, useMemo, useState, Fragment } from 'react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { ExternalLink, ArrowRight, Search, X } from 'lucide-react';
import { SquareBackground } from '../../components/ui/square-background';
import ShinyText from '../../components/ui/shiny-text';
import { TUTO_REGISTRY, TutoAccent } from './tutoRegistry';

/** Tailwind class helpers keyed by accent color */
const ACCENT_BORDER: Record<TutoAccent, string> = {
  red: 'border-red-500/20 group-hover:border-red-500/50',
  blue: 'border-blue-500/20 group-hover:border-blue-500/50',
  green: 'border-green-500/20 group-hover:border-green-500/50',
  orange: 'border-orange-500/20 group-hover:border-orange-500/50',
  purple: 'border-purple-500/20 group-hover:border-purple-500/50',
};
const ACCENT_TEXT: Record<TutoAccent, string> = {
  red: 'text-red-400',
  blue: 'text-blue-400',
  green: 'text-green-400',
  orange: 'text-orange-400',
  purple: 'text-purple-400',
};

interface Match {
  key: string;
  text: string;
}

interface Result {
  slug: string;
  titleKey: string;
  subKey: string;
  icon: React.ReactElement;
  accent: TutoAccent;
  /** First matched occurrence outside of title/sub — used for the "found in" snippet */
  firstBodyMatch: Match | null;
}

/**
 * Strips i18next numeric-placeholder tags like `<1>…</1>` from a resolved
 * translation so the inner text remains but the markup is gone. Without this,
 * search results would show raw "…le <1>FAI</1> ment…" snippets.
 */
const stripTransTags = (text: string): string =>
  text.replace(/<\/?\d+>/g, '');

/**
 * Extracts a short snippet around the first occurrence of `query` in `text`.
 * Returns text with an ellipsis prefix/suffix when the match is not at the
 * extremities.
 */
const extractSnippet = (text: string, query: string, radius = 40): string => {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end) + suffix;
};

/**
 * Splits `text` at all case-insensitive occurrences of `query` and renders
 * the matched parts with a highlight span. Safe against regex-special chars
 * in the query.
 */
const renderHighlighted = (text: string, query: string) => {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark
        key={i}
        className="bg-red-500/30 text-red-100 rounded-sm px-0.5 font-semibold"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
};

const HelpHubPage: React.FC = () => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const currentLang = i18n.language;

  useEffect(() => {
    document.title = `${t('help.hub.title')} — Movix`;
  }, [t]);

  const results: Result[] = useMemo(() => {
    const q = query.trim();
    return TUTO_REGISTRY.map((tuto) => {
      if (!q) {
        return {
          slug: tuto.slug,
          titleKey: tuto.titleKey,
          subKey: tuto.subKey,
          icon: tuto.icon,
          accent: tuto.accent,
          firstBodyMatch: null,
        };
      }

      const allKeys = [tuto.titleKey, tuto.subKey, ...tuto.searchKeys];
      const matches: Match[] = [];
      for (const key of allKeys) {
        const text = stripTransTags(String(t(key)));
        if (text.toLowerCase().includes(q.toLowerCase())) {
          matches.push({ key, text });
        }
      }

      if (matches.length === 0) return null;

      const firstBodyMatch =
        matches.find(
          (m) => m.key !== tuto.titleKey && m.key !== tuto.subKey
        ) ?? null;

      return {
        slug: tuto.slug,
        titleKey: tuto.titleKey,
        subKey: tuto.subKey,
        icon: tuto.icon,
        accent: tuto.accent,
        firstBodyMatch,
      };
    }).filter((r): r is Result => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, currentLang, t]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <SquareBackground className="min-h-screen">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-4xl mx-auto px-4 sm:px-6 py-10"
      >
        <motion.header variants={itemVariants} className="mb-8 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            <ShinyText
              text={t('help.hub.title')}
              color="#ffffff"
              shineColor="#ef4444"
              speed={3}
            />
          </h1>
          <p className="text-lg text-zinc-300">{t('help.hub.heroSub')}</p>
        </motion.header>

        <motion.div variants={itemVariants} className="mb-8">
          <div className="relative max-w-xl mx-auto">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('help.hub.searchPlaceholder')}
              aria-label={t('help.hub.searchPlaceholder')}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-10 py-3 text-white placeholder:text-zinc-500 outline-none focus:border-red-500/60 focus:bg-white/[0.06] transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('help.hub.clearSearch')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </motion.div>

        {results.length === 0 ? (
          <motion.p
            variants={itemVariants}
            className="text-center text-zinc-400 py-10"
          >
            {t('help.hub.noResults')}
          </motion.p>
        ) : (
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10"
          >
            {results.map((r) => (
              <Link
                key={r.slug}
                to={`/help/${r.slug}`}
                className={`group rounded-xl border bg-white/[0.03] hover:bg-white/[0.06] p-5 transition-colors ${ACCENT_BORDER[r.accent]}`}
              >
                <div className="flex items-start gap-3 mb-2">
                  <span className={ACCENT_TEXT[r.accent]}>{r.icon}</span>
                  <h2 className="text-lg font-bold text-white flex-1 pt-1">
                    {renderHighlighted(String(t(r.titleKey)), query)}
                  </h2>
                  <ArrowRight
                    className="w-5 h-5 text-zinc-500 group-hover:text-white transition-colors shrink-0 mt-1"
                    aria-hidden="true"
                  />
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {renderHighlighted(String(t(r.subKey)), query)}
                </p>
                {r.firstBodyMatch && query && (
                  <p className="mt-3 text-xs text-zinc-500 leading-relaxed border-t border-white/5 pt-2">
                    <span className="text-zinc-400 font-semibold">
                      {t('help.hub.foundIn')}
                    </span>{' '}
                    <span className="italic">
                      {renderHighlighted(
                        extractSnippet(r.firstBodyMatch.text, query),
                        query
                      )}
                    </span>
                  </p>
                )}
              </Link>
            ))}
          </motion.div>
        )}

        <motion.div
          variants={itemVariants}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center"
        >
          <p className="text-sm text-zinc-300 mb-3">
            {t('help.hub.bottomCta')}
          </p>
          <a
            href={import.meta.env.VITE_SUPPORT_TELEGRAM_URL || 'https://t.me/ix_annonces'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-sm transition-colors"
          >
            {t('help.common.contactTelegram')}
            <ExternalLink className="w-4 h-4" />
          </a>
        </motion.div>
      </motion.div>
    </SquareBackground>
  );
};

export default HelpHubPage;
