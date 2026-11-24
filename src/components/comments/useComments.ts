import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'sonner';
import { useTurnstileBypass } from '@/hooks/useTurnstileBypass';
import {
  getPushPermission, isPushSupported, isSubscribed as isPushSubscribed, subscribeToPush,
} from '@/services/pushNotificationService';
import { ADMIN_BYPASS_TOKEN } from '@/utils/turnstileBypass';
import { TURNSTILE_SITE_KEY } from '@/utils/turnstileKeys';
import { getVipHeaders } from '@/utils/vipUtils';
import { readLocalStorage } from '@/utils/browserStorage';
import type { Comment, Reply } from './types';

const MAIN_API = import.meta.env.VITE_MAIN_API;

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

/**
 * Toute la logique des commentaires d'un film ou d'une série : chargement,
 * publication, réponses, réactions, suppression, signalement, suivi et
 * vérification Turnstile. Aucun habillage ici : `CommentsSection` (anciennes
 * fiches) et `DetailsComments` (nouvelles fiches) dessinent le même état.
 */
export function useComments(contentType: 'movie' | 'tv', contentId: string) {
  const { t, i18n } = useTranslation();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  // Nombre de commentaires du titre, connu après le premier chargement.
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [isSpoiler, setIsSpoiler] = useState(false);
  // Lus dès le premier rendu : sinon l'invite « Se connecter » s'affiche le temps
  // d'un effet avant le champ de saisie, et le gabarit de chargement saute.
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!readLocalStorage('auth_token'));
  const [profileId, setProfileId] = useState<string | null>(() => (
    readLocalStorage('auth_token') ? readLocalStorage('selected_profile_id') : null
  ));
  const [expandedReplies, setExpandedReplies] = useState<Set<number>>(new Set());
  const [replies, setReplies] = useState<{ [key: number]: Reply[] }>({});
  const [replyingTo, setReplyingTo] = useState<{ commentId: number; replyId?: number; username: string } | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [isReplySpoiler, setIsReplySpoiler] = useState(false);
  const [editingComment, setEditingComment] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editIsSpoiler, setEditIsSpoiler] = useState(false);
  const [editingReply, setEditingReply] = useState<number | null>(null);
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; type: 'comment' | 'reply'; commentId?: number } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [areCommentsHidden, setAreCommentsHidden] = useState(() => {
    return readLocalStorage('settings_hide_comments_section') === 'true';
  });
  const [repliesPage, setRepliesPage] = useState<{ [key: number]: number }>({});
  const [repliesHasMore, setRepliesHasMore] = useState<{ [key: number]: boolean }>({});

  const [repliesTotalCount, setRepliesTotalCount] = useState<{ [key: number]: number }>({});
  const [commentLimits, setCommentLimits] = useState<{ movieCount: number; hourCount: number; movieLimit: number | null; hourLimit: number | null; isAdmin?: boolean } | null>(null);
  // Premières limites attendues (connecté seulement) : les habillages gardent leur place.
  const [limitsPending, setLimitsPending] = useState(() => !!readLocalStorage('auth_token'));

  // Report states
  const [reportModal, setReportModal] = useState<{ targetType: 'comment' | 'reply'; targetId: number } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());

  // Suivi des nouveaux commentaires
  const [followingComments, setFollowingComments] = useState(false);
  const [followingBusy, setFollowingBusy] = useState(false);

  // Turnstile
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Dispense admin : pas de challenge du tout. Voir `utils/turnstileBypass.ts`.
  const turnstileBypass = useTurnstileBypass();

  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastCommentRef = useRef<HTMLDivElement | null>(null);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Helper pour récupérer les données du profil de manière sécurisée
  const getProfileData = () => {
    const profile = readLocalStorage('selected_profile');
    try {
      return profile ? JSON.parse(profile) : null;
    } catch (e) {
      console.error('Erreur lors du parsing du profil:', e);
      return null;
    }
  };

  // Vérifier l'authentification et le profil
  useEffect(() => {
    const token = readLocalStorage('auth_token');
    const profileId = readLocalStorage('selected_profile_id');

    if (token) {
      setIsAuthenticated(true);
      if (profileId) {
        setProfileId(profileId);
      }

      // Vérifier si admin
      axios.get(`${MAIN_API}/api/admin/check`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(({ data }) => setIsAdmin(data?.success === true && data?.admin?.role === 'admin'))
        .catch(() => setIsAdmin(false));
    }
  }, []);

  useEffect(() => {
    const syncCommentsVisibility = () => {
      setAreCommentsHidden(readLocalStorage('settings_hide_comments_section') === 'true');
    };

    syncCommentsVisibility();
    window.addEventListener('storage', syncCommentsVisibility);
    window.addEventListener('comments_section_visibility_changed', syncCommentsVisibility as EventListener);

    return () => {
      window.removeEventListener('storage', syncCommentsVisibility);
      window.removeEventListener('comments_section_visibility_changed', syncCommentsVisibility as EventListener);
    };
  }, []);

  // Turnstile : rendre le widget quand l'utilisateur est authentifié
  const renderTurnstile = useCallback(() => {
    if (window.turnstile && turnstileRef.current && !widgetIdRef.current) {
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      });
    }
  }, []);

  useEffect(() => {
    if (turnstileBypass === 'bypass') {
      setTurnstileToken(ADMIN_BYPASS_TOKEN);
      return;
    }
    // Statut encore inconnu : on n'affiche rien plutôt qu'un challenge à
    // retirer juste après.
    if (turnstileBypass === 'unknown') return;
    if (!isAuthenticated || !TURNSTILE_SITE_KEY) return;

    const timer = setTimeout(() => {
      if (window.turnstile) {
        renderTurnstile();
      } else {
        const interval = setInterval(() => {
          if (window.turnstile) {
            clearInterval(interval);
            renderTurnstile();
          }
        }, 200);
        // Nettoyage de l'intervalle après 10s max
        setTimeout(() => clearInterval(interval), 10000);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
        setTurnstileToken('');
      }
    };
  }, [isAuthenticated, renderTurnstile, turnstileBypass]);

  const resetTurnstile = useCallback(() => {
    // Un dispensé n'a rien à réinitialiser : effacer le marqueur rebloquerait
    // le bouton après le premier commentaire.
    if (turnstileBypass !== 'challenge') return;

    setTurnstileToken('');
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [turnstileBypass]);

  // Charger les commentaires
  const loadComments = useCallback(async (pageNum: number = 1) => {
    try {
      const token = readLocalStorage('auth_token');
      const currentProfileId = readLocalStorage('selected_profile_id');

      const response = await axios.get(
        `${MAIN_API}/api/comments/${contentType}/${contentId}`,
        {
          params: { page: pageNum, limit: 20, profileId: currentProfileId },
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        }
      );

      const nextComments = response.data?.comments;
      if (!Array.isArray(nextComments)) {
        throw new Error('Réponse de commentaires invalide');
      }
      if (pageNum === 1) {
        setComments(nextComments);
      } else {
        // Un commentaire publié ou supprimé entre deux pages décale la
        // suivante : ne jamais ajouter deux fois le même.
        setComments(prev => {
          const known = new Set(prev.map(comment => comment.id));
          return [...prev, ...nextComments.filter((comment: Comment) => !known.has(comment.id))];
        });
      }

      setHasMore(response.data.hasMore === true);
      if (typeof response.data.total === 'number') setTotal(response.data.total);
      setLoading(false);

      // Délai de 0.3 secondes avant d'afficher les commentaires
      setTimeout(() => {
        setShowComments(true);
      }, 300);
    } catch (error) {
      console.error('Erreur lors du chargement des commentaires:', error);
      setLoading(false);
      setTimeout(() => {
        setShowComments(true);
      }, 300);
    }
  }, [contentType, contentId]);

  useEffect(() => {
    loadComments(1);
    fetchLimits();
  }, [loadComments]);

  // Abonnement aux nouveaux commentaires de ce contenu (par profil)
  useEffect(() => {
    const token = readLocalStorage('auth_token');
    if (!token || !profileId) {
      setFollowingComments(false);
      return;
    }
    let cancelled = false;
    axios.get(`${MAIN_API}/api/comments/subscriptions/${contentType}/${contentId}`, {
      params: { profileId },
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(({ data }) => { if (!cancelled) setFollowingComments(data?.subscribed === true); })
      .catch(() => { if (!cancelled) setFollowingComments(false); });
    return () => { cancelled = true; };
  }, [contentType, contentId, profileId]);

  const handleToggleFollowComments = async () => {
    const token = readLocalStorage('auth_token');
    if (!token || !profileId || followingBusy) return;
    const next = !followingComments;
    setFollowingBusy(true);
    try {
      await axios.put(
        `${MAIN_API}/api/comments/subscriptions/${contentType}/${contentId}`,
        { profileId, subscribed: next },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setFollowingComments(next);
      toast.success(next ? t('comments.followEnabled') : t('comments.followDisabled'));

      // Proposer aussi les notifications push du navigateur quand c'est possible.
      if (next && isPushSupported() && getPushPermission() !== 'denied') {
        const alreadyPush = await isPushSubscribed();
        if (!alreadyPush) await subscribeToPush();
      }
    } catch (error) {
      console.error('Erreur lors du suivi des commentaires:', error);
      toast.error(t('comments.followError'));
    } finally {
      setFollowingBusy(false);
    }
  };

  // Charger les limites de commentaires
  const fetchLimits = async () => {
    try {
      const token = readLocalStorage('auth_token');
      const currentProfileId = readLocalStorage('selected_profile_id');
      if (!token) return;

      const response = await axios.get(`${MAIN_API}/api/comments/limits`, {
        params: { contentType, contentId, profileId: currentProfileId },
        headers: { Authorization: `Bearer ${token}` }
      });

      setCommentLimits(response.data);
    } catch (error) {
      console.error('Erreur lors de la récupération des limites:', error);
    } finally {
      setLimitsPending(false);
    }
  };

  // Pagination infinie — stable observer that reads latest state via refs.
  // Avoids tearing down/rebuilding the IO on every page/loading transition.
  const pageRef = useRef(page);
  const hasMoreRef = useRef(hasMore);
  const loadingRef = useRef(loading);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMoreRef.current && !loadingRef.current) {
        const nextPage = pageRef.current + 1;
        setPage(nextPage);
        loadComments(nextPage);
      }
    });

    if (lastCommentRef.current) {
      observerRef.current.observe(lastCommentRef.current);
    }

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [loadComments]);

  // Page suivante à la demande : le lien « Voir les autres commentaires » des
  // nouvelles fiches, qui ne posent pas `lastCommentRef`.
  const loadingMoreRef = useRef(false);
  const loadMoreComments = useCallback(async () => {
    if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    pageRef.current = nextPage;
    setPage(nextPage);
    await loadComments(nextPage);
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [loadComments]);

  // Re-attach the IO target when the last-comment node changes (e.g. when
  // new comments are appended after pagination). Without this the observer
  // would still be watching the old "last" node.
  useEffect(() => {
    if (!observerRef.current) return;
    observerRef.current.disconnect();
    if (lastCommentRef.current) {
      observerRef.current.observe(lastCommentRef.current);
    }
  }, [comments.length]);

  // Charger les réponses d'un commentaire
  const loadReplies = async (commentId: number, page: number = 1) => {
    try {
      const token = readLocalStorage('auth_token');
      const currentProfileId = readLocalStorage('selected_profile_id');

      const response = await axios.get(
        `${MAIN_API}/api/comments/${commentId}/replies`,
        {
          params: { page, limit: 3, profileId: currentProfileId },
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        }
      );

      const hierarchicalReplies = response.data.replies || [];

      if (page === 1) {
        // Première page : remplacer les réponses
        setReplies(prev => ({
          ...prev,
          [commentId]: hierarchicalReplies
        }));
      } else {
        // Pages suivantes : ajouter les réponses
        setReplies(prev => ({
          ...prev,
          [commentId]: [...(prev[commentId] || []), ...hierarchicalReplies]
        }));
      }

      // Mettre à jour les infos de pagination
      setRepliesPage(prev => ({
        ...prev,
        [commentId]: page
      }));

      setRepliesHasMore(prev => ({
        ...prev,
        [commentId]: response.data.hasMore
      }));

      setRepliesTotalCount(prev => ({
        ...prev,
        [commentId]: response.data.total
      }));
    } catch (error) {
      console.error('Erreur lors du chargement des réponses:', error);
    }
  };

  // Charger plus de réponses
  const loadMoreReplies = async (commentId: number) => {
    const currentPage = repliesPage[commentId] || 1;
    const nextPage = currentPage + 1;
    await loadReplies(commentId, nextPage);
  };

  // Poster un commentaire
  const handlePostComment = async () => {
    if (!newComment.trim() || newComment.length > 500) return;
    if (TURNSTILE_SITE_KEY && !turnstileToken) return;

    const token = readLocalStorage('auth_token');
    if (!token) return;

    const profileData = getProfileData();

    // Créer un commentaire optimiste avec un ID temporaire négatif
    const optimisticComment: Comment = {
      id: -Date.now(), // ID temporaire négatif
      content_type: contentType,
      content_id: contentId,
      user_id: '',
      user_type: '',
      profile_id: profileId,
      username: profileData?.name || t('comments.you'),
      avatar: profileData?.avatar || null,
      content: newComment,
      is_spoiler: isSpoiler ? 1 : 0,
      is_vip: 0,
      is_admin: 0,
      is_edited: 0,
      created_at: Date.now(),
      deleted: 0,
      repliesCount: 0,
      reactions: 0,
      userReaction: null
    };

    // Ajouter immédiatement le commentaire (mise à jour optimiste)
    setComments(prev => [optimisticComment, ...prev]);
    setTotal(prev => (prev === null ? prev : prev + 1));
    const commentContent = newComment;
    const commentIsSpoiler = isSpoiler;
    setNewComment('');
    setIsSpoiler(false);

    try {
      const response = await axios.post(
        `${MAIN_API}/api/comments`,
        {
          contentType,
          contentId,
          content: commentContent,
          isSpoiler: commentIsSpoiler,
          profileId,
          turnstileToken
        },
        { headers: { Authorization: `Bearer ${token}`, ...getVipHeaders() } }
      );

      // Reset le widget Turnstile pour le prochain commentaire
      resetTurnstile();

      setComments(prev => prev.map(c =>
        c.id === optimisticComment.id ? response.data : c
      ));

      // Mettre à jour les limites après un post réussi
      fetchLimits();
    } catch (error) {
      console.error('Erreur lors de la publication du commentaire:', error);
      // En cas d'erreur, retirer le commentaire optimiste
      setComments(prev => prev.filter(c => c.id !== optimisticComment.id));
      setTotal(prev => (prev === null ? prev : Math.max(0, prev - 1)));
      // Restaurer le contenu pour que l'utilisateur ne perde pas son texte
      setNewComment(commentContent);
      setIsSpoiler(commentIsSpoiler);

      if (axios.isAxiosError(error) && error.response?.status === 429) {
        toast.error(error.response.data.error || t('comments.limitReached'));
      } else {
        toast.error(t('comments.publishError'));
      }
    }
  };

  // Poster une réponse
  const handlePostReply = async (commentId: number, parentReplyId?: number, replyToUsername?: string) => {
    if (!replyContent.trim() || replyContent.length > 500) return;
    if (TURNSTILE_SITE_KEY && !turnstileToken) return;

    const token = readLocalStorage('auth_token');
    if (!token) return;

    const profileData = getProfileData();

    // Créer une réponse optimiste avec un ID temporaire négatif
    const optimisticReply: Reply = {
      id: -Date.now(), // ID temporaire négatif
      comment_id: commentId,
      parent_reply_id: parentReplyId || null,
      user_id: '',
      user_type: '',
      profile_id: profileId,
      username: profileData?.name || t('comments.you'),
      avatar: profileData?.avatar || null,
      reply_to_username: replyToUsername || null,
      content: replyContent,
      is_spoiler: isReplySpoiler ? 1 : 0,
      is_vip: 0,
      is_admin: 0,
      is_edited: 0,
      created_at: Date.now(),
      deleted: 0,
      reactions: 0,
      userReaction: null
    };

    // Ajouter immédiatement la réponse (mise à jour optimiste)
    setReplies(prev => ({
      ...prev,
      [commentId]: [...(prev[commentId] || []), optimisticReply]
    }));

    // Mettre à jour immédiatement le compteur de réponses
    setComments(prev =>
      prev.map(c =>
        c.id === commentId ? { ...c, repliesCount: c.repliesCount + 1 } : c
      )
    );

    const replyContentBackup = replyContent;
    const isReplySpoilerBackup = isReplySpoiler;
    setReplyContent('');
    setIsReplySpoiler(false);
    setReplyingTo(null);

    try {
      await axios.post(
        `${MAIN_API}/api/comments/${commentId}/replies`,
        {
          content: replyContentBackup,
          isSpoiler: isReplySpoilerBackup,
          profileId,
          parentReplyId,
          replyToUsername,
          turnstileToken
        },
        { headers: { Authorization: `Bearer ${token}`, ...getVipHeaders() } }
      );

      // Reset le widget Turnstile pour la prochaine réponse
      resetTurnstile();

      // Recharger toutes les pages de réponses actuellement chargées
      const currentPage = repliesPage[commentId] || 1;
      const totalReplies: Reply[] = [];
      const currentProfileId = readLocalStorage('selected_profile_id');

      for (let p = 1; p <= currentPage; p++) {
        const response = await axios.get(
          `${MAIN_API}/api/comments/${commentId}/replies`,
          {
            params: { page: p, limit: 3, profileId: currentProfileId },
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        totalReplies.push(...(response.data.replies || []));

        // Mettre à jour les infos de pagination avec la dernière page
        if (p === currentPage) {
          setRepliesHasMore(prev => ({
            ...prev,
            [commentId]: response.data.hasMore
          }));
          setRepliesTotalCount(prev => ({
            ...prev,
            [commentId]: response.data.total
          }));
        }
      }

      setReplies(prev => ({
        ...prev,
        [commentId]: totalReplies
      }));
    } catch (error) {
      console.error('Erreur lors de la publication de la réponse:', error);
      // En cas d'erreur, retirer la réponse optimiste
      setReplies(prev => ({
        ...prev,
        [commentId]: (prev[commentId] || []).filter(r => r.id !== optimisticReply.id)
      }));
      // Décrémenter le compteur de réponses
      setComments(prev =>
        prev.map(c =>
          c.id === commentId ? { ...c, repliesCount: c.repliesCount - 1 } : c
        )
      );
      // Restaurer le contenu
      setReplyContent(replyContentBackup);
      setIsReplySpoiler(isReplySpoilerBackup);
      setReplyingTo({ commentId, replyId: parentReplyId, username: replyToUsername || '' });
      toast.error(t('comments.replyError'));
    }
  };

  // Éditer un commentaire
  const handleEditComment = async (commentId: number) => {
    if (!editContent.trim() || editContent.length > 500) return;

    const token = readLocalStorage('auth_token');
    if (!token) return;

    try {
      await axios.put(
        `${MAIN_API}/api/comments/${commentId}`,
        {
          content: editContent,
          isSpoiler: editIsSpoiler,
          profileId
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setComments(prev =>
        prev.map(c =>
          c.id === commentId
            ? { ...c, content: editContent, is_spoiler: editIsSpoiler ? 1 : 0, spoiler_auto: 0, is_edited: 1 }
            : c
        )
      );

      setEditingComment(null);
      setEditContent('');
    } catch (error) {
      console.error('Erreur lors de l\'édition du commentaire:', error);
    }
  };

  // Éditer une réponse
  const handleEditReply = async (replyId: number, commentId: number) => {
    if (!editContent.trim() || editContent.length > 500) return;

    const token = readLocalStorage('auth_token');
    if (!token) return;

    try {
      await axios.put(
        `${MAIN_API}/api/comments/replies/${replyId}`,
        {
          content: editContent,
          isSpoiler: editIsSpoiler,
          profileId
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setReplies(prev => ({
        ...prev,
        [commentId]: prev[commentId].map(r =>
          r.id === replyId
            ? { ...r, content: editContent, is_spoiler: editIsSpoiler ? 1 : 0, spoiler_auto: 0, is_edited: 1 }
            : r
        )
      }));

      setEditingReply(null);
      setEditContent('');
    } catch (error) {
      console.error('Erreur lors de l\'édition de la réponse:', error);
    }
  };

  // Demande confirmation de suppression (ouvre le popup)
  const requestDeleteComment = (commentId: number) => {
    setDeleteConfirm({ id: commentId, type: 'comment' });
  };

  const requestDeleteReply = (replyId: number, commentId: number) => {
    setDeleteConfirm({ id: replyId, type: 'reply', commentId });
  };

  // Exécuter la suppression confirmée
  const executeDelete = async () => {
    if (!deleteConfirm) return;
    const { id, type, commentId } = deleteConfirm;
    setDeleteConfirm(null);

    const token = readLocalStorage('auth_token');
    if (!token) return;

    setDeletingIds(prev => new Set(prev).add(id));

    try {
      if (type === 'comment') {
        await axios.delete(`${MAIN_API}/api/comments/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { profileId }
        });

        setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        setDeletedIds(prev => new Set(prev).add(id));

        setTimeout(() => {
          setComments(prev => prev.filter(c => c.id !== id));
          setTotal(prev => (prev === null ? prev : Math.max(0, prev - 1)));
          setDeletedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        }, 2000);
      } else {
        await axios.delete(`${MAIN_API}/api/comments/replies/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { profileId }
        });

        setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        setDeletedIds(prev => new Set(prev).add(id));

        setTimeout(() => {
          setReplies(prev => ({
            ...prev,
            [commentId!]: (prev[commentId!] || []).filter(r => r.id !== id)
          }));
          setComments(prev =>
            prev.map(c =>
              c.id === commentId ? { ...c, repliesCount: c.repliesCount - 1 } : c
            )
          );
          setDeletedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        }, 2000);
      }
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  // Soumettre un signalement
  const handleReport = async () => {
    if (!reportModal || !reportReason) return;
    const token = readLocalStorage('auth_token');
    if (!token) return;

    setReportSubmitting(true);
    try {
      await axios.post(
        `${MAIN_API}/api/comments/report`,
        {
          targetType: reportModal.targetType,
          targetId: reportModal.targetId,
          reason: reportReason,
          details: reportDetails || undefined,
          profileId
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setReportedIds(prev => new Set(prev).add(`${reportModal.targetType}-${reportModal.targetId}`));
      setReportModal(null);
      setReportReason('');
      setReportDetails('');
    } catch (error) {
      // 409 : déjà signalé par ce profil, même résultat pour lui.
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        setReportedIds(prev => new Set(prev).add(`${reportModal.targetType}-${reportModal.targetId}`));
        setReportModal(null);
        setReportReason('');
        setReportDetails('');
      } else {
        console.error('Erreur lors du signalement:', error);
      }
    } finally {
      setReportSubmitting(false);
    }
  };

  const REPORT_REASONS = [
    { value: 'spam', label: t('comments.reportReasons.spam', 'Spam') },
    { value: 'harassment', label: t('comments.reportReasons.harassment', 'Insultes / Harcèlement') },
    { value: 'sexual_content', label: t('comments.reportReasons.sexualContent', 'Contenu sexuel') },
    { value: 'unmarked_spoiler', label: t('comments.reportReasons.unmarkedSpoiler', 'Spoiler non marqué') },
    { value: 'impersonation', label: t('comments.reportReasons.impersonation', "Usurpation d'identité") },
    { value: 'other', label: t('comments.reportReasons.other', 'Autre') },
  ];

  // Gérer les réactions
  const handleReaction = async (targetType: 'comment' | 'reply', targetId: number) => {
    const token = readLocalStorage('auth_token');
    if (!token) return;

    // Déterminer l'état actuel de la réaction
    let currentReaction: boolean | null = null;
    if (targetType === 'comment') {
      const comment = comments.find(c => c.id === targetId);
      currentReaction = comment?.userReaction || false;
    } else {
      const commentId = Object.keys(replies).find(cId =>
        replies[parseInt(cId)].some(r => r.id === targetId)
      );
      if (commentId) {
        const reply = replies[parseInt(commentId)].find(r => r.id === targetId);
        currentReaction = reply?.userReaction || false;
      }
    }

    // Inverser l'état de la réaction de manière optimiste
    const newReactionState = !currentReaction;

    if (targetType === 'comment') {
      // Mise à jour optimiste pour un commentaire
      setComments(prev =>
        prev.map(c =>
          c.id === targetId
            ? {
              ...c,
              reactions: newReactionState ? c.reactions + 1 : c.reactions - 1,
              userReaction: newReactionState
            }
            : c
        )
      );
    } else {
      // Mise à jour optimiste pour une réponse
      const commentId = Object.keys(replies).find(cId =>
        replies[parseInt(cId)].some(r => r.id === targetId)
      );

      if (commentId) {
        setReplies(prev => ({
          ...prev,
          [parseInt(commentId)]: prev[parseInt(commentId)].map(r =>
            r.id === targetId
              ? {
                ...r,
                reactions: newReactionState ? r.reactions + 1 : r.reactions - 1,
                userReaction: newReactionState
              }
              : r
          )
        }));
      }
    }

    try {
      const response = await axios.post(
        `${MAIN_API}/api/comments/react`,
        { targetType, targetId, profileId },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Vérifier si la réponse du serveur correspond à notre état optimiste
      // Si non, corriger
      if (response.data.reacted !== newReactionState) {
        if (targetType === 'comment') {
          setComments(prev =>
            prev.map(c =>
              c.id === targetId
                ? {
                  ...c,
                  reactions: response.data.reacted ? c.reactions + 1 : c.reactions - 1,
                  userReaction: response.data.reacted
                }
                : c
            )
          );
        } else {
          const commentId = Object.keys(replies).find(cId =>
            replies[parseInt(cId)].some(r => r.id === targetId)
          );

          if (commentId) {
            setReplies(prev => ({
              ...prev,
              [parseInt(commentId)]: prev[parseInt(commentId)].map(r =>
                r.id === targetId
                  ? {
                    ...r,
                    reactions: response.data.reacted ? r.reactions + 1 : r.reactions - 1,
                    userReaction: response.data.reacted
                  }
                  : r
              )
            }));
          }
        }
      }
    } catch (error) {
      console.error('Erreur lors de la gestion de la réaction:', error);
      // En cas d'erreur, annuler la mise à jour optimiste
      if (targetType === 'comment') {
        setComments(prev =>
          prev.map(c =>
            c.id === targetId
              ? {
                ...c,
                reactions: currentReaction ? c.reactions + 1 : c.reactions - 1,
                userReaction: currentReaction
              }
              : c
          )
        );
      } else {
        const commentId = Object.keys(replies).find(cId =>
          replies[parseInt(cId)].some(r => r.id === targetId)
        );

        if (commentId) {
          setReplies(prev => ({
            ...prev,
            [parseInt(commentId)]: prev[parseInt(commentId)].map(r =>
              r.id === targetId
                ? {
                  ...r,
                  reactions: currentReaction ? r.reactions + 1 : r.reactions - 1,
                  userReaction: currentReaction
                }
                : r
            )
          }));
        }
      }
    }
  };

  // Toggle des réponses
  const toggleReplies = (commentId: number) => {
    if (!expandedReplies.has(commentId) && !replies[commentId]) {
      loadReplies(commentId);
    }
    // Mise à jour à partir de l'état courant : une ligne mémorisée garde une
    // ancienne copie de cette fonction, et ouvrir un fil ne doit pas refermer
    // ceux ouverts depuis.
    setExpandedReplies(prev => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  };

  // Révéler un spoiler
  const revealSpoiler = (type: 'comment' | 'reply', id: number) => {
    setRevealedSpoilers(prev => new Set([...prev, `${type}-${id}`]));
  };

  // Format de la date
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) {
      return date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
    } else if (days > 0) {
      return t('time.daysAgo', { count: days });
    } else if (hours > 0) {
      return t('time.hoursAgo', { count: hours });
    } else if (minutes > 0) {
      return t('time.minutesAgo', { count: minutes });
    } else {
      return t('time.justNow');
    }
  };

  return {
    // Liste
    comments, total, loading, loadingMore, hasMore, loadMoreComments, showComments, areCommentsHidden,
    lastCommentRef, formatDate,
    // Identité
    isAuthenticated, isAdmin, profileId, getProfileData, commentLimits, limitsPending,
    // Nouveau commentaire
    newComment, setNewComment, isSpoiler, setIsSpoiler, commentTextareaRef, handlePostComment,
    // Réponses
    replies, expandedReplies, repliesHasMore, repliesTotalCount, toggleReplies, loadMoreReplies,
    replyingTo, setReplyingTo, replyContent, setReplyContent, isReplySpoiler, setIsReplySpoiler,
    replyTextareaRef, handlePostReply,
    // Édition
    editingComment, setEditingComment, editingReply, setEditingReply, editContent, setEditContent,
    editIsSpoiler, setEditIsSpoiler, editTextareaRef, handleEditComment, handleEditReply,
    // Réactions et spoilers
    handleReaction, revealedSpoilers, revealSpoiler,
    // Suppression
    deletingIds, deletedIds, deleteConfirm, setDeleteConfirm, requestDeleteComment, requestDeleteReply,
    executeDelete,
    // Signalement
    reportModal, setReportModal, reportReason, setReportReason, reportDetails, setReportDetails,
    reportSubmitting, reportedIds, handleReport, REPORT_REASONS,
    // Suivi des nouveaux commentaires
    followingComments, followingBusy, handleToggleFollowComments,
    // Turnstile
    turnstileToken, turnstileRef, turnstileBypass,
  };
}

export type CommentsState = ReturnType<typeof useComments>;

export default useComments;
