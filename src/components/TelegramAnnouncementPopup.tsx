import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import groupeIxLogo from '@/assets/brand/groupe-ix.svg';
import { useIntro } from '../context/IntroContext';
import { readLocalStorage, writeLocalStorage } from '../utils/browserStorage';
import { getOverlayPortalRoot } from '../utils/overlayPortal';
import { IX_MATRIX_URL } from '@/config/community';
import { MatrixIcon } from './brand/MatrixIcon';

// Une fois fermé ou suivi, le popup ne revient plus. Changer la clé pour
// le remontrer à tout le monde lors d'une prochaine annonce.
const SEEN_KEY = 'ix_matrix_announcement_seen_v1';
const SHOW_DELAY_MS = 1500;

interface TelegramAnnouncementPopupProps {
  /** Vrai là où le popup doit attendre : lecteur, Wrapped, OAuth, autre popup. */
  suspended: boolean;
}

/**
 * Popup d'arrivée qui annonce le nouveau canal Matrix du groupe ix. Il
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
                href={IX_MATRIX_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={dismiss}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 font-semibold text-black transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <MatrixIcon className="h-5 w-5 shrink-0" />
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
