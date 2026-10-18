// Grille d'affiches des onglets « À voir », « Favoris » et « Déjà vu ».
// Une série s'ouvre sur place : son panneau d'épisodes prend toute la
// largeur sous sa rangée (grid-flow-row-dense remonte les affiches
// suivantes dans les trous de la rangée).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, Layers, ListVideo, Monitor, Tv, X } from 'lucide-react';
import { useAgeRestrictedContent } from '@/hooks/useAgeRestrictedContent';
import { encodeId } from '@/utils/idEncoder';
import { getWatchItemKey, getWatchItemTitle, isTmdbWatchItem, posterUrl } from './storage';
import TvEpisodePanel from './TvEpisodePanel';
import { IconButton, PosterTicket, ticketToneAt } from './ui';
import type { MainListType, WatchItem } from './types';

export function watchItemPath(item: WatchItem): string {
  if (item.type === 'shared-list') return `/list/${encodeURIComponent(item.shareCode || String(item.id))}`;
  if (item.type === 'live-tv') {
    const source = item.source?.trim();
    const targetId = item.liveTvTargetId?.trim();
    if (!source || !targetId || !item.liveTvKind) return '/live-tv';
    const params = new URLSearchParams({ source, targetId, kind: item.liveTvKind });
    if (item.liveTvCatalogId) params.set('catalogId', item.liveTvCatalogId);
    if (item.liveTvCategoryId) params.set('categoryId', item.liveTvCategoryId);
    return `/live-tv?${params.toString()}`;
  }
  if (typeof item.id !== 'number') return '/';
  if (item.type === 'collection') return `/collection/${item.id}`;
  return `/${item.type}/${encodeId(item.id)}`;
}

const FALLBACK_ICONS = {
  movie: <Film />,
  tv: <Tv />,
  collection: <Layers />,
  'shared-list': <ListVideo />,
  'live-tv': <Monitor />,
} as const;

interface LibraryGridProps {
  items: WatchItem[];
  listType: MainListType;
  onRemove: (item: WatchItem) => void;
}

export default function LibraryGrid({ items, listType, onRemove }: LibraryGridProps) {
  const { t, i18n } = useTranslation();
  const [openShowId, setOpenShowId] = useState<number | null>(null);

  // Filtre d'âge du profil, en un seul passage (avant : absent de cette grille).
  const tmdbItems = useMemo(() => items.filter(isTmdbWatchItem), [items]);
  const { items: allowedTmdb } = useAgeRestrictedContent(tmdbItems);
  const allowedKeys = useMemo(() => new Set(allowedTmdb.map(getWatchItemKey)), [allowedTmdb]);
  const visible = useMemo(
    () => items.filter((item) => !isTmdbWatchItem(item) || allowedKeys.has(getWatchItemKey(item))),
    [items, allowedKeys],
  );

  const dateFormat = useMemo(() => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }), [i18n.language]);

  const typeLabel = (item: WatchItem) => {
    if (item.type === 'movie') return t('profilePage.media.movie');
    if (item.type === 'tv') return t('profilePage.media.series');
    if (item.type === 'collection') return t('profilePage.media.collection');
    if (item.type === 'shared-list') return t('profilePage.media.sharedList');
    return t('profilePage.media.liveTV');
  };

  const metaLeft = (item: WatchItem) => {
    if (item.type === 'shared-list') {
      return [item.username && `@${item.username}`, typeof item.itemCount === 'number' && t('lists.itemCount', { count: item.itemCount })]
        .filter(Boolean)
        .join(' · ');
    }
    if (item.type === 'live-tv') return item.source === 'iptv' ? t('liveTV.iptvWebSource') : t('nav.liveTV');
    return typeLabel(item);
  };

  const metaRight = (item: WatchItem) => {
    const time = Date.parse(item.addedAt);
    // Les anciennes séries sans date portent l'époque Unix : rien à afficher.
    if (!Number.isFinite(time) || time < 86_400_000) return null;
    return dateFormat.format(time);
  };

  return (
    <div className="grid grid-flow-row-dense grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {visible.flatMap((item, index) => {
        const key = getWatchItemKey(item);
        const title = getWatchItemTitle(item);
        const isShow = item.type === 'tv' && typeof item.id === 'number';
        const isOpen = isShow && openShowId === item.id;

        const card = (
          <PosterTicket
            key={key}
            title={title}
            poster={posterUrl(item.poster_path)}
            fallbackIcon={FALLBACK_ICONS[item.type]}
            metaLeft={metaLeft(item)}
            metaRight={metaRight(item)}
            tone={ticketToneAt(index)}
            selected={isOpen}
            to={isShow ? undefined : watchItemPath(item)}
            onOpen={isShow ? () => setOpenShowId(isOpen ? null : (item.id as number)) : undefined}
            actions={(
              <IconButton
                label={t('profilePage.media.removeFrom', { title, defaultValue: 'Retirer « {{title}} »' })}
                tone="danger"
                onClick={() => {
                  if (isOpen) setOpenShowId(null);
                  onRemove(item);
                }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            )}
          />
        );

        if (!isOpen) return [card];
        return [
          card,
          <div key={`${key}-episodes`} className="col-span-full">
            <TvEpisodePanel
              showId={item.id as number}
              showTitle={title}
              listType={listType}
              detailsPath={watchItemPath(item)}
              onClose={() => setOpenShowId(null)}
            />
          </div>,
        ];
      })}
    </div>
  );
}
