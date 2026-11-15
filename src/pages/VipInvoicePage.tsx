import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useParams, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  ExternalLink,
  Gift,
  HandHeart,
  Hourglass,
  Info,
  KeyRound,
  Loader2,
  MessageCircle,
  RefreshCcw,
  ShieldCheck,
  Timer,
  TimerOff,
  XCircle,
  type LucideIcon
} from 'lucide-react';

import { IX_MATRIX_URL } from '@/config/community';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import AnimatedBorderCard from '../components/ui/animated-border-card';
import BlurText from '../components/ui/blur-text';
import { Button } from '../components/ui/button';
import ShinyText from '../components/ui/shiny-text';
import { SquareBackground } from '../components/ui/square-background';
import { useVipModal } from '../context/VipModalContext';
import {
  checkVipInvoice,
  getVipInvoice,
  type VipInvoice,
  type VipInvoiceStatus
} from '../services/vipDonationsService';
import {
  formatVipCrypto,
  formatVipFiat,
  getVipDurationLabel,
  getVipPaymentLabel,
  getVipPaymentShortLabel,
  getVipStatusMeta
} from '../utils/vipDonationsUi';
import { rememberVipInvoice } from '../utils/vipInvoiceHistory';
import { copyText } from '../utils/clipboard';

type QrCodeModule = {
  default: {
    toDataURL: (
      text: string,
      options: { width: number; margin: number; color: { dark: string; light: string } }
    ) => Promise<string>;
  };
};

// iconTone : quand le texte du badge est translucide, l'icône prend la couleur
// pleine et l'opacité à part, sinon ses tracés se superposent en plus clair.
const STATUS_STYLE: Record<VipInvoiceStatus, { tone: string; icon: LucideIcon; iconTone?: string }> = {
  awaiting_payment: { tone: 'border-yellow-400/35 bg-yellow-500/15 text-yellow-100', icon: Hourglass },
  partial_payment: { tone: 'border-orange-400/35 bg-orange-500/15 text-orange-100', icon: AlertTriangle },
  confirming: { tone: 'border-cyan-300/35 bg-cyan-500/15 text-cyan-100', icon: Clock3 },
  paid: { tone: 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100', icon: CheckCircle2 },
  delivered: { tone: 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100', icon: CheckCircle2 },
  expired: { tone: 'border-white/20 bg-white/10 text-white/80', icon: TimerOff, iconTone: 'text-white opacity-80' },
  cancelled: { tone: 'border-red-400/35 bg-red-500/15 text-red-100', icon: XCircle }
};

// Statuts où le don peut encore avancer : la page se revérifie toute seule.
const LIVE_STATUSES = new Set<VipInvoiceStatus>(['awaiting_payment', 'partial_payment', 'confirming', 'paid']);
const FINAL_STATUSES = new Set<VipInvoiceStatus>(['delivered', 'expired', 'cancelled']);

// Montants crypto comparés en plus petite unité (satoshi, litoshi) : pas
// d'erreur d'arrondi quand on calcule le reste à envoyer.
const CRYPTO_UNITS = 1e8;
const COUNTDOWN_TICK_MS = 15000;
const POLL_INTERVAL_MS = 30000;

const PANEL_CLASS = 'rounded-2xl border border-white/10 bg-[#0a0a0a]/90';
const GOLD_BUTTON_CLASS = 'bg-yellow-500 text-black shadow-yellow-500/20 hover:bg-yellow-400 focus-visible:ring-yellow-400/50';
const GOLD_LINK_CLASS = 'inline-flex items-center justify-center gap-2 rounded-lg bg-yellow-500 px-5 text-sm font-semibold text-black shadow-lg shadow-yellow-500/20 transition-colors hover:bg-yellow-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/50';
const OUTLINE_LINK_CLASS = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30';

const toCryptoUnits = (value: number | null | undefined) => (
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * CRYPTO_UNITS) : 0
);

const isHttpUrl = (value: string | null | undefined): value is string => (
  typeof value === 'string' && /^https?:\/\//i.test(value)
);

// Sans FRONTEND_BASE_URL, le serveur renvoie un chemin relatif : un lien à
// garder ou à partager doit toujours être complet.
const toAbsoluteUrl = (value: string) => {
  if (isHttpUrl(value)) {
    return value;
  }

  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return value;
  }
};

