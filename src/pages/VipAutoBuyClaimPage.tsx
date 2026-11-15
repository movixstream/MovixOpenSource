import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, ShoppingBag } from 'lucide-react';

import AnimatedBorderCard from '../components/ui/animated-border-card';
import BlurText from '../components/ui/blur-text';
import { Button } from '../components/ui/button';
import { SquareBackground } from '../components/ui/square-background';

const LAST_AUTOBUY_INVOICE_STORAGE_KEY = 'vip_autobuy_last_invoice_public_id';

const VipAutoBuyClaimPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const lastInvoicePublicId = searchParams.get('publicId')?.trim()
      || searchParams.get('invoice')?.trim()
      || localStorage.getItem(LAST_AUTOBUY_INVOICE_STORAGE_KEY)?.trim();
    if (!lastInvoicePublicId) {
      return;
    }

    const query = location.search || '';
    navigate(`/vip/invoice/${encodeURIComponent(lastInvoicePublicId)}${query}`, {
      replace: true
    });
  }, [location.search, navigate]);

  return (
    <SquareBackground
      squareSize={48}
      borderColor="rgba(14, 165, 233, 0.12)"
      className="min-h-screen bg-black text-white"
    >
      <div className="container mx-auto px-4 py-8 sm:px-6 sm:py-12 relative z-10">
        <Link to="/vip/don" className="inline-flex items-center text-white/50 hover:text-white transition-colors mb-8 group/icon">
          <ArrowLeft className="w-5 h-5 mr-2 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity]" />
          {t('vipDonations.page.backVip')}
        </Link>

        <div className="mx-auto max-w-3xl space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-6"
          >
            <div className="inline-flex items-center justify-center p-3 rounded-full ring-1 ring-sky-400/40 bg-sky-400/10">
              <ShoppingBag className="w-8 h-8 text-sky-300" />
            </div>

            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-sky-300/80">
                {t('vipDonations.autobuy.heroEyebrow')}
              </p>
              <BlurText
                text={t('vipDonations.autobuy.redirectTitle')}
                delay={220}
                animateBy="words"
                direction="top"
                className="text-4xl md:text-5xl font-bold text-white justify-center"
              />
              <p className="text-base md:text-lg text-white/60 leading-relaxed">
                {t('vipDonations.autobuy.redirectDescription')}
              </p>
            </div>
          </motion.div>

          <AnimatedBorderCard
            highlightColor="14 165 233"
            backgroundColor="10 10 10"
            className="p-6 sm:p-8 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center text-center">
              <Loader2 className="h-10 w-10 animate-spin text-sky-300" />
              <p className="mt-4 text-sm leading-6 text-white/60">
                {t('vipDonations.autobuy.redirectHint')}
              </p>
              <Button className="mt-6 h-12 bg-sky-400 text-black hover:bg-sky-300" onClick={() => navigate('/vip/don')}>
                {t('vipDonations.page.backVip')}
              </Button>
            </div>
          </AnimatedBorderCard>
        </div>
      </div>
    </SquareBackground>
  );
};

export default VipAutoBuyClaimPage;
