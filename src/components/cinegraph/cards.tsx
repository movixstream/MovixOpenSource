import { memo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, Film, Link2, Star, Tv2, User, ZoomIn } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { CineMap, EntityType, MapItem, MapZone } from '@/services/cineGraph/types';
import { reasonChip } from './reasons';
import { ZONE_META, zoneDescription, zoneTitle } from './zones';

export type CardState = 'idle' | 'selected' | 'related' | 'dimmed';

const zoneStyle = (color: string) => ({ '--zone': color }) as CSSProperties;

/** Affiche ou portrait, avec une icône si l'image manque ou ne charge pas. */
export function EntityImage({ src, type, alt = '', className }: {
  src?: string;
  type: EntityType;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    const Icon = type === 'person' ? User : type === 'tv' ? Tv2 : Film;
    return (
      <span className={cn('cg-image-fallback', className)} aria-hidden="true">
        <Icon size={22} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

interface MapCardProps {
  item: MapItem;
  state: CardState;
  onSelect: (key: string) => void;
  onHover?: (key: string | null) => void;
}

/** Vignette d'un élément de la carte : image, titre et raison du lien. */
export const MapCard = memo(function MapCard({ item, state, onSelect, onHover }: MapCardProps) {
  const { t } = useTranslation();
  const isPerson = item.type === 'person';
  return (
    <button
      type="button"
      className={cn('cg-card', isPerson ? 'cg-card--person' : 'cg-card--work', `is-${state}`)}
      style={zoneStyle(ZONE_META[item.zone].color)}
      aria-pressed={state === 'selected'}
      onClick={() => onSelect(item.key)}
      onMouseEnter={onHover ? () => onHover(item.key) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onFocus={onHover ? () => onHover(item.key) : undefined}
      onBlur={onHover ? () => onHover(null) : undefined}
    >
      <span className="cg-card-media">
        <EntityImage src={item.img} type={item.type} />
        {!isPerson && item.year && <span className="cg-card-year">{item.year}</span>}
        {state === 'related' && (
          <span className="cg-card-linked">
            <Link2 size={11} aria-hidden="true" />
            {t('cinegraph.linked')}
          </span>
        )}
      </span>
      <span className="cg-card-title">{item.title}</span>
      <span className="cg-card-chip">{reasonChip(t, item)}</span>
    </button>
  );
});

const typeLabelKey: Record<EntityType, string> = {
  movie: 'cinegraph.filmLabel',
  tv: 'cinegraph.seriesLabel',
  person: 'cinegraph.artistLabel',
};

/** Le point de départ de la carte. */
export const RootCard = memo(function RootCard({ map, selected, variant, onSelect }: {
  map: CineMap;
  selected: boolean;
  variant: 'canvas' | 'list';
  onSelect: (key: string) => void;
}) {
  const { t } = useTranslation();
  const { root } = map;
  const isPerson = root.type === 'person';
  const details = isPerson ? (root.department ? [t(`cinegraph.department.${root.department}`, { defaultValue: root.department })] : []) : (root.genres ?? []).slice(0, 3);
  return (
    <button
      type="button"
      className={cn('cg-root', `cg-root--${variant}`, isPerson && 'cg-root--person', selected && 'is-selected')}
      aria-pressed={selected}
      onClick={() => onSelect(root.key)}
    >
      <span className="cg-root-media">
        <EntityImage src={root.img} type={root.type} />
      </span>
      <span className="cg-root-text">
        <span className="cg-root-kicker">{t('cinegraph.rootLabel')}</span>
        <span className="cg-root-title">{root.title}</span>
        <span className="cg-root-meta">
          <span className={`cinegraph-type-badge ${root.type}`}>{t(typeLabelKey[root.type])}</span>
          {root.year && <span>{root.year}</span>}
          {!!root.rating && root.rating > 0 && (
            <span className="cg-root-rating">
              <Star size={12} fill="currentColor" aria-hidden="true" />
              {root.rating.toFixed(1)}
            </span>
          )}
        </span>
        {details.length > 0 && (
          <span className="cg-root-tags">
            {details.map((detail) => <span key={detail}>{detail}</span>)}
          </span>
        )}
      </span>
    </button>
  );
});

/**
 * Dernière case d'une zone trop remplie : les affiches cachées empilées et
 * leur nombre. Une vraie vignette plutôt qu'un petit bouton dans l'en-tête :
 * on voit qu'il reste des titres, et la cible est aussi grande qu'une carte.
 */
export const MoreTile = memo(function MoreTile({ zone, map, hiddenCount, expanded, onToggle }: {
  zone: MapZone;
  map: CineMap;
  hiddenCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const isPerson = map.items[zone.items[0]]?.type === 'person';
  const hidden = zone.items
    .slice(zone.items.length - hiddenCount)
    .slice(0, 3)
    .map((key) => map.items[key])
    .filter((item): item is MapItem => Boolean(item));
  return (
    <button
      type="button"
      className={cn('cg-more', isPerson ? 'cg-more--person' : 'cg-more--work', expanded && 'is-expanded')}
      style={zoneStyle(ZONE_META[zone.kind].color)}
      aria-expanded={expanded}
      aria-label={expanded ? t('cinegraph.seeLess') : t('cinegraph.seeMore', { count: hiddenCount })}
      onClick={onToggle}
    >
      {expanded ? (
        <span className="cg-more-icon" aria-hidden="true">
          <ChevronUp size={26} />
        </span>
      ) : (
        <span className="cg-more-stack" aria-hidden="true">
          {hidden.map((item, index) => (
            <span key={item.key} className="cg-more-thumb" style={{ '--i': index, '--n': hidden.length } as CSSProperties}>
              <EntityImage src={item.img} type={item.type} />
            </span>
          ))}
          <span className="cg-more-count">+{hiddenCount}</span>
        </span>
      )}
      <span className="cg-more-label">{expanded ? t('cinegraph.seeLess') : t('cinegraph.seeMoreShort')}</span>
    </button>
  );
});

/** Titre d'une zone : la raison commune à tous ses éléments. */
export function ZoneHeader({ zone, map, total, onFocusZone }: {
  zone: MapZone;
  map: CineMap;
  total: number;
  /** Vue carte : un clic sur le titre zoome sur la zone. */
  onFocusZone?: () => void;
}) {
  const { t } = useTranslation();
  const { icon: Icon, color } = ZONE_META[zone.kind];
  const label = (
    <>
      <span className="cg-zone-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="cg-zone-text">
        <span className="cg-zone-title">
          <span className="cg-zone-name">{zoneTitle(t, zone, map)}</span>
          <span className="cg-zone-count">{total}</span>
          {onFocusZone && <ZoomIn size={14} className="cg-zone-focus-icon" aria-hidden="true" />}
        </span>
        <span className="cg-zone-desc">{zoneDescription(t, zone, map)}</span>
      </span>
    </>
  );
  return (
    <div className="cg-zone-head" style={zoneStyle(color)}>
      {onFocusZone ? (
        <button type="button" className="cg-zone-focus" onClick={onFocusZone} title={t('cinegraph.focusZone')}>
          {label}
        </button>
      ) : label}
    </div>
  );
}
