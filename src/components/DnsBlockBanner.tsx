import { useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ShieldAlert, X } from 'lucide-react';
import FaiTooltip from './FaiTooltip';

// Flag module-level : persistent pour la durée du chargement de la page,
// wipé naturellement à chaque refresh (pas sessionStorage, qui persisterait
// à travers un reload). Matche le besoin "1 fois par chargement".
let dnsPopupDismissed = false;

const DOWNLOAD_URL = 'https://one.one.one.one/';
const HELP_PATH = '/help/dns';
const TOAST_ID = 'movix-dns-block';

const DnsBlockBanner: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    const dismiss = (id: string | number) => {
      dnsPopupDismissed = true;
      toast.dismiss(id);
    };

    const onBlocked = (ev: Event) => {
      if (dnsPopupDismissed) return;
      const detail = (ev as CustomEvent).detail || {};
      const wasSwitched: boolean = !!detail.switched;

      toast.custom(
        (id) => (
          <div
            role="alert"
            // select-none on wrapper so touchdown doesn't start a text
            // selection, which cancels Sonner's swipe-to-dismiss. The tooltip
            // trigger re-enables select via its own styling when needed.
            className="w-[min(92vw,420px)] flex gap-3 p-4 rounded-xl border border-red-500/50 bg-red-950/95 backdrop-blur-md shadow-2xl text-red-50 select-none"
          >
            <ShieldAlert
              className="w-5 h-5 text-red-300 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-bold text-sm leading-tight">
                  <Trans
                    i18nKey="dnsBlock.title"
                    components={{ 1: <FaiTooltip /> }}
                  />
                </h3>
                <button
                  type="button"
                  onClick={() => dismiss(id)}
                  aria-label={t('dnsBlock.closeAria')}
                  className="shrink-0 -mr-1 -mt-1 p-1 rounded text-red-200/70 hover:text-red-50 hover:bg-red-900/50 transition-colors group/icon"
                >
                  <X className="w-4 h-4 text-red-200 opacity-70 group-hover/icon:text-red-50 group-hover/icon:opacity-100 transition-[color,opacity]" />
                </button>
              </div>
              <p className="text-xs text-red-100/80 leading-relaxed mb-2">
                {t('dnsBlock.body')}
              </p>
              {wasSwitched && (
                <p className="text-xs text-red-200/90 italic leading-relaxed mb-3">
                  {t('dnsBlock.autoSwitched')}
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    window.open(DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
                    dismiss(id);
                  }}
                  className="flex-1 px-3 py-2 rounded-md bg-red-500 hover:bg-red-400 text-white font-semibold text-xs transition-colors"
                >
                  {t('dnsBlock.downloadCta')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigate(HELP_PATH);
                    dismiss(id);
                  }}
                  className="flex-1 px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-xs transition-colors"
                >
                  {t('dnsBlock.learnMoreCta')}
                </button>
              </div>
            </div>
          </div>
        ),
        {
          id: TOAST_ID,
          duration: Infinity,
          position: 'bottom-center',
          // unstyled=true drops Sonner's INTERNAL default styles, but the
          // classNames.toast defined in our Toaster wrapper (sonner.tsx)
          // still applies: bg-gray-900 + border-white/10 + shadow-lg +
          // rounded-xl. That dark-gray/bluish frame was showing behind
          // our custom red card. We override each one with !important via
          // Tailwind's `!` prefix. focus-* rules also kill the browser's
          // default blue focus ring on the <li tabIndex=0>.
          unstyled: true,
          className:
            '!bg-transparent !border-0 !shadow-none !p-0 focus:outline-none focus-visible:outline-none',
          onDismiss: () => {
            dnsPopupDismissed = true;
          },
          onAutoClose: () => {
            dnsPopupDismissed = true;
          },
        }
      );
    };

    window.addEventListener('movix:dns-blocked', onBlocked);
    return () => {
      window.removeEventListener('movix:dns-blocked', onBlocked);
    };
  }, [t, navigate]);

  return null;
};

export default DnsBlockBanner;
