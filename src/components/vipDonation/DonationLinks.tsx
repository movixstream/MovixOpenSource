import React from 'react';
import { useTranslation } from 'react-i18next';
import { FolderHeart, KeyRound, LifeBuoy } from 'lucide-react';

import { useVipModal } from '@/context/VipModalContext';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';

interface DonationLinksProps {
  matrixUrl: string;
  discordUrl: string | null;
}

const secondaryLinkClass = 'flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-sm font-medium leading-tight text-white/85 transition-colors duration-150 hover:border-white/20 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60';
const helpLinkClass = 'rounded font-medium text-white/80 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60';

// Liens sous la carte de don : historique des dons, activation d'une clé
// existante et aide. Gardés aussi quand les dons sont en pause.
const DonationLinks: React.FC<DonationLinksProps> = ({ matrixUrl, discordUrl }) => {
  const { t } = useTranslation();
  const { openVipModal } = useVipModal();

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Link to="/vip/invoices" className={secondaryLinkClass}>
          <FolderHeart className="h-4 w-4 shrink-0 text-yellow-400" aria-hidden="true" />
          {t('vipDonations.donate.links.myDonations')}
        </Link>
        <button type="button" onClick={openVipModal} className={secondaryLinkClass}>
          <KeyRound className="h-4 w-4 shrink-0 text-yellow-400" aria-hidden="true" />
          {t('vipDonations.donate.links.haveKey')}
        </button>
      </div>

      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-white/55">
        {/* Couleur pleine + opacité : en blanc translucide, les traits de la
            bouée se superposaient. */}
        <LifeBuoy className="h-4 w-4 shrink-0 text-white opacity-55" aria-hidden="true" />
        <span>{t('vipDonations.donate.links.help')}</span>
        <a href={matrixUrl} target="_blank" rel="noopener noreferrer" className={helpLinkClass}>
          {t('vipDonations.donate.links.matrix')}
        </a>
        {discordUrl && (
          <>
            <span aria-hidden="true">·</span>
            <a href={discordUrl} target="_blank" rel="noopener noreferrer" className={helpLinkClass}>
              {t('vipDonations.donate.links.discord')}
            </a>
          </>
        )}
      </p>
    </div>
  );
};

export default DonationLinks;
