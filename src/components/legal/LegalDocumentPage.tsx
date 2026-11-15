import React from 'react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { motion } from 'framer-motion';
import { ArrowLeft, CalendarDays, LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SEO from '../SEO';
import { SquareBackground } from '../ui/square-background';
import { SITE_URL } from '../../config/runtime';

type LegalActionVariant = 'primary' | 'secondary' | 'ghost';

export interface LegalAction {
  label: string;
  to?: string;
  href?: string;
  external?: boolean;
  variant?: LegalActionVariant;
}

export interface LegalSection {
  id: string;
  title: string;
  icon?: LucideIcon;
  paragraphs?: string[];
  bullets?: string[];
  note?: string;
}

interface LegalSupportCard {
  title: string;
  paragraphs: string[];
  actions?: LegalAction[];
}

interface LegalDocumentPageProps {
  title: string;
  eyebrow: string;
  lastUpdated: string;
  seoTitle: string;
  seoDescription: string;
  canonicalPath: string;
  heroIcon: LucideIcon;
  intro: string[];
  summaryItems: string[];
  sections: LegalSection[];
  supportCard?: LegalSupportCard;
  footerNote?: string;
}

const cardClass = 'rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md';

const actionClassMap: Record<LegalActionVariant, string> = {
  primary: 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-600/20',
  secondary: 'border border-white/15 bg-white/5 text-white hover:bg-white/10',
  ghost: 'text-white/70 hover:bg-white/5 hover:text-white',
};

const ActionLink: React.FC<LegalAction> = ({
  label,
  to,
  href,
  external = false,
  variant = 'secondary',
}) => {
  const className = `inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${actionClassMap[variant]}`;

  if (to) {
    return (
      <Link to={to} className={className}>
        {label}
      </Link>
    );
  }

  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className={className}
    >
      {label}
    </a>
  );
};

const LegalDocumentPage: React.FC<LegalDocumentPageProps> = ({
  title,
  eyebrow,
  lastUpdated,
  seoTitle,
  seoDescription,
  canonicalPath,
  heroIcon: HeroIcon,
  intro,
  summaryItems,
  sections,
  supportCard,
  footerNote,
}) => {
  const { t } = useTranslation();
  const canonical = canonicalPath.startsWith('http')
    ? canonicalPath
    : `${SITE_URL}${canonicalPath}`;

  return (
    <SquareBackground
      squareSize={48}
      borderColor="rgba(220, 38, 38, 0.12)"
      className="min-h-screen bg-black text-white"
    >
      <SEO
        title={seoTitle}
        description={seoDescription}
        canonical={canonical}
        ogUrl={canonical}
      />

      <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link to="/" className="inline-flex items-center text-white/50 hover:text-white transition-colors mb-8 group/icon">
          <ArrowLeft className="w-5 h-5 mr-2 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity]" />
          {t('legalDocument.backHome')}
        </Link>

        <div className="max-w-6xl mx-auto">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <motion.section
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              className={`${cardClass} p-6 sm:p-8`}
            >
              <div className="inline-flex items-center gap-3 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-200">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                  <HeroIcon className="h-5 w-5" />
                </span>
                <span className="font-medium">{eyebrow}</span>
              </div>

              <h1 className="mt-6 text-4xl sm:text-5xl font-black tracking-tight text-white">
                {title}
              </h1>

              <div className="mt-6 space-y-4 text-base leading-relaxed text-white/70">
                {intro.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </motion.section>

            <div className="space-y-6">
              <motion.aside
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className={`${cardClass} p-6`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">
                  {t('legalDocument.referenceVersion')}
                </p>

                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mt-0.5 rounded-full bg-red-500/10 p-2 text-red-400">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm text-white/45">{t('legalDocument.lastUpdatedLabel')}</p>
                    <p className="mt-1 text-base font-semibold text-white">{lastUpdated}</p>
                  </div>
                </div>

                <div className="mt-6">
                  <p className="text-sm font-semibold text-white">{t('legalDocument.summaryTitle')}</p>
                  <ul className="mt-3 space-y-3 text-sm text-white/65">
                    {summaryItems.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.aside>

              {supportCard && (
                <motion.aside
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 }}
                  className={`${cardClass} p-6`}
                >
                  <p className="text-lg font-semibold text-white">{supportCard.title}</p>
                  <div className="mt-3 space-y-3 text-sm leading-relaxed text-white/65">
                    {supportCard.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>

                  {supportCard.actions && supportCard.actions.length > 0 && (
                    <div className="mt-5 flex flex-wrap gap-3">
                      {supportCard.actions.map((action) => (
                        <ActionLink key={`${action.label}-${action.to || action.href}`} {...action} />
                      ))}
                    </div>
                  )}
                </motion.aside>
              )}
            </div>
          </div>

          <div className="mt-10 grid gap-4">
            {sections.map((section, index) => {
              const SectionIcon = section.icon;

              return (
                <motion.section
                  key={section.id}
                  id={section.id}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ delay: index * 0.03 }}
                  className={`${cardClass} p-6 sm:p-7`}
                >
                  <div className="flex items-start gap-4">
                    <div className="mt-1 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400">
                      {SectionIcon ? <SectionIcon className="h-5 w-5" /> : <span className="h-2.5 w-2.5 rounded-full bg-red-500" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <h2 className="text-2xl font-bold text-white">{section.title}</h2>

                      {section.paragraphs && section.paragraphs.length > 0 && (
                        <div className="mt-4 space-y-4 text-sm sm:text-[15px] leading-relaxed text-white/70">
                          {section.paragraphs.map((paragraph) => (
                            <p key={paragraph}>{paragraph}</p>
                          ))}
                        </div>
                      )}

                      {section.bullets && section.bullets.length > 0 && (
                        <ul className="mt-5 space-y-3 text-sm sm:text-[15px] leading-relaxed text-white/70">
                          {section.bullets.map((bullet) => (
                            <li key={bullet} className="flex items-start gap-3">
                              <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {section.note && (
                        <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm leading-relaxed text-red-100/90">
                          {section.note}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.section>
              );
            })}
          </div>

          {footerNote && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5 text-sm leading-relaxed text-white/55"
            >
              {footerNote}
            </motion.div>
          )}
        </div>
      </div>
    </SquareBackground>
  );
};

export default LegalDocumentPage;
