import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';
import type { MapViewProps } from './CineMapCanvas';
import { MapCard, RootCard, ZoneHeader } from './cards';
import { useMapFocus } from './highlight';
import { useMediaQuery } from './useMediaQuery';
import { ZONE_META } from './zones';

/**
 * Vue « liste » (téléphone, tablette ou au choix) : les mêmes zones, empilées
 * le long d'une ligne qui part du centre, chacune en rangée qui défile.
 * Le défilement natif reste fluide là où une carte à faire glisser fatigue.
 */
export default function CineMapList({ map, hiddenZones, selectedKey, onSelect }: MapViewProps) {
  // Sur écran tactile, un appui déclenche aussi « survol » sans jamais le quitter.
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
  const { focusKey, stateOf, setHoverKey } = useMapFocus(map, selectedKey);
  const activeZone = focusKey ? map.items[focusKey]?.zone : undefined;
  const zones = map.zones.filter((zone) => !hiddenZones.has(zone.kind) && zone.items.length > 0);

  return (
    <div className="cg-list">
      <RootCard map={map} selected={selectedKey === map.root.key} variant="list" onSelect={onSelect} />
      <ol className="cg-list-zones">
        {zones.map((zone) => (
          <li
            key={zone.kind}
            className={cn('cg-list-zone', activeZone === zone.kind && 'is-active')}
            style={{ '--zone': ZONE_META[zone.kind].color } as CSSProperties}
          >
            <ZoneHeader zone={zone} map={map} total={zone.items.length} />
            <div className="cg-list-row">
              {zone.items.map((key) => {
                const item = map.items[key];
                if (!item) return null;
                return (
                  <MapCard
                    key={key}
                    item={item}
                    state={stateOf(key)}
                    onSelect={onSelect}
                    onHover={canHover ? setHoverKey : undefined}
                  />
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
