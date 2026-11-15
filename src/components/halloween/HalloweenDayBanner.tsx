import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { isHalloweenDay } from '@/hooks/useHalloweenTheme';
import { readSessionStorage } from '@/utils/browserStorage';
import { Pumpkin } from './HalloweenIcons';

const DISMISS_KEY = 'halloween_day_banner_closed';

/**
 * Bandeau « Joyeux Halloween » posé au-dessus de la ligne de l'en-tête, le
 * 31 octobre seulement (heure locale), thème allumé ou non.
 *
 * Il ne se montre qu'en haut de page : dès qu'on défile, ou qu'un menu de
 * l'en-tête s'ouvre, il se replie pour rendre à l'en-tête ses 64 px habituels
 * (les panneaux mobiles et les pages sont calés dessus). La croix le ferme
 * jusqu'à la fin de la session.
 */
const HalloweenDayBanner = ({ hidden }: { hidden: boolean }) => {
  const { t } = useTranslation();
  const [closed, setClosed] = useState(() => readSessionStorage(DISMISS_KEY) === '1');
  const [atTop, setAtTop] = useState(() => typeof window === 'undefined' || window.scrollY < 8);

  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY < 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (closed || !isHalloweenDay()) return null;

  const open = atTop && !hidden;

  const close = () => {
    setClosed(true);
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* Préférence facultative. */ }
  };

  return (
    <div
      className={`relative z-20 grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}
      aria-hidden={!open}
    >
      <div className="overflow-hidden">
        <div className="relative flex h-7 items-center justify-center gap-2 bg-gradient-to-r from-[#2a0f3d] via-[#c2410c] to-[#2a0f3d] px-9 text-[13px] font-semibold text-orange-50 shadow-[0_1px_0_rgba(0,0,0,0.4)]">
          <Pumpkin className="h-3.5 w-[17px] shrink-0" />
          <span className="truncate">{t('header.halloweenDayBanner')}</span>
          <Pumpkin className="h-3.5 w-[17px] shrink-0" />
          <button
            type="button"
            onClick={close}
            tabIndex={open ? 0 : -1}
            aria-label={t('header.halloweenDayBannerClose')}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-orange-50 opacity-70 transition-opacity hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default HalloweenDayBanner;
