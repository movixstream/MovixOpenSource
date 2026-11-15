import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios, { AxiosError } from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpFromLine,
  BarChart3,
  Coins,
  Copy,
  Image as ImageIcon,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import ConfirmDialog from './ui/confirm-dialog';
import { Input } from './ui/input';
import ReusableModal from './ui/reusable-modal';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { copyText } from '../utils/clipboard';

interface OAuthAppRow {
  id: number;
  clientId: string;
  clientName: string;
  description: string | null;
  homepageUrl: string | null;
  redirectUris: string[];
  allowedScopes: string[];
  publicClient: boolean;
  requirePkce: boolean;
  hasClientSecret: boolean;
  iconFilename: string | null;
  iconUrl: string | null;
  vipDaysBalance: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  stats30d?: Record<string, number>;
}

interface AppStats {
  sinceMs: number;
  byType: { event_type: string; n: number }[];
  byDay: { day: string; n: number }[];
  uniqueUsers: number;
}

interface AppGrant {
  id: number;
  clientId: string;
  userId: string;
  userType: string;
  userIdOnly: string;
  daysGranted: number;
  accessKeyHint: string | null;
  expiresAt: string | null;
  grantedAt: number;
  revokedAt: number | null;
}

const API_URL = import.meta.env.VITE_MAIN_API;

function getRequestErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError<{ error?: string }>;
    return ax.response?.data?.error || ax.message;
  }
  if (error instanceof Error) return error.message;
  return '';
}

function fmtDate(ms: number | null): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

const AdminOAuthApps: React.FC = () => {
  const { t } = useTranslation();
  const [apps, setApps] = useState<OAuthAppRow[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OAuthAppRow | null>(null);
  const [statsFor, setStatsFor] = useState<OAuthAppRow | null>(null);
  const [statsData, setStatsData] = useState<AppStats | null>(null);
  const [grantsData, setGrantsData] = useState<AppGrant[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<OAuthAppRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const getAuth = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token')}` });

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/admin/oauth-apps`, {
        params: { inactive: includeInactive ? '1' : undefined },
        headers: getAuth(),
      });
      setApps(res.data?.apps || []);
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [includeInactive, t]);

  const loadScopes = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/oauth-apps/scopes`, { headers: getAuth() });
      setScopes(res.data?.scopes || []);
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    }
  }, [t]);

  useEffect(() => { loadApps(); loadScopes(); }, [loadApps, loadScopes]);

  const filtered = useMemo(() => {
    if (!search.trim()) return apps;
    const q = search.toLowerCase();
    return apps.filter((a) =>
      a.clientId.toLowerCase().includes(q)
      || a.clientName.toLowerCase().includes(q)
      || (a.description?.toLowerCase().includes(q) ?? false),
    );
  }, [apps, search]);

  const handleDeleteConfirmed = async () => {
    if (!deleteCandidate) return;
    setDeleting(true);
    try {
      await axios.delete(`${API_URL}/api/admin/oauth-apps/${deleteCandidate.clientId}`, { headers: getAuth() });
      toast.success(t('adminOauthApps.deleted'));
      setDeleteCandidate(null);
      loadApps();
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (app: OAuthAppRow) => {
    try {
      await axios.put(
        `${API_URL}/api/admin/oauth-apps/${app.clientId}`,
        { isActive: !app.isActive },
        { headers: getAuth() },
      );
      toast.success(app.isActive ? t('adminOauthApps.disabled') : t('adminOauthApps.enabled'));
      loadApps();
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    }
  };

  const handleShowStats = async (app: OAuthAppRow) => {
    setStatsFor(app);
    setStatsLoading(true);
    setStatsData(null);
    setGrantsData([]);
    try {
      const [s, g] = await Promise.all([
        axios.get(`${API_URL}/api/admin/oauth-apps/${app.clientId}/stats`, { headers: getAuth() }),
        axios.get(`${API_URL}/api/admin/oauth-apps/${app.clientId}/grants`, { headers: getAuth() }),
      ]);
      setStatsData({
        sinceMs: s.data?.sinceMs,
        byType: s.data?.byType || [],
        byDay: s.data?.byDay || [],
        uniqueUsers: s.data?.uniqueUsers || 0,
      });
      setGrantsData(g.data?.grants || []);
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    } finally {
      setStatsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('adminOauthApps.searchPlaceholder')}
            className="max-w-md"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => loadApps()}
            title={t('common.refresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="oauth-show-inactive" className="flex cursor-pointer items-center gap-2 text-xs text-white/60">
            <Switch
              id="oauth-show-inactive"
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
              aria-label={t('adminOauthApps.showInactive')}
              size="sm"
            />
            {t('adminOauthApps.showInactive')}
          </label>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('adminOauthApps.create')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-white/60">{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-white/60">
          {t('adminOauthApps.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filtered.map((app) => (
            <AppCard
              key={app.clientId}
              app={app}
              onEdit={() => setEditing(app)}
              onStats={() => handleShowStats(app)}
              onDelete={() => setDeleteCandidate(app)}
              onToggleActive={() => handleToggleActive(app)}
              onChanged={loadApps}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateAppModal
          scopes={scopes}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); loadApps(); }}
        />
      )}

      {editing && (
        <EditAppModal
          app={editing}
          scopes={scopes}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadApps(); }}
        />
      )}

      {statsFor && (
        <StatsModal
          app={statsFor}
          stats={statsData}
          grants={grantsData}
          loading={statsLoading}
          onClose={() => { setStatsFor(null); setStatsData(null); setGrantsData([]); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteCandidate}
        title={t('common.delete')}
        message={t('adminOauthApps.confirmDelete', { name: deleteCandidate?.clientName ?? '' })}
        variant="destructive"
        busy={deleting}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => !deleting && setDeleteCandidate(null)}
      />
    </div>
  );
};

