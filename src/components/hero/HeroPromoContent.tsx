import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ExternalLink, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { cn } from '@/lib/utils';
import type { HeroPromoDisplay } from '@/hooks/useHeroPromos';
import { getHeroPromoGoUrl, trackHeroPromoClick } from '@/services/heroPromoService';
import { isMovixAppWebView } from '@/utils/wrappedShareFile';
import ShinyText from '../ui/shiny-text';
import { HERO_OVERVIEW_SLOT, HERO_TITLE_SLOT } from '../heroLayout';
import { getReadableTextColor } from './heroPromoStyle';

interface HeroPromoAdLabelProps {
  promo: HeroPromoDisplay;
}

/** Mention « Publicité » dans un coin haut de la bannière (si l'admin la garde). */
export const HeroPromoAdLabel: React.FC<HeroPromoAdLabelProps> = ({ promo }) => {
  const { t } = useTranslation();
  if (!promo.adLabel.show) return null;
  return (
    <span
      className={cn(
        'pointer-events-none absolute top-3 z-20 rounded-md border border-white/15 bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80 sm:top-4 sm:text-[11px]',
        promo.adLabel.position === 'top-left' ? 'left-3 sm:left-4' : 'right-3 sm:right-4'
      )}
    >
      {promo.texts.adLabel || t('heroPromo.slide.defaultAdLabel')}
    </span>
  );
};

interface HeroPromoCtaProps {
  promo: HeroPromoDisplay;
  className: string;
  style: React.CSSProperties;
  children: React.ReactNode;
  /** Aperçu de l'admin : bouton non cliquable, aucun clic compté. */
  preview?: boolean;
}

const HeroPromoCta: React.FC<HeroPromoCtaProps> = ({ promo, className, style, children, preview }) => {
  const track = () => trackHeroPromoClick(promo.id);

  // Aperçu de l'admin : simple bouton visuel, pour ne pas quitter le formulaire.
  if (preview) {
    return <span className={className} style={style}>{children}</span>;
  }

  // Page du site : navigation interne, le clic est compté à part (beacon).
  if (promo.internalLink && !promo.openInNewTab) {
    return (
      <Link to={promo.linkUrl} data-hero-cta onClick={track} className={className} style={style}>
        {children}
      </Link>
    );
  }

  // Autre site : comme la popup pub, on passe par le Main API, qui compte le
  // clic puis redirige vers le lien. Dans l'appli mobile, un autre site
  // s'ouvre dans le navigateur du système (nouvel onglet), jamais à la place
  // de Movix.
  const goUrl = promo.internalLink ? null : getHeroPromoGoUrl(promo.id);
  const newTab = promo.openInNewTab || (!promo.internalLink && isMovixAppWebView());
  const trackLocally = !goUrl;
  return (
    <a
      href={goUrl ?? promo.linkUrl}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer' : undefined}
      data-hero-cta
      onClick={trackLocally ? track : undefined}
      onAuxClick={trackLocally ? (event) => {
        if (event.button === 1) track();
      } : undefined}
      className={className}
      style={style}
    >
      {children}
    </a>
  );
};

interface HeroPromoContentProps {
  promo: HeroPromoDisplay;
  isActive: boolean;
  isMorph: boolean;
  frozen: boolean;
  preview?: boolean;
}

/** Contenu d'une slide promo : même mise en page que celle d'un film. */
export const HeroPromoContent: React.FC<HeroPromoContentProps> = ({ promo, isActive, isMorph, frozen, preview }) => {
  const { t } = useTranslation();
  const { texts, accentColor } = promo;
  const ctaTextColor = getReadableTextColor(accentColor);
  const external = !promo.internalLink || promo.openInNewTab;
  const CtaIcon = external ? ExternalLink : ArrowRight;

  return (
    <>
      <HeroPromoAdLabel promo={promo} />
      <div className="absolute inset-0 flex items-end md:items-center z-20">
        <div className="w-full md:max-w-2xl px-4 sm:px-6 md:px-12 pb-20 md:pb-16">
          <AnimatePresence mode="wait">
            {(isMorph || isActive) && (
              <motion.div
                key={`content-promo-${promo.id}`}
                initial={isMorph ? false : { opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={isMorph ? undefined : { opacity: 0 }}
                transition={isMorph ? { duration: 0 } : { duration: 0.5, delay: 0.1 }}
                data-hero-content
                className="space-y-3 sm:space-y-5"
              >
                {(texts.badge || texts.tagline) && (
                  <div className="flex flex-wrap gap-1.5 sm:gap-2 items-center">
                    {texts.badge && (
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full border text-white text-[10px] sm:text-xs font-semibold uppercase tracking-wider"
                        style={{ backgroundColor: `${accentColor}40`, borderColor: `${accentColor}80` }}
                      >
                        {texts.badge}
                      </span>
                    )}
                    {texts.tagline && (
                      <span className="inline-flex min-w-0 items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full bg-black/45 border border-white/15 text-white/90 text-[10px] sm:text-xs font-medium">
                        <Sparkles className="w-3 h-3 shrink-0" style={{ color: accentColor }} aria-hidden="true" />
                        <span className="truncate">{texts.tagline}</span>
                      </span>
                    )}
                  </div>
                )}

                <div className={HERO_TITLE_SLOT}>
                  {promo.logoUrl ? (
                    <img
                      src={promo.logoUrl}
                      alt={texts.title}
                      className="block object-contain object-left w-auto h-auto max-w-full max-h-[64px] sm:max-h-[80px] md:max-h-[110px] min-h-[40px] md:min-h-[56px]"
                      draggable={false}
                      loading={isActive ? 'eager' : 'lazy'}
                      decoding="async"
                    />
                  ) : (
                    <h1 className="text-2xl sm:text-3xl md:text-5xl lg:text-6xl font-bold leading-tight line-clamp-2">
                      <ShinyText
                        text={texts.title}
                        speed={4}
                        color="#ffffff"
                        shineColor={accentColor}
                        disabled={!isActive || frozen}
                      />
                    </h1>
                  )}
                </div>

                {texts.description && (
                  <p className={`${HERO_OVERVIEW_SLOT} text-white/80`}>{texts.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                    <HeroPromoCta
                      promo={promo}
                      preview={preview}
                      className="inline-flex items-center justify-center gap-2 px-5 sm:px-6 md:px-7 py-3 min-h-[48px] rounded-xl sm:rounded-2xl text-sm sm:text-base font-semibold shadow-lg transition-[filter] hover:brightness-110 touch-manipulation"
                      style={{ backgroundColor: accentColor, color: ctaTextColor }}
                    >
                      {texts.ctaLabel || t('heroPromo.slide.defaultCta')}
                      <CtaIcon className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                    </HeroPromoCta>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
};
