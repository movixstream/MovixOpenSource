import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowLeft, Crown, Heart } from 'lucide-react';

import AnimatedBorderCard from '@/components/ui/animated-border-card';
import { SquareBackground } from '@/components/ui/square-background';
import DonationForm from '@/components/vipDonation/DonationForm';
import DonationLinks from '@/components/vipDonation/DonationLinks';
import DonationPerks from '@/components/vipDonation/DonationPerks';
import { DonationPausedCard, DonationSkeleton } from '@/components/vipDonation/DonationCardStates';
import {
  ALL_DONATION_METHODS_AVAILABLE,
  getDonationRule,
  isSafeExternalUrl,
  scrollToDonationCard
} from '@/components/vipDonation/donationUtils';
import { IX_MATRIX_URL } from '@/config/community';
import { useLightMode } from '@/context/LightModeContext';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import {
  DEFAULT_VIP_DONATION_SETTINGS,
  getVipDonationSettings,
  type VipDonationAvailability,
  type VipDonationSettings
} from '@/services/vipDonationsService';
import { readLocalStorage } from '@/utils/browserStorage';

type DonationSettingsState =
  | { status: 'loading' }
  | { status: 'ready'; settings: VipDonationSettings; availability: VipDonationAvailability };

const DONATION_CARD_STYLE = { '--_card-radius': '1.25rem' } as React.CSSProperties;
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const SCROLL_CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

// Page de don unique, servie sur /vip et /vip/don : pourquoi donner, le
// montant, le moyen, puis le don. Le VIP est le merci.
const VipPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'fr';
  const location = useLocation();
  const { effectivePrefs } = useLightMode();
  const donationCardRef = useRef<HTMLDivElement>(null);
  const transitionsRef = useRef(effectivePrefs.transitions);
  const [state, setState] = useState<DonationSettingsState>({ status: 'loading' });

  useEffect(() => {
    transitionsRef.current = effectivePrefs.transitions;
  }, [effectivePrefs.transitions]);

  useEffect(() => {
    let cancelled = false;
    getVipDonationSettings()
      .then(({ settings, availability }) => {
        if (!cancelled) {
          setState({ status: 'ready', settings, availability });
        }
      })
      .catch(() => {
        // API muette : réglages par défaut, pour que le don reste possible.
        if (!cancelled) {
          setState({
            status: 'ready',
            settings: DEFAULT_VIP_DONATION_SETTINGS,
            availability: ALL_DONATION_METHODS_AVAILABLE
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const wantsDonationCard = /^\/vip\/don\/?$/.test(location.pathname) || location.hash === '#don';

  useEffect(() => {
    if (!wantsDonationCard) {
      return undefined;
    }

    // Le moindre geste de l'utilisateur annule le défilement automatique.
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    SCROLL_CANCEL_EVENTS.forEach((type) => window.addEventListener(type, cancel, { passive: true }));

    // Laisse d'abord passer le retour en haut de page fait à chaque
    // changement de route (ScrollToTop dans App.tsx).
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        const smooth = transitionsRef.current && readLocalStorage('settings_smooth_scroll') !== 'false';
        scrollToDonationCard(donationCardRef.current, smooth);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      SCROLL_CANCEL_EVENTS.forEach((type) => window.removeEventListener(type, cancel));
    };
  }, [wantsDonationCard, location.key]);

  const ready = state.status === 'ready' ? state : null;
  // Pas de règle affichée pendant une pause : rien ne peut être donné.
  const rule = ready?.settings.donationsEnabled ? getDonationRule(t, locale, ready.settings) : null;
  const contacts = (ready?.settings ?? DEFAULT_VIP_DONATION_SETTINGS).contacts;
  const matrixUrl = isSafeExternalUrl(contacts.matrixRoomUrl) ? contacts.matrixRoomUrl.trim() : IX_MATRIX_URL;
  const discordUrl = isSafeExternalUrl(contacts.discordUrl) ? contacts.discordUrl.trim() : null;

  return (
    <SquareBackground
      squareSize={48}
      borderColor="rgba(234, 179, 8, 0.12)"
      // overflow-clip au lieu de overflow-hidden : même découpe du fond, mais
      // sans créer de conteneur de défilement, sinon la carte de don ne peut
      // pas rester collée (sticky) sur ordinateur.
      className="min-h-screen overflow-clip bg-black text-white"
    >
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-4 sm:px-6 sm:pt-8 lg:px-8">
        <Link
          to="/"
          className="group inline-flex items-center gap-2 rounded text-sm text-white/55 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60"
        >
          {/* Couleur pleine + opacité sur l'icône : avec une couleur
              translucide, ses deux traits se superposent à la pointe. */}
          <ArrowLeft className="h-4 w-4 text-white opacity-55 transition-opacity group-hover:opacity-100" aria-hidden="true" />
          {t('common.backToHome')}
        </Link>

        {/* Lignes « auto 1fr » : la carte de don, à cheval sur les deux lignes,
            ne grandit que la seconde. Changer de moyen (champ email de la carte
            bancaire) ne fait donc plus bouger la colonne de gauche. */}
        <div className="mt-8 grid items-start gap-10 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-14">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE_OUT }}
            className="lg:col-start-1 lg:row-start-1 lg:pt-2"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-400/10 ring-1 ring-inset ring-yellow-400/25">
              <Heart className="h-6 w-6 fill-yellow-400/20 text-yellow-400" aria-hidden="true" />
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-5xl">
              {t('vipDonations.donate.heroTitle')}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-white/70 sm:text-lg">
              {t('vipDonations.donate.heroText')}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              {ready === null ? (
                <span aria-hidden="true" className="h-[34px] w-44 animate-pulse rounded-full bg-white/[0.06]" />
              ) : rule && (
                <span className="inline-flex items-center gap-2 rounded-full border border-yellow-400/25 bg-yellow-400/10 px-3.5 py-1.5 text-sm font-medium text-yellow-100">
                  <Crown className="h-4 w-4 shrink-0 text-yellow-400" aria-hidden="true" />
                  {rule}
                </span>
              )}
              <Link
                to="/frais"
                className="rounded text-sm text-white/55 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60"
              >
                {t('vipDonations.donate.costsLink')}
              </Link>
            </div>
          </motion.div>

          {/* Sur téléphone, la carte vient juste après l'accroche ; sur
              ordinateur, elle occupe la colonne de droite et reste en vue. */}
          <div className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <motion.div
              id="don"
              ref={donationCardRef}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.06, ease: EASE_OUT }}
              className="scroll-mt-24"
            >
              {ready && !ready.settings.donationsEnabled ? (
                <DonationPausedCard message={ready.settings.pausedMessage} />
              ) : (
                <AnimatedBorderCard
                  highlightColor="234 179 8"
                  backgroundColor="12 12 12"
                  animationSpeed={0.5}
                  style={DONATION_CARD_STYLE}
                  className="p-5 sm:p-7"
                >
                  {ready
                    ? <DonationForm settings={ready.settings} availability={ready.availability} />
                    : <DonationSkeleton />}
                </AnimatedBorderCard>
              )}
            </motion.div>
            <DonationLinks matrixUrl={matrixUrl} discordUrl={discordUrl} />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.12, ease: EASE_OUT }}
            className="lg:col-start-1 lg:row-start-2"
          >
            <DonationPerks />
          </motion.div>
        </div>
      </div>
    </SquareBackground>
  );
};

export default VipPage;
