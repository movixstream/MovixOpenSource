import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotionConfig } from 'framer-motion';
import {
  BaseEdge,
  ConnectionMode,
  Handle,
  PanOnScrollMode,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type FitViewOptions,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { Expand, LocateFixed, Shrink, ZoomIn, ZoomOut } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { CineMap, MapItem, ZoneKind } from '@/services/cineGraph/types';
import { MapCard, MoreTile, RootCard, ZoneHeader, type CardState } from './cards';
import { useMapFocus } from './highlight';
import { VISIBLE_PER_ZONE, ZONE_ANCHOR_Y, layoutMap, type ZoneBox } from './layout';
import { useMediaQuery } from './useMediaQuery';
import { ZONE_META } from './zones';

export interface MapViewProps {
  map: CineMap;
  hiddenZones: ReadonlySet<ZoneKind>;
  selectedKey: string | null;
  /** Le panneau « Pourquoi » couvre le bord droit : la vue se décale pour ne pas cacher l'élément choisi. */
  panelOpen: boolean;
  onSelect: (key: string | null) => void;
  /** Vue carte seulement : la carte occupe toute la fenêtre. */
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

type RootNodeData = { map: CineMap };
type ZoneNodeData = {
  box: ZoneBox;
  map: CineMap;
  onToggleMore: (kind: ZoneKind) => void;
  onFocusZone: (kind: ZoneKind) => void;
};
/** `reveal` : rang d'apparition d'une vignette montrée par « Voir plus ». */
type ItemNodeData = { item: MapItem; reveal?: number };
type FlowNode =
  | Node<RootNodeData, 'root'>
  | Node<ZoneNodeData, 'zone'>
  | Node<ZoneNodeData, 'more'>
  | Node<ItemNodeData, 'item'>;

/**
 * Survol et choix passent par ce contexte, pas par les données des nœuds :
 * React Flow traite tout nouvel objet nœud comme un nœud neuf et recalcule
 * ses points d'accroche, ce qui recréait les traits à chaque survol (le point
 * lumineux repartait du début).
 */
interface MapFocus {
  selectedKey: string | null;
  stateOf: (key: string) => CardState;
  onSelect: (key: string) => void;
  onHover?: (key: string | null) => void;
  /** Zone en train de se replier : ses vignettes en plus s'effacent d'abord. */
  closingZone: ZoneKind | null;
}
const MapFocusContext = createContext<MapFocus>({
  selectedKey: null,
  stateOf: () => 'idle',
  onSelect: () => {},
  closingZone: null,
});

/** Durée de l'effacement avant que la zone se replie (cinegraph.css : cg-card-out). */
const COLLAPSE_DELAY_MS = 170;
const REVEAL_STEP_MS = 45;
type BeamData = { color: string; active: boolean; reduced: boolean };
type FlowEdge = Edge<BeamData, 'beam'>;

const ROOT_ID = 'root';
// En bas, la place des boutons de zoom : sans elle, ils cachent les dernières vignettes.
const FIT_OPTIONS = {
  padding: { top: '24px', right: '24px', bottom: '76px', left: '24px' },
  maxZoom: 1.1,
} satisfies FitViewOptions;
const PANEL_WIDTH = 400;
const zoneStyle = (kind: ZoneKind) => ({ '--zone': ZONE_META[kind].color }) as CSSProperties;

const RootNode = memo(function RootNode({ data }: NodeProps<Node<RootNodeData, 'root'>>) {
  const { selectedKey, onSelect } = useContext(MapFocusContext);
  return (
    <>
      <RootCard map={data.map} selected={selectedKey === data.map.root.key} variant="canvas" onSelect={onSelect} />
      <Handle id="l" type="source" position={Position.Left} isConnectable={false} className="cg-handle" />
      <Handle id="r" type="source" position={Position.Right} isConnectable={false} className="cg-handle" />
    </>
  );
});

const MoreNode = memo(function MoreNode({ data }: NodeProps<Node<ZoneNodeData, 'more'>>) {
  const { box, map, onToggleMore } = data;
  return (
    <MoreTile
      zone={box.zone}
      map={map}
      hiddenCount={box.hiddenCount}
      expanded={box.expanded}
      onToggle={() => onToggleMore(box.kind)}
    />
  );
});

const ZoneNode = memo(function ZoneNode({ data }: NodeProps<Node<ZoneNodeData, 'zone'>>) {
  const { box, map, onFocusZone } = data;
  return (
    <div className="cg-zone" style={zoneStyle(box.kind)}>
      <ZoneHeader zone={box.zone} map={map} total={box.zone.items.length} onFocusZone={() => onFocusZone(box.kind)} />
      {/* Le trait venu du centre entre dans la zone au niveau de son icône. */}
      <Handle id="l" type="source" position={Position.Left} isConnectable={false} className="cg-handle" style={{ top: ZONE_ANCHOR_Y }} />
      <Handle id="r" type="source" position={Position.Right} isConnectable={false} className="cg-handle" style={{ top: ZONE_ANCHOR_Y }} />
    </div>
  );
});

const ItemNode = memo(function ItemNode({ data }: NodeProps<Node<ItemNodeData, 'item'>>) {
  const { stateOf, onSelect, onHover, closingZone } = useContext(MapFocusContext);
  const card = <MapCard item={data.item} state={stateOf(data.item.key)} onSelect={onSelect} onHover={onHover} />;
  if (data.reveal === undefined) return card;
  return (
    <div
      className={cn('cg-reveal', closingZone === data.item.zone && 'is-leaving')}
      style={{ '--reveal-delay': `${data.reveal * REVEAL_STEP_MS}ms` } as CSSProperties}
    >
      {card}
    </div>
  );
});

/**
 * Trait du centre vers une zone, inspiré de l'Animated Beam de Magic UI :
 * dégradé discret au repos ; quand on regarde un élément de la zone, trait
 * plein, halo et point lumineux qui file du centre vers la zone.
 *
 * Le point suit le trait en CSS Motion Path (`offset-path`), pas en SMIL
 * (`animateMotion`) : tant que l'animation SMIL n'avait pas démarré, le point
 * restait à l'origine de la carte et clignotait en haut à gauche de la
 * première zone.
 */
function BeamEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<BeamData, 'beam'>>) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.4 });
  const color = data?.color ?? '#ffffff';
  const active = Boolean(data?.active);
  const gradientId = `cg-beam-${id}`;
  return (
    <g className={cn('cg-beam', active && 'is-active')}>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor={color} stopOpacity={active ? 0.35 : 0.12} />
          <stop offset="100%" stopColor={color} stopOpacity={active ? 1 : 0.55} />
        </linearGradient>
      </defs>
      {active && <path d={path} className="cg-beam-halo" style={{ stroke: color }} />}
      <BaseEdge id={id} path={path} interactionWidth={0} style={{ stroke: `url(#${gradientId})`, strokeWidth: active ? 3 : 2 }} />
      {active && !data?.reduced && (
        <circle r={4.5} className="cg-beam-dot" style={{ fill: color, offsetPath: `path('${path}')` }} />
      )}
    </g>
  );
}

