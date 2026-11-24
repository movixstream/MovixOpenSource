import { useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { cn } from '@/lib/utils';
import type { SagaFilmProgress } from '@/hooks/useSagaProgress';
import { DETAILS_FOCUS, DETAILS_PHONE_SCROLL } from '../layout';
import { PersonPoster } from './PersonPoster';
import { personCreditHref, personCreditRole } from './personLabels';
import type { PersonCredit } from './personCredits';

export interface PersonKnownForProps {
  credits: readonly PersonCredit[];
  gender: number;
  /** État de visionnage des films, par identifiant TMDB. */
  progress: ReadonlyMap<number, SagaFilmProgress>;
}

/**
 * « Connu pour » : les titres phares, en affiches. Rangée qui défile sous
 * 768 px, puis grille de 4 à 8 colonnes, comme la distribution des fiches.
 */
export function PersonKnownFor({ credits, gender, progress }: PersonKnownForProps) {
  const { t } = useTranslation();
  if (credits.length === 0) return null;
  return (
    <ul className={cn(DETAILS_PHONE_SCROLL, 'md:grid md:grid-cols-4 md:gap-x-4 md:gap-y-[22px] xl:grid-cols-8')}>
      {credits.map((credit) => {
        const role = personCreditRole(credit, gender, t);
        return (
          <li key={credit.key} className="w-[124px] min-w-0 flex-none md:w-auto">
            <Link
              to={personCreditHref(credit)}
              className={cn('group block rounded-xl', DETAILS_FOCUS)}
            >
              <PersonPoster
                credit={credit}
                variant="card"
                sizes="(min-width: 1280px) 12vw, (min-width: 768px) 22vw, 124px"
                progress={credit.media_type === 'movie' ? progress.get(credit.id) : undefined}
                className="rounded-xl transition-opacity duration-200 group-hover:opacity-80 group-active:opacity-70 motion-reduce:transition-none"
              />
              <b className="mt-2 line-clamp-2 text-[13px] font-semibold leading-[1.3] text-white md:mt-2.5 md:text-sm">
                {credit.title}
              </b>
              {role && <span className="line-clamp-1 text-xs leading-snug text-white/55 md:text-[13px]">{role}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default PersonKnownFor;
