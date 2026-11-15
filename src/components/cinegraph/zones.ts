import { Clapperboard, Drama, Layers, Sparkles, Users, Video, type LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';
import { isCrewDepartment } from '@/services/cineGraph/build';
import type { CineMap, MapZone, ZoneKind } from '@/services/cineGraph/types';

/**
 * Une couleur et une icône par raison de lien. Elles sont reprises partout
 * (cadre de zone, trait, puce, panneau) : la couleur suffit à dire « pourquoi ».
 */
export const ZONE_META: Record<ZoneKind, { color: string; icon: LucideIcon }> = {
  team: { color: '#f59e0b', icon: Users },
  saga: { color: '#a78bfa', icon: Layers },
  director: { color: '#f43f5e', icon: Clapperboard },
  cast: { color: '#38bdf8', icon: Drama },
  mood: { color: '#2dd4bf', icon: Sparkles },
  roles: { color: '#f43f5e', icon: Drama },
  crew: { color: '#f59e0b', icon: Clapperboard },
  partners: { color: '#38bdf8', icon: Users },
  directors: { color: '#a78bfa', icon: Video },
};

/** Noms lisibles : « A et B », « A, B et C ». */
export function joinNames(t: TFunction, names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return t('cinegraph.and', { first: names.slice(0, -1).join(', '), last: names[names.length - 1] });
}

/**
 * Centre = cinéaste ou scénariste : ses « partenaires » sont les acteurs qu'il
 * fait tourner, pas des gens qui jouent à ses côtés.
 */
export function directsPartners(map: CineMap): boolean {
  return map.root.type === 'person' && isCrewDepartment(map.root.department);
}

export function zoneTitle(t: TFunction, zone: MapZone, map: CineMap): string {
  if (zone.kind === 'director' && zone.job === 'creator') return t('cinegraph.zones.director.titleCreator');
  if (zone.kind === 'partners' && directsPartners(map)) return t('cinegraph.zones.partners.titleCrew');
  return t(`cinegraph.zones.${zone.kind}.title`);
}

/** Phrase qui explique la zone entière, sous son titre. */
export function zoneDescription(t: TFunction, zone: MapZone, map: CineMap): string {
  const title = map.root.title;
  const names = joinNames(t, (zone.people ?? []).map((person) => person.name));
  switch (zone.kind) {
    case 'saga':
      return t('cinegraph.zones.saga.desc', { saga: zone.saga ?? title });
    case 'director':
      return zone.job === 'creator'
        ? t('cinegraph.zones.director.descCreator', { names })
        : t('cinegraph.zones.director.desc', { names });
    case 'partners':
      return t(directsPartners(map) ? 'cinegraph.zones.partners.descCrew' : 'cinegraph.zones.partners.desc', { name: title });
    case 'roles':
    case 'crew':
    case 'directors':
      return t(`cinegraph.zones.${zone.kind}.desc`, { name: title });
    default:
      return t(`cinegraph.zones.${zone.kind}.desc`, { title });
  }
}