const formatTimeLeft = (ms: number, t: TFunction) => {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) {
    return t('vipDonations.track.time.lessThanMinute');
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return t('vipDonations.track.time.minutes', { minutes });
  }
  if (minutes === 0) {
    return t('vipDonations.track.time.hours', { hours });
  }
  return t('vipDonations.track.time.hoursMinutes', { hours, minutes });
};

const isInvoiceNotFoundError = (error: unknown) => (
  error instanceof Error
  && (
    (typeof (error as { statusCode?: number }).statusCode === 'number' && (error as { statusCode?: number }).statusCode === 404)
    || /invoice introuvable/i.test(error.message)
  )
);

const CopyIconButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="group/icon shrink-0 rounded-lg border border-white/10 p-2 transition-colors hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/50"
  >
    <Copy className="h-4 w-4 text-white opacity-60 transition-[color,opacity] group-hover/icon:opacity-100" />
  </button>
);

const LiveDot: React.FC = () => (
  <span className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
);

const NoteRow: React.FC<{
  icon: LucideIcon;
  title?: string;
  warning?: boolean;
  children: React.ReactNode;
}> = ({ icon: Icon, title, warning = false, children }) => (
  <div
    className={`flex items-start gap-3 rounded-xl border p-3.5 text-sm leading-6 ${
      warning
        ? 'border-orange-400/25 bg-orange-400/[0.07] text-orange-50/85'
        : 'border-white/10 bg-white/[0.03] text-white/65'
    }`}
  >
    <Icon className={`mt-1 h-4 w-4 shrink-0 ${warning ? 'text-orange-300' : 'text-yellow-300'}`} />
    <div className="min-w-0">
      {title && <p className="font-semibold text-white">{title}</p>}
      <p>{children}</p>
    </div>
  </div>
);

const SummaryRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-4 py-3">
    <dt className="text-white/50">{label}</dt>
    <dd className="min-w-0 text-right font-semibold text-white">{children}</dd>
  </div>
);

