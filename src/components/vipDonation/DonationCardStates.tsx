import React from 'react';
import { useTranslation } from 'react-i18next';
import { PauseCircle } from 'lucide-react';

// Squelette léger affiché dans la carte de don pendant le chargement des
// réglages : mêmes blocs que le formulaire, pour éviter un saut de mise en page.
export const DonationSkeleton: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div aria-busy="true" className="animate-pulse space-y-8">
      <span className="sr-only" role="status">{t('vipDonations.donate.loading')}</span>
      <div aria-hidden="true">
        <div className="h-4 w-20 rounded bg-white/[0.08]" />
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-[4.25rem] rounded-xl bg-white/[0.05]" />
          ))}
        </div>
        <div className="mt-4 h-12 rounded-xl bg-white/[0.05]" />
      </div>
      <div aria-hidden="true">
        <div className="h-4 w-32 rounded bg-white/[0.08]" />
        <div className="mt-3 space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-[4.25rem] rounded-xl bg-white/[0.05]" />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="h-12 rounded-xl bg-white/[0.08]" />
    </div>
  );
};

// Remplace la carte de don quand l'équipe a mis les dons en pause.
export const DonationPausedCard: React.FC<{ message: string }> = ({ message }) => {
  const { t } = useTranslation();
  const adminMessage = message.trim();

  return (
    <div className="rounded-[1.25rem] border border-white/10 bg-[#0c0c0c] p-6 text-center sm:p-8">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06] text-yellow-300">
        <PauseCircle className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-white">{t('vipDonations.donate.paused.title')}</h2>
      {adminMessage && (
        <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-white/75">{adminMessage}</p>
      )}
      <p className="mt-3 text-sm leading-6 text-white/55">{t('vipDonations.donate.paused.text')}</p>
    </div>
  );
};
