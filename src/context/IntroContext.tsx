import React, { createContext, useState, useContext, useEffect, useCallback, useMemo } from 'react';
import { useLightMode } from '@/context/LightModeContext';
import { readLocalStorage } from '@/utils/browserStorage';

interface IntroContextProps {
  showIntro: boolean;
  setShowIntro: React.Dispatch<React.SetStateAction<boolean>>;
  introCompleted: boolean;
  completeIntro: () => void;
  skipIntro: () => void;
}

const IntroContext = createContext<IntroContextProps | undefined>(undefined);

export const IntroProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { effectivePrefs } = useLightMode();
  const [showIntro, setShowIntro] = useState(false);
  const [introCompleted, setIntroCompleted] = useState(true);

  useEffect(() => {
    const introEnabled = readLocalStorage('movix_intro_enabled') === 'true';
    const hasSeenIntro = readLocalStorage('movix_intro_seen') === 'true';

    if (introEnabled && !hasSeenIntro) {
      setShowIntro(true);
      setIntroCompleted(false);
    }
  }, []);

  useEffect(() => {
    if (!effectivePrefs.transitions) {
      setShowIntro(false);
      setIntroCompleted(true);
    }
  }, [effectivePrefs.transitions]);

  // Ecouter les changements de setting (toggle depuis SettingsPage)
  useEffect(() => {
    const handleIntroReset = () => {
      // Quand on active l'intro dans les settings, reset le "seen" pour la prochaine visite
      try { localStorage.removeItem('movix_intro_seen'); } catch { /* Préférence facultative. */ }
    };
    window.addEventListener('intro_settings_changed', handleIntroReset);
    return () => window.removeEventListener('intro_settings_changed', handleIntroReset);
  }, []);

  const completeIntro = useCallback(() => {
    setShowIntro(false);
    setIntroCompleted(true);
    try { localStorage.setItem('movix_intro_seen', 'true'); } catch { /* Préférence facultative. */ }
  }, []);

  const skipIntro = useCallback(() => {
    setShowIntro(false);
    setIntroCompleted(true);
    try { localStorage.setItem('movix_intro_seen', 'true'); } catch { /* Préférence facultative. */ }
  }, []);

  const value = useMemo(
    () => ({ showIntro: showIntro && effectivePrefs.transitions, setShowIntro, introCompleted: introCompleted || !effectivePrefs.transitions, completeIntro, skipIntro }),
    [showIntro, setShowIntro, introCompleted, completeIntro, skipIntro, effectivePrefs.transitions]
  );

  return (
    <IntroContext.Provider value={value}>
      {children}
    </IntroContext.Provider>
  );
};

export const useIntro = (): IntroContextProps => {
  const context = useContext(IntroContext);
  if (context === undefined) {
    throw new Error('useIntro must be used within an IntroProvider');
  }
  return context;
};
