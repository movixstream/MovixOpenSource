import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, LayoutGroup, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { ArrowRight, BookOpen, Cast, Flame, Tv, type LucideIcon } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { cn } from '@/lib/utils';
import { TV_APP_DOWNLOADER_CODE } from '@/config/tvApp';
import { FocusBrackets } from './FocusBrackets';
import { DownloaderTarget, PathTrail } from './TvInstallVisuals';
import { useLabelList } from './useLabelList';
import { scrollToSection, TV_EASE } from './tvMotion';
import type { TvAppRelease } from './useTvAppRelease';

/*
 * Étapes d'installation en défilement collant, adaptées de « Sticky Scroll
 * Reveal » d'Aceternity UI (https://ui.aceternity.com/components/sticky-scroll-reveal,
 * registre https://ui.aceternity.com/registry/sticky-scroll-reveal.json,
 * relevé le 15/10/2026). Composant gratuit, licence Aceternity : usage libre
 * dans un produit final, pas de redistribution du composant seul.
 *
 * Adaptations pour Movix :
 * - défilement de la page (variante `target` indiquée dans la source) au lieu
 *   d'une boîte à défilement interne ;
 * - framer-motion 11 du projet ; étape active lue sur `scrollYProgress` comme
 *   dans l'original, mais par tranches égales au lieu du point le plus proche ;
 * - pas de dégradés de couleur : le panneau collant montre le chemin des menus,
 *   le code Downloader ou une vraie capture de l'appli ;
 * - l'étape en cours porte les crochets du logo, qui glissent d'une étape à
 *   l'autre ; sur téléphone, rien ne colle et chaque visuel suit son étape.
 */

export type TvDeviceId = 'fire' | 'google' | 'android';

const DEVICES: Array<{ id: TvDeviceId; icon: LucideIcon; guide: string }> = [
  { id: 'fire', icon: Flame, guide: '/help/fire-tv' },
  { id: 'google', icon: Cast, guide: '/help/google-tv' },
  { id: 'android', icon: Tv, guide: '/help/android-tv' },
];

const STEPS = ['downloader', 'unlock', 'code', 'install', 'open'] as const;
type StepId = (typeof STEPS)[number];

const DESKTOP_QUERY = '(min-width: 1024px)';

function useIsDesktop(): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_QUERY).matches
      : false
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setMatches(query.matches);
    update();
    if (query.addEventListener) {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return matches;
}

// ─── Choix de l'appareil (groupe de boutons radio) ──────────────────────────
interface DevicePickerProps {
  value: TvDeviceId;
  onChange: (next: TvDeviceId) => void;
}

