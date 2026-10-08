import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import groupeIxLogo from '@/assets/brand/groupe-ix.svg';
import { useIntro } from '../context/IntroContext';
import { readLocalStorage, writeLocalStorage } from '../utils/browserStorage';
import { getOverlayPortalRoot } from '../utils/overlayPortal';

export const IX_TELEGRAM_URL = 'https://t.me/ix_annonces';
// Une fois fermé ou suivi, le popup ne revient plus. Changer la clé pour
// le remontrer à tout le monde lors d'une prochaine annonce.
const SEEN_KEY = 'ix_telegram_announcement_seen_v1';
const SHOW_DELAY_MS = 1500;

interface TelegramAnnouncementPopupProps {
  /** Vrai là où le popup doit attendre : lecteur, Wrapped, OAuth, autre popup. */
  suspended: boolean;
}

/**
 * Popup d'arrivée qui annonce le nouveau canal Telegram du groupe ix. Il
 * attend la fin de l'intro et des routes suspendues avant de s'ouvrir.
 */
const TelegramAnnouncementPopup: React.FC<TelegramAnnouncementPopupProps> = ({ suspended }) => {
  const { t } = useTranslation();
  const { introCompleted } = useIntro();
  const [seen, setSeen] = useState(() => readLocalStorage(SEEN_KEY) === 'true');
  const [open, setOpen] = useState(false);
  const joinRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (seen || suspended || !introCompleted) return;
    const timer = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [seen, suspended, introCompleted]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setSeen(true);
    writeLocalStorage(SEEN_KEY, 'true');
  }, []);

  // Pendant l'ouverture : Échap ferme, la page ne défile plus et le bouton
  // principal prend le focus.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    joinRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, dismiss]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="ix-telegram-announcement"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) dismiss();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ix-telegram-announcement-title"
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 text-center shadow-2xl sm:p-8"
          >
            <button
              type="button"
              onClick={dismiss}
              aria-label={t('common.close')}
              className="absolute right-3 top-3 rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>

            <img src={groupeIxLogo} alt="" className="mx-auto mb-5 h-20 w-20" />

            <h2 id="ix-telegram-announcement-title" className="text-2xl font-bold text-white">
              {t('telegram.announcementTitle')}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-300 sm:text-base">
              <Trans t={t} i18nKey="telegram.announcementBody" components={{ strong: <strong className="text-white" /> }} />
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <a
                ref={joinRef}
                href={IX_TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={dismiss}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#229ED9] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#1a8abf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 shrink-0" aria-hidden="true">
                  <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19l-9.48 5.99-4.1-1.28c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3L18.24 18.8c-.19.92-.73 1.14-1.48.71l-4.14-3.06-1.99 1.93c-.23.23-.42.42-.85.42z" />
                </svg>
                {t('telegram.announcementJoin')}
              </a>
              <button
                type="button"
                onClick={dismiss}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white/10 px-5 py-3 font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {t('telegram.announcementLater')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    getOverlayPortalRoot(),
  );
};

export default TelegramAnnouncementPopup;
