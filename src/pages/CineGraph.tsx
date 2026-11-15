import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Film,
  HelpCircle,
  List,
  Loader,
  Map as MapIcon,
  MousePointerClick,
  Network,
  RefreshCw,
  Search,
  Shrink,
  Star,
  User,
  X,
} from 'lucide-react';

import { isChunkLoadError, lazyWithRetry } from '@/routing/lazyWithRetry';
import { SquareBackground } from '@/components/ui/square-background';
import { getOverlayPortalRoot } from '@/utils/overlayPortal';
import { encodeId } from '@/utils/idEncoder';
import { cn } from '@/lib/utils';
import { fetchPersonMap, fetchTrending, fetchWorkMap, searchCineGraph } from '@/services/cineGraph/tmdb';
import type { CineMap, EntityType, MapEntity, SearchHit, ZoneKind } from '@/services/cineGraph/types';
import CineMapList from '@/components/cinegraph/CineMapList';
import type { MapViewProps } from '@/components/cinegraph/CineMapCanvas';
import WhyPanel from '@/components/cinegraph/WhyPanel';
import { RootCard } from '@/components/cinegraph/cards';
import { useMediaQuery } from '@/components/cinegraph/useMediaQuery';
import { ZONE_META, zoneTitle } from '@/components/cinegraph/zones';
import '@/styles/cinegraph.css';

// La vue « carte » (React Flow) n'est chargée que sur grand écran. Chargement
// discret : si ce morceau ne vient pas (réseau, cache abîmé), la page garde la
// vue liste au lieu de se recharger. React.lazy garde un échec en mémoire :
// chaque nouvel essai demandé par « Réessayer » repart d'un composant neuf.
type CanvasComponent = React.LazyExoticComponent<React.ComponentType<MapViewProps>>;
const canvasAttempts = new Map<number, CanvasComponent>();
function canvasFor(attempt: number): CanvasComponent {
  let component = canvasAttempts.get(attempt);
  if (!component) {
    component = lazy(() => lazyWithRetry(() => import('@/components/cinegraph/CineMapCanvas'), { silent: true }));
    canvasAttempts.set(attempt, component);
  }
  return component;
}

/** Bascule sur la vue liste si le moteur de carte ne se charge pas. */
class MapEngineBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error)) console.warn('CinéGraph : carte indisponible, affichage en liste', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // Un vrai bug de rendu doit atteindre l'ErrorBoundary de l'application.
    if (!isChunkLoadError(this.state.error)) throw this.state.error;
    return this.props.fallback;
  }
}

type ViewMode = 'map' | 'list';
interface TrailStep {
  type: EntityType;
  id: number;
  title: string;
}

const VIEW_STORAGE_KEY = 'cinegraph-view';
const ENTITY_TYPES: readonly EntityType[] = ['movie', 'tv', 'person'];
const isEntityType = (value: string | null): value is EntityType => ENTITY_TYPES.includes(value as EntityType);

function readViewPreference(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'map';
  } catch {
    return 'map';
  }
}

/** Fil d'Ariane de l'exploration : revenir sur un pas coupe la suite. */
function nextTrail(previous: TrailStep[], map: CineMap, reset: boolean): TrailStep[] {
  const step = { type: map.root.type, id: map.root.tmdbId, title: map.root.title };
  if (reset) return [step];
  const index = previous.findIndex((entry) => entry.type === step.type && entry.id === step.id);
  if (index >= 0) return previous.slice(0, index + 1);
  return [...previous, step].slice(-8);
}

const typeLabelKey: Record<EntityType, string> = {
  movie: 'cinegraph.filmLabel',
  tv: 'cinegraph.seriesLabel',
  person: 'cinegraph.artistLabel',
};

/** La carte tient dans la fenêtre : la molette n'a pas de page à faire défiler. */
const MIN_STAGE_HEIGHT = 460;
const STAGE_BOTTOM_GAP = 16;

