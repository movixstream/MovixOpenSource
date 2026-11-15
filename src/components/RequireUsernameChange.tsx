import React, { useEffect, useState } from 'react';
import axios, { AxiosError } from 'axios';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, User } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from './ui/button';
import { Input } from './ui/input';

const API_URL = import.meta.env.VITE_MAIN_API;
const PROFILE_NAME_MAX = 32;
const STORAGE_KEY = 'requires_username_change';

function readStoredAuthUsername(): string {
  try {
    const raw = localStorage.getItem('auth');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return String(parsed?.userProfile?.username || '');
  } catch {
    return '';
  }
}

function getRequestErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError<{ error?: string }>;
    return ax.response?.data?.error || ax.message;
  }
  if (error instanceof Error) return error.message;
  return '';
}

/**
 * Modale BLOQUANTE qui apparaît si le pseudo OAuth (Discord/Google) stocké
 * viole la policy serveur (trop long, caractères de contrôle, zero-width).
 *
 *  - Lit le flag `requires_username_change` posé en localStorage par
 *    `persistResolvedSession()` au login.
 *  - Aucun moyen de fermer la modale sans soumettre un pseudo valide.
 *  - POST /api/auth/username pour persister le nouveau pseudo.
 *  - À la réussite, met à jour `auth` en localStorage + clear le flag +
 *    notifie le reste de l'app via `auth-changed` event.
 */
const RequireUsernameChange: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [originalUsername, setOriginalUsername] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lecture initiale + écoute des changements du flag (login/logout).
  useEffect(() => {
    const refresh = () => {
      let flag: boolean;
      try {
        flag = localStorage.getItem(STORAGE_KEY) === '1';
      } catch {
        return;
      }
      if (flag) {
        const stored = readStoredAuthUsername();
        setOriginalUsername(stored);
        setNewUsername('');
        setError(null);
        setOpen(true);
      } else {
        setOpen(false);
      }
    };
    refresh();
    const handler = () => refresh();
    window.addEventListener('storage', handler);
    window.addEventListener('auth-changed', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('auth-changed', handler);
    };
  }, []);

  // Empêche le scroll de l'arrière-plan tant que la modale est ouverte.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleaned = newUsername.trim();
    if (!cleaned) {
      setError(t('requireUsernameChange.errorEmpty'));
      return;
    }
    if (cleaned.length > PROFILE_NAME_MAX) {
      setError(t('requireUsernameChange.errorTooLong', { max: PROFILE_NAME_MAX }));
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await axios.post(
        `${API_URL}/api/auth/username`,
        { username: cleaned },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      // Met à jour le bloc `auth` en localStorage avec le nouveau username.
      if (res.data?.authData) {
        try {
          localStorage.setItem('auth', JSON.stringify(res.data.authData));
        } catch { /* quota plein */ }
      } else {
        try {
          const stored = JSON.parse(localStorage.getItem('auth') || '{}');
          if (stored?.userProfile) {
            stored.userProfile.username = cleaned;
            localStorage.setItem('auth', JSON.stringify(stored));
          }
        } catch { /* ignore */ }
      }

      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event('auth-changed'));
      toast.success(t('requireUsernameChange.success'));
      setOpen(false);
    } catch (err) {
      setError(getRequestErrorMessage(err) || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          // Pas de onClick backdrop : modale non-fermable.
          role="dialog"
          aria-modal="true"
          aria-labelledby="require-username-title"
        >
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="w-full max-w-md rounded-2xl border border-yellow-300/30 bg-gray-950 p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="shrink-0 rounded-full bg-yellow-300/15 p-2 ring-1 ring-yellow-300/40">
                <AlertTriangle className="h-6 w-6 text-yellow-300" />
              </div>
              <div className="flex-1">
                <h2 id="require-username-title" className="text-lg font-semibold text-white">
                  {t('requireUsernameChange.title')}
                </h2>
                <p className="mt-1 text-sm leading-5 text-white/70">
                  {t('requireUsernameChange.description', { max: PROFILE_NAME_MAX })}
                </p>
              </div>
            </div>

            {originalUsername && (
              <div className="mb-4 rounded-lg border border-white/10 bg-black/30 p-3 text-xs">
                <div className="text-white/40">{t('requireUsernameChange.currentLabel')}</div>
                <div className="mt-1 break-all font-mono text-white/80">{originalUsername}</div>
                <div className="mt-1 text-white/40">
                  {t('requireUsernameChange.currentLength', { count: originalUsername.length })}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="new-username" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">
                  {t('requireUsernameChange.inputLabel')}
                </label>
                <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white opacity-40" />
                  <Input
                    id="new-username"
                    type="text"
                    value={newUsername}
                    onChange={(e) => { setNewUsername(e.target.value); setError(null); }}
                    placeholder={t('requireUsernameChange.placeholder')}
                    maxLength={PROFILE_NAME_MAX}
                    autoFocus
                    autoComplete="off"
                    className="pl-9"
                  />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-white/40">
                  <span>{t('requireUsernameChange.hint', { max: PROFILE_NAME_MAX })}</span>
                  <span>{newUsername.length}/{PROFILE_NAME_MAX}</span>
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={submitting || !newUsername.trim()}
                className="w-full"
              >
                {submitting ? t('requireUsernameChange.submitting') : t('requireUsernameChange.submit')}
              </Button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default RequireUsernameChange;
