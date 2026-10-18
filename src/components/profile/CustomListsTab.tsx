// Onglet « Mes listes » du profil : vue d'ensemble des listes perso, liste
// ouverte (entrées réordonnables ou tous les films de ses sagas), détail d'une
// saga, partage par code ou au catalogue.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Film,
  Globe,
  GripVertical,
  Info,
  Layers,
  Link2,
  List,
  Lock,
  MoreVertical,
  Pencil,
  Plus,
  Share2,
  Trash2,
  Tv,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import NewListModal from '@/components/NewListModal';
import AgeRestrictedMedia from '@/components/AgeRestrictedMedia';
import TurnstileWidget from '@/components/TurnstileWidget';
import { useTurnstileBypass } from '@/hooks/useTurnstileBypass';
import { ADMIN_BYPASS_TOKEN } from '@/utils/turnstileBypass';
import { TURNSTILE_SITE_KEY } from '@/utils/turnstileKeys';
import { copyText } from '@/utils/clipboard';
import { fetchTmdb, getWatchItemTitle, posterUrl } from './storage';
import type { CustomList, CustomListItem, SharedListStatus } from './types';
import {
  Button,
  EmptyState,
  IconButton,
  PosterBadge,
  PosterGrid,
  PosterTicket,
  Spinner,
  buttonClass,
  ticketToneAt,
} from './ui';

const API_URL = import.meta.env.VITE_MAIN_API;

// Même rendu qu'IconButton (ton clair), pour les déclencheurs qui ont besoin
// d'une ref (menu Radix, poignée dnd-kit).
const LIGHT_ICON_BUTTON =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white [&_svg]:opacity-80 ' +
  'transition-[background-color,color,transform] duration-150 hover:bg-white/[0.16] hover:[&_svg]:opacity-100 active:scale-[0.94] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70';

const DARK_ICON_BUTTON =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/70 text-white ' +
  'transition-[background-color,transform] duration-150 hover:bg-black active:scale-[0.94] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 cursor-grab active:cursor-grabbing';

const MENU_CONTENT_CLASS = 'min-w-[200px] border-white/10 bg-gray-900 backdrop-blur-none';
const MENU_ITEM_CLASS = 'gap-2 text-white/85 focus:text-white [&_svg]:text-white [&_svg]:opacity-85 focus:[&_svg]:opacity-100';

type ListViewMode = 'items' | 'flat';

interface DragHandleProps {
  ref: (node: HTMLElement | null) => void;
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
}

interface TmdbMovie {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  adult?: boolean;
}

interface FlatEntry {
  key: string;
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  poster: string;
  year: string;
  adult?: boolean;
  /** Entrée individuelle de la liste (null pour un film venu d'une saga). */
  source: CustomListItem | null;
}

interface FlatGroup {
  key: string;
  /** Saga d'origine, ou null pour le groupe des films et séries ajoutés seuls. */
  saga: CustomListItem | null;
  entries: FlatEntry[];
}

interface OpenedCollection {
  id: number;
  name: string;
}

// --- Aides --------------------------------------------------------------------

const itemKey = (item: Pick<CustomListItem, 'type' | 'id'>) => `${item.type}-${item.id}`;

/** Une saga compte pour son nombre de films, le reste pour un élément. */
const countListItems = (list: CustomList) =>
  list.items.reduce((total, item) => total + (item.type === 'collection' ? item.movieCount || 0 : 1), 0);

const yearOf = (date?: string) => (date && /^\d{4}/.test(date) ? date.slice(0, 4) : '');

/** Films d'une saga dans l'ordre de sortie, les dates inconnues à la fin. */
const sortByRelease = (parts: TmdbMovie[]) =>
  [...parts].sort((a, b) => {
    const da = a.release_date || '';
    const db = b.release_date || '';
    if (!da) return db ? 1 : 0;
    if (!db) return -1;
    return da.localeCompare(db);
  });

const getAuth = () => ({
  profileId: localStorage.getItem('selected_profile_id'),
  token: localStorage.getItem('auth_token'),
});

const shareUrlFor = (shareCode: string) => `${window.location.origin}/list/${shareCode}`;

// --- Éléments réordonnables ----------------------------------------------------

function SortableBlock({ id, children }: { id: string; children: (handle: DragHandleProps) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 'auto',
  };
  return (
    <div ref={setNodeRef} style={style} className="relative">
      {children({ ref: setActivatorNodeRef, listeners, attributes })}
    </div>
  );
}

