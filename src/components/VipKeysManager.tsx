import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import ReusableModal from './ui/reusable-modal';
import { copyText } from '../utils/clipboard';

interface VipKey {
  key_value: string;
  active: number;
  used: boolean;
  duree_validite: string | null;
  expires_at: string | number | null;
  created_at: string;
}

type FilterType = 'all' | 'active' | 'inactive' | 'unused';
const PAGE_SIZE = 30;

const VipKeysManager: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [newKey, setNewKey] = useState('');
  const [dureeValidite, setDureeValidite] = useState('');
  const [keys, setKeys] = useState<VipKey[]>([]);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<VipKey | null>(null);
  const [editDuration, setEditDuration] = useState('');
  const [editMode, setEditMode] = useState<'duration' | 'date'>('duration');
  const [editExpiresAt, setEditExpiresAt] = useState('');

  const API_URL = import.meta.env.VITE_MAIN_API;

  const getAuthToken = () => localStorage.getItem('auth_token');
  const getRequestErrorMessage = (error: unknown) => {
    if (axios.isAxiosError(error)) {
      return error.response?.data?.error || error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return t('admin.unknownError');
  };

  const generateKey = () => {
    const length = 16;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'VIP-';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewKey(result);
  };

  const addKey = async () => {
    if (!newKey.trim()) {
      toast.error(t('admin.pleaseEnterKey'));
      return;
    }

    try {
      await axios.post(
        `${API_URL}/api/admin/vip-keys`,
        {
          key: newKey.trim(),
          duree_validite: dureeValidite || null
        },
        {
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`,
            'Content-Type': 'application/json'
          }
        }
      );

      toast.success(t('admin.keyAddedSuccess'));
      setNewKey('');
      loadKeys();
    } catch (error: unknown) {
      console.error('Erreur lors de l\'ajout:', error);
      toast.error(`Erreur: ${getRequestErrorMessage(error)}`);
    }
  };

  const loadKeys = async (pageOverride?: number) => {
    setIsLoading(true);
    try {
      const p = pageOverride ?? page;

      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (currentFilter === 'active') params.append('active', 'true');
      if (currentFilter === 'inactive') params.append('active', 'false');
      if (currentFilter === 'unused') params.append('used', 'false');
      if (debouncedSearch.trim()) params.append('search', debouncedSearch.trim());

      const response = await axios.get(`${API_URL}/api/admin/vip-keys?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
      });

      const data = response.data;
      setKeys(data.keys || []);
      setHasMore(data.hasMore || false);
      setTotal(data.total || 0);
      setPage(data.page || p);
    } catch (error: unknown) {
      console.error('Erreur lors du chargement des clés:', error);
      toast.error(`Erreur: ${getRequestErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const copyKey = async (key: string) => {
    if (await copyText(key)) {
      toast.success(t('admin.keyCopied'));
    } else {
      toast.error(t('admin.copyError'));
    }
  };

  const openEditModal = (key: VipKey) => {
    setEditingKey(key);
    setEditDuration(key.duree_validite || '');
    setEditMode('duration');
    // Pré-remplir la date si la clé a déjà une expiration
    if (key.expires_at) {
      const d = new Date(key.expires_at);
      // Format pour datetime-local: YYYY-MM-DDTHH:MM
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setEditExpiresAt(local);
    } else {
      setEditExpiresAt('');
    }
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async () => {
    if (!editingKey) return;

    try {
      const body: Record<string, string | null> = {};

      if (editMode === 'date') {
        // Date précise : envoyer expires_at directement
        if (!editExpiresAt) {
          toast.error(t('admin.pleaseSelectDate', 'Veuillez sélectionner une date'));
          return;
        }
        const d = new Date(editExpiresAt);
        body.expires_at = d.toISOString().slice(0, 19).replace('T', ' ');
        body.duree_validite = null;
      } else {
        // Durée relative
        body.duree_validite = editDuration === 'none' ? null : editDuration || null;
      }

      await axios.put(
        `${API_URL}/api/admin/vip-keys/${encodeURIComponent(editingKey.key_value)}`,
        body,
        {
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`,
            'Content-Type': 'application/json'
          }
        }
      );

      toast.success(t('admin.keyModifiedSuccess'));
      setIsEditModalOpen(false);
      setEditingKey(null);
      loadKeys();
    } catch (error: unknown) {
      console.error('Erreur lors de la modification:', error);
      toast.error(`Erreur: ${getRequestErrorMessage(error)}`);
    }
  };

  const deleteKey = async (key: string) => {
    if (!confirm(t('admin.confirmDeleteKey'))) return;

    try {
      await axios.delete(`${API_URL}/api/admin/vip-keys/${encodeURIComponent(key)}`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });

      toast.success(t('admin.keyDeletedSuccess'));
      loadKeys();
    } catch (error: unknown) {
      console.error('Erreur lors de la suppression:', error);
      toast.error(`Erreur: ${getRequestErrorMessage(error)}`);
    }
  };

  const filterKeys = (filter: FilterType) => {
    setCurrentFilter(filter);
    setPage(1);
  };

  // Debounce search input
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  }, []);

  useEffect(() => {
    setPage(1);
    loadKeys(1);
  }, [currentFilter, debouncedSearch]);

  // Fetch when page changes
  useEffect(() => {
    loadKeys();
  }, [page]);

  const getKeyStatus = (key: VipKey) => {
    const isActive = key.active === 1;
    const expiresAt = key.expires_at ? new Date(key.expires_at) : null;
    const isExpired = expiresAt && expiresAt < new Date();

    if (isActive && !isExpired) return { text: t('admin.active'), class: 'bg-green-600' };
    if (isExpired) return { text: t('admin.expired'), class: 'bg-red-600' };
    return { text: t('admin.inactive'), class: 'bg-gray-600' };
  };

  const durationOptions = [
    "5 minutes", "30 minutes", "1 heure", "6 heures", "12 heures",
    "1 jour", "3 jours", "7 jours", "15 jours", "30 jours",
    "2 mois", "3 mois", "6 mois", "9 mois", "1 an",
    "18 mois", "2 ans", "3 ans", "4 ans", "5 ans"
  ];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageWindowStart = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pageWindowEnd = Math.min(totalPages, pageWindowStart + 4);
  const visiblePages = Array.from({ length: pageWindowEnd - pageWindowStart + 1 }, (_, index) => pageWindowStart + index);

  return (
    <div className="space-y-6">
      {/* Add New Key Section */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-white mb-4">{t('admin.newVipKey')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('admin.key')}
            </label>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={t('admin.enterOrGenerateKey')}
              maxLength={255}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('admin.validityDuration')}
            </label>
            <Select value={dureeValidite} onValueChange={setDureeValidite}>
              <SelectTrigger className="bg-gray-700 border-gray-600">
                <SelectValue placeholder={t('admin.noExpiration')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('admin.noExpiration')}</SelectItem>
                {durationOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={generateKey}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
            >
              {t('admin.generate')}
            </button>
            <button
              onClick={addKey}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
            >
              {t('admin.add')}
            </button>
          </div>
        </div>
      </div>

      {/* Search + Filter Buttons */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 w-full sm:max-w-xs">
          <input
            type="text"
            placeholder={t('admin.searchKeys')}
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: t('admin.allFem') },
            { id: 'active', label: t('admin.activePlural') },
            { id: 'inactive', label: t('admin.inactivePlural') },
            { id: 'unused', label: t('admin.unused') }
          ].map((filter) => (
            <button
              key={filter.id}
              onClick={() => filterKeys(filter.id as FilterType)}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors ${currentFilter === filter.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {total > 0 && (
          <span className="text-xs text-gray-400">{keys.length}/{total}</span>
        )}
      </div>

      {/* Keys List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-gray-400">{t('admin.loadingKeys')}</p>
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-400">{t('admin.noKeysFound')}</p>
          </div>
        ) : (
          <>
            {keys.map((key) => {
              const status = getKeyStatus(key);
              const expiresAt = key.expires_at ? new Date(key.expires_at) : null;

              return (
                <div
                  key={key.key_value}
                  className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-mono text-xl text-white mb-3 bg-gray-700 px-4 py-2 rounded-lg inline-block">
                        {key.key_value}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-400 font-medium">{t('admin.status')}:</span>
                          <span className={`ml-2 px-2 py-1 rounded text-xs font-bold text-white ${status.class}`}>
                            {status.text}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400 font-medium">{t('admin.used')}:</span>
                          <span className="ml-2 text-white">{key.used ? t('admin.yes') : t('admin.no')}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 font-medium">{t('admin.validityDuration')}:</span>
                          <span className="ml-2 text-white">{key.duree_validite || t('admin.unlimited')}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 font-medium">{t('admin.expiresOn')}:</span>
                          <span className="ml-2 text-white">
                            {expiresAt ? expiresAt.toLocaleDateString(i18n.language) : t('admin.never')}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 text-sm">
                        <span className="text-gray-400 font-medium">{t('admin.createdOn')}:</span>
                        <span className="ml-2 text-white">
                          {new Date(key.created_at).toLocaleDateString(i18n.language)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col space-y-2 ml-4">
                      <button
                        onClick={() => copyKey(key.key_value)}
                        className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-500"
                      >
                        {t('admin.copy')}
                      </button>
                      <button
                        onClick={() => openEditModal(key)}
                        className="px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700"
                      >
                        {t('admin.edit')}
                      </button>
                      <button
                        onClick={() => deleteKey(key.key_value)}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                      >
                        {t('admin.delete')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Pagination */}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between py-4 px-2">
                <span className="text-xs text-gray-400">
                  {t('admin.page')} {page}/{totalPages} ({total} {t('admin.total')})
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={page <= 1 || isLoading}
                    onClick={() => setPage(p => p - 1)}
                    className="px-4 py-2 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('admin.previous')}
                  </button>
                  {visiblePages.map((pageNumber) => (
                    <button
                      key={pageNumber}
                      disabled={isLoading}
                      onClick={() => setPage(pageNumber)}
                      className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                        pageNumber === page
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-white hover:bg-gray-600'
                      } disabled:opacity-30 disabled:cursor-not-allowed`}
                    >
                      {pageNumber}
                    </button>
                  ))}
                  <button
                    disabled={!hasMore || isLoading || page >= totalPages}
                    onClick={() => setPage(p => p + 1)}
                    className="px-4 py-2 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('admin.next')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Edit Modal */}
      <ReusableModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={t('admin.editVipKey')}
        className="max-w-md"
      >
        <div className="space-y-6">
          {/* Mode toggle */}
          <div className="flex rounded-xl bg-white/5 border border-white/10 p-1">
            <button
              onClick={() => setEditMode('duration')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${editMode === 'duration' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {t('admin.relativeDuration', 'Durée relative')}
            </button>
            <button
              onClick={() => setEditMode('date')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${editMode === 'date' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {t('admin.preciseDate', 'Date précise')}
            </button>
          </div>

          {editMode === 'duration' ? (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.newValidityDuration')}
              </label>
              <Select value={editDuration} onValueChange={setEditDuration}>
                <SelectTrigger className="bg-gray-700 border-gray-600">
                  <SelectValue placeholder={t('admin.noExpiration')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('admin.noExpiration')}</SelectItem>
                  {durationOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-2">
                {t('admin.durationHint', 'La durée sera calculée à partir de maintenant')}
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.expirationDate', "Date d'expiration")}
              </label>
              <input
                type="datetime-local"
                value={editExpiresAt}
                onChange={(e) => setEditExpiresAt(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-green-500/50 transition-colors [color-scheme:dark]"
              />
              {editExpiresAt && (
                <p className="text-xs text-gray-500 mt-2">
                  {t('admin.expiresOn', 'Expire le')} : {new Date(editExpiresAt).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}
                </p>
              )}
            </div>
          )}

          <div className="flex space-x-4">
            <button
              onClick={handleEditSubmit}
              className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
            >
              {t('admin.save')}
            </button>
            <button
              onClick={() => setIsEditModalOpen(false)}
              className="flex-1 px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-semibold"
            >
              {t('admin.cancel')}
            </button>
          </div>
        </div>
      </ReusableModal>
    </div>
  );
};

export default VipKeysManager;
