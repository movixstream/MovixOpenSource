/**
 * Page d'une personne (`/person/:id`) : données TMDB, filmographie fusionnée
 * par titre, « Connu pour », et leurs vues. Le reste de la page vient des
 * briques communes des fiches (`@/components/details`).
 */
export { usePersonDetails, type PersonDetailsState, type PersonExternalIds, type PersonProfile } from './usePersonDetails';
export {
  ACTING, ageInYears, compareByDateDesc, compareByPopularity, departmentsByCount, groupByYear, mergePersonCredits, pickKnownFor,
  type PersonCredit, type PersonCreditInput, type PersonMediaType, type PersonYearGroup,
} from './personCredits';
export { personCreditHref, personCreditRole, personDepartmentLabel, personGenderContext, personProfessionLabel } from './personLabels';
export { PersonPoster, type PersonPosterProps } from './PersonPoster';
export { PersonKnownFor, type PersonKnownForProps } from './PersonKnownFor';
export { PersonFilmography, type PersonFilmographyProps } from './PersonFilmography';
export { PersonDetailsSkeleton } from './PersonDetailsSkeleton';
