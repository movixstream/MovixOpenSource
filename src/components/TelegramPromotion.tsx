import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import groupeIxLogo from '@/assets/brand/groupe-ix.svg';
import { IX_MATRIX_URL } from '@/config/community';
import { MatrixIcon } from './brand/MatrixIcon';

const TelegramPromotion: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="px-5 md:px-10">
      {/* Deux boutons à droite seulement en grand écran : avant, ils passent
          sous le texte pour lui laisser la largeur. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 rounded-xl border border-white/10 bg-white/5 p-4 sm:px-6 sm:py-5 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <img src={groupeIxLogo} alt="" className="h-12 w-12 rounded-lg" />

        <div className="min-w-0">
          <h2 className="text-base font-bold leading-snug text-white sm:text-lg">
            {t('telegram.joinCommunity')}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-400">
            <Trans t={t} i18nKey="telegram.officialAnnouncements" components={{ strong: <strong /> }} />
            <br />
            👉 <strong>{t('telegram.joinUsNow')}</strong>
          </p>
        </div>

        <div className="col-start-2 flex flex-wrap gap-2 lg:col-start-auto lg:justify-end">
          <a
            href={IX_MATRIX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors duration-150 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black motion-reduce:transition-none"
          >
            <MatrixIcon className="h-4 w-4 shrink-0" />
            {t('telegram.joinTelegram')}
          </a>
        </div>
      </div>
    </div>
  );
};

export default TelegramPromotion;
