import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { Crown, Gamepad2, Play, Puzzle, ShieldAlert, Smartphone, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLightMode } from '@/context/LightModeContext';
import { useAdFreePopup } from "../context/AdFreePopupContext";
import { getAdPopupMode, subscribeToAdPopupModeChanges, type AdPopupMode } from "../utils/adPopupMode";
import { getAdTargetUrls, isAdultAdsEnabled, subscribeToAdultAdsChanges } from "../utils/adAdultMode";
import {
  SCRIPT_AD_MODE_ENABLED,
  getAdScriptState,
  loadAdScript,
  subscribeToAdScriptState,
  type AdScriptState,
} from "../utils/adScriptMode";
import { getOverlayPortalRoot } from "@/utils/overlayPortal";
import AdPopupCinemaRain from "@/components/AdPopupCinemaRain";
import { isMobileOrTabletDevice } from "../utils/deviceDetection";
import { cn } from "@/lib/utils";

// Interrupteurs build-time des avertissements du popup de pub (constantes de
// code, pas des réglages utilisateur — même principe que SCRIPT_AD_MODE_ENABLED).
// SHOW_ADULT_AD_WARNING : encart rouge « contenu explicite +18 ».
// SHOW_AD_PAGE_WARNING : bandeau jaune « ne clique rien, ne scanne rien, ne télécharge rien ».
const SHOW_ADULT_AD_WARNING: boolean = false;
const SHOW_AD_PAGE_WARNING: boolean = false;

// Code Konami : ↑ ↑ ↓ ↓ ← → ← → B A.
const KONAMI_CODE = [
  'arrowup', 'arrowup', 'arrowdown', 'arrowdown',
  'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a',
];
const EASTER_EGG_TAP_COUNT = 5;
const EASTER_EGG_TAP_INTERVAL_MS = 700;

// Cibler l'animation explicitement pour garder l'ouverture et la fermeture
// à 150 ms, indépendamment des classes de durée des transitions CSS.
const POPUP_ANIMATION_CLASS = "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:[animation-duration:150ms] data-[state=closed]:[animation-duration:150ms] [animation-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none";

const PRIMARY_BUTTON_CLASS = "relative flex h-12 w-full max-w-xs cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap rounded-lg bg-blue-600 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent)] px-6 text-base font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_6px_16px_-8px_rgba(37,99,235,0.6)] transition-[background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#181f2e] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-blue-700 active:scale-[0.985] motion-reduce:transform-none";

interface AdFreePlayerAdsProps {
  onClose?: () => void;
  onAccept?: () => void;
  adType?: "ad1" | "ad2";
  onAdClick?: () => void;
  variant?: "player" | "download" | "livetv";
}

