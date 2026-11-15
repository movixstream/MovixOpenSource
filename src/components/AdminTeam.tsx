import React, { useCallback, useEffect, useState } from 'react';
import axios, { AxiosError } from 'axios';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  Copy,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  User,
} from 'lucide-react';

import { Badge } from './ui/badge';
import { Button } from './ui/button';
import ConfirmDialog from './ui/confirm-dialog';
import { Input } from './ui/input';
import ReusableModal from './ui/reusable-modal';
import { copyText } from '../utils/clipboard';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TeamMember {
  id: number;
  userId: string;
  authType: 'oauth' | 'bip-39';
  role: 'admin' | 'uploader';
  username: string;
  avatar: string | null;
  createdAt: string;
}

interface HistoryEntry {
  action: 'added' | 'removed';
  link_type: 'streaming' | 'download';
  media_type: 'movie' | 'tv';
  tmdb_id: number;
  season: number | null;
  episode: number | null;
  link_url: string;
  changed_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_MAIN_API;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRequestErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError<{ error?: string }>;
    return ax.response?.data?.error || ax.message;
  }
  if (error instanceof Error) return error.message;
  return '';
}

const getAuth = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token')}` });

// Convert stored authType to query param value
function toApiAuthType(authType: 'oauth' | 'bip-39'): 'oauth' | 'bip39' {
  return authType === 'bip-39' ? 'bip39' : 'oauth';
}

function formatMediaLabel(entry: HistoryEntry): string {
  const base = `${entry.media_type} #${entry.tmdb_id}`;
  if (entry.media_type !== 'tv' || (entry.season === null && entry.episode === null)) {
    return base;
  }
  if (entry.season === 0) {
    return `${base} – saison complète`;
  }
  const s = entry.season !== null ? `S${entry.season}` : '';
  const e = entry.episode !== null ? `E${entry.episode}` : '';
  return `${base} ${s}${e}`.trim();
}

// ─── Main component ───────────────────────────────────────────────────────────

