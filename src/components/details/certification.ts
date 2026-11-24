import type { TFunction } from 'i18next';
import { ageMap, allAgesCerts } from '@/utils/certificationUtils';

/** Classifications retenues par pays (`FR`, à défaut `US`). */
export type DetailsCertifications = Record<string, string>;

/** Classification affichée : la française, à défaut l'américaine. */
export const pickDetailsCertification = (certifications: DetailsCertifications): string =>
  certifications['FR'] || certifications['US'] || '';

/** Texte de la pastille d'âge (« Tous publics », « 12+ »…), ou `null`. */
export function detailsClassificationPill(cert: string, t: TFunction): string | null {
  if (!cert) return null;
  if (allAgesCerts.has(cert)) return t('details.allAges');
  return cert in ageMap ? `${ageMap[cert]}+` : cert;
}
