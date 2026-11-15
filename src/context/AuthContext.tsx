import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { checkVipStatus } from '../utils/vipUtils';
import i18n from '../i18n';

interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  checkAccessCode: (code: string, alreadyAuthenticated?: boolean) => Promise<boolean>;
  logout: () => void;
  lastAttempt: number | null;
  remainingTime: number;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAttempt, setLastAttempt] = useState<number | null>(null);
  const [remainingTime, setRemainingTime] = useState(0);

  const updateRemainingTime = useCallback(() => {
    if (!lastAttempt) return 0;
    const elapsed = Date.now() - lastAttempt;
    const remaining = Math.max(0, 30 - Math.floor(elapsed / 1000));
    setRemainingTime(remaining);
    return remaining;
  }, [lastAttempt]);

  useEffect(() => {
    if (!lastAttempt) return;
    
    const interval = setInterval(() => {
      const remaining = updateRemainingTime();
      if (remaining === 0) {
        setLastAttempt(null);
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [lastAttempt, updateRemainingTime]);

  useEffect(() => {
    const checkStoredAuth = async () => {
      let storedAuth: string | null;
      try {
        storedAuth = localStorage.getItem('auth');
      } catch {
        setLoading(false);
        return;
      }
      if (storedAuth) {
        try {
          const parsedAuth = JSON.parse(storedAuth);
          const { code, expiresAt: localExpiresAt } = parsedAuth;

          // Vérifier que le code existe et n'est pas vide
          if (!code || typeof code !== 'string') {
            // Preserve stored 'auth' per user request; mark unauthenticated instead.
            setIsAuthenticated(false);
            setLoading(false);
            return;
          }

          // Vérifier si la clé existe toujours dans la base de données MySQL
          try {
            const response = await fetch(`${import.meta.env.VITE_MAIN_API}/api/verify-access-code`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ code }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
              const apiExpiresAt = data.data.expiresAt;
              const isExpired = apiExpiresAt ? new Date(apiExpiresAt) < new Date() : false;
              const isActive = !isExpired;

              // Vérifier si les dates d'expiration correspondent
              const localExpDate = localExpiresAt === 'never' ? null : new Date(localExpiresAt);
              const apiExpDate = apiExpiresAt || 'never';
              const expirationMatch =
                (localExpiresAt === 'never' && !apiExpiresAt) ||
                (localExpDate && apiExpiresAt && localExpDate.getTime() === new Date(apiExpiresAt).getTime());

              if (!isActive) {
                // Preserve stored 'auth' per user request; mark unauthenticated and set error.
                setIsAuthenticated(false);
                setError(i18n.t('auth.errors.invalidKey'));
              } else if (!expirationMatch) {
                // Si les dates d'expiration ne correspondent pas, mettre à jour le localStorage
                localStorage.setItem('auth', JSON.stringify({
                  code,
                  expiresAt: apiExpDate
                }));
                setIsAuthenticated(apiExpDate === 'never' || new Date(apiExpDate) > new Date());
                if (!setIsAuthenticated) {
                  setError(i18n.t('auth.errors.expirationChanged'));
                }
              } else {
                setIsAuthenticated(true);
              }
            } else {
              // Preserve stored 'auth' per user request; mark unauthenticated and set error.
              setIsAuthenticated(false);
              setError(i18n.t('auth.errors.keyNotFound'));
            }
          } catch (error) {
            console.error('Erreur lors de la vérification de la clé:', error);
            setError(i18n.t('auth.errors.verificationError'));
          }
        } catch (parseError) {
          console.error('Erreur lors du parsing de l\'auth stockée:', parseError);
          // Preserve stored 'auth' per user request; mark unauthenticated.
          setIsAuthenticated(false);
        }
      }
      setLoading(false);
    };

    checkStoredAuth();
  }, []);

  const checkAccessCode = useCallback(async (code: string, _alreadyAuthenticated = false): Promise<boolean> => {
    // Vérifier si on doit attendre avant de réessayer
    if (lastAttempt) {
      const elapsed = Date.now() - lastAttempt;
      if (elapsed < 30000) {
        const remaining = Math.ceil((30000 - elapsed) / 1000);
        setError(i18n.t('auth.errors.rateLimited', { remaining }));
        return false;
      }
    }

    // Toujours définir lastAttempt au début pour imposer le cooldown de 30 secondes
    setLastAttempt(Date.now());

    try {
      setError(null);
      
      // Utiliser la nouvelle API MySQL au lieu de Firebase
      const response = await fetch(`${import.meta.env.VITE_MAIN_API}/api/verify-access-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Sauvegarder le code d'accès et l'expiration
        localStorage.setItem('access_code', code);
        const rawExpires = data.data.expiresAt;
        if (rawExpires) {
          const d = new Date(typeof rawExpires === 'number' ? rawExpires : rawExpires);
          localStorage.setItem('access_code_expires', isNaN(d.getTime()) ? 'never' : d.toISOString());
        } else {
          localStorage.setItem('access_code_expires', 'never');
        }

        // Définir flag VIP (sera vérifié côté serveur à chaque requête)
        localStorage.setItem('is_vip', 'true');

        // Forcer une vérification serveur immédiate pour synchroniser le cache
        checkVipStatus(true).catch(() => { /* ignore */ });

        // Générer un guest_uuid si il n'existe pas déjà
        if (!localStorage.getItem('guest_uuid')) {
          const tempUuid = 'vip_' + Math.random().toString(36).substring(2, 15);
          localStorage.setItem('guest_uuid', tempUuid);
        }

        // NE PAS connecter l'utilisateur - juste activer le statut VIP
        // setIsAuthenticated(true); // Cette ligne est commentée pour garder l'utilisateur déconnecté
        return true;
      } else {
        // Gérer les différents types d'erreurs
        if (response.status === 404) {
          setError(i18n.t('auth.errors.invalidCode'));
        } else if (response.status === 410) {
          setError(i18n.t('auth.errors.expiredKey'));
        } else if (response.status === 503) {
          setError(i18n.t('auth.errors.serviceUnavailable'));
        } else {
          setError(data.error || 'Erreur lors de la vérification du code d\'accès.');
        }
        return false;
      }
    } catch (error) {
      console.error('Erreur lors de la vérification du code:', error);
      setError(i18n.t('auth.errors.connectionError'));
      return false;
    }
  }, [lastAttempt]);

  const logout = useCallback(() => {
    // When logging out, we still preserve the 'auth' key in localStorage per user request.
    // Only update local state to unauthenticated.
    setIsAuthenticated(false);
  }, []);

  // Memoize the context value so the 4 consumers (incl. ProtectedRoute, which
  // wraps several routes) only re-render when the auth state actually changes,
  // not on every parent render. Previously the bare `{...}` literal was a fresh
  // object identity per render — particularly painful during the 1s cooldown
  // tick where the 1s interval re-set lastAttempt and forced a full subtree
  // re-render. — perf
  const value = useMemo<AuthContextType>(() => ({
    isAuthenticated,
    loading,
    error,
    checkAccessCode,
    logout,
    lastAttempt,
    remainingTime
  }), [isAuthenticated, loading, error, checkAccessCode, logout, lastAttempt, remainingTime]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