const AdminTeam: React.FC = () => {
  const { t } = useTranslation();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form state
  const [addOpen, setAddOpen] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [addAuthType, setAddAuthType] = useState<'oauth' | 'bip39'>('oauth');
  const [addBusy, setAddBusy] = useState(false);

  // Remove confirm state
  const [removeCandidate, setRemoveCandidate] = useState<TeamMember | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  // History modal state
  const [historyMember, setHistoryMember] = useState<TeamMember | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);

  // ─── Load members ───────────────────────────────────────────────────────────

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/admin/admins`, { headers: getAuth() });
      setMembers(res.data?.members || []);
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error', 'Erreur'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // ─── Add uploader ────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!addUserId.trim()) return;
    setAddBusy(true);
    try {
      await axios.post(
        `${API_URL}/api/admin/admins`,
        { userId: addUserId.trim(), authType: addAuthType },
        { headers: getAuth() },
      );
      toast.success(t('admin.team.addedSuccess', 'Uploader ajouté avec succès'));
      setAddOpen(false);
      setAddUserId('');
      setAddAuthType('oauth');
      loadMembers();
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error', 'Erreur'));
    } finally {
      setAddBusy(false);
    }
  };

  // ─── Remove uploader ─────────────────────────────────────────────────────────

  const handleRemoveConfirmed = async () => {
    if (!removeCandidate) return;
    setRemoveBusy(true);
    try {
      await axios.delete(`${API_URL}/api/admin/admins/${removeCandidate.id}`, { headers: getAuth() });
      toast.success(t('admin.team.removedSuccess', 'Uploader retiré'));
      setRemoveCandidate(null);
      loadMembers();
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error', 'Erreur'));
    } finally {
      setRemoveBusy(false);
    }
  };

  // ─── History ─────────────────────────────────────────────────────────────────

  const fetchHistory = useCallback(
    async (member: TeamMember, page: number, append: boolean) => {
      if (append) {
        setHistoryLoadingMore(true);
      } else {
        setHistoryLoading(true);
        setHistoryEntries([]);
        setHistoryTotal(0);
        setHistoryHasMore(false);
      }
      try {
        const res = await axios.get(`${API_URL}/api/admin/team/history`, {
          params: {
            userId: member.userId,
            authType: toApiAuthType(member.authType),
            page,
            limit: 30,
          },
          headers: getAuth(),
        });
        const entries: HistoryEntry[] = res.data?.history || [];
        if (append) {
          setHistoryEntries((prev) => [...prev, ...entries]);
        } else {
          setHistoryEntries(entries);
        }
        setHistoryTotal(res.data?.total ?? 0);
        setHistoryHasMore(res.data?.hasMore ?? false);
      } catch (err) {
        toast.error(getRequestErrorMessage(err) || t('common.error', 'Erreur'));
      } finally {
        setHistoryLoading(false);
        setHistoryLoadingMore(false);
      }
    },
    [t],
  );

  const openHistory = (member: TeamMember) => {
    setHistoryMember(member);
    setHistoryPage(1);
    fetchHistory(member, 1, false);
  };

  const closeHistory = () => {
    setHistoryMember(null);
    setHistoryEntries([]);
    setHistoryTotal(0);
    setHistoryHasMore(false);
    setHistoryPage(1);
  };

  const handleLoadMore = () => {
    if (!historyMember || historyLoadingMore) return;
    const nextPage = historyPage + 1;
    setHistoryPage(nextPage);
    fetchHistory(historyMember, nextPage, true);
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">
            {t('admin.team.title', 'Équipe admin')}
          </h2>
          {!loading && (
            <span className="text-xs text-white/40">({members.length})</span>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={loadMembers}
            title={t('common.refresh', 'Rafraîchir')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('admin.team.addUploader', 'Ajouter un uploader')}
        </Button>
      </div>

      {/* Member list */}
      {loading ? (
        <div className="py-12 text-center text-white/60">
          {t('common.loading', 'Chargement…')}
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-white/60">
          {t('admin.team.empty', 'Aucun membre dans l\'équipe')}
        </div>
      ) : (
        <div className="space-y-3">
          {members.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              onHistory={() => openHistory(member)}
              onRemove={() => setRemoveCandidate(member)}
            />
          ))}
        </div>
      )}

      {/* Add uploader modal */}
      <ReusableModal
        isOpen={addOpen}
        onClose={() => !addBusy && setAddOpen(false)}
        title={t('admin.team.addUploader', 'Ajouter un uploader')}
        className="max-w-md"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">
              {t('admin.team.userIdLabel', 'Identifiant utilisateur')}
            </label>
            <Input
              type="text"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              placeholder={t('admin.team.userIdPlaceholder', 'discord:123456789 ou bip39:…')}
              className="font-mono"
              disabled={addBusy}
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/50">
              {t('admin.team.authTypeLabel', 'Type d\'authentification')}
            </label>
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-white/80">
                <input
                  type="radio"
                  name="authType"
                  checked={addAuthType === 'oauth'}
                  onChange={() => setAddAuthType('oauth')}
                  className="accent-yellow-300"
                  disabled={addBusy}
                />
                {t('admin.team.authTypeOAuth', 'Discord / Google (OAuth)')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-white/80">
                <input
                  type="radio"
                  name="authType"
                  checked={addAuthType === 'bip39'}
                  onChange={() => setAddAuthType('bip39')}
                  className="accent-yellow-300"
                  disabled={addBusy}
                />
                {t('admin.team.authTypeBip39', 'BIP-39')}
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => { setAddOpen(false); setAddUserId(''); setAddAuthType('oauth'); }}
              disabled={addBusy}
            >
              {t('common.cancel', 'Annuler')}
            </Button>
            <Button
              onClick={handleAdd}
              disabled={addBusy || !addUserId.trim()}
            >
              <Plus className="mr-2 h-4 w-4" />
              {addBusy
                ? t('admin.team.adding', 'Ajout…')
                : t('admin.team.addUploader', 'Ajouter un uploader')}
            </Button>
          </div>
        </div>
      </ReusableModal>

      {/* Remove confirm dialog */}
      <ConfirmDialog
        isOpen={!!removeCandidate}
        title={t('admin.team.removeTitle', 'Retirer cet uploader ?')}
        message={
          removeCandidate
            ? t('admin.team.removeConfirm', `Retirer @${removeCandidate.username} de l'équipe ?`)
            : ''
        }
        variant="destructive"
        busy={removeBusy}
        onConfirm={handleRemoveConfirmed}
        onCancel={() => !removeBusy && setRemoveCandidate(null)}
      />

      {/* History modal */}
      {historyMember && (
        <HistoryModal
          member={historyMember}
          entries={historyEntries}
          total={historyTotal}
          hasMore={historyHasMore}
          loading={historyLoading}
          loadingMore={historyLoadingMore}
          onLoadMore={handleLoadMore}
          onClose={closeHistory}
        />
      )}
    </div>
  );
};

// ─── MemberCard ───────────────────────────────────────────────────────────────

interface MemberCardProps {
  member: TeamMember;
  onHistory: () => void;
  onRemove: () => void;
}

