import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

const TelegramPromotion: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="px-5 md:px-10">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-6 sm:py-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-sky-500 text-white" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" className="h-6 w-6" viewBox="0 0 24 24">
            <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19l-9.48 5.99-4.1-1.28c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3L18.24 18.8c-.19.92-.73 1.14-1.48.71l-4.14-3.06-1.99 1.93c-.23.23-.42.42-.85.42z" />
          </svg>
        </div>

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

        <a
          href="https://t.me/ix_annonces"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('telegram.joinTelegram')}
          className="col-start-2 inline-flex min-h-11 items-center justify-center justify-self-start rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black motion-reduce:transition-none sm:col-start-auto sm:justify-self-end"
        >
          {t('telegram.joinTelegram')}
        </a>
      </div>
    </div>
  );
};

export default TelegramPromotion;
