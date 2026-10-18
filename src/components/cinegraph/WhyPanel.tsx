import { forwardRef, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useDragControls, useReducedMotionConfig } from 'framer-motion';
import { Eye, Network, Star, User, X } from 'lucide-react';

import { AnimatedBeam } from '@/components/ui/animated-beam';
import { AvatarGroup, AvatarGroupTooltip } from '@/components/ui/avatar-group';
import { cn } from '@/lib/utils';
import type { CineMap, MapEntity, MapItem } from '@/services/cineGraph/types';
import { EntityImage } from './cards';
import { bridgeFor, reasonLines, type Bridge } from './reasons';
import { ZONE_META, zoneTitle } from './zones';

interface WhyPanelProps {
  map: CineMap;
  itemKey: string;
  /** Panneau latéral sur grand écran, feuille qui monte du bas sur téléphone. */
  docked: boolean;
  onClose: () => void;
  onSelect: (key: string) => void;
  onExplore: (entity: MapEntity) => void;
  onOpen: (entity: MapEntity) => void;
}

const MAX_BRIDGE_FACES = 4;

const BeamEnd = forwardRef<HTMLDivElement, { entity: MapEntity; caption?: string }>(function BeamEnd({ entity, caption }, ref) {
  return (
    <div className="cg-why-end">
      <div ref={ref} className={cn('cg-why-end-media', entity.type === 'person' && 'is-person')}>
        <EntityImage src={entity.img} type={entity.type} />
      </div>
      <span className="cg-why-end-title">{entity.title}</span>
      {caption && <span className="cg-why-end-caption">{caption}</span>}
    </div>
  );
});

function BridgeContent({ bridge }: { bridge: Bridge }) {
  if (bridge.kind === 'label') return <span className="cg-why-pill">{bridge.text}</span>;

  const entries = bridge.kind === 'people'
    ? bridge.people.map((person) => ({ id: `p${person.id}`, title: person.name, img: person.img, type: 'person' as const }))
    : bridge.works.map((work) => ({ id: work.key, title: work.title, img: work.img, type: work.type }));
  const shown = entries.slice(0, MAX_BRIDGE_FACES);
  const extra = entries.length - shown.length;
  const avatars = shown.map((entry) => (
    <div key={entry.id} className={cn('cg-why-avatar', entry.type !== 'person' && 'is-poster')}>
      <EntityImage src={entry.img} type={entry.type} alt={entry.title} />
      <AvatarGroupTooltip>{entry.title}</AvatarGroupTooltip>
    </div>
  ));
  if (extra > 0) {
    avatars.push(
      <div key="more" className={cn('cg-why-avatar is-more', shown[0]?.type !== 'person' && 'is-poster')}>
        +{extra}
      </div>,
    );
  }
  return (
    <div className="cg-why-faces">
      <AvatarGroup side="bottom" translate="-18%" className="cg-why-avatar-group">
        {avatars}
      </AvatarGroup>
      {shown.length === 1 && <span className="cg-why-faces-caption">{shown[0].title}</span>}
    </div>
  );
}

/** Le lien en image : centre → raison → élément, relié par deux faisceaux. */
function WhyBeam({ map, item }: { map: CineMap; item: MapItem }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLDivElement>(null);
  const middleRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLDivElement>(null);
  const bridge = bridgeFor(t, item);
  const color = ZONE_META[item.zone].color;
  if (!bridge) return null;
  return (
    <div ref={containerRef} className="cg-why-beam">
      <BeamEnd ref={fromRef} entity={map.root} caption={t('cinegraph.rootLabel')} />
      <div ref={middleRef} className="cg-why-bridge">
        <BridgeContent bridge={bridge} />
      </div>
      <BeamEnd ref={toRef} entity={item} />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={fromRef}
        toRef={middleRef}
        pathColor={color}
        pathOpacity={0.3}
        gradientStartColor={color}
        gradientStopColor="#ffffff"
        duration={2.8}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={middleRef}
        toRef={toRef}
        pathColor={color}
        pathOpacity={0.3}
        gradientStartColor={color}
        gradientStopColor="#ffffff"
        duration={2.8}
        delay={0.7}
      />
    </div>
  );
}