const MemberCard: React.FC<MemberCardProps> = ({ member, onHistory, onRemove }) => {
  const { t } = useTranslation();

  const handleCopyUserId = async () => {
    if (await copyText(member.userId)) {
      toast.success(t('admin.team.copied', 'Copié'));
    } else {
      toast.error(t('common.error', 'Erreur'));
    }
  };

  const authTypeLabel =
    member.authType === 'bip-39'
      ? t('admin.team.authTypeBip39Short', 'BIP-39')
      : t('admin.team.authTypeOAuthShort', 'OAuth');

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center gap-4">
        {/* Avatar */}
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40">
          {member.avatar ? (
            <img
              src={member.avatar}
              alt={member.username}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <User className="h-5 w-5 text-white opacity-30" />
            </div>
          )}
        </div>

        {/* Identity */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">{member.username}</span>

            {/* Role badge */}
            {member.role === 'admin' ? (
              <Badge variant="premium" className="gap-1 text-[11px]">
                <ShieldCheck className="h-3 w-3" />
                {t('admin.team.roleAdmin', 'Admin')}
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 text-[11px]">
                <Upload className="h-3 w-3" />
                {t('admin.team.roleUploader', 'Uploader')}
              </Badge>
            )}

            {/* Auth type */}
            <span className="text-xs text-white/40">{authTypeLabel}</span>
          </div>

          {/* userId + copy */}
          <div className="mt-1 flex items-center gap-1.5 text-xs text-white/40">
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-white/60">
              {member.userId}
            </code>
            <button
              type="button"
              onClick={handleCopyUserId}
              className="text-white/40 transition-colors hover:text-white group/icon"
              aria-label={t('common.copy', 'Copier')}
            >
              <Copy className="h-3.5 w-3.5 text-white opacity-40 group-hover/icon:opacity-100 transition-[color,opacity]" />
            </button>
          </div>

          {/* Created date */}
          <p className="mt-0.5 text-[11px] text-white/30">
            {t('admin.team.since', 'Depuis')}{' '}
            {new Date(member.createdAt).toLocaleDateString()}
          </p>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onHistory}>
            <Clock className="mr-1.5 h-3.5 w-3.5" />
            {t('admin.team.history', 'Historique')}
          </Button>

          {member.role === 'uploader' && (
            <Button variant="destructive" size="sm" onClick={onRemove}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t('admin.team.remove', 'Retirer')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── HistoryModal ─────────────────────────────────────────────────────────────

interface HistoryModalProps {
  member: TeamMember;
  entries: HistoryEntry[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onClose: () => void;
}

const HistoryModal: React.FC<HistoryModalProps> = ({
  member,
  entries,
  total,
  hasMore,
  loading,
  loadingMore,
  onLoadMore,
  onClose,
}) => {
  const { t } = useTranslation();

  return (
    <ReusableModal
      isOpen
      onClose={onClose}
      title={t('admin.team.historyTitle', `Historique — ${member.username}`)}
      className="max-w-2xl"
    >
      {loading ? (
        <div className="py-8 text-center text-white/60">
          {t('common.loading', 'Chargement…')}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-white/60">
          {t('admin.team.historyEmpty', 'Aucune action enregistrée')}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-white/40">
            {t('admin.team.historyCount', `${total} action(s) au total`)}
          </p>

          <div className="space-y-2">
            {entries.map((entry, idx) => (
              <HistoryRow key={idx} entry={entry} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore
                  ? t('admin.team.loadingMore', 'Chargement…')
                  : t('admin.team.loadMore', 'Charger plus')}
              </Button>
            </div>
          )}
        </div>
      )}
    </ReusableModal>
  );
};

// ─── HistoryRow ───────────────────────────────────────────────────────────────

interface HistoryRowProps {
  entry: HistoryEntry;
}

const HistoryRow: React.FC<HistoryRowProps> = ({ entry }) => {
  const { t } = useTranslation();

  const isAdded = entry.action === 'added';

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap items-start gap-3">
        {/* Action icon */}
        <div
          className={`mt-0.5 shrink-0 rounded-full p-1.5 ${
            isAdded
              ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30'
              : 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
          }`}
        >
          {isAdded ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Top row: link_type badge + media label */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={entry.link_type === 'streaming' ? 'searching' : 'secondary'}
              className="text-[11px]"
            >
              {entry.link_type === 'streaming'
                ? t('admin.team.linkStreaming', 'Streaming')
                : t('admin.team.linkDownload', 'Téléchargement')}
            </Badge>
            <span className="text-sm font-medium text-white/80">
              {formatMediaLabel(entry)}
            </span>
          </div>

          {/* URL */}
          <p className="break-all font-mono text-[11px] text-white/40">
            {entry.link_url}
          </p>

          {/* Date */}
          <p className="text-[11px] text-white/30">
            {new Date(entry.changed_at).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminTeam;
