import React from 'react';
import { useTranslation } from 'react-i18next';
import { HeartHandshake } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';

type CostItem = {
  key: string;
  amount: number;
  maxAmount?: number;
  currency: 'EUR' | 'USD';
  period?: 'month' | 'day';
  approximate?: boolean;
  noteKey?: string;
};

type CostSection = {
  key: string;
  items: CostItem[];
};

// Taux de référence BCE du 18 septembre 2026, figé pour cette estimation.
const USD_PER_EUR = 1.146;
const EXCHANGE_RATE_DATE = '2026-09-18';
const EXCHANGE_RATE_SOURCE = 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html';
const DAYS_PER_MONTH = 30;
const DOMAIN_COST = 5;
const AI_MIN_COST = 225;
const AI_MAX_COST = 275;
const AI_CRYPTO_FEES = 50;

const SECTIONS: CostSection[] = [
  {
    key: 'infrastructure',
    items: [
      { key: 'server', amount: 137.99, currency: 'EUR', period: 'month' },
      { key: 'frontendServer', amount: 1.34, currency: 'USD', period: 'day' },
      { key: 'proxies', amount: 35, currency: 'EUR', period: 'month' },
      { key: 'domains', amount: DOMAIN_COST, currency: 'EUR', approximate: true, noteKey: 'costs.items.domainsNote' },
    ],
  },
  {
    key: 'ai',
    items: [
      { key: 'ai', amount: AI_MIN_COST, maxAmount: AI_MAX_COST, currency: 'EUR', period: 'month', noteKey: 'costs.items.aiNote' },
    ],
  },
  {
    key: 'sources',
    items: [
      { key: 'debrid', amount: 20, currency: 'EUR', period: 'month', approximate: true },
    ],
  },
];

const MONTHLY_TOTAL = SECTIONS.flatMap((section) => section.items).reduce(
  (total, item) => {
    if (!item.period) return total;
    const factor = (item.period === 'day' ? DAYS_PER_MONTH : 1)
      / (item.currency === 'USD' ? USD_PER_EUR : 1);
    return {
      ...total,
      amount: total.amount + item.amount * factor,
      maxAmount: total.maxAmount + (item.maxAmount ?? item.amount) * factor,
    };
  },
  { key: 'total', amount: 0, maxAmount: 0, currency: 'EUR' as const, approximate: true },
);

const CostsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const formatAmount = (amount: number, currency: CostItem['currency']) => (
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  );
  const formatCost = (item: CostItem, currency: CostItem['currency']) => {
    const factor = item.currency === currency ? 1 : currency === 'USD' ? USD_PER_EUR : 1 / USD_PER_EUR;
    const amount = formatAmount(item.amount * factor, currency);
    const range = item.maxAmount === undefined ? amount : `${amount} – ${formatAmount(item.maxAmount * factor, currency)}`;
    return `${item.approximate || item.currency !== currency ? '≈ ' : ''}${range}`;
  };
  const formatEuroAndUsd = (amount: number) => `${formatAmount(amount, 'EUR')} / ≈ ${formatAmount(amount * USD_PER_EUR, 'USD')}`;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="w-full relative z-10 px-10">
        <div className="mt-32 pb-20 relative w-full max-w-[640px] mx-auto">
          <span className="sm:text-5xl text-4xl font-bold mb-6 text-white text-center block">
            {t('costs.title')}
          </span>

          <p className="text-gray-300 font-medium mt-10 opacity-75">
            {t('costs.intro')}
          </p>

          {SECTIONS.map((section) => (
            <div key={section.key} className="mt-10">
              <h2 className="text-xl font-semibold text-white mb-2">
                {t(`costs.sections.${section.key}`)}
              </h2>
              {section.items.map((item) => (
                <div
                  key={item.key}
                  className="flex flex-col gap-2 border-b border-white/10 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                >
                  <div>
                    <span className="text-gray-200 font-medium">
                      {t(`costs.items.${item.key}`)}
                    </span>
                    {item.noteKey && (
                      <p className="text-sm text-gray-400">
                        {t(item.noteKey, {
                          claude: formatEuroAndUsd(AI_MAX_COST),
                          chatgpt: formatEuroAndUsd(AI_MIN_COST),
                          cryptoFees: formatEuroAndUsd(AI_CRYPTO_FEES),
                        })}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 font-semibold tabular-nums sm:text-right">
                    <div className="text-white">
                      {formatCost(item, 'EUR')}
                      {item.period && t(item.period === 'day' ? 'costs.perDay' : 'costs.perMonth')}
                    </div>
                    <div className="text-sm text-gray-400">
                      {formatCost(item, 'USD')}
                      {item.period && t(item.period === 'day' ? 'costs.perDay' : 'costs.perMonth')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}

          <div className="flex flex-col gap-2 mt-10 rounded-lg bg-white/5 border border-white/10 px-4 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <div>
              <span className="text-white font-bold">{t('costs.totalLabel')}</span>
              <p className="text-sm text-gray-400">
                {t('costs.totalNote', { days: DAYS_PER_MONTH, domains: formatEuroAndUsd(DOMAIN_COST) })}
              </p>
            </div>
            <div className="shrink-0 font-bold tabular-nums sm:text-right">
              <div className="text-white text-lg">
                {formatCost(MONTHLY_TOTAL, 'EUR')}{t('costs.perMonth')}
              </div>
              <div className="text-sm text-gray-400">
                {formatCost(MONTHLY_TOTAL, 'USD')}{t('costs.perMonth')}
              </div>
            </div>
          </div>

          <p className="mt-4 text-sm text-gray-400">
            {t('costs.exchangeRateNote', {
              rate: new Intl.NumberFormat(locale, { minimumFractionDigits: 4 }).format(USD_PER_EUR),
              date: new Intl.DateTimeFormat(locale, { timeZone: 'UTC' }).format(new Date(EXCHANGE_RATE_DATE)),
            })}{' '}
            <a href={EXCHANGE_RATE_SOURCE} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-white">
              {t('costs.exchangeRateSource')}
            </a>
          </p>

          <p className="text-gray-300 font-medium mt-10 opacity-75">
            {t('costs.supportText')}
          </p>

          <Link className="mt-6 block w-fit" to="/vip/don">
            <button className="flex items-center justify-center font-medium whitespace-nowrap relative overflow-hidden transition-all h-10 text-sm px-4 rounded-md bg-white text-black hover:bg-white/80 focus-visible:outline-white cursor-pointer">
              <HeartHandshake className="size-4 mr-2" />
              {t('costs.supportCta')}
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default CostsPage;
