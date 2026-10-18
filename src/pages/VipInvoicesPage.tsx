import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  HandHeart,
  Heart,
  Loader2,
  RefreshCcw
} from 'lucide-react';

import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import AnimatedBorderCard from '../components/ui/animated-border-card';
import BlurText from '../components/ui/blur-text';
import { Button } from '../components/ui/button';
import ShinyText from '../components/ui/shiny-text';
import { SquareBackground } from '../components/ui/square-background';
import {
  getVipInvoice,
  listMyVipInvoices,
  type VipInvoice,
  type VipInvoiceStatus
} from '../services/vipDonationsService';
import {
  formatVipDateTime,
  formatVipFiat,
  getVipDurationLabel,
  getVipPaymentLabel,
  getVipStatusMeta
} from '../utils/vipDonationsUi';
import { getStoredVipInvoiceHistory } from '../utils/vipInvoiceHistory';

const OPEN_STATUSES = new Set<VipInvoiceStatus>(['awaiting_payment', 'partial_payment', 'confirming', 'paid']);

const STATUS_TONE: Record<VipInvoiceStatus, string> = {
  awaiting_payment: 'border-yellow-400/35 bg-yellow-500/15 text-yellow-100',
  partial_payment: 'border-orange-400/35 bg-orange-500/15 text-orange-100',
  confirming: 'border-cyan-300/35 bg-cyan-500/15 text-cyan-100',
  paid: 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100',
  delivered: 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100',
  expired: 'border-white/20 bg-white/10 text-white/75',
  cancelled: 'border-red-400/35 bg-red-500/15 text-red-100'
};

const PANEL_CLASS = 'rounded-2xl border border-white/10 bg-[#0a0a0a]/90';
const GOLD_LINK_CLASS = 'inline-flex items-center justify-center gap-2 rounded-lg bg-yellow-500 px-4 text-sm font-semibold text-black shadow-lg shadow-yellow-500/20 transition-colors hover:bg-yellow-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/50';
const OUTLINE_LINK_CLASS = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30';

const sortByCreatedAtDesc = (items: VipInvoice[]) => [...items].sort((left, right) => {
  const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
  const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
  return rightTime - leftTime;
});

const VipInvoicesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [invoices, setInvoices] = useState<VipInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const hasAccountToken = useMemo(() => Boolean(localStorage.getItem('auth_token')), []);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const loadInvoices = async () => {
      try {
        if (refreshNonce === 0) {
          setIsLoading(true);
        } else {
          setIsRefreshing(true);
        }

        if (isMounted) {
          setHasError(false);
        }

        const localIds = getStoredVipInvoiceHistory();

        const localSettled = await Promise.allSettled(
          localIds.map((publicId) => getVipInvoice(publicId))
        );
        const localInvoices = localSettled
          .filter((result): result is PromiseFulfilledResult<VipInvoice> => result.status === 'fulfilled')
          .map((result) => result.value);

        let accountInvoices: VipInvoice[] = [];
        if (hasAccountToken) {
          try {
            accountInvoices = await listMyVipInvoices(50);
          } catch (loadError) {
            console.warn('VIP donations account list failed:', loadError);
            if (!localInvoices.length && isMounted) {
              setHasError(true);
            }
          }
        }

        const merged = new Map<string, VipInvoice>();
        for (const invoice of localInvoices) {
          merged.set(invoice.publicId, invoice);
        }
        for (const invoice of accountInvoices) {
          merged.set(invoice.publicId, invoice);
        }

        if (isMounted) {
          setInvoices(sortByCreatedAtDesc(Array.from(merged.values())));
        }
      } catch (loadError) {
        // Le message du serveur parle d'« invoices » : le donateur voit un
        // texte simple, le détail reste dans la console.
        console.warn('VIP donations list failed:', loadError);
        if (isMounted) {
          setHasError(true);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    void loadInvoices();

    return () => {
      isMounted = false;
    };
  }, [hasAccountToken, refreshNonce]);

  const openInvoices = useMemo(
    () => invoices.filter((invoice) => OPEN_STATUSES.has(invoice.status)),
    [invoices]
  );
  const doneInvoices = useMemo(
    () => invoices.filter((invoice) => !OPEN_STATUSES.has(invoice.status)),
    [invoices]
  );

  const handleRefresh = () => setRefreshNonce((value) => value + 1);

  const renderInvoiceRow = (invoice: VipInvoice) => {
    const statusMeta = getVipStatusMeta(t, invoice.status);
    const isOpen = OPEN_STATUSES.has(invoice.status);
    const methodLabel = invoice.paymentMethod === 'cryptogate'
      ? t('vipDonations.track.summary.methodCryptoGate')
      : getVipPaymentLabel(t, invoice.paymentMethod, invoice.coin);
    const details = [
      invoice.createdAt ? formatVipDateTime(i18n.language, invoice.createdAt) : null,
      methodLabel
    ].filter(Boolean).join(' · ');
    const trackingPath = invoice.invoicePath || `/vip/invoice/${encodeURIComponent(invoice.publicId)}`;

    return (
      <li
        key={invoice.publicId}
        className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
      >
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-lg font-bold text-white">
              {formatVipFiat(i18n.language, invoice.amountEur, 'EUR')}
            </span>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                STATUS_TONE[invoice.status] ?? STATUS_TONE.expired
              }`}
            >
              {statusMeta.label}
            </span>
          </div>
          <p className="text-sm text-yellow-200/85">
            {t('vipDonations.track.summary.rewardValue', {
              duration: getVipDurationLabel(t, invoice.vipYears, 'plain')
            })}
            {' · '}
            {invoice.recipientMode === 'gift'
              ? t('vipDonations.myDonations.forGift')
              : t('vipDonations.myDonations.forSelf')}
          </p>
          {details && <p className="text-xs text-white/40">{details}</p>}
          {isOpen && <p className="pt-1 text-xs leading-5 text-white/55">{statusMeta.hint}</p>}
        </div>

        <Link
          to={trackingPath}
          className={`h-10 shrink-0 ${isOpen ? GOLD_LINK_CLASS : OUTLINE_LINK_CLASS}`}
        >
          {t('vipDonations.myDonations.viewButton')}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </li>
    );
  };

  const sections = [
    { id: 'open', title: t('vipDonations.myDonations.openTitle'), items: openInvoices, highlighted: true },
    { id: 'done', title: t('vipDonations.myDonations.doneTitle'), items: doneInvoices, highlighted: false }
  ].filter((section) => section.items.length > 0);

  const refreshButton = (
    <Button
      variant="ghost"
      size="sm"
      className="group/icon h-8 gap-1.5 text-white/60 focus-visible:ring-white/30"
      onClick={handleRefresh}
      disabled={isLoading || isRefreshing}
    >
      {isRefreshing
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <RefreshCcw className="h-3.5 w-3.5 text-white opacity-60 transition-[color,opacity] duration-200 group-hover/icon:opacity-100" />}
      {isRefreshing ? t('vipDonations.myDonations.refreshing') : t('vipDonations.myDonations.refresh')}
    </Button>
  );

  return (
    <SquareBackground
      squareSize={48}
      borderColor="rgba(234, 179, 8, 0.12)"
      className="min-h-screen bg-black text-white"
    >
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
              <Heart className="h-7 w-7 text-yellow-400" />
            </div>
            <div role="heading" aria-level={1}>
              <BlurText
                text={t('vipDonations.myDonations.title')}
                delay={120}
                animateBy="words"
                direction="top"
                className="justify-center text-3xl font-bold text-white sm:text-5xl"
              />
            </div>
            <p className="mx-auto max-w-xl text-base leading-relaxed text-white/60">
              {hasAccountToken
                ? t('vipDonations.myDonations.descriptionConnected')
                : t('vipDonations.myDonations.descriptionGuest')}
            </p>
          </motion.header>

          <div className="mt-8 sm:mt-10">
            {isLoading ? (
              <div className="py-12 text-center" role="status">
                <Loader2 className="mx-auto h-9 w-9 animate-spin text-yellow-400" />
                <p className="mt-4 text-sm text-white/55">{t('vipDonations.myDonations.loading')}</p>
              </div>
            ) : hasError ? (
              <div className={`${PANEL_CLASS} p-6 text-center`}>
                <p className="text-white/75">{t('vipDonations.myDonations.loadError')}</p>
                <Button
                  variant="outline"
                  className="mt-4 h-10 border-white/15 focus-visible:ring-white/30"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                >
                  {isRefreshing
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <RefreshCcw className="mr-2 h-4 w-4" />}
                  {t('vipDonations.myDonations.retry')}
                </Button>
              </div>
            ) : invoices.length === 0 ? (
              <AnimatedBorderCard
                highlightColor="234 179 8"
                backgroundColor="10 10 10"
                animationSpeed={0.6}
                className="p-8 text-center sm:p-10"
              >
                <ShinyText
                  text={t('vipDonations.myDonations.emptyTitle')}
                  speed={2.5}
                  color="#fbbf24"
                  shineColor="#ffffff"
                  className="text-2xl font-bold"
                />
                <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/60">
                  {t('vipDonations.myDonations.emptyText')}
                </p>
                <Link to="/vip" className={`mt-6 h-11 px-5 ${GOLD_LINK_CLASS}`}>
                  <HandHeart className="h-4 w-4" />
                  {t('vipDonations.myDonations.emptyButton')}
                </Link>
              </AnimatedBorderCard>
            ) : (
              <div className="space-y-8">
                {sections.map((section, index) => {
                  const list = (
                    <ul className="divide-y divide-white/10">
                      {section.items.map(renderInvoiceRow)}
                    </ul>
                  );

                  return (
                    <section key={section.id} aria-labelledby={`vip-donations-${section.id}`}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h2
                          id={`vip-donations-${section.id}`}
                          className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45"
                        >
                          {section.title}
                        </h2>
                        {index === 0 && refreshButton}
                      </div>
                      {section.highlighted ? (
                        <AnimatedBorderCard
                          highlightColor="234 179 8"
                          backgroundColor="10 10 10"
                          animationSpeed={0.6}
                          className="p-5"
                        >
                          {list}
                        </AnimatedBorderCard>
                      ) : (
                        <div className={`${PANEL_CLASS} p-5`}>{list}</div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </SquareBackground>
  );
};

export default VipInvoicesPage;
