import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Gift, KeyRound, Loader2, LockKeyhole, ShieldCheck, Sparkles, Unlock } from 'lucide-react';

import TurnstileWidget from '../components/TurnstileWidget';
import AnimatedBorderCard from '../components/ui/animated-border-card';
import BlurText from '../components/ui/blur-text';
import { Button } from '../components/ui/button';
import ShinyText from '../components/ui/shiny-text';
import { SquareBackground } from '../components/ui/square-background';
import { useVipModal } from '../context/VipModalContext';
import { getVipGift, unsealVipGift, VipGift } from '../services/vipDonationsService';
import { TURNSTILE_SITE_KEY, getVipDurationLabel } from '../utils/vipDonationsUi';
import { copyText } from '../utils/clipboard';

const VipGiftPage: React.FC = () => {
  const { giftToken } = useParams<{ giftToken: string }>();
  const { t } = useTranslation();
  const { openVipModal } = useVipModal();
  const [gift, setGift] = useState<VipGift | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnsealing, setIsUnsealing] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);

  useEffect(() => {
    if (!giftToken) {
      return;
    }

    let isMounted = true;

    const load = async () => {
      try {
        const fetchedGift = await getVipGift(giftToken);
        if (isMounted) {
          setGift(fetchedGift);
        }
      } catch (error) {
        if (isMounted) {
          toast.error(error instanceof Error ? error.message : t('vipDonations.gift.loadError'));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [giftToken, t]);

  const handleCopyKey = async () => {
    if (!gift?.vipKey) {
      return;
    }

    if (await copyText(gift.vipKey)) {
      toast.success(t('vipDonations.common.copyVipKeySuccess'));
    } else {
      toast.error(t('vipDonations.common.copyFailed'));
    }
  };

  // La fenêtre VIP n'accepte pas de clé préremplie : on copie la clé avant de
  // l'ouvrir, il ne reste qu'à la coller.
  const handleActivateKey = () => {
    if (!gift?.vipKey) {
      return;
    }

    void copyText(gift.vipKey).then((copied) => {
      if (copied) {
        toast.success(t('vipDonations.common.copyVipKeySuccess'));
      }
    });
    openVipModal();
  };

  const handleUnseal = async () => {
    if (!giftToken) {
      return;
    }

    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      toast.error(t('vipDonations.common.turnstileRequired'));
      return;
    }

    try {
      setIsUnsealing(true);
      const unsealedGift = await unsealVipGift(giftToken, TURNSTILE_SITE_KEY ? turnstileToken : undefined);
      setGift(unsealedGift);
      toast.success(t('vipDonations.gift.unsealSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('vipDonations.gift.unsealError'));
      setTurnstileResetSignal((value) => value + 1);
    } finally {
      setIsUnsealing(false);
    }
  };

  if (isLoading) {
    return (
      <SquareBackground squareSize={48} borderColor="rgba(56, 189, 248, 0.14)" className="min-h-screen bg-black text-white">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="text-center">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-cyan-300" />
            <p className="mt-4 text-sm text-white/60">{t('vipDonations.common.loadingGift')}</p>
          </div>
        </div>
      </SquareBackground>
    );
  }

  if (!gift) {
    return (
      <SquareBackground squareSize={48} borderColor="rgba(56, 189, 248, 0.14)" className="min-h-screen bg-black text-white">
        <div className="flex min-h-screen items-center justify-center px-4">
          <AnimatedBorderCard highlightColor="56 189 248" backgroundColor="10 10 10" className="max-w-lg p-8 text-center">
            <h1 className="text-2xl font-bold text-white">{t('vipDonations.common.giftNotFound')}</h1>
            <p className="mt-3 text-sm leading-6 text-white/60">{t('vipDonations.gift.notFoundDescription')}</p>
            <Link to="/vip" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-cyan-100">
              <ArrowLeft className="h-4 w-4" />
              {t('vipDonations.gift.backVip')}
            </Link>
          </AnimatedBorderCard>
        </div>
      </SquareBackground>
    );
  }

  const isSealed = gift.status === 'sealed';

  return (
    <SquareBackground
      squareSize={48}
      borderColor="rgba(56, 189, 248, 0.14)"
      className="min-h-screen bg-black text-white"
    >
      <div className="container mx-auto px-4 py-8 sm:px-6 sm:py-12 relative z-10">
        <Link to="/vip" className="inline-flex items-center text-white/50 hover:text-white transition-colors mb-8 group/icon">
          <ArrowLeft className="w-5 h-5 mr-2 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity]" />
          {t('vipDonations.gift.backVip')}
        </Link>

        <div className="max-w-5xl mx-auto space-y-10">
          <div className="text-center space-y-6">
            <div className="inline-flex items-center justify-center p-3 bg-cyan-400/10 rounded-full ring-1 ring-cyan-400/40">
              {isSealed ? <LockKeyhole className="w-8 h-8 text-cyan-300" /> : <Gift className="w-8 h-8 text-cyan-300" />}
            </div>

            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-200/70">
                {t('vipDonations.gift.heroEyebrow')}
              </p>
              <BlurText
                text={isSealed ? t('vipDonations.gift.sealedTitle') : t('vipDonations.gift.unsealedTitle')}
                delay={220}
                animateBy="words"
                direction="top"
                className="text-4xl md:text-6xl font-bold text-white justify-center"
              />
              <p className="text-base md:text-lg text-white/60 max-w-3xl mx-auto leading-relaxed">
                {isSealed
                  ? t('vipDonations.gift.sealedDescription')
                  : t('vipDonations.gift.unsealedDescription')}
              </p>
              <div className="inline-flex items-center gap-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-4 py-2">
                <Sparkles className="h-4 w-4 text-yellow-400" />
                <ShinyText
                  text={getVipDurationLabel(t, gift.vipYears, 'vip')}
                  speed={2}
                  color="#fbbf24"
                  shineColor="#ffffff"
                  className="text-sm font-semibold"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr]">
            <AnimatedBorderCard
              highlightColor="56 189 248"
              backgroundColor="10 10 10"
              className="p-6 sm:p-8 backdrop-blur-sm"
            >
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-cyan-400/10 ring-1 ring-cyan-400/20">
                    <Gift className="h-6 w-6 text-cyan-300" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">
                      {t('vipDonations.gift.cardLabel')}
                    </p>
                    <ShinyText
                      text={getVipDurationLabel(t, gift.vipYears, 'vip')}
                      speed={2}
                      color="#fbbf24"
                      shineColor="#ffffff"
                      className="text-2xl font-bold"
                    />
                  </div>
                </div>

                <div className="text-sm text-white/60">
                  <div className="flex items-center justify-between">
                    <span>{t('vipDonations.gift.statusLabel')}</span>
                    <span className={`font-semibold ${isSealed ? 'text-cyan-100' : 'text-emerald-200'}`}>
                      {isSealed ? t('vipDonations.gift.sealedStatus') : t('vipDonations.gift.unsealedStatus')}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span>{t('vipDonations.gift.durationLabel')}</span>
                    <span className="font-semibold text-yellow-300">{getVipDurationLabel(t, gift.vipYears, 'vip')}</span>
                  </div>
                </div>

                {isSealed && TURNSTILE_SITE_KEY && (
                  <div className="border-t border-white/10 pt-5">
                    <p className="text-sm font-semibold text-white">{t('vipDonations.gift.turnstileTitle')}</p>
                    <p className="mt-1 text-xs leading-5 text-white/45">{t('vipDonations.gift.turnstileDescription')}</p>
                    <div className="mt-4 flex overflow-x-auto">
                      <TurnstileWidget
                        action="vip_gift_unseal"
                        resetSignal={turnstileResetSignal}
                        onTokenChange={setTurnstileToken}
                        className="origin-left scale-[0.9] sm:scale-100"
                      />
                    </div>
                  </div>
                )}

                {isSealed ? (
                  <Button
                    className="h-12 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300"
                    onClick={handleUnseal}
                    disabled={isUnsealing || Boolean(TURNSTILE_SITE_KEY && !turnstileToken)}
                  >
                    {isUnsealing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('vipDonations.gift.unsealingButton')}
                      </>
                    ) : (
                      <>
                        <Unlock className="mr-2 h-4 w-4" />
                        {t('vipDonations.gift.unsealButton')}
                      </>
                    )}
                  </Button>
                ) : (
                  <div className="border-t border-white/10 pt-5">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-400/15">
                        <ShieldCheck className="h-5 w-5 text-emerald-200" />
                      </div>
                      <p className="text-sm font-semibold text-emerald-100">{t('vipDonations.gift.revealedKeyTitle')}</p>
                    </div>

                    <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white/[0.04] px-4 py-3 ring-1 ring-inset ring-white/10">
                      <code className="min-w-0 flex-1 break-all text-sm font-semibold text-white">{gift.vipKey}</code>
                      <button
                        type="button"
                        onClick={handleCopyKey}
                        aria-label={t('vipDonations.track.thanks.copyKey')}
                        title={t('vipDonations.track.thanks.copyKey')}
                        className="rounded-2xl border border-white/10 p-3 text-white/60 transition-colors hover:border-white/20 hover:text-white group/icon"
                      >
                        <Copy className="h-4 w-4 text-white opacity-60 group-hover/icon:opacity-100 transition-[color,opacity]" />
                      </button>
                    </div>

                    {gift.vipKey && (
                      <>
                        <Button
                          className="mt-4 h-12 w-full bg-cyan-400 text-slate-950 shadow-cyan-500/20 hover:bg-cyan-300 focus-visible:ring-cyan-300/50"
                          onClick={handleActivateKey}
                        >
                          <KeyRound className="mr-2 h-4 w-4" />
                          {t('vipDonations.track.thanks.activateButton')}
                        </Button>
                        <p className="mt-2 text-center text-xs leading-5 text-white/45">
                          {t('vipDonations.track.thanks.activateHint')}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </AnimatedBorderCard>

            <div className="space-y-6">
              <AnimatedBorderCard
                highlightColor="234 179 8"
                backgroundColor="10 10 10"
                className="p-6 backdrop-blur-sm"
              >
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-yellow-500/10 ring-1 ring-yellow-500/20">
                      <Sparkles className="h-5 w-5 text-yellow-400" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">
                        {t('vipDonations.gift.supportEyebrow')}
                      </p>
                      <BlurText
                        text={t('vipDonations.gift.supportTitle')}
                        delay={80}
                        className="text-2xl font-bold text-white"
                      />
                    </div>
                  </div>

                  <p className="text-sm leading-6 text-white/58">{t('vipDonations.gift.supportText1')}</p>
                </div>
              </AnimatedBorderCard>

              <AnimatedBorderCard
                highlightColor="56 189 248"
                backgroundColor="10 10 10"
                className="p-6 backdrop-blur-sm"
              >
                <div className="space-y-4 text-center">
                  <div className="inline-flex items-center justify-center p-3 bg-cyan-400/10 rounded-full ring-1 ring-cyan-400/30">
                    <Gift className="w-6 h-6 text-cyan-300" />
                  </div>
                  <p className="text-sm text-white/55">
                    {t('vipDonations.gift.supportText2')}
                  </p>
                  <a
                    href={gift.supportTelegramUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#229ED9] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#229ED9]/80"
                  >
                    <Gift className="h-4 w-4" />
                    {t('vipDonations.gift.supportButton')}
                  </a>
                </div>
              </AnimatedBorderCard>
            </div>
          </div>
        </div>
      </div>
    </SquareBackground>
  );
};

export default VipGiftPage;
