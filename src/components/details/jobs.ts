import type { TFunction } from 'i18next';

/** Métiers TMDB traduits ; les autres s'affichent tels quels. */
const JOB_KEYS: Record<string, string> = {
  'Director': 'details.jobDirector',
  'Producer': 'details.jobProducer',
  'Executive Producer': 'details.jobExecProducer',
  'Writer': 'details.jobWriter',
  'Director of Photography': 'details.jobDOP',
  'Editor': 'details.jobEditor',
  'Production Design': 'details.jobProdDesign',
  'Costume Design': 'details.jobCostume',
  'Music': 'details.jobMusic',
  'Sound': 'details.jobSound',
  'Screenplay': 'details.jobScreenplay',
  'Story': 'details.jobStory',
  'Characters': 'details.jobCharacters',
  'Casting': 'details.jobCasting',
  'Art Direction': 'details.jobArtDirection',
  'Set Decoration': 'details.jobSetDecoration',
};

/** Nom d'un métier TMDB (`job` d'un membre de l'équipe) dans la langue du site. */
export function detailsJobLabel(job: string, t: TFunction): string {
  const key = JOB_KEYS[job];
  return key ? t(key) : job;
}
