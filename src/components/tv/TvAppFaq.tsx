import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import AnimatedBorderCard from '@/components/ui/animated-border-card';
import { TV_EASE } from './tvMotion';

// Même accordéon que /extension et /top10 (AnimatedBorderCard + hauteur animée).
// Réponses courtes : le dépannage complet vit dans les guides du centre d'aide.
const FAQ_ITEMS = ['free', 'vip', 'update', 'playProtect', 'safe', 'unlink'] as const;

const GUIDES = [
  { to: '/help/fire-tv', labelKey: 'tvApp.install.devices.fire.name' },
  { to: '/help/google-tv', labelKey: 'tvApp.install.devices.google.name' },
  { to: '/help/android-tv', labelKey: 'tvApp.install.devices.android.name' },
];

export function TvAppFaq({ calm }: { calm: boolean }) {
  const { t } = useTranslation();
  const baseId = useId();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {FAQ_ITEMS.map((key, index) => {
        const isOpen = open === index;
        const buttonId = `${baseId}-q-${index}`;
        const panelId = `${baseId}-a-${index}`;
        return (
          <AnimatedBorderCard
            key={key}
            highlightColor="rgb(var(--movix-red-600))"
            backgroundColor="12 12 12"
            className="overflow-hidden"
          >
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : index)}
                className="flex w-full items-center justify-between gap-4 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
              >
                <span className="text-sm font-semibold text-white sm:text-base">{t(`tvApp.faq.items.${key}.q`)}</span>
                <motion.span
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: calm ? 0 : 0.2 }}
                  className="shrink-0"
                >
                  <ChevronDown className="h-5 w-5 text-white/60" aria-hidden="true" />
                </motion.span>
              </button>
            </h3>
            <motion.div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!isOpen}
              initial={false}
              animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
              transition={{ duration: calm ? 0 : 0.25, ease: TV_EASE }}
              className="overflow-hidden"
            >
              <div className="px-5 pb-5 text-sm leading-relaxed text-zinc-300">
                <p>{t(`tvApp.faq.items.${key}.a`)}</p>
                {key === 'playProtect' && (
                  <p className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                    {GUIDES.map((guide) => (
                      <Link
                        key={guide.to}
                        to={guide.to}
                        tabIndex={isOpen ? undefined : -1}
                        className="font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                      >
                        {t('tvApp.faq.guideLink', { device: t(guide.labelKey) })}
                      </Link>
                    ))}
                  </p>
                )}
              </div>
            </motion.div>
          </AnimatedBorderCard>
        );
      })}
    </div>
  );
}

export default TvAppFaq;