const VipInvoicePage: React.FC = () => {
  const { publicId } = useParams<{ publicId: string }>();
  const { t, i18n } = useTranslation();
  const { openVipModal } = useVipModal();
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoice, setInvoice] = useState<VipInvoice | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [isMissingInvoice, setIsMissingInvoice] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const invoiceStatus = invoice?.status;
  const isCryptoGateInvoice = invoice?.paymentMethod === 'cryptogate';
  const isPaygateInvoice = invoice?.paymentMethod === 'paygate_hosted';
  const isPayblisInvoice = invoice?.paymentMethod === 'payblis';
  const isHostedCheckoutInvoice = isCryptoGateInvoice || isPaygateInvoice || isPayblisInvoice;
  const isCryptoInvoice = !isHostedCheckoutInvoice && Boolean(invoice?.paymentAddress);
  const isAwaitingDonation = invoiceStatus === 'awaiting_payment' || invoiceStatus === 'partial_payment';
  const expiresAtMs = invoice?.expiresAt ? Date.parse(invoice.expiresAt) : Number.NaN;
  const showCountdown = isAwaitingDonation && Number.isFinite(expiresAtMs);

  // Après un don crypto incomplet, le serveur additionne tout ce qui arrive
  // sur l'adresse : on ne demande plus que le reste.
  const expectedUnits = toCryptoUnits(invoice?.amountCryptoExpected);
  const receivedUnits = toCryptoUnits(invoice?.amountCryptoReceived);
  const isPartialCrypto = isCryptoInvoice
    && invoiceStatus === 'partial_payment'
    && receivedUnits > 0
    && expectedUnits > receivedUnits;
  const amountToSend = (isPartialCrypto ? expectedUnits - receivedUnits : expectedUnits) / CRYPTO_UNITS;

  const qrPayload = useMemo(() => {
    const payload = invoice?.qrPayload;
    if (!payload) {
      return '';
    }

    // Le QR du serveur demande le montant complet : après un don incomplet,
    // il ne doit demander que le reste.
    return isPartialCrypto
      ? payload.replace(/([?&]amount=)[^&]*/i, (_match, prefix: string) => `${prefix}${amountToSend.toFixed(8)}`)
      : payload;
  }, [invoice?.qrPayload, isPartialCrypto, amountToSend]);

  useEffect(() => {
    if (!showCountdown) {
      return undefined;
    }

    setNow(Date.now());
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, COUNTDOWN_TICK_MS);

    return () => window.clearInterval(interval);
  }, [showCountdown]);

  useEffect(() => {
    setQrFailed(false);
    if (!qrPayload) {
      setQrCodeUrl('');
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        // @ts-expect-error -- qrcode est publié sans types et @types/qrcode n'est pas installé.
        const { default: QRCode } = (await import('qrcode')) as QrCodeModule;
        const url = await QRCode.toDataURL(qrPayload, {
          width: 320,
          margin: 1,
          color: {
            dark: '#0a0a0a',
            light: '#ffffff'
          }
        });
        if (!cancelled) setQrCodeUrl(url);
      } catch {
        if (!cancelled) {
          setQrCodeUrl('');
          setQrFailed(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [qrPayload]);

  useEffect(() => {
    if (invoice?.publicId) {
      rememberVipInvoice(invoice.publicId);
    }
  }, [invoice?.publicId]);

  const payblisReturn = searchParams.get('payblis');

  useEffect(() => {
    if (!payblisReturn || !invoice?.publicId) return;

    if (payblisReturn === 'ok') {
      toast.success(t('vipDonations.track.returnOk'));
      checkVipInvoice(invoice.publicId).then(setInvoice).catch(() => {});
    } else if (payblisReturn === 'ko') {
      const retryUrl = invoice.checkoutUrl;
      toast.error(t('vipDonations.track.returnKo'), {
        action: retryUrl
          ? {
              label: t('vipDonations.track.retryPayment'),
              onClick: () => window.open(retryUrl, '_blank', 'noopener,noreferrer')
            }
          : undefined
      });
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('payblis');
    setSearchParams(nextParams, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payblisReturn, invoice?.publicId, invoice?.checkoutUrl]);

  useEffect(() => {
    if (!publicId) {
      setInvoice(null);
      setHasLoadError(false);
      setIsMissingInvoice(true);
      setIsLoading(false);
      return undefined;
    }

    let isMounted = true;

    const load = async () => {
      try {
        if (isMounted) {
          setIsLoading(true);
          setHasLoadError(false);
          setIsMissingInvoice(false);
        }

        const fetchedInvoice = await checkVipInvoice(publicId).catch(() => getVipInvoice(publicId));
        if (isMounted) {
          setInvoice(fetchedInvoice);
          setHasLoadError(false);
          setIsMissingInvoice(false);
        }
      } catch (error) {
        if (isMounted) {
          // Le message du serveur reste dans la console : il parle d'« invoice »,
          // le donateur voit un texte simple à la place.
          const notFound = isInvoiceNotFoundError(error);
          if (!notFound) {
            console.warn('VIP donation load failed:', error);
          }
          setInvoice(null);
          setHasLoadError(!notFound);
          setIsMissingInvoice(notFound);
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
  }, [publicId, reloadNonce]);

  useEffect(() => {
    if (!publicId) {
      return undefined;
    }

    if (!invoice || hasLoadError || isMissingInvoice) {
      return undefined;
    }

    if (invoiceStatus && FINAL_STATUSES.has(invoiceStatus)) {
      return undefined;
    }

    const interval = window.setInterval(async () => {
      try {
        const refreshedInvoice = await checkVipInvoice(publicId);
        setInvoice(refreshedInvoice);
      } catch (error) {
        console.warn('VIP invoice polling failed:', error);
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [invoice, invoiceStatus, isMissingInvoice, hasLoadError, publicId]);

  const handleCheckNow = async () => {
    if (!publicId) {
      return;
    }

    const loadingToastId = toast.loading(t('vipDonations.track.checkInProgress'));

    try {
      setIsChecking(true);
      const refreshedInvoice = await checkVipInvoice(publicId);
      setInvoice(refreshedInvoice);
      const refreshedStatusMeta = getVipStatusMeta(t, refreshedInvoice.status);
      toast.success(
        t('vipDonations.track.checkResult', { status: refreshedStatusMeta.label }),
        {
          id: loadingToastId,
          description: refreshedStatusMeta.hint
        }
      );
    } catch (error) {
      console.warn('VIP invoice manual check failed:', error);
      toast.error(t('vipDonations.track.checkError'), {
        id: loadingToastId
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleCopy = async (value: string, successMessage: string) => {
    if (await copyText(value)) {
      toast.success(successMessage);
    } else {
      toast.error(t('vipDonations.common.copyFailed'));
    }
  };

  // La fenêtre VIP n'accepte pas de clé préremplie : on copie la clé avant de
  // l'ouvrir, il ne reste qu'à la coller.
  const handleActivateKey = (vipKey: string) => {
    void copyText(vipKey).then((copied) => {
      if (copied) {
        toast.success(t('vipDonations.common.copyVipKeySuccess'));
      }
    });
    openVipModal();
  };

  const renderShell = (content: React.ReactNode) => (
    <SquareBackground squareSize={48} borderColor="rgba(234, 179, 8, 0.12)" className="min-h-screen bg-black text-white">
      {content}
    </SquareBackground>
  );

  if (isLoading) {
    return renderShell(
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center" role="status">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-yellow-400" />
          <p className="mt-4 text-sm text-white/60">{t('vipDonations.track.loading')}</p>
        </div>
      </div>
    );
  }

  if (!invoice && hasLoadError) {
    return renderShell(
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <AnimatedBorderCard highlightColor="239 68 68" backgroundColor="10 10 10" className="w-full max-w-md p-6 text-center sm:p-8">
          <h1 className="text-2xl font-bold text-white">{t('vipDonations.track.loadErrorTitle')}</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">{t('vipDonations.track.loadErrorText')}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
              className={`h-11 px-5 ${GOLD_BUTTON_CLASS}`}
              onClick={() => setReloadNonce((value) => value + 1)}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              {t('vipDonations.track.retry')}
            </Button>
            <a href={IX_MATRIX_URL} target="_blank" rel="noopener noreferrer" className={`h-11 ${OUTLINE_LINK_CLASS}`}>
              <MessageCircle className="h-4 w-4" />
              {t('vipDonations.track.help.buttonMatrix')}
            </a>
          </div>
          <Link to="/vip" className="group/icon mt-5 inline-flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-white">
            <ArrowLeft className="h-4 w-4 text-white opacity-50 transition-[color,opacity] group-hover/icon:opacity-100" />
            {t('vipDonations.track.back')}
          </Link>
        </AnimatedBorderCard>
      </div>
    );
  }

  if (!invoice && isMissingInvoice) {
    return renderShell(
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <AnimatedBorderCard highlightColor="234 179 8" backgroundColor="10 10 10" className="w-full max-w-md p-6 text-center sm:p-8">
          <h1 className="text-2xl font-bold text-white">{t('vipDonations.track.notFoundTitle')}</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">{t('vipDonations.track.notFoundText')}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link to="/vip/invoices" className={`h-11 ${GOLD_LINK_CLASS}`}>
              {t('vipDonations.track.myDonationsButton')}
            </Link>
            <Link to="/vip" className={`h-11 ${OUTLINE_LINK_CLASS}`}>
              {t('vipDonations.track.back')}
            </Link>
          </div>
        </AnimatedBorderCard>
      </div>
    );
  }

  if (!invoice) {
    return null;
  }

  const lang = i18n.language;
  const statusMeta = getVipStatusMeta(t, invoice.status);
  const { tone: statusTone, icon: StatusIcon, iconTone: statusIconTone } = STATUS_STYLE[invoice.status] ?? STATUS_STYLE.awaiting_payment;
  const isGift = invoice.recipientMode === 'gift';
  const providerName = getVipPaymentShortLabel(t, invoice.paymentMethod, invoice.coin);
  const networkName = getVipPaymentLabel(t, invoice.paymentMethod, invoice.coin);
  const coinTicker = (invoice.coin || '').toUpperCase();
  const methodLabel = isCryptoGateInvoice
    ? t('vipDonations.track.summary.methodCryptoGate')
    : getVipPaymentLabel(t, invoice.paymentMethod, invoice.coin);
  const durationLabel = getVipDurationLabel(t, invoice.vipYears, 'plain');
  const supportUrl = isHttpUrl(invoice.supportTelegramUrl) ? invoice.supportTelegramUrl : IX_MATRIX_URL;
  const supportButtonLabel = /matrix/i.test(supportUrl)
    ? t('vipDonations.track.help.buttonMatrix')
    : t('vipDonations.track.help.button');
  const checkoutUrl = isHttpUrl(invoice.checkoutUrl) ? invoice.checkoutUrl : null;
  const pageUrl = toAbsoluteUrl(invoice.invoicePath || window.location.pathname);
  const vipKey = invoice.vipKey;
  const giftLink = invoice.giftUrl ? toAbsoluteUrl(invoice.giftUrl) : null;
  const showThanks = invoice.status === 'delivered' || Boolean(vipKey || giftLink);
  const isLive = LIVE_STATUSES.has(invoice.status);
  const isWaitingConfirmation = invoice.status === 'confirming' || invoice.status === 'paid';
  const isEnded = invoice.status === 'expired' || invoice.status === 'cancelled';
  const isPaygateMinimumApplied = isPaygateInvoice && invoice.amountEur > invoice.packEur;
  const requiredConfirmations = invoice.requiredConfirmations ?? 0;
  const showConfirmations = isCryptoInvoice && isWaitingConfirmation && requiredConfirmations > 0;
  const showKeepLinkNote = isLive && !showThanks;
  const remainingMs = showCountdown ? expiresAtMs - now : 0;

  const renderValidity = (validForKey: 'vipDonations.track.crypto.validFor' | 'vipDonations.track.hosted.validFor') => (
    showCountdown ? (
      <p className="flex items-center gap-2 text-sm text-white/70">
        <Timer className="h-4 w-4 shrink-0 text-yellow-400" />
        {remainingMs > 0
          ? t(validForKey, { time: formatTimeLeft(remainingMs, t) })
          : t('vipDonations.track.validityOver')}
      </p>
    ) : null
  );

  const renderLiveCheck = (withDivider = true) => (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
        withDivider ? 'mt-6 border-t border-white/10 pt-5' : ''
      }`}
    >
      <p className="flex items-center gap-2.5 text-xs leading-5 text-white/50">
        <LiveDot />
        {t('vipDonations.track.autoCheck')}
      </p>
      <Button
        variant="outline"
        className="h-10 w-full shrink-0 border-white/15 focus-visible:ring-white/30 sm:w-auto"
        onClick={handleCheckNow}
        disabled={isChecking}
      >
        {isChecking ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('vipDonations.track.checking')}
          </>
        ) : (
          <>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {t('vipDonations.track.checkNow')}
          </>
        )}
      </Button>
    </div>
  );

  const renderThanksBlock = () => (
    <AnimatedBorderCard highlightColor="234 179 8" backgroundColor="10 10 10" animationSpeed={0.6} className="p-5 sm:p-8">
      <div className="text-center">
        <div className="inline-flex items-center justify-center rounded-full bg-yellow-500/10 p-3 ring-1 ring-yellow-500/40">
          {giftLink && !vipKey
            ? <Gift className="h-6 w-6 text-yellow-300" />
            : <KeyRound className="h-6 w-6 text-yellow-300" />}
        </div>
        <h2 className="mt-4 text-2xl font-bold text-white sm:text-3xl">{t('vipDonations.track.thanks.title')}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/65 sm:text-base">
          {!vipKey && !giftLink
            ? t('vipDonations.track.thanks.missing')
            : giftLink && !vipKey
              ? t('vipDonations.track.thanks.giftText', { duration: durationLabel })
              : t('vipDonations.track.thanks.selfText', { duration: durationLabel })}
        </p>
      </div>

      {vipKey && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
            {t('vipDonations.track.thanks.keyLabel')}
          </p>
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-white/[0.05] py-2.5 pl-4 pr-2 ring-1 ring-inset ring-yellow-500/25">
            <code className="min-w-0 flex-1 break-all font-mono text-base font-semibold text-white sm:text-lg">{vipKey}</code>
            <CopyIconButton
              label={t('vipDonations.track.thanks.copyKey')}
              onClick={() => handleCopy(vipKey, t('vipDonations.common.copyVipKeySuccess'))}
            />
          </div>
          <Button
            className={`mt-5 h-12 w-full text-base font-semibold ${GOLD_BUTTON_CLASS}`}
            onClick={() => handleActivateKey(vipKey)}
          >
            <KeyRound className="mr-2 h-4 w-4" />
            {t('vipDonations.track.thanks.activateButton')}
          </Button>
          <p className="mt-2 text-center text-xs leading-5 text-white/45">{t('vipDonations.track.thanks.activateHint')}</p>
        </div>
      )}

      {giftLink && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
            {t('vipDonations.track.thanks.giftLinkLabel')}
          </p>
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-white/[0.05] py-2.5 pl-4 pr-2 ring-1 ring-inset ring-yellow-500/25">
            <code className="min-w-0 flex-1 break-all font-mono text-sm text-white">{giftLink}</code>
            <CopyIconButton
              label={t('vipDonations.track.thanks.copyGiftLink')}
              onClick={() => handleCopy(giftLink, t('vipDonations.track.thanks.giftLinkCopied'))}
            />
          </div>
          {!vipKey && (
            <>
              <Button
                className={`mt-5 h-12 w-full text-base font-semibold ${GOLD_BUTTON_CLASS}`}
                onClick={() => handleCopy(giftLink, t('vipDonations.track.thanks.giftLinkCopied'))}
              >
                <Copy className="mr-2 h-4 w-4" />
                {t('vipDonations.track.thanks.copyGiftLink')}
              </Button>
              <p className="mt-2 text-center text-xs leading-5 text-white/45">{t('vipDonations.track.thanks.giftHint')}</p>
            </>
          )}
        </div>
      )}
    </AnimatedBorderCard>
  );

  const renderCryptoBlock = () => (
    <AnimatedBorderCard highlightColor="234 179 8" backgroundColor="10 10 10" animationSpeed={0.6} className="p-5 sm:p-7">
      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-sm font-medium text-white/60">
              {isPartialCrypto
                ? t('vipDonations.track.crypto.sendRemaining')
                : t('vipDonations.track.crypto.sendExactly')}
            </p>
            <div className="mt-1.5 flex items-center gap-3">
              <ShinyText
                text={`${formatVipCrypto(lang, amountToSend)} ${coinTicker}`}
                speed={2.5}
                color="#fbbf24"
                shineColor="#ffffff"
                className="min-w-0 break-all text-2xl font-black sm:text-3xl"
              />
              <CopyIconButton
                label={t('vipDonations.track.crypto.copyAmount')}
                onClick={() => handleCopy(amountToSend.toFixed(8), t('vipDonations.common.copyAmountSuccess'))}
              />
            </div>
            <p className="mt-1 text-sm text-white/45">
              {isPartialCrypto
                ? t('vipDonations.track.crypto.alreadyReceived', {
                    received: formatVipCrypto(lang, receivedUnits / CRYPTO_UNITS),
                    expected: formatVipCrypto(lang, expectedUnits / CRYPTO_UNITS),
                    coin: coinTicker
                  })
                : t('vipDonations.track.crypto.fiatEquivalent', {
                    amount: formatVipFiat(lang, invoice.amountEur, 'EUR')
                  })}
            </p>
          </div>

          <div>
            <p className="text-sm font-medium text-white/60">
              {t('vipDonations.track.crypto.toAddress', { network: networkName })}
            </p>
            <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-white/[0.04] py-2 pl-3 pr-2 ring-1 ring-inset ring-white/10">
              <code className="min-w-0 flex-1 break-all font-mono text-[13px] leading-5 text-white/85">{invoice.paymentAddress}</code>
              <CopyIconButton
                label={t('vipDonations.track.crypto.copyAddress')}
                onClick={() => handleCopy(invoice.paymentAddress || '', t('vipDonations.common.copyAddressSuccess'))}
              />
            </div>
          </div>
        </div>

        <figure className="flex flex-col items-center gap-2 text-center sm:w-44">
          {qrCodeUrl ? (
            <img
              src={qrCodeUrl}
              alt={t('vipDonations.track.crypto.qrAlt', { coin: coinTicker })}
              className="w-40 rounded-xl bg-white p-2 sm:w-44"
            />
          ) : qrPayload && !qrFailed ? (
            <div className="h-40 w-40 animate-pulse rounded-xl bg-white/[0.06] sm:h-44 sm:w-44" aria-hidden="true" />
          ) : (
            <div className="grid h-40 w-40 place-items-center rounded-xl border border-dashed border-white/15 px-3 text-xs text-white/40 sm:h-44 sm:w-44">
              {t('vipDonations.track.crypto.qrUnavailable')}
            </div>
          )}
          <figcaption className="text-xs leading-5 text-white/45">
            {t('vipDonations.track.crypto.qrHint', { coin: coinTicker })}
          </figcaption>
        </figure>
      </div>

      <div className="mt-6 space-y-2.5">
        {renderValidity('vipDonations.track.crypto.validFor')}
        <p className="flex items-start gap-2 text-xs leading-5 text-white/45">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white opacity-45" />
          {t('vipDonations.track.crypto.feesHint')}
        </p>
      </div>

      {renderLiveCheck()}
    </AnimatedBorderCard>
  );

  const renderHostedBlock = () => (
    <AnimatedBorderCard highlightColor="234 179 8" backgroundColor="10 10 10" animationSpeed={0.6} className="p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-xl bg-yellow-500/10 p-2.5 ring-1 ring-yellow-500/25">
          <CreditCard className="h-5 w-5 text-yellow-300" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white sm:text-xl">
            {t('vipDonations.track.hosted.title', { provider: providerName })}
          </h2>
          <p className="mt-1 text-sm leading-6 text-white/55">
            {t('vipDonations.track.hosted.text', { provider: providerName })}
          </p>
        </div>
      </div>

      {(invoice.status === 'partial_payment' || isPaygateInvoice) && (
        <div className="mt-5 space-y-3">
          {invoice.status === 'partial_payment' && (
            <NoteRow icon={AlertTriangle} warning>
              {t('vipDonations.track.hosted.partialText', { provider: providerName })}
            </NoteRow>
          )}
          {isPaygateInvoice && (
            <NoteRow icon={ShieldCheck} title={t('vipDonations.track.hosted.identityTitle')}>
              {t('vipDonations.track.hosted.identityText', { provider: providerName })}
            </NoteRow>
          )}
          {isPaygateMinimumApplied && (
            <NoteRow icon={Info}>
              {t('vipDonations.track.hosted.minimumText', {
                provider: providerName,
                originalAmount: formatVipFiat(lang, invoice.packEur, 'EUR'),
                minimumAmount: formatVipFiat(lang, invoice.amountEur, 'EUR')
              })}
            </NoteRow>
          )}
        </div>
      )}

      {checkoutUrl ? (
        <div className="mt-6 flex flex-col items-center gap-2">
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`h-12 w-full text-base ${GOLD_LINK_CLASS}`}
          >
            <ExternalLink className="h-4 w-4" />
            {t('vipDonations.track.hosted.openButton', { provider: providerName })}
          </a>
          <button
            type="button"
            onClick={() => handleCopy(checkoutUrl, t('vipDonations.track.linkCopied'))}
            className="group/icon inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-white/55 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <Copy className="h-3.5 w-3.5 text-white opacity-55 transition-[color,opacity] group-hover/icon:opacity-100" />
            {t('vipDonations.track.hosted.copyLink')}
          </button>
        </div>
      ) : (
        <p className="mt-5 text-sm leading-6 text-white/55">{t('vipDonations.track.hosted.missingLink')}</p>
      )}

      {showCountdown && (
        <div className="mt-4 flex justify-center">
          {renderValidity('vipDonations.track.hosted.validFor')}
        </div>
      )}

      {renderLiveCheck()}
    </AnimatedBorderCard>
  );

  const renderWaitingBlock = () => (
    <AnimatedBorderCard highlightColor="52 211 153" backgroundColor="10 10 10" animationSpeed={0.6} className="p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-xl bg-emerald-400/10 p-2.5 ring-1 ring-emerald-400/25">
          <Hourglass className="h-5 w-5 text-emerald-200" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white sm:text-xl">{t('vipDonations.track.waiting.title')}</h2>
          {showConfirmations && (
            <p className="mt-1 text-sm text-white/55">
              {t('vipDonations.track.crypto.confirmations', {
                current: Math.min(invoice.confirmations ?? 0, requiredConfirmations),
                required: requiredConfirmations
              })}
            </p>
          )}
        </div>
      </div>
      {renderLiveCheck()}
    </AnimatedBorderCard>
  );

  const renderEndedBlock = () => (
    <div className={`${PANEL_CLASS} p-5 text-center sm:p-6`}>
      <p className="text-sm leading-6 text-white/60">{t('vipDonations.track.ended.text')}</p>
      <Link to="/vip" className={`mt-4 h-11 ${GOLD_LINK_CLASS}`}>
        <HandHeart className="h-4 w-4" />
        {t('vipDonations.track.ended.button')}
      </Link>
    </div>
  );

  let mainBlockKey = 'none';
  let mainBlock: React.ReactNode = null;
  if (showThanks) {
    mainBlockKey = 'thanks';
    mainBlock = renderThanksBlock();
  } else if (isAwaitingDonation && isHostedCheckoutInvoice) {
    mainBlockKey = 'hosted';
    mainBlock = renderHostedBlock();
  } else if (isAwaitingDonation && isCryptoInvoice) {
    mainBlockKey = 'crypto';
    mainBlock = renderCryptoBlock();
  } else if (isWaitingConfirmation) {
    mainBlockKey = 'waiting';
    mainBlock = renderWaitingBlock();
  } else if (isEnded) {
    mainBlockKey = 'ended';
    mainBlock = renderEndedBlock();
  } else if (isLive) {
    // Ancien moyen sans adresse ni lien de paiement : seulement le suivi.
    mainBlockKey = 'live';
    mainBlock = <div className={`${PANEL_CLASS} p-5`}>{renderLiveCheck(false)}</div>;
  }

  return renderShell(
    <div className="container relative z-10 mx-auto px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          to="/vip"
          className="group/icon mb-8 inline-flex items-center text-sm text-white/50 transition-colors hover:text-white"
        >
          <ArrowLeft className="mr-2 h-4 w-4 text-white opacity-50 transition-[color,opacity] group-hover/icon:opacity-100" />
          {t('vipDonations.track.back')}
        </Link>

        <motion.header
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4 text-center"
        >
          <div className="inline-flex items-center justify-center rounded-full bg-yellow-500/10 p-3 ring-1 ring-yellow-500/40">
            <HandHeart className="h-7 w-7 text-yellow-400" />
          </div>
          <div role="heading" aria-level={1}>
            <BlurText
              text={t('vipDonations.track.title')}
              delay={120}
              animateBy="words"
              direction="top"
              className="justify-center text-3xl font-bold text-white sm:text-5xl"
            />
          </div>
          <div aria-live="polite" className="space-y-4">
            {!showThanks && (
              <p className="mx-auto max-w-xl text-base leading-relaxed text-white/60">{statusMeta.hint}</p>
            )}
            <span className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${statusTone}`}>
              <StatusIcon className={statusIconTone ? `h-4 w-4 ${statusIconTone}` : 'h-4 w-4'} />
              {statusMeta.label}
            </span>
          </div>
        </motion.header>

        <div className="mt-8 space-y-4 sm:mt-10">
          {mainBlock && (
            <motion.div
              key={mainBlockKey}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            >
              {mainBlock}
            </motion.div>
          )}

          {showKeepLinkNote && (
            <div className="flex items-start gap-3 rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.06] px-4 py-3.5">
              <Bookmark className="mt-1 h-4 w-4 shrink-0 text-yellow-400" />
              <div className="min-w-0 text-sm leading-6 text-yellow-50/80">
                <p>
                  <Trans
                    t={t}
                    i18nKey={isGift ? 'vipDonations.track.keepLink.gift' : 'vipDonations.track.keepLink.self'}
                    components={{
                      link: (
                        <Link
                          to="/vip/invoices"
                          className="font-semibold text-yellow-300 underline decoration-yellow-300/40 underline-offset-2 transition-colors hover:text-yellow-200"
                        />
                      )
                    }}
                  />
                </p>
                <button
                  type="button"
                  onClick={() => handleCopy(pageUrl, t('vipDonations.track.linkCopied'))}
                  className="group/icon mt-1 inline-flex items-center gap-1.5 rounded text-xs font-semibold text-yellow-300/90 transition-colors hover:text-yellow-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/50"
                >
                  <Copy className="h-3.5 w-3.5 text-yellow-300 opacity-90 transition-[color,opacity] group-hover/icon:text-yellow-200 group-hover/icon:opacity-100" />
                  {t('vipDonations.track.keepLink.copy')}
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <dl aria-label={t('vipDonations.track.summary.label')} className={`${PANEL_CLASS} divide-y divide-white/10 px-5 py-1 text-sm`}>
              <SummaryRow label={t('vipDonations.track.summary.amount')}>
                {formatVipFiat(lang, invoice.amountEur, 'EUR')}
              </SummaryRow>
              <SummaryRow label={t('vipDonations.track.summary.reward')}>
                <ShinyText
                  text={t('vipDonations.track.summary.rewardValue', { duration: durationLabel })}
                  speed={3}
                  color="#fbbf24"
                  shineColor="#ffffff"
                  className="font-semibold"
                />
              </SummaryRow>
              <SummaryRow label={t('vipDonations.track.summary.for')}>
                {isGift ? t('vipDonations.track.summary.forGift') : t('vipDonations.track.summary.forSelf')}
              </SummaryRow>
              <SummaryRow label={t('vipDonations.track.summary.method')}>
                {methodLabel}
              </SummaryRow>
            </dl>

            <div className={`${PANEL_CLASS} flex flex-col p-5`}>
              <p className="flex items-center gap-2 font-semibold text-white">
                <MessageCircle className="h-4 w-4 shrink-0 text-yellow-400" />
                {t('vipDonations.track.help.title')}
              </p>
              <p className="mt-1.5 flex-1 text-sm leading-6 text-white/55">{t('vipDonations.track.help.text')}</p>
              <a
                href={supportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-4 h-10 w-full ${OUTLINE_LINK_CLASS}`}
              >
                <ExternalLink className="h-4 w-4" />
                {supportButtonLabel}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VipInvoicePage;