interface SearchBoxProps {
  query: string;
  results: SearchHit[];
  searching: boolean;
  open: boolean;
  /** Version courte, dans la barre du plein écran. */
  compact?: boolean;
  containerRef?: React.Ref<HTMLDivElement>;
  onQueryChange: (value: string) => void;
  onFocus: () => void;
  onClear: () => void;
  onPick: (hit: SearchHit) => void;
}

/** Champ de recherche d'un point de départ (film, série ou artiste). */
function SearchBox({ query, results, searching, open, compact, containerRef, onQueryChange, onFocus, onClear, onPick }: SearchBoxProps) {
  const { t } = useTranslation();
  return (
    <div className={cn('cinegraph-search-container', compact && 'is-compact')} ref={containerRef}>
      <div className="cinegraph-search-wrapper">
        <Search size={18} className="cinegraph-search-icon" aria-hidden="true" />
        <input
          type="text"
          className="cinegraph-search-input"
          placeholder={t('cinegraph.searchPlaceholder')}
          aria-label={t('cinegraph.searchPlaceholder')}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={onFocus}
        />
        {query && (
          <button type="button" className="cinegraph-search-clear" aria-label={t('cinegraph.clearSearch')} onClick={onClear}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && query.trim().length >= 2 && (
          <motion.div
            className="cinegraph-search-results"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            onWheel={(event) => event.stopPropagation()}
            data-lenis-prevent
          >
            {searching && results.length === 0 ? (
              <div className="cg-search-state">
                <Loader size={20} className="animate-spin" style={{ color: '#e50914' }} aria-hidden="true" />
              </div>
            ) : results.length > 0 ? (
              results.map((hit) => (
                <button key={`${hit.type}-${hit.id}`} type="button" className="cinegraph-search-result-item" onClick={() => onPick(hit)}>
                  {hit.img ? (
                    <img src={hit.img} alt="" className={cn('cinegraph-search-result-poster', hit.type === 'person' && 'is-person')} />
                  ) : (
                    <span className="cinegraph-search-result-poster-placeholder">
                      {hit.type === 'person' ? <User size={16} aria-hidden="true" /> : <Film size={16} aria-hidden="true" />}
                    </span>
                  )}
                  <span className="cinegraph-search-result-info">
                    <span className="cinegraph-search-result-title">{hit.title}</span>
                    <span className="cinegraph-search-result-meta">
                      <span className={`cinegraph-type-badge ${hit.type}`}>{t(typeLabelKey[hit.type])}</span>
                      {hit.year && <span>{hit.year}</span>}
                      {!!hit.rating && hit.rating > 0 && (
                        <span className="cg-search-rating">
                          <Star size={11} fill="#fbbf24" color="#fbbf24" aria-hidden="true" />
                          {hit.rating.toFixed(1)}
                        </span>
                      )}
                      {hit.knownFor && <span className="cg-search-known">{hit.knownFor}</span>}
                    </span>
                  </span>
                  <Network size={16} className="cg-search-go" aria-hidden="true" />
                </button>
              ))
            ) : (
              <div className="cg-search-state">{t('cinegraph.noResultsFound')}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const CineGraphPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isWide = useMediaQuery('(min-width: 1180px)');
  const isDocked = useMediaQuery('(min-width: 768px)');

  const typeParam = searchParams.get('type');
  const mapType = isEntityType(typeParam) ? typeParam : null;
  const idParam = Number(searchParams.get('id'));
  const mapId = mapType && Number.isInteger(idParam) && idParam > 0 ? idParam : null;

  const [map, setMap] = useState<CineMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [trail, setTrail] = useState<TrailStep[]>([]);
  const resetTrailRef = useRef(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hiddenZones, setHiddenZones] = useState<ReadonlySet<ZoneKind>>(() => new Set());
  const [viewPreference, setViewPreference] = useState<ViewMode>(readViewPreference);
  const view: ViewMode = isWide ? viewPreference : 'list';
  const [canvasAttempt, setCanvasAttempt] = useState(0);
  const CineMapCanvas = canvasFor(canvasAttempt);
  const [fullscreen, setFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageHeight, setStageHeight] = useState<number | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [trending, setTrending] = useState<SearchHit[]>([]);
  const [showHelp, setShowHelp] = useState(false);

  // ─── Chargement de la carte (l'URL fait foi : précédent/suivant marchent) ──

  useEffect(() => {
    if (!mapType || !mapId) {
      setMap(null);
      setSelectedKey(null);
      setError(false);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setSelectedKey(null);
    const request = mapType === 'person'
      ? fetchPersonMap(mapId, controller.signal)
      : fetchWorkMap(mapType, mapId, controller.signal);
    request
      .then((next) => {
        if (controller.signal.aborted) return;
        setMap(next);
        // Une zone masquée sur la carte précédente n'a pas de sens pour la suivante.
        setHiddenZones(new Set());
        setTrail((previous) => nextTrail(previous, next, resetTrailRef.current));
        resetTrailRef.current = false;
      })
      .catch((err) => {
        // Seule notre propre annulation se tait : toute autre coupure doit
        // afficher l'erreur et « Réessayer », jamais une page vide.
        if (controller.signal.aborted) return;
        console.error('CinéGraph : impossible de charger la carte', err);
        // Garder l'ancienne carte sous une URL qui en désigne une autre tromperait.
        setMap(null);
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [mapType, mapId, reloadToken]);

  useEffect(() => {
    if (!loading) return;
    const phrases = [t('cinegraph.mappingCinematicUniverse'), t('cinegraph.discoveringCreativeNetwork')];
    let index = 0;
    setLoadingText(phrases[0]);
    const timer = window.setInterval(() => {
      index = (index + 1) % phrases.length;
      setLoadingText(phrases[index]);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loading, t]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTrending(controller.signal)
      .then((hits) => {
        if (!controller.signal.aborted) setTrending(hits);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const openMap = useCallback((type: EntityType, id: number, fresh: boolean) => {
    setShowResults(false);
    if (type === mapType && id === mapId) {
      if (fresh) setTrail((previous) => previous.slice(-1));
      setSelectedKey(null);
      return;
    }
    resetTrailRef.current = fresh;
    setSearchParams({ type, id: String(id) });
  }, [mapType, mapId, setSearchParams]);

  const closeMap = useCallback(() => {
    setTrail([]);
    setSearchParams({});
  }, [setSearchParams]);

  const openEntityPage = useCallback((entity: MapEntity) => {
    navigate(entity.type === 'person' ? `/person/${entity.tmdbId}` : `/${entity.type}/${encodeId(entity.tmdbId)}`);
  }, [navigate]);

  const exploreEntity = useCallback((entity: MapEntity) => {
    openMap(entity.type, entity.tmdbId, false);
  }, [openMap]);

  const changeView = (next: ViewMode) => {
    setViewPreference(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Préférence de confort : sans stockage, on garde la vue par défaut.
    }
  };

  const toggleZone = (kind: ZoneKind) => {
    setHiddenZones((previous) => {
      const next = new Set(previous);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        // Au moins une zone reste visible, sinon la carte se résume au centre.
        const visible = map?.zones.filter((zone) => !next.has(zone.kind)).length ?? 0;
        if (visible <= 1) return previous;
        next.add(kind);
      }
      return next;
    });
  };

  // ─── Recherche ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchCineGraph(trimmed, controller.signal)
        .then((hits) => {
          if (controller.signal.aborted) return;
          setResults(hits);
          setSearching(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const pickHit = (hit: SearchHit) => {
    setQuery('');
    setResults([]);
    openMap(hit.type, hit.id, true);
  };

  const hasMap = Boolean(map);
  const visibleZones = map?.zones.filter((zone) => zone.items.length > 0) ?? [];
  const canFullscreen = isWide && view === 'map' && visibleZones.length > 0;
  const isFullscreen = fullscreen && canFullscreen;

  // Échap ferme d'abord ce qui est le plus « au-dessus » : la liste de
  // résultats, l'aide, le panneau, puis seulement le plein écran.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showResults) setShowResults(false);
      else if (showHelp) setShowHelp(false);
      else if (selectedKey) setSelectedKey(null);
      else if (isFullscreen) setFullscreen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showResults, showHelp, selectedKey, isFullscreen]);

  // Plein écran : la page dessous ne défile plus.
  useEffect(() => {
    if (!isFullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!canFullscreen) setFullscreen(false);
  }, [canFullscreen]);

  const searchProps = {
    query,
    results,
    searching,
    onQueryChange: (value: string) => {
      setQuery(value);
      setShowResults(true);
    },
    onFocus: () => setShowResults(true),
    onClear: () => {
      setQuery('');
      setResults([]);
    },
    onPick: pickHit,
  };

  const trailNav = trail.length > 1 ? (
    <nav className="cg-trail" aria-label={t('cinegraph.trail')}>
      {trail.map((step, index) => {
        const last = index === trail.length - 1;
        return (
          <React.Fragment key={`${step.type}-${step.id}`}>
            {index > 0 && <ChevronRight size={14} className="cg-trail-sep" aria-hidden="true" />}
            {last ? (
              <span className="cg-trail-step is-current" aria-current="page">{step.title}</span>
            ) : (
              <button type="button" className="cg-trail-step" onClick={() => openMap(step.type, step.id, false)}>
                {step.title}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  ) : null;

  const zoneChips = map ? (
    <div className="cg-zone-chips" role="group" aria-label={t('cinegraph.zonesFilter')}>
      {visibleZones.map((zone) => {
        const { icon: Icon, color } = ZONE_META[zone.kind];
        const active = !hiddenZones.has(zone.kind);
        return (
          <button
            key={zone.kind}
            type="button"
            className={cn('cg-zone-chip', active ? 'is-active' : 'is-inactive')}
            style={{ '--zone': color } as CSSProperties}
            aria-pressed={active}
            onClick={() => toggleZone(zone.kind)}
          >
            <Icon size={13} aria-hidden="true" />
            {zoneTitle(t, zone, map)}
            <span className="cg-zone-chip-count">{zone.items.length}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  // Même contenu dans la page ou en plein écran : un seul des deux est monté.
  const mapList = map ? (
    <CineMapList map={map} hiddenZones={hiddenZones} selectedKey={selectedKey} panelOpen={false} onSelect={setSelectedKey} />
  ) : null;
  const stageContent = map ? (
    <>
      {visibleZones.length === 0 ? (
        <div className="cg-empty">
          <RootCard map={map} selected={selectedKey === map.root.key} variant="list" onSelect={setSelectedKey} />
          <p>{t('cinegraph.emptyMap', { title: map.root.title })}</p>
        </div>
      ) : view === 'map' ? (
        <MapEngineBoundary
          key={canvasAttempt}
          fallback={(
            <div className="cg-stage-scroll" data-lenis-prevent>
              <div className="cg-engine-note" role="status">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{t('cinegraph.mapUnavailable')}</span>
                <button type="button" onClick={() => setCanvasAttempt((attempt) => attempt + 1)}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {t('cinegraph.retry')}
                </button>
              </div>
              {mapList}
            </div>
          )}
        >
          <Suspense
            fallback={(
              <div className="cg-stage-fallback">
                <Loader className="animate-spin" size={28} aria-hidden="true" />
              </div>
            )}
          >
            <CineMapCanvas
              key={map.root.key}
              map={map}
              hiddenZones={hiddenZones}
              selectedKey={selectedKey}
              panelOpen={Boolean(selectedKey) && isDocked}
              onSelect={setSelectedKey}
              fullscreen={isFullscreen}
              onToggleFullscreen={() => setFullscreen((value) => !value)}
            />
          </Suspense>
        </MapEngineBoundary>
      ) : mapList}

      <AnimatePresence>
        {loading && (
          <motion.div className="cg-stage-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="cinegraph-loading-orb" />
            <div className="cinegraph-loading-text">{loadingText}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  ) : null;

  // La carte s'arrête au bas de la fenêtre : la molette sert à la parcourir,
  // il ne doit rester aucune page à faire défiler pour la voir en entier.
  useLayoutEffect(() => {
    if (!hasMap || view !== 'map' || isFullscreen) return;
    const measure = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const top = stage.getBoundingClientRect().top + window.scrollY;
      setStageHeight(Math.max(MIN_STAGE_HEIGHT, Math.round(window.innerHeight - top - STAGE_BOTTOM_GAP)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [hasMap, view, isFullscreen, trail.length, map]);

  return (
    <SquareBackground squareSize={48} borderColor="rgba(229, 9, 20, 0.10)" className="cinegraph-page">
      <div className="cinegraph-header">
        <div className="cinegraph-title-container">
          {(hasMap || mapType) && (
            <motion.button
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={closeMap}
              className="cinegraph-control-btn"
              style={{ padding: '8px 12px' }}
              aria-label={t('cinegraph.backToStart')}
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </motion.button>
          )}
          <h1 className="cinegraph-title">
            <Network size={36} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 10 }} aria-hidden="true" />
            {t('cinegraph.title')}
          </h1>
          <button type="button" className="cinegraph-help-btn" onClick={() => setShowHelp(true)} aria-label={t('cinegraph.howToUse')}>
            <HelpCircle size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="cinegraph-subtitle">
          {map ? t('cinegraph.exploringUniverse', { title: map.root.title }) : t('cinegraph.exploreHiddenConnections')}
        </p>

        <SearchBox
          {...searchProps}
          // En plein écran, c'est le champ de la barre du haut qui sert.
          open={showResults && !isFullscreen}
          containerRef={isFullscreen ? undefined : searchContainerRef}
        />
      </div>

      {/* ─── Carte ─────────────────────────────────────────────────────────── */}
      {map && (
        <motion.div className="cg-workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
          <div className="cg-toolbar">
            {trailNav}
            {zoneChips}

            {isWide && (
              <div className="cg-view-toggle" role="group" aria-label={t('cinegraph.viewMode')}>
                <button type="button" className={cn(view === 'map' && 'is-active')} aria-pressed={view === 'map'} onClick={() => changeView('map')}>
                  <MapIcon size={14} aria-hidden="true" />
                  {t('cinegraph.mapView')}
                </button>
                <button type="button" className={cn(view === 'list' && 'is-active')} aria-pressed={view === 'list'} onClick={() => changeView('list')}>
                  <List size={14} aria-hidden="true" />
                  {t('cinegraph.listView')}
                </button>
              </div>
            )}
          </div>

          <p className="cg-hint">
            <MousePointerClick size={14} aria-hidden="true" />
            {t(view === 'map' ? 'cinegraph.hintMap' : 'cinegraph.hint')}
          </p>

          {!isFullscreen && (
            <div
              ref={stageRef}
              className={cn('cg-stage', view === 'map' ? 'cg-stage--map' : 'cg-stage--list')}
              style={view === 'map' && stageHeight ? { height: stageHeight } : undefined}
            >
              {stageContent}
            </div>
          )}
        </motion.div>
      )}

      {/* ─── Plein écran : la carte occupe toute la fenêtre ────────────────── */}
      {map && isFullscreen && createPortal(
        <div className="cg-fullscreen" role="dialog" aria-modal="true" aria-label={t('cinegraph.fullscreen')} data-lenis-prevent>
          <div className="cg-fullscreen-bar">
            <span className="cg-fullscreen-title">
              <Network size={18} aria-hidden="true" />
              {map.root.title}
            </span>
            {trailNav}
            {zoneChips}
            <SearchBox {...searchProps} compact open={showResults} containerRef={searchContainerRef} />
            <button type="button" className="cinegraph-control-btn cg-fullscreen-exit" onClick={() => setFullscreen(false)}>
              <Shrink size={14} aria-hidden="true" />
              {t('cinegraph.exitFullscreen')}
              <kbd>{t('cinegraph.escKey')}</kbd>
            </button>
          </div>
          <div className="cg-stage cg-stage--map cg-stage--fullscreen">{stageContent}</div>
        </div>,
        getOverlayPortalRoot(),
      )}

      {/* ─── Premier chargement et erreurs ─────────────────────────────────── */}
      {!map && loading && (
        <div className="cinegraph-loading">
          <div className="cinegraph-loading-orb" />
          <div className="cinegraph-loading-text">{loadingText}</div>
        </div>
      )}

      {error && !loading && (
        <div className="cg-error" role="alert">
          <p>{t('cinegraph.loadError')}</p>
          <button type="button" className="cinegraph-detail-link secondary" onClick={() => setReloadToken((value) => value + 1)}>
            <RefreshCw size={16} aria-hidden="true" />
            {t('cinegraph.retry')}
          </button>
        </div>
      )}

      {/* ─── Écran de départ : tendances ───────────────────────────────────── */}
      {!map && !loading && !mapType && (
        <motion.div
          className="cinegraph-start-grid"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <h2>{t('cinegraph.trendingChoose')}</h2>
          <div className="cinegraph-start-items">
            {trending.map((hit) => (
              <motion.button
                key={`${hit.type}-${hit.id}`}
                type="button"
                className="cinegraph-start-item"
                onClick={() => openMap(hit.type, hit.id, true)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                {hit.img ? (
                  <img src={hit.img} alt="" loading="lazy" />
                ) : (
                  <span className="cinegraph-start-item-placeholder">
                    <Film size={28} aria-hidden="true" />
                  </span>
                )}
                <span className="cinegraph-start-item-info">
                  <span className="cinegraph-start-item-title">{hit.title}</span>
                  <span className="cinegraph-start-item-meta">
                    {t(typeLabelKey[hit.type])}
                    {hit.year && ` • ${hit.year}`}
                  </span>
                </span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}

      {/* ─── Panneau « Pourquoi c'est là ? » ───────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {map && selectedKey && (
            <WhyPanel
              key="why"
              map={map}
              itemKey={selectedKey}
              docked={isDocked}
              onClose={() => setSelectedKey(null)}
              onSelect={setSelectedKey}
              onExplore={exploreEntity}
              onOpen={openEntityPage}
            />
          )}
        </AnimatePresence>,
        getOverlayPortalRoot(),
      )}

      {/* ─── Aide ──────────────────────────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {showHelp && (
            <motion.div
              key="help"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[100000]"
              onClick={(event) => {
                if (event.target === event.currentTarget) setShowHelp(false);
              }}
              onWheel={(event) => event.stopPropagation()}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="cinegraph-help-title"
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="bg-gray-900 border border-white/10 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[85dvh]"
              >
                <div className="p-4 md:p-6 border-b border-white/10 flex justify-between items-center shrink-0">
                  <h3 id="cinegraph-help-title" className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
                    <HelpCircle className="text-red-500 h-5 w-5 md:h-6 md:w-6" aria-hidden="true" />
                    {t('cinegraph.howToUse')}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowHelp(false)}
                    className="text-white/60 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
                    aria-label={t('cinegraph.close')}
                  >
                    <X className="w-5 h-5 md:w-6 md:h-6" aria-hidden="true" />
                  </button>
                </div>
                <div className="p-4 md:p-6 flex-1 overflow-y-auto custom-scrollbar overscroll-contain" data-lenis-prevent>
                  <p className="text-white/70 text-sm md:text-base mb-5 leading-relaxed text-center">
                    {t('cinegraph.visualizesDescription')}
                  </p>
                  <div className="flex flex-col gap-3">
                    {(['start', 'read', 'why', 'explore', 'navigate'] as const).map((step) => (
                      <div key={step} className="flex gap-3 items-start p-3 md:p-4 rounded-lg bg-white/5 border border-white/5">
                        <span className="text-xl md:text-2xl shrink-0 mt-0.5" aria-hidden="true">{t(`cinegraph.help.${step}.icon`)}</span>
                        <div>
                          <h4 className="font-semibold text-white text-sm md:text-base">{t(`cinegraph.help.${step}.title`)}</h4>
                          <p className="text-white/60 text-xs md:text-sm mt-1 leading-relaxed">{t(`cinegraph.help.${step}.desc`)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        getOverlayPortalRoot(),
      )}
    </SquareBackground>
  );
};

export default CineGraphPage;