/** Poignée de glisser-déposer : seule zone qui bloque le défilement tactile. */
function DragHandle({ handle, label, className }: { handle: DragHandleProps; label: string; className: string }) {
  return (
    <button
      type="button"
      ref={handle.ref}
      {...handle.attributes}
      {...handle.listeners}
      aria-label={label}
      title={label}
      onClick={(event) => event.stopPropagation()}
      className={`${className} cursor-grab active:cursor-grabbing`}
      style={{ touchAction: 'none' }}
    >
      <GripVertical className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

// --- Champ de renommage --------------------------------------------------------

interface RenameFieldProps {
  initial: string;
  placeholder: string;
  className: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onSave: (name: string) => void;
  onCancel: () => void;
}

/** Entrée valide, Échap annule, la perte du focus enregistre si le nom n'est pas vide. */
function RenameField({ initial, placeholder, className, inputRef, onSave, onCancel }: RenameFieldProps) {
  const [value, setValue] = useState(initial);
  const settledRef = useRef(false);

  const settle = (save: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const trimmed = value.trim();
    if (save && trimmed && trimmed !== initial) onSave(trimmed);
    else onCancel();
  };

  return (
    <form
      className="min-w-0 flex-1"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        settle(true);
      }}
    >
      <input
        ref={inputRef}
        value={value}
        autoFocus
        maxLength={100}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => settle(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            settle(false);
          }
        }}
        className={`w-full min-w-0 rounded-lg bg-black px-3 text-white outline-none ring-1 ring-white/15 placeholder:text-white/40 focus:ring-2 focus:ring-red-600 ${className}`}
      />
    </form>
  );
}

// --- Onglet ---------------------------------------------------------------------

interface CustomListsTabProps {
  lists: CustomList[];
  saveLists: (next: CustomList[]) => void;
  loading: boolean;
}

