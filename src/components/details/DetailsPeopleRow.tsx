import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { cn } from '@/lib/utils';
import { DETAILS_FOCUS, DETAILS_PHONE_SCROLL } from './layout';

export interface DetailsPerson {
  id: number | string;
  name: string;
  /** Rôle joué ou métier, sous le nom. */
  role?: string | null;
  /** Portrait déjà dimensionné (`getTmdbImageUrl`, kind `profile`). */
  imageUrl?: string | null;
  /** Route de la page de la personne ; sans elle la carte n'est pas cliquable. */
  to?: string;
}

export interface DetailsPeopleRowProps {
  people: DetailsPerson[];
  /**
   * `row` : aperçu, rangée qui défile sous 768 px puis grille de 4 à 8 colonnes.
   * `grid` : liste complète, grille à toutes les largeurs.
   */
  layout?: 'row' | 'grid';
  /**
   * Les portraits à partir de cet index apparaissent en montant, en cascade :
   * ceux ajoutés au dépliage. Les premiers restent en place, sans se recharger.
   */
  revealFrom?: number;
  className?: string;
}

const initial = (name: string) => name.trim().charAt(0).toUpperCase();

function Portrait({ person, className }: { person: DetailsPerson; className: string }) {
  return person.imageUrl ? (
    <img src={person.imageUrl} alt="" loading="lazy" decoding="async" className={cn('block bg-gray-900 object-cover', className)} />
  ) : (
    <span aria-hidden="true" className={cn('flex items-center justify-center bg-white/10 font-semibold text-white', className)}>
      {initial(person.name)}
    </span>
  );
}

/** Rangée de personnes en portraits 4:5 : distribution, équipe mise en avant. */
export function DetailsPeopleRow({ people, layout = 'row', revealFrom, className }: DetailsPeopleRowProps) {
  if (people.length === 0) return null;
  const grid = 'grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:gap-x-4 md:gap-y-[22px] xl:grid-cols-8';
  return (
    <ul
      data-reveal-grid
      className={cn(
        layout === 'row' ? cn(DETAILS_PHONE_SCROLL, 'md:grid md:grid-cols-4', grid) : cn('grid', grid),
        className,
      )}
    >
      {people.map((person, index) => {
        const revealIndex = revealFrom === undefined ? -1 : index - revealFrom;
        const body = (
          <>
            <Portrait person={person} className="aspect-[4/5] w-full rounded-xl text-3xl" />
            <b className="mt-2 block text-[13px] font-semibold leading-[1.3] text-white md:mt-2.5 md:text-sm">{person.name}</b>
            {person.role && <span className="block text-xs leading-snug text-white/55 md:text-[13px]">{person.role}</span>}
          </>
        );
        return (
          <li
            key={person.id}
            className={cn('min-w-0', layout === 'row' && 'w-28 flex-none md:w-auto', revealIndex >= 0 && 'details-rise-in')}
            style={revealIndex >= 0 ? { animationDelay: `${Math.min(revealIndex, 12) * 35}ms` } : undefined}
          >
            {person.to ? (
              <Link
                to={person.to}
                className={cn('block rounded-xl transition-opacity duration-200 hover:opacity-80 active:opacity-70 motion-reduce:transition-none', DETAILS_FOCUS)}
              >
                {body}
              </Link>
            ) : body}
          </li>
        );
      })}
    </ul>
  );
}

export interface DetailsPeopleListProps {
  people: DetailsPerson[];
  className?: string;
}

/** Liste compacte (portrait rond, nom, métier) pour les longues listes : équipe technique. */
export function DetailsPeopleList({ people, className }: DetailsPeopleListProps) {
  if (people.length === 0) return null;
  return (
    <ul className={cn('grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4', className)}>
      {people.map((person) => {
        const body = (
          <>
            <Portrait person={person} className="size-12 flex-none rounded-full text-lg" />
            <span className="min-w-0">
              <b className="block truncate text-sm font-semibold text-white">{person.name}</b>
              {person.role && <span className="block text-[13px] leading-snug text-white/55">{person.role}</span>}
            </span>
          </>
        );
        const row = 'flex min-h-14 items-center gap-3 rounded-xl px-2 py-1.5';
        return (
          <li key={person.id} className="min-w-0">
            {person.to ? (
              <Link
                to={person.to}
                className={cn(row, 'transition-colors duration-200 hover:bg-white/5 active:bg-white/10 motion-reduce:transition-none', DETAILS_FOCUS)}
              >
                {body}
              </Link>
            ) : <div className={row}>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export default DetailsPeopleRow;