function DevicePicker({ value, onChange }: DevicePickerProps) {
  const { t } = useTranslation();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveTo = (index: number) => {
    const next = (index + DEVICES.length) % DEVICES.length;
    onChange(DEVICES[next].id);
    refs.current[next]?.focus();
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(DEVICES.length - 1);
    }
  };

  return (
    <LayoutGroup id="tv-device-picker">
      <div
        role="radiogroup"
        aria-label={t('tvApp.install.deviceLegend')}
        className="grid gap-4 sm:grid-cols-3 sm:gap-5"
      >
        {DEVICES.map(({ id, icon: Icon }, index) => {
          const selected = id === value;
          return (
            <button
              key={id}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(id)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              className={cn(
                'relative flex h-full min-w-0 items-start gap-3.5 rounded-2xl p-4 text-left transition-colors sm:p-5',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                selected ? 'bg-white/[0.08]' : 'bg-white/[0.03] hover:bg-white/[0.06]',
              )}
            >
              {selected && <FocusBrackets layoutId="tv-device-focus" size="md" transition={{ duration: 0.35, ease: TV_EASE }} />}
              <span
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors',
                  selected ? 'bg-red-600 text-white' : 'bg-white/[0.06] text-zinc-300',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-bold text-white">{t(`tvApp.install.devices.${id}.name`)}</span>
                <span className="mt-1 block text-sm leading-snug text-zinc-400">{t(`tvApp.install.devices.${id}.models`)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

// ─── Visuel d'une étape ─────────────────────────────────────────────────────
interface StepVisualProps {
  step: StepId;
  device: TvDeviceId;
  calm: boolean;
  release: TvAppRelease;
}

function StepVisual({ step, device, calm, release }: StepVisualProps) {
  const { t } = useTranslation();
  const downloaderPath = useLabelList(`tvApp.install.paths.${device}.downloader`);
  const devModePath = useLabelList(`tvApp.install.paths.${device}.devMode`);
  const allowPath = useLabelList(`tvApp.install.paths.${device}.allow`);
  const installPath = useLabelList(`tvApp.install.paths.${device}.install`);

  switch (step) {
    case 'downloader':
      return (
        <div>
          <PathTrail items={downloaderPath} />
          <p className="mt-5 text-sm text-zinc-400">{t('tvApp.install.steps.downloader.caption')}</p>
        </div>
      );
    case 'unlock':
      return (
        <div className="space-y-6">
          <PathTrail items={devModePath} caption={t('tvApp.install.steps.unlock.devMode')} />
          <PathTrail items={allowPath} caption={t('tvApp.install.steps.unlock.allow')} />
          {device === 'android' && (
            <p className="text-sm text-zinc-400">{t('tvApp.install.steps.unlock.brandNote')}</p>
          )}
        </div>
      );
    case 'code':
      return <DownloaderTarget calm={calm} release={release} />;
    case 'install':
      return (
        <div>
          <PathTrail items={installPath} />
          <p className="mt-5 text-sm leading-relaxed text-zinc-400">
            {t(device === 'fire' ? 'tvApp.install.steps.install.noteFire' : 'tvApp.install.steps.install.notePlayProtect')}
          </p>
        </div>
      );
    case 'open':
      return (
        <div>
          <img
            src="/help/tv/accueil.webp"
            alt={t('tvApp.install.steps.open.alt')}
            width={1600}
            height={900}
            loading="lazy"
            decoding="async"
            className="aspect-video w-full rounded-xl object-cover ring-1 ring-white/10"
          />
          <a
            href="#relier"
            onClick={(event) => {
              event.preventDefault();
              scrollToSection('relier', calm);
            }}
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-zinc-950 transition-transform hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.98]"
          >
            {t('tvApp.install.steps.open.cta')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      );
    default:
      return null;
  }
}

// ─── Section ────────────────────────────────────────────────────────────────
interface TvInstallGuideProps {
  calm: boolean;
  release: TvAppRelease;
}

export function TvInstallGuide({ calm, release }: TvInstallGuideProps) {
  const { t } = useTranslation();
  const [device, setDevice] = useState<TvDeviceId>('fire');
  const [active, setActive] = useState(0);
  const isDesktop = useIsDesktop();
  const listRef = useRef<HTMLOListElement>(null);
  const hasCode = Boolean(TV_APP_DOWNLOADER_CODE?.trim());
  const guide = DEVICES.find((item) => item.id === device)?.guide ?? '/help';

  // Étape au niveau de la ligne des 55 % de l'écran : chaque étape occupe une
  // tranche égale de la progression.
  const { scrollYProgress } = useScroll({ target: listRef, offset: ['start 55%', 'end 55%'] });
  useMotionValueEvent(scrollYProgress, 'change', (latest) => {
    const next = Math.min(STEPS.length - 1, Math.max(0, Math.floor(latest * STEPS.length)));
    setActive((previous) => (previous === next ? previous : next));
  });

  const stepTitle = (step: StepId) => (
    step === 'code' && !hasCode ? t('tvApp.install.steps.code.titleNoCode') : t(`tvApp.install.steps.${step}.title`)
  );
  const stepBody = (step: StepId) => {
    if (step === 'code') return t(hasCode ? 'tvApp.install.steps.code.body' : 'tvApp.install.steps.code.bodyNoCode');
    if (step === 'open') return t('tvApp.install.steps.open.body');
    return t(`tvApp.install.steps.${step}.${device}`);
  };

  return (
    <div>
      <DevicePicker value={device} onChange={setDevice} />

      <div className="mt-5 flex flex-col gap-3 text-sm leading-relaxed text-zinc-400 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <p className="max-w-3xl">
          {t('tvApp.install.incompatible')} {t('tvApp.install.minimum')}
        </p>
        <Link
          to={guide}
          className="inline-flex shrink-0 items-center gap-2 font-semibold text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {t('tvApp.install.guide')}
        </Link>
      </div>

      <div className="mt-12 lg:mt-16 lg:grid lg:grid-cols-12 lg:gap-12">
        <LayoutGroup id="tv-install-steps">
          <ol ref={listRef} className="lg:col-span-5">
            {STEPS.map((step, index) => {
              const isActive = index === active;
              return (
                <li
                  key={step}
                  className="border-t border-white/10 py-8 first:border-t-0 first:pt-0 lg:flex lg:min-h-[52vh] lg:items-center lg:border-t-0 lg:py-0"
                >
                  <motion.div
                    className="w-full"
                    animate={{ opacity: isDesktop && !isActive ? 0.32 : 1 }}
                    transition={{ duration: calm ? 0 : 0.3, ease: 'easeOut' }}
                  >
                    <div className="relative inline-flex max-w-full items-center gap-3 py-1 pl-1 pr-2">
                      {isDesktop && isActive && (
                        <FocusBrackets layoutId="tv-step-focus" size="sm" transition={{ duration: 0.35, ease: TV_EASE }} />
                      )}
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular-nums',
                          isActive || !isDesktop ? 'bg-red-600 text-white' : 'bg-white/[0.08] text-zinc-300',
                        )}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <h3 className="text-xl font-bold leading-tight text-white sm:text-2xl">{stepTitle(step)}</h3>
                    </div>
                    <p className="mt-3 max-w-md text-base leading-relaxed text-zinc-300">{stepBody(step)}</p>
                    {!isDesktop && (
                      <div className="mt-6">
                        <StepVisual step={step} device={device} calm={calm} release={release} />
                      </div>
                    )}
                  </motion.div>
                </li>
              );
            })}
          </ol>
        </LayoutGroup>

        {/* Panneau collant : ordinateur seulement ; au téléphone, chaque visuel suit son étape. */}
        {isDesktop && (
          <div className="lg:col-span-7">
            <div className="sticky top-[max(7rem,calc(50vh-13rem))]">
              <div className="relative min-h-[22rem] overflow-hidden rounded-2xl bg-zinc-950/85 p-8 ring-1 ring-inset ring-white/10 backdrop-blur-sm">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={`${device}-${STEPS[active]}`}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: calm ? 0 : 0.28, ease: TV_EASE }}
                  >
                    <p className="mb-5 text-sm font-semibold text-zinc-400">{stepTitle(STEPS[active])}</p>
                    <StepVisual step={STEPS[active]} device={device} calm={calm} release={release} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TvInstallGuide;
