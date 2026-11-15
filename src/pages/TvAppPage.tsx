import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowDown, Download, History, QrCode } from 'lucide-react';
import { SquareBackground } from '@/components/ui/square-background';
import { BracketFocusTitle } from '@/components/tv/BracketFocusTitle';
import { TvScreensShowcase } from '@/components/tv/TvScreensShowcase';
import { TvDemoVideo } from '@/components/tv/TvDemoVideo';
import { TvInstallGuide } from '@/components/tv/TvInstallGuide';
import { TvLinkPanel } from '@/components/tv/TvLinkPanel';
import { TvAppFaq } from '@/components/tv/TvAppFaq';
import { useLabelList } from '@/components/tv/useLabelList';
import { useTvAppRelease } from '@/components/tv/useTvAppRelease';
import { scrollToSection, TV_EASE, useCalmMotion } from '@/components/tv/tvMotion';

// Sections atteignables par une ancre : le QR de la télé mène à /tv?code=…,
// redirigé ici vers #relier.
const ANCHORS = new Set(['installer', 'relier']);
// Après le retour en haut de page que le site fait à chaque changement de route.
const ANCHOR_DELAY_MS = 420;

const sectionClass = 'mx-auto max-w-6xl scroll-mt-24 px-4 pt-24 sm:px-6 sm:pt-32 lg:px-8';
const headingClass = 'text-3xl font-black leading-tight tracking-tight text-white focus:outline-none sm:text-4xl lg:text-5xl';
const introClass = 'mt-4 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg';

function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.5, ease: TV_EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const TvAppPage = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const calm = useCalmMotion();
  const release = useTvAppRelease();
  const titleWords = useLabelList('tvApp.hero.words');
  const words = titleWords.length > 0 ? titleWords : t('tvApp.hero.title').split(' ');

  useEffect(() => {
    document.title = t('tvApp.meta.title');
  }, [t]);

  // Arrivée par le QR (?code=…), par #installer ou par #relier : on descend à la section.
  useEffect(() => {
    const hash = location.hash.replace(/^#/, '');
    const hasCode = new URLSearchParams(location.search).has('code');
    const target = ANCHORS.has(hash) ? hash : hasCode ? 'relier' : null;
    if (!target) return undefined;
    const timer = window.setTimeout(() => scrollToSection(target, calm), ANCHOR_DELAY_MS);
    return () => window.clearTimeout(timer);
    // Une fois par navigation : `calm` ou la recherche ne doivent pas relancer le défilement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const pill = 'inline-flex h-12 items-center justify-center gap-2.5 rounded-full px-6 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.98]';

  return (
    // overflow-clip au lieu de overflow-hidden : même découpe du fond, sans
    // conteneur de défilement, sinon le panneau des étapes ne peut pas coller.
    <SquareBackground className="min-h-screen overflow-clip bg-black text-white">
      <div className="pb-28">
        <section className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12 lg:px-8 lg:pt-16">
          <BracketFocusTitle
            label={t('tvApp.hero.title')}
            words={words}
            calm={calm}
            className="text-[2.65rem] font-black leading-[1.08] tracking-tight text-white sm:text-6xl lg:text-7xl"
          />
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: TV_EASE }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-300 sm:text-xl"
          >
            {t('tvApp.hero.subtitle')}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25, ease: TV_EASE }}
            className="mt-8 flex flex-wrap gap-3"
          >
            <a
              href="#installer"
              onClick={(event) => {
                event.preventDefault();
                scrollToSection('installer', calm);
              }}
              className={`${pill} bg-white text-zinc-950 hover:bg-zinc-200`}
            >
              {t('tvApp.hero.install')}
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href={release.apkUrl}
              rel="noopener"
              className={`${pill} bg-white/10 text-white ring-1 ring-inset ring-white/15 hover:bg-white/15`}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('tvApp.hero.apk')}
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35, ease: TV_EASE }}
            className="mt-12 sm:mt-16"
          >
            <TvDemoVideo calm={calm} />
          </motion.div>
        </section>

        <section aria-labelledby="tv-screens-title" className={sectionClass}>
          <Reveal>
            <h2 id="tv-screens-title" className={headingClass}>{t('tvApp.screens.title')}</h2>
            <p className={introClass}>{t('tvApp.screens.subtitle')}</p>
          </Reveal>
          <div className="mt-10">
            <TvScreensShowcase calm={calm} />
          </div>
        </section>

        <section id="installer" aria-labelledby="tv-install-title" className={sectionClass}>
          <Reveal>
            <h2 id="tv-install-title" data-section-heading tabIndex={-1} className={headingClass}>
              {t('tvApp.install.title')}
            </h2>
            <p className={introClass}>{t('tvApp.install.subtitle')}</p>
          </Reveal>
          <div className="mt-10">
            <TvInstallGuide calm={calm} release={release} />
          </div>
        </section>

        <section id="relier" aria-labelledby="tv-link-title" className={sectionClass}>
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
            <Reveal className="lg:col-span-5">
              <h2 id="tv-link-title" data-section-heading tabIndex={-1} className={headingClass}>
                {t('tvApp.link.title')}
              </h2>
              <p className="mt-4 text-base leading-relaxed text-zinc-300 sm:text-lg">{t('tvApp.link.body')}</p>
              <ul className="mt-8 space-y-5 text-sm leading-relaxed text-zinc-400 sm:text-base">
                <li className="flex gap-3.5">
                  <History className="mt-0.5 h-5 w-5 shrink-0 text-zinc-300" aria-hidden="true" />
                  <span>{t('tvApp.link.sync')}</span>
                </li>
                <li className="flex gap-3.5">
                  <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-zinc-300" aria-hidden="true" />
                  <span>{t('tvApp.link.code')}</span>
                </li>
              </ul>
            </Reveal>
            <div className="lg:col-span-7">
              <div className="rounded-2xl bg-zinc-950/85 p-6 ring-1 ring-inset ring-white/10 backdrop-blur-sm sm:p-8">
                <TvLinkPanel calm={calm} />
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="tv-faq-title" className="mx-auto max-w-3xl px-4 pt-24 sm:px-6 sm:pt-32">
          <Reveal>
            <h2 id="tv-faq-title" className={headingClass}>{t('tvApp.faq.title')}</h2>
          </Reveal>
          <div className="mt-8">
            <TvAppFaq calm={calm} />
          </div>
        </section>
      </div>
    </SquareBackground>
  );
};

export default TvAppPage;
