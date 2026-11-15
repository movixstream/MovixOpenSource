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

// L'intro repose sur les unités de conteneur (cq*) et les propriétés translate/scale.
// Sans elles (Safari 15, Chrome < 105), le logo ferait 0 × 0 sur un écran noir : on la saute.
const introSupported = (): boolean =>
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' &&
  CSS.supports('width', '1cqmin') && CSS.supports('translate', '1px') && CSS.supports('scale', '1');

// L'intro se joue à chaque chargement complet du site quand le réglage est actif.
// Elle n'est montée qu'au démarrage : la navigation interne ne la rejoue pas.
const shouldShowIntro = (): boolean =>
  readLocalStorage('movix_intro_enabled') === 'true' && introSupported();

export const IntroProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { effectivePrefs } = useLightMode();
  // Décidé dès le premier rendu, pas dans un effet : sinon la page s'affiche
  // une image avant que l'intro ne la recouvre.
  const [showIntro, setShowIntro] = useState(shouldShowIntro);
  const [introCompleted, setIntroCompleted] = useState(() => !showIntro);

  useEffect(() => {
    if (!effectivePrefs.transitions) {
      setShowIntro(false);
      setIntroCompleted(true);
    }
  }, [effectivePrefs.transitions]);

  const completeIntro = useCallback(() => {
    setShowIntro(false);
    setIntroCompleted(true);
  }, []);

  const skipIntro = completeIntro;

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
