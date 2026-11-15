import type { TFunction } from 'i18next';
import type { CineMap, MapItem, PersonRef, Reason, WorkRef } from '@/services/cineGraph/types';
import { directsPartners, joinNames } from './zones';

/** Ligne du panneau « Pourquoi c'est là ? ». */
export interface ReasonLine {
  key: string;
  type: Reason['type'];
  text: string;
}

/** Ce qui relie le centre et l'élément, dessiné entre les deux dans le panneau. */
export type Bridge =
  | { kind: 'people'; people: PersonRef[] }
  | { kind: 'works'; works: WorkRef[] }
  | { kind: 'label'; text: string };

const firstValues = (values: string[], max: number) => values.slice(0, max).join(', ');

/** Puce courte affichée sous chaque vignette de la carte. */
export function reasonChip(t: TFunction, item: MapItem): string {
  const reason = item.reasons[0];
  if (!reason) return '';
  switch (reason.type) {
    case 'crew':
    case 'crewOn':
      return t(`cinegraph.chip.${reason.job}`);
    case 'plays':
      return reason.character
        ? t('cinegraph.chip.plays', { character: reason.character })
        : t('cinegraph.chip.playsNoName');
    case 'saga':
      return reason.part && reason.parts
        ? t('cinegraph.chip.sagaPart', { part: reason.part, parts: reason.parts })
        : t('cinegraph.chip.saga');
    case 'sameDirector':
      return t('cinegraph.chip.by', { name: reason.people[0]?.name ?? '' });
    case 'sharedCast': {
      const [first, ...others] = reason.people;
      if (!first) return '';
      return others.length
        ? t('cinegraph.chip.withMore', { name: first.name, count: others.length })
        : t('cinegraph.chip.with', { name: first.name });
    }
    case 'themes':
      return firstValues(reason.keywords.length ? reason.keywords : reason.genres, 2);
    case 'together':
      return t('cinegraph.chip.together', { count: reason.works.length });
  }
}

/** Toutes les raisons d'un élément, en phrases complètes. */
export function reasonLines(t: TFunction, item: MapItem, map: CineMap): ReasonLine[] {
  const root = map.root.title;
  const rootIsPerson = map.root.type === 'person';
  const lines: ReasonLine[] = [];
  item.reasons.forEach((reason, index) => {
    const push = (text: string, suffix = '') => lines.push({ key: `${index}${suffix}`, type: reason.type, text });
    switch (reason.type) {
      case 'crew':
        push(t(`cinegraph.why.crew_${reason.job}`, { root }));
        break;
      case 'crewOn':
        push(t(`cinegraph.why.crewOn_${reason.job}`, { root }));
        break;
      case 'plays':
        if (rootIsPerson) {
          push(reason.character
            ? t('cinegraph.why.playsRoot', { root, character: reason.character })
            : t('cinegraph.why.playsRootNoName', { root }));
        } else {
          push(reason.character
            ? t('cinegraph.why.plays', { root, character: reason.character })
            : t('cinegraph.why.playsNoName', { root }));
        }
        break;
      case 'saga':
        push(reason.part && reason.parts
          ? t('cinegraph.why.sagaPart', { saga: reason.name, part: reason.part, parts: reason.parts })
          : t('cinegraph.why.saga', { saga: reason.name }));
        break;
      case 'sameDirector':
        push(t(reason.job === 'creator' ? 'cinegraph.why.sameCreator' : 'cinegraph.why.sameDirector', {
          root,
          names: joinNames(t, reason.people.map((person) => person.name)),
        }));
        break;
      case 'sharedCast': {
        const shown = reason.people.slice(0, 4).map((person) => person.name);
        const hidden = reason.people.length - shown.length;
        const names = hidden > 0
          ? t('cinegraph.andMore', { names: shown.join(', '), count: hidden })
          : joinNames(t, shown);
        push(t('cinegraph.why.sharedCast', { root, names }));
        break;
      }
      case 'themes':
        if (reason.keywords.length) push(t('cinegraph.why.themes', { list: firstValues(reason.keywords, 4) }), 'k');
        if (reason.genres.length) push(t('cinegraph.why.genres', { list: firstValues(reason.genres, 3) }), 'g');
        break;
      case 'together': {
        const titles = firstValues(reason.works.map((work) => work.title), 3);
        const key = item.zone === 'directors'
          ? 'cinegraph.why.directedRoot'
          : directsPartners(map) ? 'cinegraph.why.castBy' : 'cinegraph.why.playedWith';
        push(t(key, { root, count: reason.works.length, titles }));
        break;
      }
    }
  });
  return lines;
}

/** Ce qu'on dessine entre le centre et l'élément choisi. */
export function bridgeFor(t: TFunction, item: MapItem): Bridge | null {
  const reason = item.reasons[0];
  if (!reason) return null;
  switch (reason.type) {
    case 'sameDirector':
    case 'sharedCast':
      return reason.people.length ? { kind: 'people', people: reason.people } : null;
    case 'together':
      return reason.works.length ? { kind: 'works', works: reason.works } : null;
    case 'plays':
      return { kind: 'label', text: reason.character || t('cinegraph.chip.playsNoName') };
    case 'crew':
    case 'crewOn':
      return { kind: 'label', text: t(`cinegraph.chip.${reason.job}`) };
    case 'saga':
      return {
        kind: 'label',
        text: reason.part && reason.parts
          ? t('cinegraph.chip.sagaPart', { part: reason.part, parts: reason.parts })
          : reason.name,
      };
    case 'themes':
      return { kind: 'label', text: reason.keywords[0] ?? reason.genres[0] ?? '' };
  }
}