const AdFreePlayerAds: React.FC<AdFreePlayerAdsProps> = ({
  onClose,
  onAccept,
  onAdClick,
  variant = "player",
}) => {
  const { t } = useTranslation();
  const { effectivePrefs } = useLightMode();
  const {
    showAdFreePopup,
    isVoVostfrOnly,
    handlePopupAccept,
  } = useAdFreePopup();

  const finalOnAccept = onAccept || handlePopupAccept;
  const shouldShow = !!onClose || showAdFreePopup;

  const [hasClicked, setHasClicked] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [easterEggFound, setEasterEggFound] = useState(false);
  // Mobile/tablette → on pousse l'appli ; PC/Mac → l'extension navigateur.
  const isMobile = useMemo(() => isMobileOrTabletDevice(), []);
  const [popupMode, setPopupMode] = useState<AdPopupMode>(() => getAdPopupMode());
  const [adultAdsOn, setAdultAdsOn] = useState<boolean>(() => isAdultAdsEnabled());
  const [scriptState, setScriptState] = useState<AdScriptState>(() => getAdScriptState());
  const autoFiredRef = useRef(false);
  const scriptAdFiredRef = useRef(false);
  const scriptAcceptTimeoutRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const easterEggTapsRef = useRef({ count: 0, lastTapAt: 0 });
  const previousHeightRef = useRef<number | null>(null);
  const heightAnimationRef = useRef<Animation | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const revealUnlockedState = useCallback(() => {
    previousHeightRef.current = effectivePrefs.transitions && dialogRef.current
      ? parseFloat(getComputedStyle(dialogRef.current).height)
      : null;
    setHasClicked(true);
  }, [effectivePrefs.transitions]);

  const revealEasterEgg = useCallback(() => {
    if (closingRef.current) return;
    if (scriptAcceptTimeoutRef.current !== null) {
      window.clearTimeout(scriptAcceptTimeoutRef.current);
      scriptAcceptTimeoutRef.current = null;
    }
    easterEggTapsRef.current = { count: 0, lastTapAt: 0 };
    setEasterEggFound(true);
  }, []);

  const handleEasterEggTap = useCallback(() => {
    const now = performance.now();
    const taps = easterEggTapsRef.current;
    taps.count = now - taps.lastTapAt <= EASTER_EGG_TAP_INTERVAL_MS ? taps.count + 1 : 1;
    taps.lastTapAt = now;
    if (taps.count >= EASTER_EGG_TAP_COUNT) revealEasterEgg();
  }, [revealEasterEgg]);

  useLayoutEffect(() => {
    if (!easterEggFound) return;
    heightAnimationRef.current?.cancel();
    previousHeightRef.current = null;
    continueButtonRef.current?.focus({ preventScroll: true });
  }, [easterEggFound]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!effectivePrefs.transitions) {
      heightAnimationRef.current?.cancel();
      previousHeightRef.current = null;
      return;
    }
    const previousHeight = previousHeightRef.current;
    if (!hasClicked || !dialog || previousHeight === null) return;
    previousHeightRef.current = null;
    const nextHeight = parseFloat(getComputedStyle(dialog).height);
    heightAnimationRef.current?.cancel();
    heightAnimationRef.current = null;
    if (typeof dialog.animate !== 'function') return;
    heightAnimationRef.current = dialog.animate(
      [{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }],
      { duration: 250, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    );
  }, [hasClicked, effectivePrefs.transitions]);

  useEffect(() => () => {
    heightAnimationRef.current?.cancel();
    if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
    if (scriptAcceptTimeoutRef.current !== null) window.clearTimeout(scriptAcceptTimeoutRef.current);
  }, []);

  // Le mode script ne s'applique qu'au popup normal avec bouton. Les modes auto
  // et click-anywhere gardent le lien direct.
  const scriptAdMode = popupMode === 'normal' && SCRIPT_AD_MODE_ENABLED;
  // Script réellement utilisable : un bloqueur qui annule son chargement passe
  // l'état à 'failed' → le clic valide alors directement, sans ouvrir de pub
  // (ni script ni lien direct) et sans attendre le timer du geste script.
  const scriptAdActive = scriptAdMode && scriptState !== 'failed';

  useEffect(() => subscribeToAdPopupModeChanges(setPopupMode), []);
  useEffect(() => subscribeToAdultAdsChanges(setAdultAdsOn), []);
  useEffect(() => subscribeToAdScriptState(setScriptState), []);

  useEffect(() => {
    // Reset des gardes quand le popup disparaît, pour laisser le suivant se déclencher.
    if (!shouldShow) {
      autoFiredRef.current = false;
      scriptAdFiredRef.current = false;
      closingRef.current = false;
      setHasClicked(false);
      setIsClosing(false);
      setEasterEggFound(false);
      easterEggTapsRef.current = { count: 0, lastTapAt: 0 };
      heightAnimationRef.current?.cancel();
      previousHeightRef.current = null;
      if (closeTimeoutRef.current !== null) clearTimeout(closeTimeoutRef.current);
      if (scriptAcceptTimeoutRef.current !== null) {
        window.clearTimeout(scriptAcceptTimeoutRef.current);
        scriptAcceptTimeoutRef.current = null;
      }
    }
  }, [shouldShow]);

  useEffect(() => {
    if (shouldShow && scriptAdMode) loadAdScript();
  }, [shouldShow, scriptAdMode]);

  useEffect(() => {
    if (!shouldShow || popupMode !== 'normal') return;

    const lenis = (
      window as unknown as { lenis?: { stop: () => void; start: () => void } }
    ).lenis;
    if (lenis) lenis.stop();

    return () => {
      if (lenis) lenis.start();
    };
  }, [shouldShow, popupMode]);

  // Ouvre toutes les cibles pub (1 fenêtre par URL) dans le même geste user.
  // Anchor créé à l'exécution pour éviter le filtrage réseau (Brave Shields /
  // EasyList). Cibles déterminées par le toggle "Publicités +18" : en +18 = les
  // 3 directlinks, sinon le lien SFW unique (utils/adAdultMode). Lu frais au clic.
  // NB: le navigateur n'autorise qu'1 popup non sollicité par geste -> les autres
  // sont souvent bloqués sauf si l'utilisateur autorise les popups pour le site.
  const openAdLinks = useCallback(() => {
    getAdTargetUrls().forEach((url) => {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }, []);

  const handleLinkClick = useCallback(() => {
    openAdLinks();
    revealUnlockedState();
    if (onAdClick) onAdClick();
  }, [openAdLinks, onAdClick, revealUnlockedState]);

  const completeScriptAdGesture = useCallback(() => {
    if (scriptAcceptTimeoutRef.current !== null) {
      window.clearTimeout(scriptAcceptTimeoutRef.current);
      scriptAcceptTimeoutRef.current = null;
    }
    if (onAdClick) onAdClick();
    revealUnlockedState();
  }, [onAdClick, revealUnlockedState]);

  const beginScriptAdGesture = useCallback(() => {
    if (scriptAdFiredRef.current) return;
    scriptAdFiredRef.current = true;
    loadAdScript();
    scriptAcceptTimeoutRef.current = window.setTimeout(completeScriptAdGesture, 700);
  }, [completeScriptAdGesture]);

  // Le popunder peut consommer le onClick React. La capture pointerdown prépare
  // la détection avant les listeners document du script.
  useEffect(() => {
    if (!shouldShow || !scriptAdActive || hasClicked || easterEggFound) return;
    const onCapturePointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest('[data-ad-view-button]')) beginScriptAdGesture();
    };
    window.addEventListener('pointerdown', onCapturePointer, true);
    return () => window.removeEventListener('pointerdown', onCapturePointer, true);
  }, [shouldShow, scriptAdActive, hasClicked, easterEggFound, beginScriptAdGesture]);

  useEffect(() => {
    if (!shouldShow || isClosing || easterEggFound || popupMode === 'auto') return;

    const pressedKeys: string[] = [];
    const resetSequence = () => { pressedKeys.length = 0; };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing
        || (target instanceof HTMLElement
          && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]')))) {
        resetSequence();
        return;
      }
      if (event.repeat || event.key === 'Shift') return;

      pressedKeys.push(event.key.toLowerCase());
      if (pressedKeys.length > KONAMI_CODE.length) pressedKeys.shift();

      if (KONAMI_CODE.every((key, index) => pressedKeys[index] === key)) {
        resetSequence();
        revealEasterEgg();
      }
    };

    // Fonctionne même lorsque le bouton de la popup a le focus.
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', resetSequence);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', resetSequence);
    };
  }, [shouldShow, isClosing, easterEggFound, popupMode, revealEasterEgg]);

  // Fermeture avec animation de sortie avant de notifier le parent
  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    if (!effectivePrefs.transitions) {
      finalOnAccept();
      return;
    }
    closeTimeoutRef.current = setTimeout(() => {
      finalOnAccept();
    }, 150);
  }, [finalOnAccept, effectivePrefs.transitions]);

  // Auto mode: fire the ad + accept as soon as the popup is requested. The
  // guard ref ensures a single trigger per popup lifecycle (re-renders won't
  // re-fire it). The reset effect above clears the guard when shouldShow flips
  // back to false, so the next popup can trigger again.
  useEffect(() => {
    if (!shouldShow || popupMode !== 'auto' || autoFiredRef.current) return;
    autoFiredRef.current = true;
    handleLinkClick();
    finalOnAccept();
  }, [shouldShow, popupMode, handleLinkClick, finalOnAccept]);

  // Texte contextualisé
  const headerText = hasClicked
    ? variant === "download"
      ? t("adBlocker.thanksUnlockedDownload")
      : variant === "livetv"
        ? t("adBlocker.thanksUnlockedAccess")
        : t("adBlocker.thanksForHelp")
    : variant === "download"
      ? t("adBlocker.stepBeforeDownload")
      : variant === "livetv"
        ? t("adBlocker.accessLiveTV")
        : t("adBlocker.stepBeforeVideo");

  const descriptionText = hasClicked
    ? variant === "download"
      ? t("adBlocker.thanksDownloadDesc")
      : variant === "livetv"
        ? t("adBlocker.thanksLiveTVDesc")
        : t("adBlocker.thanksPlayerDesc")
    : variant === "download"
      ? t("adBlocker.stepDownloadDesc")
      : variant === "livetv"
        ? t("adBlocker.stepLiveTVDesc")
        : isVoVostfrOnly
          ? t("adBlocker.stepVoVostfrDesc")
          : t("adBlocker.stepPlayerDesc");

  const primaryButtonLabel = hasClicked
    ? variant === "download"
      ? t("adBlocker.decodeLink")
      : variant === "livetv"
        ? t("adBlocker.accessChannel")
        : t("adBlocker.playback")
    : variant === "download"
      ? t("adBlocker.viewAdSpace")
      : t("adBlocker.viewAd");

  if (!shouldShow) return null;

  // Auto mode: useEffect above fires the ad + accept; render nothing.
  if (popupMode === 'auto') return null;

  // Click-anywhere mode: invisible full-screen catcher, first click opens ad + accepts.
  if (popupMode === 'click-anywhere' && !hasClicked && !easterEggFound) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={t('adBlocker.clickAnywhereLabel')}
        className="fixed inset-0 z-[100000] cursor-pointer bg-transparent"
        onClick={() => {
          handleLinkClick();
          finalOnAccept();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleLinkClick();
            finalOnAccept();
          }
        }}
      />
    );
  }

  return (
    <DialogPrimitive.Root
      open={!isClosing}
      onOpenChange={(open) => {
        if (!open && hasClicked) {
          handleClose();
        }
      }}
    >
      <DialogPrimitive.Portal container={getOverlayPortalRoot()}>
        {/* Overlay avec fond bleu */}
        <DialogPrimitive.Overlay
          className={cn("fixed inset-0 z-50", effectivePrefs.transitions && POPUP_ANIMATION_CLASS)}
          style={{ background: easterEggFound ? "#000" : "rgba(59,130,246,0.22)" }}
          // Repère pour l'habillage Halloween (halloween-ui.css) ; l'écran
          // noir de l'easter egg reste tel quel.
          data-ad-overlay={easterEggFound ? undefined : ''}
          onClick={(e) => {
            if (e.target === e.currentTarget && hasClicked) {
              handleClose();
            }
          }}
        />

        {/* Contenu du dialog */}
        <DialogPrimitive.Content
          ref={dialogRef}
          onPointerDownOutside={(e) => {
            if (!hasClicked) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!hasClicked) e.preventDefault();
          }}
          data-lenis-prevent
          data-ad-dialog={easterEggFound ? undefined : ''}
          className={cn(
            easterEggFound
              ? "fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-black px-6 py-8 transition-none"
              : "fixed left-[50%] top-[50%] z-50 w-full max-w-[480px] translate-x-[-50%] translate-y-[-50%] rounded-2xl p-4 sm:p-6 max-h-[90vh] overflow-y-auto",
            effectivePrefs.transitions && POPUP_ANIMATION_CLASS,
            effectivePrefs.transitions && !easterEggFound && "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-1/2 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2"
          )}
          style={easterEggFound ? { pointerEvents: "auto", overscrollBehavior: "contain" } : {
            background: "#181f2e",
            border: "1px solid rgba(255,255,255,0.08)",
            pointerEvents: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {easterEggFound ? (
            <div className="my-auto w-full max-w-lg origin-center py-8 text-center motion-safe:animate-ad-easter-egg-enter">
              <Gamepad2 className="mx-auto mb-6 h-14 w-14 text-blue-400" aria-hidden="true" />
              <DialogPrimitive.Title className="text-balance text-2xl font-bold leading-tight text-white sm:text-3xl">
                {t('adBlocker.easterEggTitle')}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mx-auto mt-4 max-w-sm text-pretty text-base leading-relaxed text-blue-100/80">
                <span className="block">{t('adBlocker.easterEggDescription')}</span>
                <span className="mt-3 block text-sm leading-relaxed text-blue-200/80">
                  {t('adBlocker.easterEggReminder')}
                </span>
              </DialogPrimitive.Description>
              <button
                ref={continueButtonRef}
                onClick={handleClose}
                disabled={isClosing}
                className={`${PRIMARY_BUTTON_CLASS} mx-auto mt-8 gap-2 disabled:cursor-default`}
              >
                <Play className="h-5 w-5" aria-hidden="true" />
                {t('adBlocker.easterEggContinue')}
              </button>
            </div>
          ) : (
          <>
          <AdPopupCinemaRain unlocked={hasClicked} />

          {/* Bouton fermer (visible uniquement après le clic) */}
          {hasClicked && (
            <DialogPrimitive.Close
              onClick={handleClose}
              className="absolute right-4 top-4 rounded-full p-1.5 text-white/50 transition-all duration-200 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 group/icon"
            >
              <X className="h-4 w-4 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity]" />
              <span className="sr-only">{t("common.close")}</span>
            </DialogPrimitive.Close>
          )}

          {/* Header avec icône */}
          <div className="flex flex-col items-center justify-center pt-4 sm:pt-8 pb-2 px-4 sm:px-8">
            {isMobile ? (
              <button
                type="button"
                aria-label={t('adBlocker.shieldLabel')}
                onClick={handleEasterEggTap}
                disabled={isClosing}
                className="mb-2 inline-flex h-12 w-12 shrink-0 touch-manipulation select-none items-center justify-center rounded-lg text-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                <ShieldAlert className="h-10 w-10" aria-hidden="true" />
              </button>
            ) : (
              <ShieldAlert className="w-10 h-10 text-blue-400 mb-2" aria-hidden="true" />
            )}
            <DialogPrimitive.Title data-ad-copy className="text-lg sm:text-xl font-bold leading-tight tracking-tight flex items-center gap-2 text-center mb-1 text-white">
              <span key={String(hasClicked)} className={hasClicked ? "inline-block motion-safe:animate-ad-content-enter" : undefined}>{headerText}</span>
            </DialogPrimitive.Title>
            <DialogPrimitive.Description data-ad-copy aria-live="polite" aria-atomic="true" className="text-xs sm:text-sm text-blue-100/80 font-medium text-center leading-relaxed">
              <span key={String(hasClicked)} className={hasClicked ? "inline-block motion-safe:animate-ad-content-enter" : undefined}>{descriptionText}</span>
            </DialogPrimitive.Description>
          </div>

          {/* Avertissement contenu adulte (visible seulement si pubs +18 actives) */}
          {SHOW_ADULT_AD_WARNING && !hasClicked && adultAdsOn && (
            <div className="mx-4 sm:mx-6 mb-2">
              <div className="text-left bg-red-950/70 border-2 border-red-500 p-3 sm:p-4 rounded-lg shadow-lg">
                <p className="text-red-300 font-bold text-sm sm:text-base leading-snug">
                  {t("adBlocker.adultAdsWarning")}
                </p>
                <p className="text-red-200/90 text-xs sm:text-sm mt-1.5">
                  {t("adBlocker.adultAdsDisablePrefix")}
                  <Link
                    to="/settings#intermission"
                    className="text-red-300 hover:text-red-100 underline font-semibold"
                  >
                    {t("adBlocker.adultAdsSettingsLink")}
                  </Link>
                  {t("adBlocker.adultAdsDisableSuffix")}
                </p>
              </div>
            </div>
          )}

          {/* Avertissement compact : ne rien faire sur la page de pub */}
          {SHOW_AD_PAGE_WARNING && !hasClicked && (
            <div className="mx-4 sm:mx-6 mb-2">
              <p className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-yellow-200 text-xs sm:text-sm font-semibold text-center">
                ⚠️ {t("adBlocker.adPageWarning")}
              </p>
            </div>
          )}

          {/* Boutons */}
          <div className="flex flex-col items-center gap-2 px-4 sm:px-8 pb-4 sm:pb-8 pt-2">
            <button
              data-ad-view-button={hasClicked ? undefined : ''}
              onClick={hasClicked ? handleClose : scriptAdMode
                ? scriptAdActive ? beginScriptAdGesture : completeScriptAdGesture
                : handleLinkClick}
              className={`${PRIMARY_BUTTON_CLASS} ${hasClicked ? '' : 'mb-1'}`}
              autoFocus
            >
              <span key={String(hasClicked)} className={`inline-flex items-center justify-center ${hasClicked ? 'motion-safe:animate-ad-content-enter' : ''}`}>
                {hasClicked && <Play className="w-5 h-5 mr-2" aria-hidden="true" />}{primaryButtonLabel}
              </span>
            </button>
            {!hasClicked && (
              <span data-ad-copy className="text-xs text-blue-200 text-center mt-1">
                {t("adBlocker.closeAdTip")}
              </span>
            )}

            {/* Alternatives sans pub : VIP, et extension (PC/Mac) ou appli (mobile) */}
            {!hasClicked && (
              <div className="w-full max-w-xs mt-2 pt-3 border-t border-white/10">
                <p data-ad-copy className="text-[11px] text-blue-200/70 text-center mb-2">
                  {t("adBlocker.noAdsQuestion")}
                </p>
                <div className={`grid gap-2 ${variant === "player" ? "grid-cols-2" : "grid-cols-1"}`}>
                  <Link
                    to="/vip"
                    className="flex flex-col items-center justify-center gap-0.5 rounded-lg py-2 px-2 bg-amber-500/15 border border-amber-400/40 text-amber-300 hover:bg-amber-500/25 hover:text-amber-200 transition-colors"
                  >
                    <span data-ad-copy className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold">
                      <Crown className="w-4 h-4 flex-shrink-0" />
                      {t("adBlocker.vipButton")}
                    </span>
                    <span data-ad-copy className="text-[10px] text-amber-200/70 leading-tight text-center">
                      {t("adBlocker.vipButtonHint")}
                    </span>
                  </Link>
                  {variant === "player" && (
                    <Link
                      to={isMobile ? "/app" : "/extension"}
                      className="flex flex-col items-center justify-center gap-0.5 rounded-lg py-2 px-2 bg-indigo-500/15 border border-indigo-400/40 text-indigo-300 hover:bg-indigo-500/25 hover:text-indigo-200 transition-colors"
                    >
                      <span data-ad-copy className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold">
                        {isMobile ? (
                          <Smartphone className="w-4 h-4 flex-shrink-0" />
                        ) : (
                          <Puzzle className="w-4 h-4 flex-shrink-0" />
                        )}
                        {isMobile ? t("adBlocker.appButton") : t("adBlocker.extensionButton")}
                      </span>
                      <span data-ad-copy className="text-[10px] text-indigo-200/70 leading-tight text-center">
                        {t("adBlocker.sourcesButtonHint")}
                      </span>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
          </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default AdFreePlayerAds;
