import React from 'react';
import { useTranslation } from 'react-i18next';
import { localizeIsoName } from './sagaFormat';
import type { SagaProductionData } from './types';

interface SagaProductionProps {
  info: SagaProductionData;
}

interface ProductionGroup {
  key: string;
  title: string;
  /** Intitulé court des lignes sur téléphone. */
  shortTitle: string;
  items: { key: string | number; name: string; count: number }[];
}

/**
 * Sociétés, pays, langues et genres de la collection. Quatre listes avec le
 * nombre de films à partir de `md` ; sur téléphone, une ligne par rubrique.
 */
export const SagaProduction: React.FC<SagaProductionProps> = ({ info }) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  const groups: ProductionGroup[] = [
    {
      key: 'companies',
      title: t('collections.productionCompanies'),
      shortTitle: t('collections.companiesShort'),
      items: info.productionCompanies.map((company) => ({ key: company.id, name: company.name, count: company.count })),
    },
    {
      key: 'countries',
      title: t('collections.productionCountries'),
      shortTitle: t('collections.countriesShort'),
      items: info.productionCountries.map((country) => ({
        key: country.code,
        name: localizeIsoName('region', country.code, country.name, language),
        count: country.count,
      })),
    },
    {
      key: 'languages',
      title: t('collections.languages'),
      shortTitle: t('collections.languages'),
      items: info.spokenLanguages.map((spoken) => ({
        key: spoken.code,
        name: localizeIsoName('language', spoken.code, spoken.name, language),
        count: spoken.count,
      })),
    },
    {
      key: 'genres',
      title: t('collections.mainGenres'),
      shortTitle: t('collections.genresShort'),
      items: info.genres.map((genre) => ({ key: genre.id, name: genre.name, count: genre.count })),
    },
  ].filter((group) => group.items.length > 0);

  if (groups.length === 0) return null;

  return (
    <>
      <div className="hidden gap-x-10 gap-y-7 md:grid md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {groups.map((group) => (
          <div key={group.key} className="min-w-0">
            <h3 className="mb-2 text-[13px] font-medium leading-normal text-white/55">{group.title}</h3>
            <ul>
              {group.items.map((item) => (
                <li
                  key={item.key}
                  className="flex justify-between gap-4 border-t border-white/[0.12] py-[9px] text-[15px] leading-normal text-white"
                >
                  <span className="min-w-0">{item.name}</span>
                  <span className="whitespace-nowrap text-[13px] text-white/55">
                    {t('collections.filmCount', { count: item.count })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <dl className="border-t border-white/[0.12] md:hidden">
        {groups.map((group) => (
          <div
            key={group.key}
            className="flex justify-between gap-5 border-b border-white/[0.12] py-3 text-[14px] leading-normal"
          >
            <dt className="whitespace-nowrap text-white/55">{group.shortTitle}</dt>
            <dd className="text-right font-medium text-white">
              {group.items.map((item) => item.name).join(', ')}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
};
