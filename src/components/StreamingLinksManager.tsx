import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import ReusableModal from './ui/reusable-modal';
import { getTmdbLanguage } from '../i18n';
import { DOWNLOAD_HOSTS, resolveHostIcon } from '@/data/downloadHosts';
import {
  AdminDownloadLink,
  DownloadLinkInput,
  listDownloadLinks,
  addDownloadLinks,
  deleteDownloadLink,
} from '@/services/downloadLinksService';

interface MovieResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string;
}

interface Season {
  season_number: number;
}

interface Episode {
  episode_number: number;
  name: string;
}

// API stores streaming links as either a plain URL string or a VIP-gated object.
// Links added via the panel also carry an `added_by` owner stamp (used to scope
// who may delete them).
type StreamingLink =
  | string
  | {
      url: string;
      isVip?: boolean;
      label?: string;
      language?: string;
      added_by?: { id: string; auth_type: string };
      added_at?: string;
    };

const StreamingLinksManager: React.FC = () => {
  const { t } = useTranslation();
  const [currentMedia, setCurrentMedia] = useState<'movie' | 'tv'>('movie');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MovieResult[]>([]);
  const [selectedItem, setSelectedItem] = useState<MovieResult | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedEpisode, setSelectedEpisode] = useState('');
  const [links, setLinks] = useState<string[]>(['']);
  const [currentLinks, setCurrentLinks] = useState<StreamingLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMassAddModalOpen, setIsMassAddModalOpen] = useState(false);
  const [massLinksText, setMassLinksText] = useState('');
  const [startEpisode, setStartEpisode] = useState(1);
  const [rulesOpen, setRulesOpen] = useState(true);

  // États pour la pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalResults, setTotalResults] = useState(0);

  // Mode toggle: streaming vs download
  const [mode, setMode] = useState<'streaming' | 'download'>('streaming');
  const [downloadLinks, setDownloadLinks] = useState<AdminDownloadLink[]>([]);
  const [downloadForm, setDownloadForm] = useState<DownloadLinkInput>({
    url: '',
    language: 'VF',
    quality: '1080p',
    sub: false,
    host: '1fichier',
    size: '',
  });
  const [customHost, setCustomHost] = useState('');
  const [isFullSeason, setIsFullSeason] = useState(false);
  // Current admin identity — used to hide the delete button on download links
  // an uploader didn't add (admins keep it on all). The backend enforces this
  // regardless; this is just so uploaders don't see buttons that would 403.
  const [currentAdmin, setCurrentAdmin] = useState<{ userId: string; userType: string; role: string } | null>(null);

  const API_URL = import.meta.env.VITE_MAIN_API;
  const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

  const getAuthToken = () => localStorage.getItem('auth_token');

  const normalizeUrl = (url: string): string => {
    if (!url.trim()) return url;
    // Add https:// if URL doesn't have protocol
    if (!url.match(/^https?:\/\//i)) {
      return 'https://' + url;
    }
    return url;
  };

  const searchContent = async (page: number = 1) => {
    if (!searchQuery.trim()) {
      toast.error(t('streamingLinks.enterTitle'));
      return;
    }

    setIsLoading(true);
    try {
      const response = await axios.get(
        `https://api.themoviedb.org/3/search/${currentMedia}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}&query=${encodeURIComponent(searchQuery)}&page=${page}`
      );
      setSearchResults(response.data.results);
      setCurrentPage(response.data.page);
      setTotalPages(response.data.total_pages);
      setTotalResults(response.data.total_results);
    } catch (error) {
      console.error('Erreur lors de la recherche:', error);
      toast.error(t('streamingLinks.searchError'));
    } finally {
      setIsLoading(false);
    }
  };

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      searchContent(page);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      goToPage(currentPage + 1);
    }
  };

  const goToPreviousPage = () => {
    if (currentPage > 1) {
      goToPage(currentPage - 1);
    }
  };

  const openModal = async (item: MovieResult) => {
    setSelectedItem(item);
    setIsModalOpen(true);
    setLinks(['']);
    setCurrentLinks([]);
    setIsFullSeason(false);

    // Réinitialiser les sélections pour les séries TV
    if (currentMedia === 'tv') {
      setSelectedSeason('');
      setSelectedEpisode('');
      setEpisodes([]);
    }

    if (currentMedia === 'tv') {
      try {
        const response = await axios.get(
          `https://api.themoviedb.org/3/tv/${item.id}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
        );
        setSeasons(response.data.seasons);
      } catch (error) {
        console.error('Erreur lors du chargement des saisons:', error);
      }
    } else {
      await loadCurrentLinks();
    }
  };

  const loadEpisodes = async (seasonNumber: string) => {
    if (!selectedItem || !seasonNumber) return;

    try {
      const response = await axios.get(
        `https://api.themoviedb.org/3/tv/${selectedItem.id}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
      );
      setEpisodes(response.data.episodes);
      setSelectedEpisode('');
    } catch (error) {
      console.error('Erreur lors du chargement des épisodes:', error);
    }
  };

  const loadCurrentLinks = async () => {
    if (!selectedItem) return;

    // Use the authed admin endpoint (not the public /api/links) so the response
    // includes the `added_by` owner stamp needed to gate the delete buttons.
    try {
      let url = `${API_URL}/api/admin/streaming-links/${currentMedia}/${selectedItem.id}`;

      if (currentMedia === 'tv') {
        if (!selectedSeason || !selectedEpisode) {
          setCurrentLinks([]);
          return;
        }
        url += `?season=${selectedSeason}&episode=${selectedEpisode}`;
      }

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });

      if (response.data?.success) {
        setCurrentLinks(Array.isArray(response.data.links) ? response.data.links : []);
      } else {
        setCurrentLinks([]);
      }
    } catch (error) {
      console.error('Erreur lors du chargement des liens:', error);
      setCurrentLinks([]);
    }
  };

  const loadCurrentDownloadLinks = async () => {
    if (!selectedItem) return;
    try {
      const baseParams: { type: 'movie' | 'tv'; id: string; season?: number; episode?: number; fullSeason?: boolean } = {
        type: currentMedia,
        id: selectedItem.id.toString(),
      };
      if (currentMedia === 'tv' && selectedSeason) {
        baseParams.season = parseInt(selectedSeason);
        if (isFullSeason) {
          baseParams.fullSeason = true;
        } else if (selectedEpisode) {
          baseParams.episode = parseInt(selectedEpisode);
        } else {
          return;
        }
      }
      const links = await listDownloadLinks(baseParams);
      setDownloadLinks(links);
    } catch (err) {
      console.error('Error loading download links:', err);
      setDownloadLinks([]);
    }
  };

  const addLinkInput = () => {
    setLinks([...links, '']);
  };

  const removeLinkInput = (index: number) => {
    setLinks(links.filter((_, i) => i !== index));
  };

  const updateLink = (index: number, value: string) => {
    const newLinks = [...links];
    newLinks[index] = value;
    setLinks(newLinks);
  };

  const saveLinks = async () => {
    const validLinks = links.filter(link => link.trim()).map(link => normalizeUrl(link));

    if (validLinks.length === 0) {
      toast.error(t('streamingLinks.addAtLeastOneLink'));
      return;
    }

    if (!selectedItem) return;

    if (currentMedia === 'tv' && (!selectedSeason || !selectedEpisode)) {
      toast.error(t('streamingLinks.selectSeasonAndEpisode'));
      return;
    }

    try {
      const body: any = {
        type: currentMedia,
        id: selectedItem.id.toString(),
        links: validLinks
      };

      if (currentMedia === 'tv') {
        body.season = parseInt(selectedSeason);
        body.episode = parseInt(selectedEpisode);
      }

      await axios.post(`${API_URL}/api/admin/links`, body, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json'
        }
      });

      toast.success(t('streamingLinks.linksSaved'));
      await loadCurrentLinks();
      setLinks(['']);
    } catch (error: any) {
      console.error('Erreur lors de l\'enregistrement:', error);
      toast.error('Erreur: ' + (error.response?.data?.error || error.message));
    }
  };

  const deleteAllLinks = async () => {
    if (!confirm(t('streamingLinks.confirmDeleteAll'))) return;
    if (!selectedItem) return;

    try {
      const body: any = {
        type: currentMedia,
        id: selectedItem.id.toString()
      };

      if (currentMedia === 'tv' && selectedSeason && selectedEpisode) {
        body.season = parseInt(selectedSeason);
        body.episode = parseInt(selectedEpisode);
      }

      await axios.delete(`${API_URL}/api/admin/links`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json'
        },
        data: body
      });

      toast.success(t('streamingLinks.linksDeleted'));
      await loadCurrentLinks();
    } catch (error: any) {
      console.error('Erreur lors de la suppression:', error);
      toast.error('Erreur: ' + (error.response?.data?.error || error.message));
    }
  };

  const saveDownloadLink = async () => {
    if (!selectedItem) return;
    if (!downloadForm.url.trim()) return toast.error('URL requise');
    if (currentMedia === 'tv') {
      if (!selectedSeason) return toast.error(t('streamingLinks.selectSeasonFirst'));
      if (!isFullSeason && !selectedEpisode) return toast.error(t('streamingLinks.selectSeasonAndEpisode'));
    }
    const effectiveHost = downloadForm.host === 'Autre' ? customHost.trim() : downloadForm.host;
    if (!effectiveHost) return toast.error('Hébergeur requis');

    const linkToSend: DownloadLinkInput = { ...downloadForm, host: effectiveHost };
    try {
      const params: any = {
        type: currentMedia,
        id: selectedItem.id.toString(),
        links: [linkToSend],
      };
      if (currentMedia === 'tv') {
        params.season = parseInt(selectedSeason);
        if (isFullSeason) {
          params.fullSeason = true;
        } else {
          params.episode = parseInt(selectedEpisode);
        }
      }
      await addDownloadLinks(params);
      toast.success('Lien ajouté');
      setDownloadForm({ ...downloadForm, url: '', size: '' });
      setCustomHost('');
      await loadCurrentDownloadLinks();
    } catch (error: any) {
      toast.error('Erreur: ' + (error.response?.data?.error || error.message));
    }
  };

  const deleteDownloadLinkFromList = async (url: string, fullSeasonFlag: boolean) => {
    if (!selectedItem) return;
    if (!confirm('Supprimer ce lien ?')) return;
    try {
      const params: any = {
        type: currentMedia,
        id: selectedItem.id.toString(),
        url,
      };
      if (currentMedia === 'tv') {
        params.season = parseInt(selectedSeason);
        if (fullSeasonFlag) {
          params.fullSeason = true;
        } else {
          params.episode = parseInt(selectedEpisode);
        }
      }
      await deleteDownloadLink(params);
      toast.success('Lien supprimé');
      await loadCurrentDownloadLinks();
    } catch (error: any) {
      toast.error('Erreur: ' + (error.response?.data?.error || error.message));
    }
  };

  const deleteSpecificLink = async (index: number) => {
    if (!confirm(t('streamingLinks.confirmDeleteOne'))) return;
    if (!selectedItem) return;

    // Delete the single link by URL. The backend enforces ownership (uploaders
    // may only remove links they added), so we no longer replace the whole array.
    const link = currentLinks[index];
    const linkUrl = typeof link === 'string' ? link : link.url;

    try {
      const body: any = {
        type: currentMedia,
        id: selectedItem.id.toString(),
        url: linkUrl,
      };

      if (currentMedia === 'tv' && selectedSeason && selectedEpisode) {
        body.season = parseInt(selectedSeason);
        body.episode = parseInt(selectedEpisode);
      }

      await axios.delete(`${API_URL}/api/admin/links`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json'
        },
        data: body
      });

      toast.success(t('streamingLinks.linkDeleted'));
      await loadCurrentLinks();
    } catch (error: any) {
      console.error('Erreur lors de la suppression:', error);
      toast.error('Erreur: ' + (error.response?.data?.error || error.message));
    }
  };

  const showMassAddInterface = () => {
    if (!selectedSeason) {
      toast.error(t('streamingLinks.selectSeasonFirst'));
      return;
    }

    setMassLinksText('');
    setStartEpisode(1);
    setIsMassAddModalOpen(true);
  };

  const closeMassAddModal = () => {
    setIsMassAddModalOpen(false);
  };

  const processMassEpisodeLinks = async () => {
    if (!selectedItem || !selectedSeason) return;

    try {
      const linksText = massLinksText.trim();

      if (!linksText) {
        toast.error(t('streamingLinks.enterAtLeastOneLink'));
        return;
      }

      // Split links by line and filter empty lines
      const links = linksText.split('\n')
        .map(link => link.trim())
        .filter(link => link.length > 0)
        .map(link => normalizeUrl(link));

      if (links.length === 0) {
        toast.error(t('streamingLinks.noValidLinks'));
        return;
      }

      let successCount = 0;
      let failCount = 0;

      // Process each link
      for (let i = 0; i < links.length; i++) {
        const episodeNumber = startEpisode + i;
        const link = links[i];

        try {
          // Add episode with link
          await axios.post(`${API_URL}/api/admin/links`, {
            type: 'tv',
            id: selectedItem.id.toString(),
            season: parseInt(selectedSeason),
            episode: episodeNumber,
            links: [link]
          }, {
            headers: {
              'Authorization': `Bearer ${getAuthToken()}`,
              'Content-Type': 'application/json'
            }
          });

          successCount++;
        } catch (error) {
          console.error(`Erreur pour l'épisode ${episodeNumber}:`, error);
          failCount++;
        }
      }

      toast.success(t('streamingLinks.massAddResult', { success: successCount, fail: failCount }));
      setIsMassAddModalOpen(false);

      // Reload current links if we're viewing the same season/episode
      if (selectedEpisode) {
        await loadCurrentLinks();
      }

    } catch (error: any) {
      console.error('Erreur lors de l\'ajout en masse:', error);
      toast.error('Erreur: ' + (error.response?.data?.error || error.message));
    }
  };

  // Réinitialiser la pagination quand on change de type de média
  useEffect(() => {
    setCurrentPage(1);
    setTotalPages(0);
    setTotalResults(0);
    setSearchResults([]);
  }, [currentMedia]);

  useEffect(() => {
    if (currentMedia === 'tv' && selectedSeason) {
      loadEpisodes(selectedSeason);
    }
  }, [selectedSeason]);

  useEffect(() => {
    const canLoad =
      (currentMedia === 'tv' && selectedSeason && (isFullSeason || selectedEpisode)) ||
      (currentMedia === 'movie' && selectedItem);
    if (!canLoad) return;
    if (mode === 'streaming') {
      loadCurrentLinks();
    } else {
      loadCurrentDownloadLinks();
    }
  }, [selectedSeason, selectedEpisode, selectedItem, currentMedia, mode, isFullSeason]);

  // Fetch current admin identity once so we can scope download-link deletion.
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/admin/check`, {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
        });
        if (res.data?.success && res.data.admin) {
          setCurrentAdmin({
            userId: String(res.data.admin.userId),
            userType: String(res.data.admin.userType),
            role: String(res.data.admin.role || 'admin'),
          });
        }
      } catch {
        // Non-blocking: leave identity unknown and defer to backend enforcement.
      }
    })();
  }, [API_URL]);

  // An uploader may only delete the download links they uploaded; admins may
  // delete any. Mirrors the server check (added_by stamp). Fails open when the
  // identity is still unknown — the backend is the real authority.
  const canDeleteDownloadLink = (l: AdminDownloadLink): boolean => {
    if (!currentAdmin) return true;
    if (currentAdmin.role === 'admin') return true;
    const stamp = l.added_by;
    if (!stamp) return false;
    const myAuthType = currentAdmin.userType === 'bip39' ? 'bip-39' : 'oauth';
    return String(stamp.id) === String(currentAdmin.userId) && stamp.auth_type === myAuthType;
  };

  // Same ownership rule for streaming links. Legacy links (plain strings, or
  // objects with no `added_by`) have no owner → only admins can delete them.
  const canDeleteStreamingLink = (l: StreamingLink): boolean => {
    if (!currentAdmin) return true;
    if (currentAdmin.role === 'admin') return true;
    const stamp = typeof l === 'object' ? l.added_by : undefined;
    if (!stamp) return false;
    const myAuthType = currentAdmin.userType === 'bip39' ? 'bip-39' : 'oauth';
    return String(stamp.id) === String(currentAdmin.userId) && stamp.auth_type === myAuthType;
  };

  return (
    <div className="space-y-6">
      {/* Mode Toggle: Streaming / Téléchargement */}
      <div className="flex justify-center space-x-4">
        <button
          onClick={() => setMode('streaming')}
          className={`px-6 py-3 rounded-lg font-semibold transition-colors ${mode === 'streaming' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
        >
          Liens Streaming
        </button>
        <button
          onClick={() => setMode('download')}
          className={`px-6 py-3 rounded-lg font-semibold transition-colors ${mode === 'download' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
        >
          Liens Téléchargement
        </button>
      </div>

      {/* Media Type Switch */}
      <div className="flex justify-center space-x-4">
        <button
          onClick={() => setCurrentMedia('movie')}
          className={`px-6 py-3 rounded-lg font-semibold transition-colors ${currentMedia === 'movie'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
        >
          {t('streamingLinks.movies')}
        </button>
        <button
          onClick={() => setCurrentMedia('tv')}
          className={`px-6 py-3 rounded-lg font-semibold transition-colors ${currentMedia === 'tv'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
        >
          {t('streamingLinks.series')}
        </button>
      </div>

      {/* Search */}
      <div className="flex space-x-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('streamingLinks.searchPlaceholder')}
          className="flex-1 px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          onKeyPress={(e) => e.key === 'Enter' && searchContent(1)}
        />
        <button
          onClick={() => searchContent(1)}
          disabled={isLoading}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? t('streamingLinks.searching') : t('streamingLinks.searchBtn')}
        </button>
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <>
          {/* Informations de pagination */}
          <div className="text-center text-gray-400 mb-4">
            <p>
              {t('streamingLinks.pageInfo', { current: currentPage, total: totalPages })}
            </p>
          </div>

          {/* Grille des résultats */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            {searchResults.map((item) => (
              <div
                key={item.id}
                onClick={() => openModal(item)}
                className="bg-gray-800 rounded-lg overflow-hidden cursor-pointer hover:bg-gray-700 transition-colors"
              >
                <img
                  src={
                    item.poster_path
                      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
                      : 'https://via.placeholder.com/200x300?text=No+Image'
                  }
                  alt={item.title || item.name}
                  className="w-full h-64 object-cover"
                />
                <div className="p-3">
                  <h3 className="font-semibold text-sm text-white truncate">
                    {item.title || item.name}
                  </h3>
                  <p className="text-gray-400 text-xs">
                    {item.release_date || item.first_air_date
                      ? new Date(item.release_date || item.first_air_date!).getFullYear()
                      : 'N/A'}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Contrôles de pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center space-x-4">
              <button
                onClick={goToPreviousPage}
                disabled={currentPage === 1 || isLoading}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <span>‹</span>
                <span>{t('streamingLinks.previous')}</span>
              </button>

              {/* Numéros de page */}
              <div className="flex space-x-2">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNumber;
                  if (totalPages <= 5) {
                    pageNumber = i + 1;
                  } else if (currentPage <= 3) {
                    pageNumber = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNumber = totalPages - 4 + i;
                  } else {
                    pageNumber = currentPage - 2 + i;
                  }

                  return (
                    <button
                      key={pageNumber}
                      onClick={() => goToPage(pageNumber)}
                      disabled={isLoading}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${currentPage === pageNumber
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {pageNumber}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={goToNextPage}
                disabled={currentPage === totalPages || isLoading}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <span>{t('streamingLinks.next')}</span>
                <span>›</span>
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal */}
      <ReusableModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedItem ? (selectedItem.title || selectedItem.name) : ''}
      >
        {selectedItem && (
          <div className="space-y-6">
            {/* Uploader guidelines — applies to both streaming & download.
                Toggle + grid-rows 0fr/1fr trick animates the collapse (native
                <details> can't tween height). */}
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <button
                type="button"
                onClick={() => setRulesOpen((o) => !o)}
                className="flex w-full items-center gap-2 font-semibold text-amber-300"
              >
                {/* warning triangle */}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="h-5 w-5 flex-shrink-0"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
                <span>Règles avant d'ajouter un lien</span>
                {/* chevron flips with state */}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className={`ml-auto h-4 w-4 flex-shrink-0 transition-transform duration-300 ${
                    rulesOpen ? 'rotate-180' : ''
                  }`}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              <div
                className={`grid transition-all duration-300 ease-out ${
                  rulesOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
              <ul className="list-inside list-disc space-y-2 overflow-hidden pt-3 text-sm text-amber-100/90">
                <li>
                  <strong>Pas de doublons :</strong> ne réuploadez pas un lien déjà présent dans la
                  liste, ni la même version (même hébergeur + même langue + même qualité) deux fois.
                </li>
                <li>
                  <strong>Pas de chevauchement de versions :</strong> si un lien couvre déjà une
                  langue (ex. MULTI ou VF+VOSTFR), n'ajoutez pas en plus le même hébergeur en VF
                  seul. Une version par hébergeur / qualité suffit.
                </li>
                <li>
                  <strong>Remplacez les CAM :</strong> dès qu'une meilleure qualité (HD / WEB /
                  BluRay) est disponible, supprimez vos liens CAM / TS / basse qualité.
                </li>
                <li>
                  <strong>Testez avant de poster :</strong> le lien doit lire le bon film / épisode,
                  sans lien mort, redirection pub, survey ou .exe.
                </li>
                <li>
                  <strong>Nettoyez :</strong> supprimez vos propres liens morts ou périmés.
                </li>
                <li>
                  <strong>Une question / un doute ?</strong> MP&nbsp;: Discord{' '}
                  <span className="font-mono text-amber-200">mysticsaba_alt</span> · Telegram{' '}
                  <span className="font-mono text-amber-200">MysticSaba2</span>.
                </li>
              </ul>
              </div>
            </div>

            {/* Season/Episode Selectors for TV */}
            {currentMedia === 'tv' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('streamingLinks.selectSeasonLabel')}
                  </label>
                  <Select
                    value={selectedSeason}
                    onValueChange={(value) => setSelectedSeason(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('streamingLinks.selectSeasonPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {seasons.map((season) => (
                        <SelectItem key={season.season_number} value={season.season_number.toString()}>
                          {t('streamingLinks.seasonLabel', { number: season.season_number })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedSeason && mode === 'download' && (
                  <div className="flex items-center gap-2 text-gray-200">
                    <input
                      id="full-season-checkbox"
                      type="checkbox"
                      checked={isFullSeason}
                      onChange={(e) => {
                        setIsFullSeason(e.target.checked);
                        if (e.target.checked) setSelectedEpisode('');
                      }}
                      className="w-4 h-4"
                    />
                    <label htmlFor="full-season-checkbox" className="text-sm cursor-pointer">
                      {t('streamingLinks.fullSeason')}
                      <span className="ml-2 text-xs text-gray-400">({t('streamingLinks.fullSeasonHelp')})</span>
                    </label>
                  </div>
                )}

                {selectedSeason && !(mode === 'download' && isFullSeason) && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      {t('streamingLinks.selectEpisodeLabel')}
                    </label>
                    <Select
                      value={selectedEpisode}
                      onValueChange={(value) => setSelectedEpisode(value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('streamingLinks.selectEpisodePlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {episodes.map((episode) => (
                          <SelectItem key={episode.episode_number} value={episode.episode_number.toString()}>
                            {t('streamingLinks.episodeLabel', { number: episode.episode_number, name: episode.name })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Mass Add Button for TV — streaming mode only */}
                {selectedSeason && mode === 'streaming' && (
                  <div className="mt-4">
                    <button
                      onClick={showMassAddInterface}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
                    >
                      {t('streamingLinks.massAdd')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Streaming-specific: Current Links + New Links form + Action Buttons */}
            {mode === 'streaming' && (
              <>
                {/* Current Links */}
                {currentLinks.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3">{t('streamingLinks.currentLinks')}</h3>
                    <div className="space-y-2">
                      {currentLinks.map((link, index) => (
                        <div key={index} className="flex items-center justify-between bg-gray-800 p-3 rounded-lg">
                          <span className="text-gray-300 text-sm flex-1 break-all">{typeof link === 'string' ? link : link.url}</span>
                          {canDeleteStreamingLink(link) && (
                            <button
                              onClick={() => deleteSpecificLink(index)}
                              className="ml-3 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                            >
                              {t('streamingLinks.deleteLink')}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* New Links */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3">{t('streamingLinks.newLinks')}</h3>
                  <div className="space-y-3">
                    {links.map((link, index) => (
                      <div key={index} className="flex space-x-2">
                        <input
                          type="text"
                          value={link}
                          onChange={(e) => updateLink(index, e.target.value)}
                          placeholder={t('streamingLinks.linkPlaceholder')}
                          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                        />
                        {links.length > 1 && (
                          <button
                            onClick={() => removeLinkInput(index)}
                            className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                          >
                            -
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={addLinkInput}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      {t('streamingLinks.addLink')}
                    </button>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-4">
                  <button
                    onClick={saveLinks}
                    className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
                  >
                    {t('streamingLinks.saveLinks')}
                  </button>
                  <button
                    onClick={deleteAllLinks}
                    className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold"
                  >
                    {t('streamingLinks.deleteAllLinks')}
                  </button>
                </div>
              </>
            )}

            {/* Download mode UI */}
            {mode === 'download' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white">Nouveau lien de téléchargement</h3>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="URL"
                    value={downloadForm.url}
                    onChange={e => setDownloadForm({ ...downloadForm, url: e.target.value })}
                    className="col-span-2 px-3 py-2 rounded bg-gray-800 text-white"
                  />
                  <select
                    value={downloadForm.language}
                    onChange={e => setDownloadForm({ ...downloadForm, language: e.target.value })}
                    className="px-3 py-2 rounded bg-gray-800 text-white"
                  >
                    <option>VF</option><option>VOSTFR</option><option>VO</option><option>MULTI</option>
                  </select>
                  <select
                    value={downloadForm.quality}
                    onChange={e => setDownloadForm({ ...downloadForm, quality: e.target.value })}
                    className="px-3 py-2 rounded bg-gray-800 text-white"
                  >
                    <option>480p</option><option>720p</option><option>1080p</option><option>4K</option>
                  </select>
                  <select
                    value={downloadForm.host}
                    onChange={e => setDownloadForm({ ...downloadForm, host: e.target.value })}
                    className="px-3 py-2 rounded bg-gray-800 text-white"
                  >
                    {DOWNLOAD_HOSTS.map(h => <option key={h}>{h}</option>)}
                  </select>
                  {downloadForm.host === 'Autre' && (
                    <input
                      type="text"
                      placeholder="Nom de l'hébergeur"
                      value={customHost}
                      onChange={e => setCustomHost(e.target.value)}
                      className="px-3 py-2 rounded bg-gray-800 text-white"
                    />
                  )}
                  <input
                    type="text"
                    placeholder="Taille (ex: 2.3 GB)"
                    value={downloadForm.size ?? ''}
                    onChange={e => setDownloadForm({ ...downloadForm, size: e.target.value })}
                    className="px-3 py-2 rounded bg-gray-800 text-white"
                  />
                  <label className="flex items-center gap-2 text-white">
                    <input
                      type="checkbox"
                      checked={downloadForm.sub ?? false}
                      onChange={e => setDownloadForm({ ...downloadForm, sub: e.target.checked })}
                    />
                    Sous-titres
                  </label>
                </div>
                <button
                  onClick={saveDownloadLink}
                  className="px-4 py-2 rounded bg-green-600 text-white"
                >
                  Ajouter le lien
                </button>

                <h3 className="text-lg font-semibold text-white mt-6">Liens existants</h3>
                {downloadLinks.length === 0 ? (
                  <p className="text-gray-400">Aucun lien.</p>
                ) : (
                  <ul className="space-y-2">
                    {downloadLinks.map((l, i) => (
                      <li key={i} className="flex items-center justify-between bg-gray-800 p-3 rounded">
                        <div className="flex items-center gap-3">
                          <img src={resolveHostIcon(l.host)} alt={l.host} className="w-6 h-6" />
                          <div>
                            <div className="text-white flex items-center gap-2">
                              <span>
                                {l.host} — {l.quality} — {l.language}{l.sub ? ' (ST)' : ''}
                                {l.size ? ` — ${l.size}` : ''}
                              </span>
                              {l.full_saison && (
                                <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">
                                  {t('streamingLinks.fullSeasonBadge')}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400">
                              {l.added_at ? new Date(l.added_at).toLocaleString() : ''}
                            </div>
                          </div>
                        </div>
                        {canDeleteDownloadLink(l) && (
                          <button
                            onClick={() => deleteDownloadLinkFromList(l.url, Boolean(l.full_saison))}
                            className="px-3 py-1 rounded bg-red-600 text-white text-sm"
                          >
                            Supprimer
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </ReusableModal>

      {/* Mass Add Modal */}
      <ReusableModal
        isOpen={isMassAddModalOpen}
        onClose={closeMassAddModal}
        title={t('streamingLinks.massAddTitle')}
      >
        <div className="space-y-6">
          <p className="text-gray-300">
            {t('streamingLinks.massAddDescription')}
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('streamingLinks.startAtEpisode')}
            </label>
            <input
              type="number"
              value={startEpisode}
              onChange={(e) => setStartEpisode(parseInt(e.target.value) || 1)}
              min="1"
              className="w-20 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('streamingLinks.linksPerLine')}
            </label>
            <textarea
              value={massLinksText}
              onChange={(e) => setMassLinksText(e.target.value)}
              placeholder={t('streamingLinks.pasteLinksPlaceholder')}
              className="w-full h-48 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 font-mono text-sm"
            />
          </div>

          <div className="flex space-x-4">
            <button
              onClick={processMassEpisodeLinks}
              className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
            >
              {t('streamingLinks.addEpisodes')}
            </button>
            <button
              onClick={closeMassAddModal}
              className="flex-1 px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-semibold"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </ReusableModal>
    </div>
  );
};

export default StreamingLinksManager;
