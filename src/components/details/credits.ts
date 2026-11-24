import type { TFunction } from 'i18next';
import { detailsJobLabel } from './jobs';
import type { DetailsPerson } from './DetailsPeopleRow';

/** Comédien du générique TMDB (`credits.cast`). */
export interface DetailsCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

/** Membre de l'équipe TMDB (`credits.crew`) : une ligne par métier. */
export interface DetailsCrewMember {
  id: number;
  name: string;
  job: string;
  profile_path: string | null;
}

/** Membre de l'équipe avec tous ses métiers réunis. */
export interface DetailsGroupedCrewMember {
  id: number;
  name: string;
  jobs: string[];
  profile_path: string | null;
}

/** TMDB rend une ligne par métier : on réunit les métiers de chaque personne. */
export function groupDetailsCrew(crew: DetailsCrewMember[]): DetailsGroupedCrewMember[] {
  const grouped = new Map<number, DetailsGroupedCrewMember>();
  for (const member of crew) {
    const existing = grouped.get(member.id);
    if (!existing) {
      grouped.set(member.id, {
        id: member.id,
        name: member.name,
        jobs: [member.job],
        profile_path: member.profile_path,
      });
    } else if (!existing.jobs.includes(member.job)) {
      existing.jobs.push(member.job);
    }
  }
  return Array.from(grouped.values());
}

/** URL d'une photo de profil à la largeur CSS voulue, ou `null`. */
export type DetailsProfileUrl = (path: string | null, cssWidth: number) => string | null;

/** Distribution et équipe au format des rangées de personnes. */
export function toDetailsPeople(
  cast: DetailsCastMember[],
  crew: DetailsGroupedCrewMember[],
  profileUrl: DetailsProfileUrl,
  t: TFunction,
): { castPeople: DetailsPerson[]; crewPeople: DetailsPerson[] } {
  return {
    castPeople: cast.map((actor, index) => ({
      id: `${actor.id}-${index}`,
      name: actor.name,
      role: actor.character || null,
      imageUrl: profileUrl(actor.profile_path, 200),
      to: `/person/${actor.id}`,
    })),
    crewPeople: crew.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.jobs.map((job) => detailsJobLabel(job, t)).join(', '),
      imageUrl: profileUrl(member.profile_path, 48),
      to: `/person/${member.id}`,
    })),
  };
}