export default function WhyPanel({ map, itemKey, docked, onClose, onSelect, onExplore, onOpen }: WhyPanelProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotionConfig();
  const dragControls = useDragControls();
  const isRoot = itemKey === map.root.key;
  const item: MapItem | undefined = isRoot ? undefined : map.items[itemKey];
  const entity: MapEntity | undefined = isRoot ? map.root : item;
  if (!entity) return null;

  const color = item ? ZONE_META[item.zone].color : '#e50914';
  const zone = item ? map.zones.find((candidate) => candidate.kind === item.zone) : undefined;
  const lines = item ? reasonLines(t, item, map) : [];
  const related = (item?.related ?? []).map((key) => map.items[key]).filter((entry): entry is MapItem => Boolean(entry));
  const isPerson = entity.type === 'person';
  // Un portrait étiré en bandeau devient flou : une personne prend le décor de
  // l'œuvre au centre, et son visage s'affiche en rond sous le bandeau.
  const cover = isPerson ? map.root.backdrop : entity.backdrop ?? entity.img;

  const motionProps = docked
    ? { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } }
    : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } };

  return (
    <>
      {!docked && (
        <motion.div
          className="cg-sheet-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
      )}
      <motion.aside
        role="dialog"
        aria-label={t('cinegraph.why.title')}
        data-lenis-prevent
        className={cn('cg-why', docked ? 'cg-why--docked' : 'cg-why--sheet')}
        style={{ '--zone': color } as CSSProperties}
        {...motionProps}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 30, stiffness: 260 }}
        drag={docked ? false : 'y'}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 700) onClose();
        }}
        onWheel={(event) => event.stopPropagation()}
      >
        {!docked && (
          <div className="cg-sheet-grip" onPointerDown={(event) => dragControls.start(event)}>
            <span />
          </div>
        )}

        <div className="cg-why-cover">
          {cover ? <img src={cover} alt="" /> : null}
          <button type="button" className="cg-why-close" onClick={onClose} aria-label={t('cinegraph.close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="cg-why-body">
          {isPerson && (
            <span className="cg-why-portrait">
              <EntityImage src={entity.img} type="person" />
            </span>
          )}
          {zone && item && (
            <span className="cg-why-zone">
              {(() => {
                const Icon = ZONE_META[item.zone].icon;
                return <Icon size={13} aria-hidden="true" />;
              })()}
              {zoneTitle(t, zone, map)}
            </span>
          )}
          <h2 className="cg-why-title">{entity.title}</h2>
          <div className="cg-why-meta">
            <span className={`cinegraph-type-badge ${entity.type}`}>
              {t(entity.type === 'movie' ? 'cinegraph.filmLabel' : entity.type === 'tv' ? 'cinegraph.seriesLabel' : 'cinegraph.artistLabel')}
            </span>
            {entity.year && <span>{entity.year}</span>}
            {!!entity.rating && entity.rating > 0 && (
              <span className="cg-why-rating">
                <Star size={13} fill="currentColor" aria-hidden="true" />
                {entity.rating.toFixed(1)}
              </span>
            )}
          </div>

          {item ? (
            <section className="cg-why-section">
              <h3>{t('cinegraph.why.title')}</h3>
              <WhyBeam key={item.key} map={map} item={item} />
              <ul className="cg-why-lines">
                {lines.map((line) => (
                  <li key={line.key}>{line.text}</li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="cg-why-root-note">{t('cinegraph.why.rootNote')}</p>
          )}

          {related.length > 0 && (
            <section className="cg-why-section">
              <h3>{t('cinegraph.why.alsoInMap')}</h3>
              <div className="cg-why-related">
                {related.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className="cg-why-related-item"
                    style={{ '--zone': ZONE_META[entry.zone].color } as CSSProperties}
                    onClick={() => onSelect(entry.key)}
                  >
                    <span className={cn('cg-why-related-media', entry.type === 'person' && 'is-person')}>
                      <EntityImage src={entry.img} type={entry.type} />
                    </span>
                    <span className="cg-why-related-title">{entry.title}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {entity.overview && <p className="cg-why-overview">{entity.overview}</p>}

          <div className="cg-why-actions">
            <button type="button" className="cinegraph-detail-link primary" onClick={() => onOpen(entity)}>
              {isPerson ? <User size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              {t(isPerson ? 'cinegraph.viewProfile' : 'cinegraph.viewRecord')}
            </button>
            {!isRoot && (
              <button type="button" className="cinegraph-detail-link secondary" onClick={() => onExplore(entity)}>
                <Network size={16} aria-hidden="true" />
                {t('cinegraph.exploreFromHere')}
              </button>
            )}
          </div>
        </div>
      </motion.aside>
    </>
  );
}