// ─── Card ───────────────────────────────────────────────────────────────

interface AppCardProps {
  app: OAuthAppRow;
  onEdit: () => void;
  onStats: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
  onChanged: () => void;
}

const AppCard: React.FC<AppCardProps> = ({ app, onEdit, onStats, onDelete, onToggleActive, onChanged }) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [balanceDelta, setBalanceDelta] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [iconHover, setIconHover] = useState(false);
  // Drag & drop state. On compte les enter/leave (dragCounter) parce qu'au
  // passage de la souris entre 2 child elements, dragenter et dragleave se
  // déclenchent en cascade ; un simple booléen flickerait.
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [iconDeleteOpen, setIconDeleteOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);

  const getAuth = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token')}` });

  const handleIconUpload = async (file: File) => {
    if (file.size > 256 * 1024) {
      toast.error(t('adminOauthApps.iconTooLarge'));
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error(t('adminOauthApps.iconTypeInvalid'));
      return;
    }
    setBusy(true);
    try {
      const reader = new FileReader();
      const dataBase64: string = await new Promise((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await axios.post(
        `${API_URL}/api/admin/oauth-apps/${app.clientId}/icon`,
        { mimeType: file.type, dataBase64 },
        { headers: getAuth() },
      );
      toast.success(t('adminOauthApps.iconUploaded'));
      onChanged();
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleIconDeleteConfirmed = async () => {
    setBusy(true);
    try {
      await axios.delete(`${API_URL}/api/admin/oauth-apps/${app.clientId}/icon`, { headers: getAuth() });
      toast.success(t('adminOauthApps.iconRemoved'));
      setIconDeleteOpen(false);
      onChanged();
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const handleBalanceUpdate = async () => {
    if (!Number.isInteger(balanceDelta) || balanceDelta === 0) {
      toast.error(t('adminOauthApps.balanceDeltaInvalid'));
      return;
    }
    setBusy(true);
    try {
      const res = await axios.post(
        `${API_URL}/api/admin/oauth-apps/${app.clientId}/vip-balance`,
        { delta: balanceDelta },
        { headers: getAuth() },
      );
      toast.success(t('adminOauthApps.balanceUpdated', { newBalance: res.data?.newBalance }));
      onChanged();
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerateSecretConfirmed = async () => {
    setBusy(true);
    try {
      const res = await axios.post(
        `${API_URL}/api/admin/oauth-apps/${app.clientId}/regenerate-secret`,
        {},
        { headers: getAuth() },
      );
      const newSecret = res.data?.clientSecret;
      if (newSecret) {
        if (!(await copyText(newSecret))) {
          toast.error(t('common.error'));
          return;
        }
        toast.success(t('adminOauthApps.secretCopied'));
      }
      setRegenOpen(false);
      onChanged();
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  // ─── Drag & drop handlers (sur toute la carte) ─────────────────────────
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (busy) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (busy) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (busy) return;
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (busy) return;
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleIconUpload(file);
  };

  const totalCalls30d = useMemo(() => {
    const stats = app.stats30d || {};
    return Object.values(stats).reduce((sum, n) => sum + n, 0);
  }, [app.stats30d]);

  return (
    <motion.div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      animate={{
        scale: isDragging ? 1.01 : 1,
        boxShadow: isDragging
          ? '0 0 0 2px rgba(253, 224, 71, 0.6), 0 24px 60px rgba(253, 224, 71, 0.15)'
          : '0 0 0 0px rgba(253, 224, 71, 0)',
      }}
      transition={{ type: 'spring', stiffness: 280, damping: 22 }}
      className={`relative rounded-2xl border ${app.isActive ? 'border-white/10 bg-white/5' : 'border-white/5 bg-white/[0.02] opacity-70'} p-5`}
    >
      {/* Overlay drop : couvre toute la carte avec une animation drop-zone. */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            key="drop-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-yellow-300/10 backdrop-blur-[2px]"
          >
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className="flex flex-col items-center gap-2 rounded-xl border border-yellow-300/40 bg-black/60 px-5 py-3 text-yellow-200 shadow-2xl"
            >
              <Upload className="h-6 w-6" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                {t('adminOauthApps.dropToUpload')}
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-start gap-4">
        <div
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40"
          onMouseEnter={() => setIconHover(true)}
          onMouseLeave={() => setIconHover(false)}
        >
          {app.iconUrl ? (
            <img src={`${API_URL}${app.iconUrl}`} alt={app.clientName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon className="h-5 w-5 text-white opacity-30" />
            </div>
          )}
          {/* Overlay hover : clic = upload */}
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100"
            title={t('adminOauthApps.uploadIcon')}
            aria-label={t('adminOauthApps.uploadIcon')}
          >
            <ArrowUpFromLine className="h-5 w-5 text-white" />
          </button>
          {/* Petite croix rouge en haut à droite : visible au hover si une icône existe. */}
          <AnimatePresence>
            {app.iconUrl && iconHover && !busy && (
              <motion.button
                key="icon-remove-btn"
                type="button"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                onClick={(e) => { e.stopPropagation(); setIconDeleteOpen(true); }}
                className="absolute -right-1.5 -top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-lg ring-2 ring-black/60 transition-colors hover:bg-red-400"
                title={t('adminOauthApps.removeIcon')}
                aria-label={t('adminOauthApps.removeIcon')}
              >
                <X className="h-3 w-3" strokeWidth={3} />
              </motion.button>
            )}
          </AnimatePresence>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleIconUpload(f);
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-white">{app.clientName}</h3>
            {!app.isActive && (
              <Badge variant="rejected" className="text-[10px] uppercase">
                {t('adminOauthApps.inactive')}
              </Badge>
            )}
            {app.publicClient ? (
              <Badge variant="secondary" className="text-[10px]">PKCE</Badge>
            ) : (
              <Badge variant="premium" className="text-[10px]">Confidential</Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-white/40">
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono">{app.clientId}</code>
            <button
              type="button"
              onClick={() => {
                void copyText(app.clientId).then((copied) => {
                  if (copied) toast.success(t('common.copied'));
                });
              }}
              className="text-white/40 hover:text-white group/icon"
              aria-label={t('common.copy')}
            >
              <Copy className="h-3 w-3 text-white opacity-40 group-hover/icon:opacity-100" />
            </button>
          </div>
          {app.description && (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/60">{app.description}</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
          <div className="flex items-center gap-1.5 text-white/40">
            <BarChart3 className="h-3 w-3 text-white opacity-40" />
            {t('adminOauthApps.callsLast30d')}
          </div>
          <div className="mt-1 text-base font-semibold text-white">{totalCalls30d}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
          <div className="flex items-center gap-1.5 text-white/40">
            <Coins className="h-3 w-3 text-white opacity-40" />
            {t('adminOauthApps.vipBalance')}
          </div>
          <div className="mt-1 text-base font-semibold text-yellow-300">{app.vipDaysBalance}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          type="number"
          value={balanceDelta}
          onChange={(e) => setBalanceDelta(Number(e.target.value))}
          className="h-8 w-24"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={handleBalanceUpdate}
        >
          {balanceDelta >= 0 ? t('adminOauthApps.addDays') : t('adminOauthApps.removeDays')}
        </Button>
        <span className="text-[11px] text-white/40">
          {t('adminOauthApps.balanceHint')}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {app.allowedScopes.slice(0, 6).map((s) => (
          <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>
        ))}
        {app.allowedScopes.length > 6 && (
          <Badge variant="secondary" className="text-[10px]">+{app.allowedScopes.length - 6}</Badge>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onStats}>
          <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
          {t('adminOauthApps.stats')}
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          {t('adminOauthApps.edit')}
        </Button>
        {!app.publicClient && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setRegenOpen(true)}>
            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            {t('adminOauthApps.regenSecret')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onToggleActive}>
          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
          {app.isActive ? t('adminOauthApps.disable') : t('adminOauthApps.enable')}
        </Button>
        <Button variant="destructive" size="sm" className="ml-auto" onClick={onDelete}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t('common.delete')}
        </Button>
      </div>

      <ConfirmDialog
        isOpen={iconDeleteOpen}
        title={t('adminOauthApps.removeIcon')}
        message={t('adminOauthApps.confirmIconDelete')}
        variant="destructive"
        busy={busy}
        onConfirm={handleIconDeleteConfirmed}
        onCancel={() => !busy && setIconDeleteOpen(false)}
      />

      <ConfirmDialog
        isOpen={regenOpen}
        title={t('adminOauthApps.regenSecret')}
        message={t('adminOauthApps.confirmRegenSecret')}
        variant="destructive"
        busy={busy}
        onConfirm={handleRegenerateSecretConfirmed}
        onCancel={() => !busy && setRegenOpen(false)}
      />
    </motion.div>
  );
};

// ─── Create modal ───────────────────────────────────────────────────────

interface CreateAppModalProps {
  scopes: string[];
  onClose: () => void;
  onCreated: () => void;
}

const CreateAppModal: React.FC<CreateAppModalProps> = ({ scopes, onClose, onCreated }) => {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [description, setDescription] = useState('');
  const [homepageUrl, setHomepageUrl] = useState('');
  const [redirectUris, setRedirectUris] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [publicClient, setPublicClient] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const getAuth = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token')}` });

  const handleCreate = async () => {
    setBusy(true);
    try {
      const res = await axios.post(
        `${API_URL}/api/admin/oauth-apps`,
        {
          clientId: clientId.trim().toLowerCase(),
          clientName: clientName.trim(),
          description: description.trim() || undefined,
          homepageUrl: homepageUrl.trim() || undefined,
          redirectUris: redirectUris.split('\n').map((u) => u.trim()).filter(Boolean),
          allowedScopes: Array.from(selectedScopes),
          publicClient,
          requirePkce: publicClient,
        },
        { headers: getAuth() },
      );
      if (res.data?.clientSecret) {
        setCreatedSecret(res.data.clientSecret);
      } else {
        toast.success(t('adminOauthApps.created'));
        onCreated();
      }
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ReusableModal isOpen onClose={onClose} title={t('adminOauthApps.createTitle')} className="max-w-2xl">
      {createdSecret ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-yellow-300/30 bg-yellow-300/10 p-4 text-sm text-yellow-100">
            <p className="font-semibold">{t('adminOauthApps.secretNotShownAgain')}</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-black/40 p-3 font-mono text-xs text-white">{createdSecret}</code>
            <Button
              variant="default"
              size="icon"
              onClick={() => { void copyText(createdSecret).then((copied) => { if (copied) toast.success(t('common.copied')); }); }}
              title={t('common.copy')}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onCreated}>
              {t('common.done')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('adminOauthApps.clientIdLabel')} hint={t('adminOauthApps.clientIdHint')}>
            <Input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="mon-app"
              className="font-mono"
            />
          </Field>
          <Field label={t('adminOauthApps.clientNameLabel')}>
            <Input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder={t('adminOauthApps.clientNamePlaceholder')}
            />
          </Field>
          <Field label={t('adminOauthApps.descriptionLabel')}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </Field>
          <Field label={t('adminOauthApps.homepageLabel')}>
            <Input
              type="url"
              value={homepageUrl}
              onChange={(e) => setHomepageUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </Field>
          <Field label={t('adminOauthApps.redirectUrisLabel')}>
            <Textarea
              value={redirectUris}
              onChange={(e) => setRedirectUris(e.target.value)}
              rows={3}
              placeholder={'https://example.com/oauth/callback\nhttp://localhost:3000/callback'}
              className="font-mono text-xs"
            />
          </Field>
          <Field label={t('adminOauthApps.scopesLabel')}>
            <ScopeList scopes={scopes} selected={selectedScopes} onChange={setSelectedScopes} />
          </Field>
          <Field label={t('adminOauthApps.clientTypeLabel')}>
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  checked={publicClient}
                  onChange={() => setPublicClient(true)}
                  className="accent-yellow-300"
                />
                {t('adminOauthApps.publicLabel')}
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  checked={!publicClient}
                  onChange={() => setPublicClient(false)}
                  className="accent-yellow-300"
                />
                {t('adminOauthApps.confidentialLabel')}
              </label>
            </div>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy || !clientId || !clientName || selectedScopes.size === 0}
              onClick={handleCreate}
            >
              {busy ? t('adminOauthApps.creating') : t('common.create')}
            </Button>
          </div>
        </div>
      )}
    </ReusableModal>
  );
};

interface EditAppModalProps {
  app: OAuthAppRow;
  scopes: string[];
  onClose: () => void;
  onSaved: () => void;
}

const EditAppModal: React.FC<EditAppModalProps> = ({ app, scopes, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [clientName, setClientName] = useState(app.clientName);
  const [description, setDescription] = useState(app.description || '');
  const [homepageUrl, setHomepageUrl] = useState(app.homepageUrl || '');
  const [redirectUris, setRedirectUris] = useState(app.redirectUris.join('\n'));
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set(app.allowedScopes));
  const [busy, setBusy] = useState(false);

  const getAuth = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token')}` });

  const handleSave = async () => {
    setBusy(true);
    try {
      await axios.put(
        `${API_URL}/api/admin/oauth-apps/${app.clientId}`,
        {
          clientName: clientName.trim(),
          description: description.trim() || null,
          homepageUrl: homepageUrl.trim() || null,
          redirectUris: redirectUris.split('\n').map((u) => u.trim()).filter(Boolean),
          allowedScopes: Array.from(selectedScopes),
        },
        { headers: getAuth() },
      );
      toast.success(t('adminOauthApps.saved'));
      onSaved();
    } catch (err) {
      toast.error(getRequestErrorMessage(err) || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ReusableModal isOpen onClose={onClose} title={t('adminOauthApps.editTitle', { name: app.clientName })} className="max-w-2xl">
      <div className="space-y-4">
        <Field label={t('adminOauthApps.clientNameLabel')}>
          <Input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <Field label={t('adminOauthApps.descriptionLabel')}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <Field label={t('adminOauthApps.homepageLabel')}>
          <Input type="url" value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} />
        </Field>
        <Field label={t('adminOauthApps.redirectUrisLabel')}>
          <Textarea
            value={redirectUris}
            onChange={(e) => setRedirectUris(e.target.value)}
            rows={3}
            className="font-mono text-xs"
          />
        </Field>
        <Field label={t('adminOauthApps.scopesLabel')}>
          <ScopeList scopes={scopes} selected={selectedScopes} onChange={setSelectedScopes} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy || !clientName || selectedScopes.size === 0}
            onClick={handleSave}
          >
            {busy ? t('adminOauthApps.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </ReusableModal>
  );
};

// ─── Scope list (réutilisé entre create & edit) ─────────────────────────

interface ScopeListProps {
  scopes: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

const ScopeList: React.FC<ScopeListProps> = ({ scopes, selected, onChange }) => {
  const toggle = (s: string, next: boolean) => {
    const updated = new Set(selected);
    if (next) updated.add(s); else updated.delete(s);
    onChange(updated);
  };

  return (
    <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-2 text-xs sm:grid-cols-2">
      {scopes.map((s) => {
        const isChecked = selected.has(s);
        const id = `scope-${s}`;
        return (
          <div
            key={s}
            onClick={() => toggle(s, !isChecked)}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-white/5"
          >
            <Checkbox
              id={id}
              checked={isChecked}
              onCheckedChange={(next) => toggle(s, next)}
              size="sm"
              aria-label={s}
            />
            <label htmlFor={id} className="cursor-pointer font-mono text-white/70">{s}</label>
          </div>
        );
      })}
    </div>
  );
};

// ─── Stats modal ────────────────────────────────────────────────────────

interface StatsModalProps {
  app: OAuthAppRow;
  stats: AppStats | null;
  grants: AppGrant[];
  loading: boolean;
  onClose: () => void;
}

const StatsModal: React.FC<StatsModalProps> = ({ app, stats, grants, loading, onClose }) => {
  const { t } = useTranslation();

  const maxDailyCount = useMemo(() => {
    if (!stats?.byDay?.length) return 1;
    return Math.max(...stats.byDay.map((d) => d.n)) || 1;
  }, [stats]);

  return (
    <ReusableModal isOpen onClose={onClose} title={t('adminOauthApps.statsTitle', { name: app.clientName })} className="max-w-3xl">
      {loading ? (
        <div className="py-8 text-center text-white/60">{t('common.loading')}</div>
      ) : !stats ? (
        <div className="py-8 text-center text-white/60">{t('adminOauthApps.statsUnavailable')}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.byType.map((b) => (
              <div key={b.event_type} className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-white/40">{b.event_type}</div>
                <div className="mt-0.5 text-xl font-semibold text-white">{b.n}</div>
              </div>
            ))}
            <div className="rounded-lg border border-yellow-300/20 bg-yellow-300/5 p-3">
              <div className="text-[10px] uppercase tracking-wider text-yellow-200/70">{t('adminOauthApps.uniqueUsers')}</div>
              <div className="mt-0.5 text-xl font-semibold text-yellow-300">{stats.uniqueUsers}</div>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-white">{t('adminOauthApps.dailyActivity')}</h4>
            {stats.byDay.length === 0 ? (
              <p className="text-xs text-white/40">{t('adminOauthApps.noActivity')}</p>
            ) : (
              <div className="space-y-1">
                {stats.byDay.slice(-14).map((d) => (
                  <div key={d.day} className="flex items-center gap-3 text-xs">
                    <span className="w-24 shrink-0 font-mono text-white/50">{d.day}</span>
                    <div className="flex-1 overflow-hidden rounded bg-white/5">
                      <div
                        className="h-3 rounded bg-yellow-300/80"
                        style={{ width: `${Math.max(2, (d.n / maxDailyCount) * 100)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-white/70">{d.n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-white">{t('adminOauthApps.recentGrants')}</h4>
            {grants.length === 0 ? (
              <p className="text-xs text-white/40">{t('adminOauthApps.noGrants')}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-xs">
                  <thead className="bg-white/5 text-white/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">{t('adminOauthApps.userColumn')}</th>
                      <th className="px-3 py-2 text-left font-medium">{t('adminOauthApps.daysColumn')}</th>
                      <th className="px-3 py-2 text-left font-medium">{t('adminOauthApps.keyColumn')}</th>
                      <th className="px-3 py-2 text-left font-medium">{t('adminOauthApps.grantedAtColumn')}</th>
                      <th className="px-3 py-2 text-left font-medium">{t('adminOauthApps.expiresColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grants.map((g) => (
                      <tr key={g.id} className="border-t border-white/5">
                        <td className="px-3 py-2 font-mono text-white/70">{g.userIdOnly}</td>
                        <td className="px-3 py-2 font-semibold text-yellow-300">{g.daysGranted}</td>
                        <td className="px-3 py-2 font-mono text-white/50">{g.accessKeyHint || '—'}</td>
                        <td className="px-3 py-2 text-white/60">{fmtDate(g.grantedAt)}</td>
                        <td className="px-3 py-2 text-white/60">{g.expiresAt || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </ReusableModal>
  );
};

// ─── Field helper ───────────────────────────────────────────────────────

const Field: React.FC<{ label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">
      {label}
    </label>
    {children}
    {hint && <p className="mt-1 text-[11px] text-white/40">{hint}</p>}
  </div>
);

export default AdminOAuthApps;
