import { useTranslation } from 'react-i18next';

/** Lit un tableau de libellés dans les traductions (menus de la télé, mots du titre). */
export function useLabelList(key: string): string[] {
  const { t } = useTranslation();
  const value = t(key, { returnObjects: true }) as unknown;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
