import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Film, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface DetailsVideoModalProps {
  /** Fenêtre ouverte. */
  open: boolean;
  /** Vrai pendant l'animation de fermeture (la page démonte la fenêtre 300 ms après). */
  closing?: boolean;
  title: string;
  /** Identifiant YouTube ; absent, la fenêtre affiche `emptyLabel`. */
  videoKey?: string | null;
  emptyLabel?: string;
  onClose: () => void;
}

/** Fenêtre de lecture d'une vidéo YouTube : bande-annonce, extrait, coulisses. */
export function DetailsVideoModal({ open, closing = false, title, videoKey, emptyLabel, onClose }: DetailsVideoModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <AnimatePresence mode="wait">
      {!closing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/90 p-2 sm:p-4"
          data-lenis-prevent
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-gray-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2 pl-4 pr-2">
              <h3 className="min-w-0 truncate text-base font-semibold text-white md:text-lg">{title}</h3>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close')}
                className="group flex size-11 flex-none items-center justify-center rounded-full transition-colors duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-[0.98] motion-reduce:transition-none"
              >
                <X aria-hidden="true" className="size-5 text-white opacity-70 transition-opacity duration-200 group-hover:opacity-100" />
              </button>
            </div>
            {videoKey ? (
              <iframe
                src={`https://www.youtube.com/embed/${videoKey}?autoplay=1`}
                title={title}
                className="block aspect-video max-h-[calc(100vh-7rem)] w-full"
                allowFullScreen
                allow="autoplay"
              />
            ) : (
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-3">
                <Film aria-hidden="true" className="size-12 text-white opacity-40" />
                <p className="text-base text-white/60">{emptyLabel}</p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default DetailsVideoModal;
