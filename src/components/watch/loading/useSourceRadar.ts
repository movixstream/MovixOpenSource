import { useRef, useSyncExternalStore } from 'react';

import { createSourceRadar, type RadarSnapshot, type SourceRadar } from './sourceRadar';

/** Un radar par page Watch, stable d'un rendu à l'autre. */
export function useSourceRadar(): SourceRadar {
  const ref = useRef<SourceRadar | null>(null);
  if (!ref.current) ref.current = createSourceRadar();
  return ref.current;
}

const EMPTY: RadarSnapshot = { sites: [], players: [], cutoff: false };
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

export function useRadarSnapshot(radar: SourceRadar | undefined): RadarSnapshot {
  return useSyncExternalStore(
    radar ? radar.subscribe : noopSubscribe,
    radar ? radar.getSnapshot : emptySnapshot,
    radar ? radar.getSnapshot : emptySnapshot,
  );
}
