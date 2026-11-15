import axios from 'axios';

const API_URL = import.meta.env.VITE_MAIN_API;

// Interface pour les notifications de l'API
export interface ApiNotification {
  id: number;
  user_id: string;
  user_type: string;
  profile_id: string | null;
  from_user_id: string;
  from_profile_id: string | null;
  from_username: string;
  from_avatar: string | null;
  notification_type: string;
  target_type: string;
  target_id: number;
  content_type: string;
  content_id: string;
  comment_preview: string | null;
  is_read: number;
  created_at: number;
}

// Interface pour les notifications du frontend (compatible avec Notification de Comment.ts)
export interface Notification {
  id: string;
  type: string;
  commentId: string;
  replyId?: string;
  content: string;
  fromUserId: string;
  fromUsername: string;
  fromAvatar: string | null;
  createdAt: Date;
  read: boolean;
}

/**
 * Convertit une notification de l'API en notification du frontend
 */
function convertApiNotificationToNotification(apiNotif: ApiNotification): Notification {
  return {
    id: apiNotif.id.toString(),
    type: apiNotif.notification_type,
    commentId: apiNotif.target_id.toString(), // Utiliser target_id comme commentId
    content: apiNotif.comment_preview || '',
    fromUserId: apiNotif.from_user_id,
    fromUsername: apiNotif.from_username,
    fromAvatar: apiNotif.from_avatar,
    createdAt: new Date(apiNotif.created_at),
    read: apiNotif.is_read === 1
  };
}

/**
 * Récupère les notifications de l'utilisateur avec les données API brutes (pagination)
 */
export async function getUserNotificationsWithApiData(page: number = 1, limit: number = 20): Promise<{ notifications: Notification[], apiNotifications: ApiNotification[], hasMore: boolean }> {
  try {
    const token = getAuthToken();
    const profileId = getCurrentProfileId();

    if (!token || !profileId) {
      return { notifications: [], apiNotifications: [], hasMore: false };
    }

    const response = await axios.get(`${API_URL}/api/comments/notifications`, {
      params: { page, limit, profileId },
      headers: { Authorization: `Bearer ${token}` }
    });

    const apiNotifications: ApiNotification[] = response.data.notifications || [];
    const notifications = apiNotifications.map(convertApiNotificationToNotification);

    // Si on a reçu moins de notifications que la limite, il n'y a plus de notifications
    const hasMore = apiNotifications.length === limit;

    return { notifications, apiNotifications, hasMore };
  } catch (error) {
    console.error('Error getting user notifications:', error);
    return { notifications: [], apiNotifications: [], hasMore: false };
  }
}

/**
 * Récupère le token d'authentification
 */
function getAuthToken(): string | null {
  return localStorage.getItem('auth_token') || localStorage.getItem('session_id');
}

/**
 * Compte et profil courants, pour ne pas réafficher les notifications d'un
 * autre profil (cache du menu des notifications).
 */
export function getNotificationsOwnerKey(): string | null {
  try {
    const token = getAuthToken();
    const profileId = getCurrentProfileId();
    return token && profileId ? `${token}|${profileId}` : null;
  } catch {
    return null;
  }
}

/**
 * Récupère le profileId actuel depuis le localStorage
 */
function getCurrentProfileId(): string | null {
  // Récupérer directement l'ID du profil sélectionné
  const profileId = localStorage.getItem('selected_profile_id');
  if (profileId) {
    return profileId;
  }

  // Fallback: essayer l'ancien format selectedProfile
  const profileData = localStorage.getItem('selectedProfile');
  if (profileData) {
    try {
      const profile = JSON.parse(profileData);
      return profile.id || null;
    } catch (e) {
      console.error('Error parsing profile data:', e);
    }
  }

  return null;
}

/**
 * Récupère les notifications de l'utilisateur (pagination)
 */
export async function getUserNotifications(page: number = 1, limit: number = 20): Promise<{ notifications: Notification[], hasMore: boolean }> {
  try {
    const token = getAuthToken();
    const profileId = getCurrentProfileId();

    if (!token || !profileId) {
      return { notifications: [], hasMore: false };
    }

    const response = await axios.get(`${API_URL}/api/comments/notifications`, {
      params: { page, limit, profileId },
      headers: { Authorization: `Bearer ${token}` }
    });

    const apiNotifications: ApiNotification[] = response.data.notifications || [];
    const notifications = apiNotifications.map(convertApiNotificationToNotification);

    // Si on a reçu moins de notifications que la limite, il n'y a plus de notifications
    const hasMore = apiNotifications.length === limit;

    return { notifications, hasMore };
  } catch (error) {
    console.error('Error getting user notifications:', error);
    return { notifications: [], hasMore: false };
  }
}

/**
 * Récupère le nombre de notifications non lues
 */
export async function getUnreadNotificationsCount(): Promise<number> {
  try {
    const token = getAuthToken();
    const profileId = getCurrentProfileId();

    if (!token || !profileId) {
      return 0;
    }

    const response = await axios.get(`${API_URL}/api/comments/notifications`, {
      params: { unreadOnly: 'true', limit: 100, profileId },
      headers: { Authorization: `Bearer ${token}` }
    });

    const unreadNotifications: ApiNotification[] = response.data.notifications || [];
    return unreadNotifications.length;
  } catch (error) {
    console.error('Error getting unread notifications count:', error);
    return 0;
  }
}

/**
 * Vérifie si les notifications sont désactivées
 */
export async function getNotificationsDisabled(): Promise<boolean> {
  try {
    const token = getAuthToken();
    if (!token) return false;
    const response = await axios.get(`${API_URL}/api/comments/notifications/preferences`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data?.notificationsDisabled ?? false;
  } catch {
    return false;
  }
}

/**
 * Marque une notification comme lue
 */
export async function markNotificationAsRead(notificationId: string): Promise<boolean> {
  try {
    const token = getAuthToken();
    const profileId = getCurrentProfileId();

    if (!token || !profileId) {
      return false;
    }

    await axios.put(`${API_URL}/api/comments/notifications/${notificationId}/read`, { profileId }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return true;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return false;
  }
}

/**
 * Marque toutes les notifications comme lues
 */
export async function markAllNotificationsAsRead(): Promise<boolean> {
  try {
    const token = getAuthToken();
    const profileId = getCurrentProfileId();

    if (!token || !profileId) {
      return false;
    }

    await axios.put(`${API_URL}/api/comments/notifications/read-all`, { profileId }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return true;
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    return false;
  }
}

/**
 * Récupère les détails du contenu associé à une notification
 * Note: On passe directement les données de notification pour éviter une requête supplémentaire
 */
export function getContentDetailsFromNotification(apiNotification?: ApiNotification): { contentId: string, contentType: 'movie' | 'tv' } | null {
  if (apiNotification && (apiNotification.content_type === 'movie' || apiNotification.content_type === 'tv')) {
    return {
      contentId: apiNotification.content_id,
      contentType: apiNotification.content_type
    };
  }
  return null;
}

/**
 * Supprime une notification
 */
export async function deleteNotification(notificationId: string): Promise<boolean> {
  try {
    const token = getAuthToken();
    const profileId = getCurrentProfileId();

    if (!token || !profileId) {
      return false;
    }

    await axios.delete(`${API_URL}/api/comments/notifications/${notificationId}`, {
      params: { profileId },
      headers: { Authorization: `Bearer ${token}` }
    });

    return true;
  } catch (error) {
    console.error('Error deleting notification:', error);
    return false;
  }
}