export default function CustomListsTab({ lists, saveLists, loading }: CustomListsTabProps): JSX.Element {
  const { t } = useTranslation();

  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ListViewMode>('items');
  const [openedCollection, setOpenedCollection] = useState<OpenedCollection | null>(null);
  const [collectionMovies, setCollectionMovies] = useState<TmdbMovie[]>([]);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [flatGroups, setFlatGroups] = useState<FlatGroup[]>([]);
  const [loadingFlat, setLoadingFlat] = useState(false);

  const [renamingListId, setRenamingListId] = useState<number | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameFromMenuRef = useRef(false);

  const [pendingDelete, setPendingDelete] = useState<CustomList | null>(null);
  const [showNewListModal, setShowNewListModal] = useState(false);

  const [sharedStatus, setSharedStatus] = useState<Record<string, SharedListStatus>>({});
  const [sharingListId, setSharingListId] = useState<number | null>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReset, setTurnstileReset] = useState(0);
  const turnstileBypass = useTurnstileBypass();

  const [activeListDragId, setActiveListDragId] = useState<string | null>(null);
  const [activeItemDragId, setActiveItemDragId] = useState<string | null>(null);

  const selectedList = useMemo(
    () => (selectedListId === null ? null : lists.find((list) => list.id === selectedListId) ?? null),
    [lists, selectedListId],
  );
  const selectedItems = selectedList?.items;
  const selectedItemsRef = useRef<CustomListItem[]>([]);
  selectedItemsRef.current = selectedItems ?? [];
  const hasCollections = !!selectedItems?.some((item) => item.type === 'collection');
  const selectedItemsKey = selectedItems ? selectedItems.map(itemKey).join(',') : '';

  // Jeton de partage : marqueur de dispense pour les admins, sinon le widget.
  const shareToken = turnstileBypass === 'bypass' ? ADMIN_BYPASS_TOKEN : turnstileToken;
  const canShare = !TURNSTILE_SITE_KEY || !!shareToken;

  const typeLabel = (type: CustomListItem['type']) =>
    type === 'movie' ? t('profilePage.media.movie') : type === 'tv' ? t('profilePage.media.series') : t('profilePage.media.collection');

  // --- Navigation ---------------------------------------------------------------

  // Avec au moins une saga on démarre sur tous les films, sinon sur les entrées.
  const openList = (list: CustomList) => {
    setSelectedListId(list.id);
    setFlatGroups([]);
    setOpenedCollection(null);
    setViewMode(list.items.some((item) => item.type === 'collection') ? 'flat' : 'items');
  };

  const closeList = () => {
    setSelectedListId(null);
    setViewMode('items');
    setFlatGroups([]);
    setOpenedCollection(null);
    setRenamingListId(null);
  };

  // La liste ouverte a disparu (suppression ailleurs, synchro) : retour à l'ensemble.
  useEffect(() => {
    if (selectedListId === null || loading || selectedList) return;
    setSelectedListId(null);
    setViewMode('items');
    setFlatGroups([]);
    setOpenedCollection(null);
    setRenamingListId(null);
  }, [selectedListId, selectedList, loading]);

  // Plus aucune saga : la vue « tous les films » n'a plus de sens.
  useEffect(() => {
    if (viewMode === 'flat' && selectedItems && !hasCollections) setViewMode('items');
  }, [viewMode, selectedItems, hasCollections]);

  // --- Saga ouverte -------------------------------------------------------------

  const openCollection = (item: CustomListItem) => {
    setOpenedCollection({ id: item.id, name: getWatchItemTitle(item) });
  };

  const openedCollectionId = openedCollection?.id ?? null;
  useEffect(() => {
    if (openedCollectionId === null) return undefined;
    let cancelled = false;
    setLoadingCollection(true);
    setCollectionMovies([]);
    fetchTmdb<{ name?: string; parts?: TmdbMovie[] }>(`/collection/${openedCollectionId}`).then((data) => {
      if (cancelled) return;
      setCollectionMovies(sortByRelease(Array.isArray(data?.parts) ? data.parts : []));
      const tmdbName = data?.name;
      if (tmdbName) {
        setOpenedCollection((current) => (current && current.id === openedCollectionId && current.name !== tmdbName
          ? { ...current, name: tmdbName }
          : current));
      }
      setLoadingCollection(false);
    });
    return () => { cancelled = true; };
  }, [openedCollectionId]);

  // --- Vue « tous les films » ---------------------------------------------------

  useEffect(() => {
    if (viewMode !== 'flat' || !selectedItemsKey) return undefined;
    let cancelled = false;
    const items = selectedItemsRef.current;
    setLoadingFlat(true);

    const sagas = items.filter((item) => item.type === 'collection');
    const singles = items.filter((item) => item.type !== 'collection');

    // Toutes les requêtes partent ensemble (fetchTmdb les met en cache).
    Promise.all([
      Promise.all(sagas.map((saga) => fetchTmdb<{ parts?: TmdbMovie[] }>(`/collection/${saga.id}`))),
      Promise.all(singles.map((item) => fetchTmdb<TmdbMovie>(`/${item.type}/${item.id}`))),
    ]).then(([sagaData, singleData]) => {
      if (cancelled) return;
      const groups: FlatGroup[] = sagas.map((saga, index) => {
        const parts = sortByRelease(Array.isArray(sagaData[index]?.parts) ? sagaData[index]!.parts! : []);
        return {
          key: itemKey(saga),
          saga,
          entries: parts.map((movie) => ({
            key: `${saga.id}-movie-${movie.id}`,
            id: movie.id,
            mediaType: 'movie' as const,
            title: movie.title || movie.name || '',
            poster: posterUrl(movie.poster_path, 342),
            year: yearOf(movie.release_date),
            adult: movie.adult,
            source: null,
          })),
        };
      });
      if (singles.length > 0) {
        groups.push({
          key: 'singles',
          saga: null,
          entries: singles.map((item, index) => {
            // Si TMDB ne répond pas, l'entrée reste affichée avec ce qui est stocké.
            const data = singleData[index];
            return {
              key: itemKey(item),
              id: item.id,
              mediaType: item.type === 'tv' ? 'tv' as const : 'movie' as const,
              title: data?.title || data?.name || item.title || item.name || '',
              poster: posterUrl(data?.poster_path || item.poster_path, 342),
              year: yearOf(data?.release_date || data?.first_air_date),
              adult: data?.adult,
              source: item,
            };
          }),
        });
      }
      setFlatGroups(groups);
      setLoadingFlat(false);
    });
    return () => { cancelled = true; };
  }, [viewMode, selectedItemsKey]);

  // --- Modifications des listes -------------------------------------------------

  const updateList = useCallback((listId: number, change: (list: CustomList) => CustomList) => {
    saveLists(lists.map((list) => (list.id === listId ? change(list) : list)));
  }, [lists, saveLists]);

  const removeItem = (listId: number, target: Pick<CustomListItem, 'type' | 'id'>) => {
    // Type et identifiant : un film et une saga peuvent partager le même id TMDB.
    updateList(listId, (list) => ({ ...list, items: list.items.filter((item) => itemKey(item) !== itemKey(target)) }));
  };

  const renameList = (listId: number, name: string) => {
    updateList(listId, (list) => ({ ...list, name }));
    setRenamingListId(null);
  };

  const createList = (name: string) => {
    saveLists([...lists, { id: Date.now(), name, items: [] }]);
    setShowNewListModal(false);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const deletedId = pendingDelete.id;
    saveLists(lists.filter((list) => list.id !== deletedId));
    setPendingDelete(null);
    if (selectedListId === deletedId) closeList();
  };

  const startRenaming = (listId: number, fromMenu = false) => {
    renameFromMenuRef.current = fromMenu;
    setRenamingListId(listId);
  };

  // --- Glisser-déposer ----------------------------------------------------------

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleListDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveListDragId(null);
    if (!over || active.id === over.id) return;
    const from = lists.findIndex((list) => String(list.id) === String(active.id));
    const to = lists.findIndex((list) => String(list.id) === String(over.id));
    if (from === -1 || to === -1) return;
    saveLists(arrayMove(lists, from, to));
  };

  const handleItemDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveItemDragId(null);
    if (!selectedList || !over || active.id === over.id) return;
    const from = selectedList.items.findIndex((item) => itemKey(item) === String(active.id));
    const to = selectedList.items.findIndex((item) => itemKey(item) === String(over.id));
    if (from === -1 || to === -1) return;
    updateList(selectedList.id, (list) => ({ ...list, items: arrayMove(list.items, from, to) }));
  };

  // --- Partage ------------------------------------------------------------------

  // Statut chargé une fois à l'affichage de l'onglet, seulement si connecté.
  useEffect(() => {
    const { profileId, token } = getAuth();
    if (!profileId || !token) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/api/shared-lists/share/status`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { profileId },
    }).then((response) => {
      if (!cancelled && response.data?.shared) setSharedStatus(response.data.shared);
    }).catch((error) => {
      console.error('Erreur chargement statut partage:', error);
    });
    return () => { cancelled = true; };
  }, []);

  const copyShareLink = async (shareCode: string) => {
    if (await copyText(shareUrlFor(shareCode))) toast.success(t('profilePage.sharing.copied'));
  };

  const shareList = async (listId: number, publishToCatalog: boolean) => {
    const { profileId, token } = getAuth();
    if (!profileId || !token || !canShare) return;
    setSharingListId(listId);
    try {
      const response = await axios.post(`${API_URL}/api/shared-lists/share`, {
        profileId,
        listId: String(listId),
        publishToCatalog,
        turnstileToken: shareToken,
      }, { headers: { Authorization: `Bearer ${token}` } });

      const shareCode: string | undefined = response.data?.shareCode;
      if (shareCode) {
        setSharedStatus((previous) => ({
          ...previous,
          [String(listId)]: { shareCode, sharedAt: Date.now(), isPublicInCatalog: !!response.data?.isPublicInCatalog },
        }));
        // Le lien est copié tout de suite.
        if (await copyText(shareUrlFor(shareCode))) toast.success(t('profilePage.sharing.copied'));
        else console.error('Erreur partage liste: copie du lien impossible');
      }
    } catch (error) {
      console.error('Erreur partage liste:', error);
    } finally {
      // Un jeton Turnstile ne sert qu'une fois ; un dispensé n'a rien à réinitialiser.
      if (turnstileBypass === 'challenge') setTurnstileReset((value) => value + 1);
      setSharingListId(null);
    }
  };

  const unshareList = async (listId: number) => {
    const { profileId, token } = getAuth();
    if (!profileId || !token) return;
    setSharingListId(listId);
    try {
      await axios.delete(`${API_URL}/api/shared-lists/share`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { profileId, listId: String(listId) },
      });
      setSharedStatus((previous) => {
        const next = { ...previous };
        delete next[String(listId)];
        return next;
      });
    } catch (error) {
      console.error('Erreur suppression partage:', error);
    } finally {
      setSharingListId(null);
    }
  };

  // --- Rendus -------------------------------------------------------------------

  const deleteDialog = (
    <ConfirmDialog
      isOpen={!!pendingDelete}
      title={t('profilePage.lists.deleteTitle', 'Supprimer cette liste ?')}
      message={t('profilePage.lists.deleteMessage', '« {{name}} » et tout son contenu seront supprimés. Cette action est définitive.', { name: pendingDelete?.name ?? '' })}
      confirmLabel={t('profilePage.sharing.delete')}
      variant="destructive"
      onConfirm={confirmDelete}
      onCancel={() => setPendingDelete(null)}
    />
  );

  const shareBadge = (status: SharedListStatus | undefined, short: boolean) => status && (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/80">
      <Share2 className="h-3 w-3" aria-hidden="true" />
      {short
        ? (status.isPublicInCatalog ? t('profilePage.customLists.catalogLabel') : t('profilePage.customLists.codeLabel'))
        : (status.isPublicInCatalog ? t('profilePage.sharing.publicCatalog') : t('profilePage.sharing.sharedByCode'))}
    </span>
  );

  // Détail d'une saga ouverte depuis une liste.
  const renderCollection = (collection: OpenedCollection) => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton tone="light" label={t('profilePage.lists.back', 'Retour')} onClick={() => setOpenedCollection(null)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <h2 className="min-w-0 truncate text-2xl font-semibold tracking-tight text-white">{collection.name}</h2>
        </div>
        <Link to={`/collection/${collection.id}`} className={buttonClass('secondary')}>
          <Info className="h-4 w-4" aria-hidden="true" />
          {t('profilePage.collectionView.viewCollection')}
        </Link>
      </div>

      {loadingCollection ? (
        <Spinner />
      ) : collectionMovies.length === 0 ? (
        <EmptyState
          icon={<Film />}
          title={t('profilePage.collectionView.noMovieFound')}
          description={t('profilePage.collectionView.noMovieFoundDesc')}
        />
      ) : (
        <PosterGrid>
          {collectionMovies.map((movie, index) => (
            <AgeRestrictedMedia key={movie.id} item={{ id: movie.id, adult: movie.adult, media_type: 'movie' }}>
              <PosterTicket
                title={movie.title || movie.name || ''}
                poster={posterUrl(movie.poster_path, 342)}
                fallbackIcon={<Film />}
                to={`/movie/${movie.id}`}
                badge={<PosterBadge>#{index + 1}</PosterBadge>}
                metaLeft={t('profilePage.media.movie')}
                metaRight={yearOf(movie.release_date)}
                tone={ticketToneAt(index)}
              />
            </AgeRestrictedMedia>
          ))}
        </PosterGrid>
      )}
    </div>
  );

  // Tous les films de la liste, groupés par saga, chaque saga retirable seule.
  const renderFlatBody = (list: CustomList) => {
    if (loadingFlat && flatGroups.length === 0) return <Spinner />;
    if (!flatGroups.some((group) => group.entries.length > 0 || group.saga)) {
      return (
        <EmptyState
          icon={<Film />}
          title={t('profilePage.collectionView.noMovieFound')}
          description={t('profilePage.collectionView.noMovieFoundDesc')}
        />
      );
    }

    return (
      <div className="space-y-10">
        {flatGroups.map((group) => {
          const saga = group.saga;
          const heading = saga ? getWatchItemTitle(saga) : t('profilePage.lists.singleItems', 'Films et séries ajoutés');
          return (
            <section key={group.key} aria-label={heading}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-semibold text-white">{heading}</h3>
                  <p className="text-sm text-white/55">
                    {saga
                      ? t('profilePage.customLists.filmCount', { count: group.entries.length })
                      : t('profilePage.customLists.itemCount', { count: group.entries.length })}
                  </p>
                </div>
                {saga && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openCollection(saga)}>
                      <Layers className="h-4 w-4" aria-hidden="true" />
                      {t('profilePage.lists.openSaga', 'Ouvrir la saga')}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => removeItem(list.id, saga)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {t('profilePage.lists.removeSaga', 'Retirer cette saga')}
                    </Button>
                  </div>
                )}
              </div>

              {group.entries.length === 0 ? (
                <p className="text-[15px] text-white/60">{t('profilePage.collectionView.noMovieFoundDesc')}</p>
              ) : (
                <PosterGrid>
                  {group.entries.map((entry, index) => (
                    <AgeRestrictedMedia key={entry.key} item={{ id: entry.id, adult: entry.adult, media_type: entry.mediaType }}>
                      <PosterTicket
                        title={entry.title}
                        poster={entry.poster}
                        fallbackIcon={entry.mediaType === 'tv' ? <Tv /> : <Film />}
                        to={`/${entry.mediaType}/${entry.id}`}
                        badge={saga ? <PosterBadge>#{index + 1}</PosterBadge> : undefined}
                        metaLeft={entry.mediaType === 'tv' ? t('profilePage.media.series') : t('profilePage.media.movie')}
                        metaRight={entry.year}
                        tone={ticketToneAt(index)}
                        actions={entry.source ? (
                          <IconButton
                            tone="danger"
                            label={t('profilePage.collectionView.removeFromList')}
                            onClick={() => removeItem(list.id, entry.source as CustomListItem)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </IconButton>
                        ) : undefined}
                      />
                    </AgeRestrictedMedia>
                  ))}
                </PosterGrid>
              )}
            </section>
          );
        })}
      </div>
    );
  };

  // Entrées de la liste, réordonnables ; une saga s'ouvre au clic.
  const renderItemsBody = (list: CustomList) => {
    if (list.items.length === 0) {
      return (
        <EmptyState
          icon={<List />}
          title={t('profilePage.sharing.listEmpty')}
          description={t('profilePage.sharing.listEmptyDesc')}
          action={{ label: t('profilePage.emptyStates.exploreCatalog'), to: '/' }}
        />
      );
    }

    const draggedItem = activeItemDragId ? list.items.find((item) => itemKey(item) === activeItemDragId) : null;

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(event: DragStartEvent) => setActiveItemDragId(String(event.active.id))}
        onDragEnd={handleItemDragEnd}
        onDragCancel={() => setActiveItemDragId(null)}
      >
        <SortableContext items={list.items.map(itemKey)} strategy={rectSortingStrategy}>
          <PosterGrid>
            {list.items.map((item, index) => {
              const title = getWatchItemTitle(item);
              return (
                <AgeRestrictedMedia key={itemKey(item)} item={item}>
                  <SortableBlock id={itemKey(item)}>
                    {(handle) => (
                      <PosterTicket
                        title={title}
                        poster={posterUrl(item.poster_path, 342)}
                        fallbackIcon={item.type === 'tv' ? <Tv /> : item.type === 'collection' ? <Layers /> : <Film />}
                        to={item.type === 'collection' ? undefined : `/${item.type}/${item.id}`}
                        onOpen={item.type === 'collection' ? () => openCollection(item) : undefined}
                        metaLeft={typeLabel(item.type)}
                        metaRight={item.type === 'collection'
                          ? t('profilePage.customLists.filmCount', { count: item.movieCount || 0 })
                          : undefined}
                        tone={ticketToneAt(index)}
                        actions={(
                          <>
                            <DragHandle handle={handle} label={t('profilePage.lists.dragItem', 'Déplacer {{name}}', { name: title })} className={DARK_ICON_BUTTON} />
                            <IconButton
                              tone="danger"
                              label={item.type === 'collection'
                                ? t('profilePage.lists.removeSaga', 'Retirer cette saga')
                                : t('profilePage.collectionView.removeFromList')}
                              onClick={() => removeItem(list.id, item)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </IconButton>
                          </>
                        )}
                      />
                    )}
                  </SortableBlock>
                </AgeRestrictedMedia>
              );
            })}
          </PosterGrid>
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
          {draggedItem ? (
            <div className="aspect-[2/3] w-28 overflow-hidden rounded-lg bg-gray-800 ring-2 ring-red-600 sm:w-32">
              {draggedItem.poster_path && (
                <img src={posterUrl(draggedItem.poster_path, 185)} alt="" className="h-full w-full object-cover" />
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    );
  };

  const renderOpenedList = (list: CustomList) => {
    const shareInfo = sharedStatus[String(list.id)];
    const isSharing = sharingListId === list.id;
    const isFlat = viewMode === 'flat';

    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <IconButton tone="light" label={t('profilePage.lists.back', 'Retour')} onClick={closeList}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            {renamingListId === list.id ? (
              <RenameField
                initial={list.name}
                inputRef={renameInputRef}
                placeholder={t('profilePage.customLists.listNamePlaceholder')}
                className="h-10 max-w-md text-xl font-semibold"
                onSave={(name) => renameList(list.id, name)}
                onCancel={() => setRenamingListId(null)}
              />
            ) : (
              <h2 className="min-w-0 text-2xl font-semibold tracking-tight text-white">
                <button
                  type="button"
                  onClick={() => startRenaming(list.id)}
                  title={t('profilePage.customLists.clickToRename')}
                  className="max-w-full truncate rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  {list.name}
                </button>
              </h2>
            )}
            {renamingListId !== list.id && (
              <IconButton tone="light" label={t('profilePage.customLists.rename')} onClick={() => startRenaming(list.id)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[15px] text-white/60">
            <span>{t('profilePage.customLists.itemCount', { count: countListItems(list) })}</span>
            {shareBadge(shareInfo, false)}
          </div>

          {/* Widget Turnstile du partage — masqué pour les dispensés */}
          {TURNSTILE_SITE_KEY && turnstileBypass === 'challenge' && (
            <div className="max-w-full overflow-hidden [&_iframe]:max-w-full">
              <TurnstileWidget
                onTokenChange={setTurnstileToken}
                resetSignal={turnstileReset}
                className="origin-left scale-[0.85] sm:scale-100"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {shareInfo ? (
              <>
                <Button variant="primary" onClick={() => copyShareLink(shareInfo.shareCode)}>
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  {t('profilePage.sharing.copyLink')}
                </Button>
                <Button
                  onClick={() => shareList(list.id, !shareInfo.isPublicInCatalog)}
                  disabled={!canShare}
                  loading={isSharing}
                >
                  {!isSharing && (shareInfo.isPublicInCatalog
                    ? <Lock className="h-4 w-4" aria-hidden="true" />
                    : <Globe className="h-4 w-4" aria-hidden="true" />)}
                  {shareInfo.isPublicInCatalog ? t('profilePage.sharing.switchToPrivate') : t('profilePage.sharing.publishToCatalog')}
                </Button>
                <Button onClick={() => unshareList(list.id)} disabled={isSharing}>
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  {t('profilePage.sharing.removeSharing')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" onClick={() => shareList(list.id, false)} disabled={!canShare} loading={isSharing}>
                  {!isSharing && <Share2 className="h-4 w-4" aria-hidden="true" />}
                  {isSharing ? t('profilePage.sharing.sharingInProgress') : t('profilePage.sharing.shareByCode')}
                </Button>
                <Button onClick={() => shareList(list.id, true)} disabled={!canShare || isSharing}>
                  <Globe className="h-4 w-4" aria-hidden="true" />
                  {t('profilePage.sharing.publishToCatalog')}
                </Button>
              </>
            )}
            {hasCollections && (
              <Button onClick={() => setViewMode(isFlat ? 'items' : 'flat')}>
                {isFlat ? <List className="h-4 w-4" aria-hidden="true" /> : <Film className="h-4 w-4" aria-hidden="true" />}
                {isFlat ? t('profilePage.collectionView.editList') : t('profilePage.collectionView.viewAllMovies')}
              </Button>
            )}
            <Button variant="danger" onClick={() => setPendingDelete(list)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t('profilePage.sharing.delete')}
            </Button>
          </div>
        </div>

        {isFlat ? renderFlatBody(list) : renderItemsBody(list)}
      </div>
    );
  };

  const renderListCard = (list: CustomList, handle: DragHandleProps) => {
    const shareInfo = sharedStatus[String(list.id)];
    const isRenaming = renamingListId === list.id;
    const previews = list.items.slice(0, 4);

    return (
      <div
        className="cursor-pointer rounded-xl bg-gray-900 p-5 transition-colors duration-150 hover:bg-gray-800"
        onClick={() => {
          if (!isRenaming && !activeListDragId) openList(list);
        }}
      >
        {/* Planche des premières affiches de la liste */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openList(list);
          }}
          aria-label={t('profilePage.lists.openList', 'Ouvrir {{name}}', { name: list.name })}
          className="grid w-full grid-cols-4 gap-1.5 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {Array.from({ length: 4 }, (_, index) => {
            const item = previews[index];
            const src = item ? posterUrl(item.poster_path, 185) : '';
            return (
              <span key={index} className="block aspect-[2/3] overflow-hidden bg-gray-800">
                {src && <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
              </span>
            );
          })}
        </button>

        <div className="mt-4 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <RenameField
                initial={list.name}
                inputRef={renameInputRef}
                placeholder={t('profilePage.customLists.listNamePlaceholder')}
                className="h-9 text-lg font-semibold"
                onSave={(name) => renameList(list.id, name)}
                onCancel={() => setRenamingListId(null)}
              />
            ) : (
              <h3 className="text-lg font-semibold text-white">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    startRenaming(list.id);
                  }}
                  title={t('profilePage.customLists.clickToRename')}
                  className="block max-w-full truncate rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  {list.name}
                </button>
              </h3>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-sm text-white/55">{t('profilePage.customLists.itemCount', { count: countListItems(list) })}</span>
              {shareBadge(shareInfo, true)}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('profilePage.lists.listActions', 'Actions de la liste')}
                title={t('profilePage.lists.listActions', 'Actions de la liste')}
                onClick={(event) => event.stopPropagation()}
                className={LIGHT_ICON_BUTTON}
              >
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className={MENU_CONTENT_CLASS}
              // Les clics du menu (rendu en portail) remontent quand même jusqu'à la carte.
              onClick={(event) => event.stopPropagation()}
              onCloseAutoFocus={(event) => {
                // Sans ça, le focus rendu au bouton du menu validerait aussitôt le renommage.
                if (renameFromMenuRef.current) {
                  event.preventDefault();
                  renameFromMenuRef.current = false;
                  renameInputRef.current?.focus();
                }
              }}
            >
              <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => startRenaming(list.id, true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {t('profilePage.customLists.rename')}
              </DropdownMenuItem>
              {shareInfo ? (
                <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => { void copyShareLink(shareInfo.shareCode); }}>
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  {t('profilePage.sharing.copyLink')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className={MENU_ITEM_CLASS}
                  disabled={sharingListId === list.id}
                  onSelect={() => {
                    // Sans jeton (vérification Turnstile à faire), on ouvre la
                    // liste : le widget et le bouton de partage s'y trouvent.
                    if (canShare) void shareList(list.id, false);
                    else openList(list);
                  }}
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  {sharingListId === list.id ? t('profilePage.sharing.sharingInProgress') : t('profilePage.sharing.shareByCode')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem
                className="gap-2 text-red-300 focus:bg-red-600 focus:text-white"
                onSelect={() => setPendingDelete(list)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t('profilePage.sharing.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DragHandle handle={handle} label={t('profilePage.lists.dragList', 'Déplacer la liste {{name}}', { name: list.name })} className={LIGHT_ICON_BUTTON} />
        </div>
      </div>
    );
  };

  const renderOverview = () => {
    const draggedList = activeListDragId ? lists.find((list) => String(list.id) === activeListDragId) : null;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight text-white">{t('profilePage.customLists.title')}</h2>
          <div className="flex flex-wrap gap-2">
            <Link to="/list-catalog" className={buttonClass('secondary')}>
              <Globe className="h-4 w-4" aria-hidden="true" />
              {t('profilePage.customLists.listCatalog')}
            </Link>
            <Button variant="primary" onClick={() => setShowNewListModal(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('profilePage.customLists.createList')}
            </Button>
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : lists.length === 0 ? (
          <EmptyState
            icon={<List />}
            title={t('profilePage.customLists.noCustomLists')}
            description={t('profilePage.customLists.noCustomListsDesc')}
            action={{ label: t('profilePage.customLists.createFirstList'), onClick: () => setShowNewListModal(true) }}
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(event: DragStartEvent) => setActiveListDragId(String(event.active.id))}
            onDragEnd={handleListDragEnd}
            onDragCancel={() => setActiveListDragId(null)}
          >
            <SortableContext items={lists.map((list) => String(list.id))} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {lists.map((list) => (
                  <SortableBlock key={list.id} id={String(list.id)}>
                    {(handle) => renderListCard(list, handle)}
                  </SortableBlock>
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
              {draggedList ? (
                <div className="rounded-xl bg-gray-800 p-5 ring-2 ring-red-600">
                  <p className="truncate text-lg font-semibold text-white">{draggedList.name}</p>
                  <p className="mt-1 text-sm text-white/55">
                    {t('profilePage.customLists.itemCount', { count: countListItems(draggedList) })}
                  </p>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    );
  };

  return (
    <>
      {openedCollection
        ? renderCollection(openedCollection)
        : selectedList
          ? renderOpenedList(selectedList)
          : renderOverview()}
      {showNewListModal && <NewListModal onClose={() => setShowNewListModal(false)} onCreateList={createList} />}
      {deleteDialog}
    </>
  );
}