const nodeTypes = { root: RootNode, zone: ZoneNode, more: MoreNode, item: ItemNode };
const edgeTypes = { beam: BeamEdge };

function CanvasInner({ map, hiddenZones, selectedKey, panelOpen, onSelect, fullscreen, onToggleFullscreen }: MapViewProps) {
  const { t } = useTranslation();
  const reduced = Boolean(useReducedMotionConfig());
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<ZoneKind>>(() => new Set());
  // Les liens cachés (un acteur et ses films ailleurs sur la carte) ressortent
  // par la mise en valeur des vignettes : un trait les relierait en traversant
  // tout le centre de la carte.
  const { focusKey, stateOf, setHoverKey } = useMapFocus(map, selectedKey);
  // Sur écran tactile, un appui déclenche aussi « survol » sans jamais le quitter.
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
  const onHover = canHover ? setHoverKey : undefined;

  const layout = useMemo(() => layoutMap(map, hiddenZones, expanded), [map, hiddenZones, expanded]);

  const handleSelect = useCallback((key: string) => onSelect(key), [onSelect]);
  const [closingZone, setClosingZone] = useState<ZoneKind | null>(null);
  const closeTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  // Ouvrir : la zone grandit et les vignettes en plus arrivent une à une.
  // Fermer : elles s'effacent d'abord, puis la zone se replie.
  const toggleMore = useCallback((kind: ZoneKind) => {
    const apply = () => setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    window.clearTimeout(closeTimer.current);
    if (!expanded.has(kind) || reduced) {
      setClosingZone(null);
      apply();
      return;
    }
    setClosingZone(kind);
    closeTimer.current = window.setTimeout(() => {
      setClosingZone(null);
      apply();
    }, COLLAPSE_DELAY_MS);
  }, [expanded, reduced]);

  // Les déplacements de nœuds ne s'animent qu'une fois la carte posée :
  // sinon tout glisserait depuis l'origine au premier affichage.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 600);
    return () => window.clearTimeout(timer);
  }, []);
  const focusZone = useCallback((kind: ZoneKind) => {
    void flow.fitView({ nodes: [{ id: `zone-${kind}` }], padding: 0.12, maxZoom: 1.3, duration: 500 });
  }, [flow]);

  const focus = useMemo<MapFocus>(
    () => ({ selectedKey, stateOf, onSelect: handleSelect, onHover, closingZone }),
    [selectedKey, stateOf, handleSelect, onHover, closingZone],
  );

  // Ne dépend que de la mise en page : un survol ne doit pas produire de
  // nouveaux objets nœuds (voir MapFocusContext).
  const nodes = useMemo<FlowNode[]>(() => {
    const result: FlowNode[] = [{
      id: ROOT_ID,
      type: 'root',
      position: { x: layout.root.x, y: layout.root.y },
      width: layout.root.w,
      height: layout.root.h,
      data: { map },
    }];
    for (const zone of layout.zones) {
      const zoneId = `zone-${zone.kind}`;
      result.push({
        id: zoneId,
        type: 'zone',
        position: { x: zone.x, y: zone.y },
        width: zone.w,
        height: zone.h,
        data: { box: zone, map, onToggleMore: toggleMore, onFocusZone: focusZone },
      });
      zone.items.forEach((box, index) => {
        const item = map.items[box.key];
        if (!item) return;
        const reveal = zone.expanded && zone.more ? index - (VISIBLE_PER_ZONE - 1) : -1;
        result.push({
          id: box.key,
          type: 'item',
          parentId: zoneId,
          extent: 'parent',
          position: { x: box.x, y: box.y },
          width: box.w,
          height: box.h,
          data: reveal >= 0 ? { item, reveal } : { item },
        });
      });
      if (zone.more) {
        result.push({
          id: `more-${zone.kind}`,
          type: 'more',
          parentId: zoneId,
          extent: 'parent',
          position: { x: zone.more.x, y: zone.more.y },
          width: zone.more.w,
          height: zone.more.h,
          data: { box: zone, map, onToggleMore: toggleMore, onFocusZone: focusZone },
        });
      }
    }
    return result;
  }, [layout, map, toggleMore, focusZone]);

  const edges = useMemo<FlowEdge[]>(() => {
    const activeZone = focusKey ? map.items[focusKey]?.zone : undefined;
    return layout.zones.map((zone) => ({
      id: `beam-${zone.kind}`,
      type: 'beam',
      source: ROOT_ID,
      sourceHandle: zone.side === 'left' ? 'l' : 'r',
      target: `zone-${zone.kind}`,
      targetHandle: zone.side === 'left' ? 'r' : 'l',
      data: { color: ZONE_META[zone.kind].color, active: activeZone === zone.kind, reduced },
    }));
  }, [layout, map, focusKey, reduced]);

  // Masquer ou réafficher une zone redistribue les colonnes : on recadre.
  const firstHiddenRun = useRef(true);
  useEffect(() => {
    if (firstHiddenRun.current) {
      firstHiddenRun.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => void flow.fitView({ ...FIT_OPTIONS, duration: 400 }));
    return () => cancelAnimationFrame(frame);
  }, [hiddenZones, flow]);

  // L'élément choisi ne doit pas finir sous le panneau « Pourquoi » : on fait
  // glisser la vue juste assez pour le dégager.
  useEffect(() => {
    if (!panelOpen || !selectedKey || !wrapperRef.current) return;
    const nodeId = selectedKey === map.root.key ? ROOT_ID : selectedKey;
    const element = wrapperRef.current.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
    if (!element) return;
    const limit = window.innerWidth - PANEL_WIDTH - 24;
    const overflow = element.getBoundingClientRect().right - limit;
    if (overflow <= 0) return;
    const viewport = flow.getViewport();
    void flow.setViewport({ ...viewport, x: viewport.x - overflow }, { duration: 450 });
    // Seul un nouveau choix doit recadrer, pas un changement de mise en page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, panelOpen]);

  return (
    // La molette déplace la carte : Lenis ne doit pas la transformer en défilement de page.
    <div ref={wrapperRef} className={cn('cg-canvas', settled && !reduced && 'is-settled')} data-lenis-prevent>
      <MapFocusContext.Provider value={focus}>
        <ReactFlow<FlowNode, FlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={FIT_OPTIONS}
          minZoom={0.3}
          maxZoom={1.75}
          // Molette = se déplacer, comme sur une page. Zoom : pincer sur le
          // pavé tactile, Ctrl + molette (Cmd sur Mac) ou les boutons.
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          panOnScrollSpeed={0.8}
          onPaneClick={() => onSelect(null)}
          proOptions={{ hideAttribution: false }}
        />
      </MapFocusContext.Provider>
      <div className="cg-canvas-controls">
        <button type="button" className="cinegraph-control-btn" onClick={() => void flow.fitView({ ...FIT_OPTIONS, duration: 400 })}>
          <LocateFixed size={14} aria-hidden="true" />
          <span>{t('cinegraph.recenter')}</span>
        </button>
        <button type="button" className="cinegraph-control-btn" aria-label={t('cinegraph.zoomIn')} onClick={() => void flow.zoomIn({ duration: 200 })}>
          <ZoomIn size={14} aria-hidden="true" />
        </button>
        <button type="button" className="cinegraph-control-btn" aria-label={t('cinegraph.zoomOut')} onClick={() => void flow.zoomOut({ duration: 200 })}>
          <ZoomOut size={14} aria-hidden="true" />
        </button>
        {onToggleFullscreen && (
          <button type="button" className="cinegraph-control-btn" aria-pressed={Boolean(fullscreen)} onClick={onToggleFullscreen}>
            {fullscreen ? <Shrink size={14} aria-hidden="true" /> : <Expand size={14} aria-hidden="true" />}
            <span>{t(fullscreen ? 'cinegraph.exitFullscreen' : 'cinegraph.fullscreen')}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Vue « carte » pour grand écran : le centre au milieu, les zones autour. */
export default function CineMapCanvas(props: MapViewProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
