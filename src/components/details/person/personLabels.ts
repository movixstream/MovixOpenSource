import type { TFunction } from 'i18next';
import { encodeId } from '@/utils/idEncoder';
import { detailsJobLabel } from '../jobs';
import { ACTING, type PersonCredit } from './personCredits';

/** Lien vers la fiche d'un titre de la filmographie. */
export const personCreditHref = (credit: PersonCredit) => `/${credit.media_type}/${encodeId(credit.id)}`;

/** Départements TMDB traduits (`details.person.department.*`) ; les autres s'affichent tels quels. */
const DEPARTMENT_KEYS: Record<string, string> = {
  [ACTING]: 'acting',
  Directing: 'directing',
  Writing: 'writing',
  Production: 'production',
  Creator: 'creator',
  Sound: 'sound',
  Camera: 'camera',
  Editing: 'editing',
  Art: 'art',
  'Costume & Make-Up': 'costume',
  'Visual Effects': 'visualEffects',
  Lighting: 'lighting',
  Crew: 'crew',
};

/**
 * Contexte i18next du genre TMDB (1 femme, 2 homme, 3 non binaire) :
 * « Actrice », « Née le », « Interprète »… Genre inconnu (0) : le mot de base.
 */
export function personGenderContext(gender: number): 'female' | 'male' | 'neutral' | undefined {
  if (gender === 1) return 'female';
  if (gender === 2) return 'male';
  if (gender === 3) return 'neutral';
  return undefined;
}

/** Nom d'un département dans les filtres de la filmographie (« Réalisation »). */
export function personDepartmentLabel(department: string, t: TFunction): string {
  const key = DEPARTMENT_KEYS[department];
  return key ? t(`details.person.department.${key}`) : department;
}

/** Métier principal, accordé au genre quand la langue le fait (« Actrice », « Réalisateur »). */
export function personProfessionLabel(department: string | null | undefined, gender: number, t: TFunction): string | null {
  if (!department) return null;
  const key = DEPARTMENT_KEYS[department];
  if (!key) return department;
  return t(`details.person.profession.${key}`, {
    context: personGenderContext(gender),
    defaultValue: personDepartmentLabel(department, t),
  });
}

/**
 * Ce que la personne fait dans le titre : personnages, puis métiers, puis le
 * nombre d'épisodes d'une série. « Dans son propre rôle » pour une apparition.
 */
export function personCreditRole(credit: PersonCredit, gender: number, t: TFunction): string {
  const parts: string[] = [];
  if (credit.isSelf) parts.push(t('details.person.self', { context: personGenderContext(gender) }));
  else if (credit.characters.length > 0) parts.push(credit.characters.join(', '));
  else if (credit.departments.includes(ACTING)) parts.push(personDepartmentLabel(ACTING, t));
  if (credit.jobs.length > 0) parts.push(credit.jobs.map((job) => detailsJobLabel(job, t)).join(', '));
  if (credit.media_type === 'tv' && credit.episodeCount) {
    parts.push(t('details.person.episodes', { count: credit.episodeCount }));
  }
  return parts.join(' · ');
}
