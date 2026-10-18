// Carte de membre Movix : en haut de la page profil, façon carte de cinéma.
// Bande perforée de pellicule, avatar, nom modifiable, profil actif,
// ancienneté, compte de connexion et fin du VIP.

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { Camera, Check, Crown, Pencil, Repeat, Settings, X } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { buttonClass } from './ui';

export interface MemberCardProps {
  name: string;
  avatar: string;
  profileCount: number;
  memberSince: string | null;
  providerLabel: string;
  vipUntil: string | null;
  isVip: boolean;
  onEditAvatar: () => void;
  onRename: (name: string) => Promise<void> | void;
}

const SPROCKETS = Array.from({ length: 22 });

function initialsOf(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || 'M';
}

export default function MemberCard({
  name,
  avatar,
  profileCount,
  memberSince,
  providerLabel,
  vipUntil,
  isVip,
  onEditAvatar,
  onRename,
}: MemberCardProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatar]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Légère inclinaison qui suit le pointeur (souris seulement, jamais au toucher).
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [3, -3]), { stiffness: 220, damping: 22 });
  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-4, 4]), { stiffness: 220, damping: 22 });

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
  };

  const resetTilt = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  const submit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ perspective: 1200 }} className="h-full">
      <motion.section
        aria-label={t('profilePage.card.label', 'Carte de membre')}
        onPointerMove={handlePointerMove}
        onPointerLeave={resetTilt}
        style={reduceMotion ? undefined : { rotateX, rotateY, transformStyle: 'preserve-3d' }}
        className="relative flex h-full min-h-[280px] flex-col overflow-hidden rounded-2xl bg-red-600 text-white"
      >
        {/* Bande de pellicule : la seule décoration de la carte */}
        <div aria-hidden="true" className="flex h-9 shrink-0 items-center justify-between gap-1.5 overflow-hidden bg-red-800 px-3">
          {SPROCKETS.map((_, index) => (
            <span key={index} className="h-3.5 w-5 shrink-0 rounded-[3px] bg-black" />
          ))}
        </div>

        <div className="flex flex-1 flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="relative">
              <button
                type="button"
                onClick={onEditAvatar}
                className="group/avatar relative block h-20 w-20 overflow-hidden rounded-full bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:h-24 sm:w-24"
                aria-label={t('profilePage.card.changeAvatar', 'Changer d’avatar')}
              >
                {avatar && !avatarFailed ? (
                  <img src={avatar} alt="" className="h-full w-full object-cover" onError={() => setAvatarFailed(true)} />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-3xl font-semibold">{initialsOf(name)}</span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity duration-150 group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100">
                  <Camera className="h-6 w-6" aria-hidden="true" />
                </span>
              </button>
            </div>
            <p className="text-right text-sm leading-snug text-white/85">
              {t('profilePage.card.title', 'Carte de membre')}
              <br />
              <span className="text-white/70">
                {profileCount > 1
                  ? t('profilePage.card.profileCount', { count: profileCount, defaultValue: '{{count}} profils' })
                  : providerLabel}
              </span>
            </p>
          </div>

          <div className="min-w-0">
            {editing ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
                className="flex flex-wrap items-center gap-2"
              >
                <label htmlFor="profile-name-input" className="sr-only">{t('profilePage.header.usernamePlaceholder')}</label>
                <input
                  id="profile-name-input"
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setEditing(false);
                  }}
                  maxLength={32}
                  className="h-11 min-w-0 flex-1 rounded-full bg-black/30 px-4 text-xl font-semibold text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white"
                  placeholder={t('profilePage.header.usernamePlaceholder')}
                />
                <button type="submit" disabled={saving} aria-label={t('profilePage.header.save')} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-black transition-transform active:scale-95 disabled:opacity-60">
                  <Check className="h-5 w-5" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setEditing(false)} aria-label={t('profilePage.header.cancel')} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/30 transition-transform active:scale-95">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="min-w-0 truncate text-4xl font-semibold leading-none tracking-tight sm:text-5xl" title={name}>
                  {name}
                </h1>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/25 transition-[background-color,transform] hover:bg-black/40 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label={t('profilePage.card.rename', 'Modifier le nom')}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
            <p className="mt-3 text-[15px] leading-relaxed text-white/85">
              {memberSince && <>{t('profilePage.card.memberSince', { date: memberSince, defaultValue: 'Membre depuis {{date}}' })}<br /></>}
              {profileCount > 1 && providerLabel}
            </p>
          </div>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
            {isVip ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black px-3.5 py-1.5 text-sm font-medium">
                <Crown className="h-4 w-4" aria-hidden="true" />
                {vipUntil ? t('vip.activeUntil', { date: vipUntil }) : t('vip.youAreVip')}
              </span>
            ) : (
              <Link to="/vip" className="inline-flex items-center gap-1.5 rounded-full bg-black px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-black/80">
                <Crown className="h-4 w-4" aria-hidden="true" />
                {t('vip.becomeVip')}
              </Link>
            )}
            <div className="flex gap-1.5">
              {profileCount > 0 && (
                <Link to="/profile-selection" className={buttonClass('ghost', 'sm', 'text-white/90 hover:bg-black/20')}>
                  <Repeat className="h-4 w-4" aria-hidden="true" />
                  {t('profilePage.card.switchProfile', 'Changer')}
                </Link>
              )}
              <Link to="/settings" className={buttonClass('ghost', 'sm', 'text-white/90 hover:bg-black/20')} aria-label={t('settings.title', 'Paramètres')}>
                <Settings className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
