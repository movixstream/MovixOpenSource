import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { ArrowLeft, Puzzle, Shield, Zap, Globe, Download, CheckCircle, AlertTriangle, MonitorSmartphone, Server, Lock, Eye, ChevronDown, Github } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SquareBackground } from '../components/ui/square-background';
import BlurText from '../components/ui/blur-text';
import ShinyText from '../components/ui/shiny-text';
import AnimatedBorderCard from '../components/ui/animated-border-card';
import { Button } from '../components/ui/button';

// Hosters supportés par l'extension
const supportedHostersData = [
  { name: 'Voe', descKey: 'extension.hosterVoeDesc', color: '#f97316' },
  { name: 'Fsvid', descKey: 'extension.hosterFsvidDesc', color: '#3b82f6' },
  { name: 'Vidzy', descKey: 'extension.hosterVidzyDesc', color: '#8b5cf6' },
  { name: 'Vidmoly', descKey: 'extension.hosterVidmolyDesc', color: '#ec4899' },
  { name: 'Sibnet', descKey: 'extension.hosterSibnetDesc', color: '#14b8a6' },
  { name: 'Uqload', descKey: 'extension.hosterUqloadDesc', color: '#f59e0b' },
  { name: 'DoodStream', descKey: 'extension.hosterDoodDesc', color: '#ef4444' },
  { name: 'SeekStreaming', descKey: 'extension.hosterSeekDesc', color: '#6366f1' },
];

// Avantages de l'extension (keys only - translated at render time)
const benefitsData = [
  {
    icon: <Zap className="w-6 h-6" />,
    titleKey: 'extension.benefitLocalTitle',
    descKey: 'extension.benefitLocalDesc',
    color: '#f59e0b',
  },
  {
    icon: <Shield className="w-6 h-6" />,
    titleKey: 'extension.benefitBypassTitle',
    descKey: 'extension.benefitBypassDesc',
    color: '#22c55e',
  },
  {
    icon: <MonitorSmartphone className="w-6 h-6" />,
    titleKey: 'extension.benefitSameDeviceTitle',
    descKey: 'extension.benefitSameDeviceDesc',
    color: '#3b82f6',
  },
  {
    icon: <Lock className="w-6 h-6" />,
    titleKey: 'extension.benefitCORSTitle',
    descKey: 'extension.benefitCORSDesc',
    color: '#a855f7',
  },
];

// FAQ (keys only)
const faqItemsData = [
  { questionKey: 'extension.faq1Q', answerKey: 'extension.faq1A' },
  { questionKey: 'extension.faq2Q', answerKey: 'extension.faq2A' },
  { questionKey: 'extension.faq3Q', answerKey: 'extension.faq3A' },
  { questionKey: 'extension.faq4Q', answerKey: 'extension.faq4A' },
  { questionKey: 'extension.faq5Q', answerKey: 'extension.faq5A' },
];

const USERSCRIPT_URL = 'https://github.com/movixstream/MovixOpenSource/tree/main/userscript';
const USERSCRIPT_INSTALL_URL = 'https://github.com/movixstream/MovixOpenSource/raw/refs/heads/main/userscript/movix.user.js';
const MOVIX_OPEN_SOURCE_GITHUB_URL = 'https://github.com/movixstream/MovixOpenSource';
const TAMPERMONKEY_URL = 'https://www.tampermonkey.net/';

const installTutorial = {
  compatibilityKey: 'extension.compatibleBrowsersUserscript',
  steps: [
    { step: 1, titleKey: 'extension.installUserscriptStep1Title', descKey: 'extension.installUserscriptStep1Desc' },
    { step: 2, titleKey: 'extension.installUserscriptStep2Title', descKey: 'extension.installUserscriptStep2Desc' },
    { step: 3, titleKey: 'extension.installUserscriptStep3Title', descKey: 'extension.installUserscriptStep3Desc' },
    { step: 4, titleKey: 'extension.installUserscriptStep4Title', descKey: 'extension.installUserscriptStep4Desc' },
  ],
  actions: [
    { href: TAMPERMONKEY_URL, labelKey: 'extension.installTampermonkey', variant: 'secondary' as const },
    { href: USERSCRIPT_INSTALL_URL, labelKey: 'extension.installMovixUserscript', variant: 'primary' as const },
  ],
};

type MovixExtensionWindow = Window & {
  __MOVIX_EXTENSION_INSTALLED?: boolean;
  hasMovixExtension?: boolean;
};

const ExtensionPage: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [extensionDetected, setExtensionDetected] = useState(false);
  const { t } = useTranslation();

  // Masquer le footer
  useEffect(() => undefined, []);

  useEffect(() => undefined, []);

  // Détecter si l'extension est déjà installée
  useEffect(() => {
    const checkExtension = () => {
      const movixWindow = window as MovixExtensionWindow;

      if (
        movixWindow.__MOVIX_EXTENSION_INSTALLED ||
        movixWindow.hasMovixExtension ||
        document.documentElement.dataset.movixExtension === 'true'
      ) {
        setExtensionDetected(true);
      }
    };

    checkExtension();

    // Écouter l'événement personnalisé dispatched par l'extension
    const handleExtensionLoaded = () => {
      setExtensionDetected(true);
    };
    window.addEventListener('movix-extension-loaded', handleExtensionLoaded);
    
    // Re-check périodique au cas où
    const interval = setInterval(checkExtension, 1000);
    
    return () => {
      window.removeEventListener('movix-extension-loaded', handleExtensionLoaded);
      clearInterval(interval);
    };
  }, []);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <SquareBackground squareSize={48} borderColor="rgba(99, 102, 241, 0.12)" className="min-h-screen bg-black text-white">
      <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 relative z-10 h-full overflow-y-auto">
        {/* Back Button */}
        <Link to="/" className="inline-flex items-center text-white/50 hover:text-white transition-colors mb-8">
          <ArrowLeft className="w-5 h-5 mr-2" />
          {t('common.backToHome')}
        </Link>

        {/* Hero Section */}
        <div className="max-w-4xl mx-auto text-center mb-16">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 relative"
          >
            <div className="inline-flex items-center justify-center p-3 bg-indigo-500/10 rounded-full mb-4 ring-1 ring-indigo-500/50">
              <Puzzle className="w-8 h-8 text-indigo-500" />
            </div>
            <h1 className="flex flex-col gap-2 text-4xl md:text-6xl font-black tracking-tight mb-4 pb-4">
              <ShinyText text={t('extension.heroTitle1')} speed={3} color="#ffffff" shineColor="#6366f1" className="block py-2 leading-tight" />
              <ShinyText text={t('extension.heroTitle2')} speed={2} color="#6366f1" shineColor="#ffffff" className="block py-2 leading-tight" />
            </h1>
            <BlurText
              text={t('extension.heroDesc')}
              delay={150}
              className="text-lg text-white/60 max-w-2xl mx-auto justify-center"
            />
          </motion.div>

          {/* Extension Status Badge */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border mt-4"
            style={{
              borderColor: extensionDetected ? 'rgba(34,197,94,0.4)' : 'rgba(234,179,8,0.4)',
              backgroundColor: extensionDetected ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)',
            }}
          >
            {extensionDetected ? (
              <>
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-green-400 text-sm font-medium">{t('extension.detected')}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                <span className="text-yellow-400 text-sm font-medium">{t('extension.notDetected')}</span>
              </>
            )}
          </motion.div>
        </div>

        {/* Why Section */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="max-w-5xl mx-auto mb-20"
        >
          <motion.div variants={itemVariants} className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t('extension.whyTitle')}</h2>
            <p className="text-white/50 max-w-2xl mx-auto">
              {t('extension.whyDesc')}
            </p>
          </motion.div>

          {/* Diagram explaining the problem */}
          <motion.div variants={itemVariants} className="mb-12">
            <AnimatedBorderCard
              highlightColor="99 102 241"
              backgroundColor="10 10 10"
              className="p-6 sm:p-8 backdrop-blur-sm"
            >
              <div className="grid md:grid-cols-2 gap-8">
                {/* Without Extension */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 rounded-lg bg-red-500/10">
                      <AlertTriangle className="w-5 h-5 text-red-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-red-400">{t('extension.withoutExtension')}</h3>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-red-500/10">
                      <Globe className="w-5 h-5 text-white opacity-40 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-white/70">{t('extension.diagramRequestServer')}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="h-px flex-1 bg-red-500/30" />
                          <span className="text-xs text-red-400">{t('extension.diagramServerRequest')}</span>
                          <div className="h-px flex-1 bg-red-500/30" />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-red-500/10">
                      <Server className="w-5 h-5 text-white opacity-40 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-white/70">{t('extension.diagramServerExtract')}</p>
                        <p className="text-xs text-red-400 mt-1">{t('extension.diagramDiffIP')}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                      <Lock className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-red-300 font-medium">{t('extension.diagramBlocked')}</p>
                        <p className="text-xs text-red-400/70 mt-1">{t('extension.diagramBlockedReason')}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* With Extension */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 rounded-lg bg-green-500/10">
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-green-400">{t('extension.withExtension')}</h3>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-green-500/10">
                      <Puzzle className="w-5 h-5 text-white opacity-40 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-white/70">{t('extension.diagramLocalExtract')}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="h-px flex-1 bg-green-500/30" />
                          <span className="text-xs text-green-400">{t('extension.diagramLocalExtraction')}</span>
                          <div className="h-px flex-1 bg-green-500/30" />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-green-500/10">
                      <MonitorSmartphone className="w-5 h-5 text-white opacity-40 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-white/70">{t('extension.diagramSameIP')}</p>
                        <p className="text-xs text-green-400 mt-1">{t('extension.diagramLegitRequest')}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <Eye className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-green-300 font-medium">{t('extension.diagramFluxOk')}</p>
                        <p className="text-xs text-green-400/70 mt-1">{t('extension.diagramSameDevice')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </AnimatedBorderCard>
          </motion.div>

          {/* Benefits Grid */}
          <div className="grid sm:grid-cols-2 gap-4">
            {benefitsData.map((benefit) => (
              <motion.div key={benefit.titleKey} variants={itemVariants}>
                <AnimatedBorderCard
                  highlightColor={hexToRgb(benefit.color)}
                  backgroundColor="12 12 12"
                  className="p-5 h-full"
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="p-2.5 rounded-lg flex-shrink-0"
                      style={{ backgroundColor: `${benefit.color}15` }}
                    >
                      <div style={{ color: benefit.color }}>{benefit.icon}</div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-white mb-1">{t(benefit.titleKey)}</h3>
                      <p className="text-sm text-white/50 leading-relaxed">{t(benefit.descKey)}</p>
                    </div>
                  </div>
                </AnimatedBorderCard>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Supported Hosters */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="max-w-5xl mx-auto mb-20"
        >
          <motion.div variants={itemVariants} className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t('extension.hostersTitle')}</h2>
            <p className="text-white/50 max-w-xl mx-auto">
              {t('extension.hostersDesc')}
            </p>
          </motion.div>

          <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {supportedHostersData.map((hoster, index) => (
              <motion.div
                key={hoster.name}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ scale: 1.05, y: -2 }}
                className="relative p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-colors text-center group"
              >
                <div
                  className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: `radial-gradient(circle at center, ${hoster.color}10, transparent 70%)` }}
                />
                <div className="relative">
                  <div
                    className="w-10 h-10 rounded-lg mx-auto mb-2 flex items-center justify-center text-lg font-bold"
                    style={{ backgroundColor: `${hoster.color}20`, color: hoster.color }}
                  >
                    {hoster.name.charAt(0)}
                  </div>
                  <h4 className="font-semibold text-white text-sm">{hoster.name}</h4>
                  <p className="text-xs text-white/40 mt-1">{t(hoster.descKey)}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        {/* Installation Steps */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="max-w-3xl mx-auto mb-20"
        >
          <motion.div variants={itemVariants} className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t('extension.installTitle')}</h2>
            <p className="text-white/50 max-w-xl mx-auto">
              {t('extension.installDesc')}
            </p>
          </motion.div>

          <AnimatedBorderCard
            highlightColor="99 102 241"
            backgroundColor="10 10 10"
            className="p-6 sm:p-8 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="space-y-6"
            >
              <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/8 p-4 sm:p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">
                  {t('extension.installMethodLabel')}
                </p>
                <p className="mt-2 text-base font-semibold text-white">{t('extension.userscriptLabel')}</p>
                <p className="mt-3 text-sm leading-relaxed text-white/55">{t('extension.installMethodUserscriptDesc')}</p>
              </div>

              {installTutorial.steps.map((step, index) => (
                <div key={`userscript-${step.step}`} className="flex gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm">
                      {step.step}
                    </div>
                    {index < installTutorial.steps.length - 1 && (
                      <div className="w-px h-8 bg-indigo-500/20 mx-auto mt-2" />
                    )}
                  </div>
                  <div className="pt-1.5">
                    <h4 className="font-semibold text-white mb-1">{t(step.titleKey)}</h4>
                    <p className="text-sm text-white/50 leading-relaxed">{t(step.descKey)}</p>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* Download Button */}
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="mt-8 flex flex-col items-center justify-center gap-4"
            >
              <div className={`grid gap-3 w-full ${installTutorial.actions.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                {installTutorial.actions.map((action) => (
                  <a
                    key={action.href}
                    href={action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg px-6 sm:px-8 text-sm sm:text-base font-semibold transition-all duration-200 active:scale-95 ${
                      action.variant === 'primary'
                        ? 'bg-orange-600 text-white shadow-lg shadow-orange-500/20 hover:bg-orange-700'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    <Download className="w-5 h-5 flex-shrink-0" />
                    <span className="truncate">{t(action.labelKey)}</span>
                  </a>
                ))}
              </div>
              <p className="text-xs text-white/30 text-center">
                {t(installTutorial.compatibilityKey)}
              </p>
              <p className="text-sm text-white/55 text-center max-w-2xl">
                {t('extension.githubNotice')}
              </p>
              <a
                href={MOVIX_OPEN_SOURCE_GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-white/20 px-6 sm:px-8 text-sm sm:text-base font-semibold text-white transition-all duration-200 hover:border-white/40 hover:bg-white/10 active:scale-95"
              >
                <Github className="w-5 h-5 flex-shrink-0" />
                <span className="truncate">{t('extension.viewOpenSourceGithub')}</span>
              </a>
            </motion.div>
          </AnimatedBorderCard>
        </motion.div>

        {/* FAQ */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="max-w-3xl mx-auto mb-20"
        >
          <motion.div variants={itemVariants} className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t('extension.faqTitle')}</h2>
          </motion.div>

          <div className="space-y-3">
            {faqItemsData.map((faq, index) => (
              <motion.div key={index} variants={itemVariants}>
                <AnimatedBorderCard
                  highlightColor="99 102 241"
                  backgroundColor="12 12 12"
                  className="overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full p-5 flex items-center justify-between text-left gap-4"
                  >
                    <span className="font-medium text-white text-sm sm:text-base">{t(faq.questionKey)}</span>
                    <motion.div
                      animate={{ rotate: openFaq === index ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex-shrink-0"
                    >
                      <ChevronDown className="w-5 h-5 text-white opacity-50" />
                    </motion.div>
                  </button>
                  <motion.div
                    initial={false}
                    animate={{
                      height: openFaq === index ? 'auto' : 0,
                      opacity: openFaq === index ? 1 : 0,
                    }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-5 text-sm text-white/50 leading-relaxed">
                      {t(faq.answerKey)}
                    </p>
                  </motion.div>
                </AnimatedBorderCard>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto text-center pb-12"
        >
          <AnimatedBorderCard
            highlightColor="99 102 241"
            backgroundColor="10 10 10"
            className="p-8 backdrop-blur-sm"
          >
            <Puzzle className="w-10 h-10 text-indigo-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">{t('extension.ctaTitle')}</h3>
            <p className="text-white/50 text-sm mb-6 max-w-md mx-auto">
              {t('extension.ctaDesc')}
            </p>
            <div className="flex flex-col items-center justify-center gap-3 w-full">
              <a href={USERSCRIPT_URL} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
                <Button variant="secondary" className="px-6 h-11 gap-2 w-full sm:w-auto">
                  <Download className="w-4 h-4 flex-shrink-0" />
                  {t('extension.userscriptLabel')}
                </Button>
              </a>
              <p className="text-sm text-white/55 text-center max-w-xl">
                {t('extension.githubNotice')}
              </p>
              <a href={MOVIX_OPEN_SOURCE_GITHUB_URL} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
                <Button variant="ghost" className="border border-white/20 hover:border-white/40 text-white h-11 px-5 gap-2 w-full sm:w-auto">
                  <Github className="w-4 h-4 flex-shrink-0" />
                  {t('extension.viewOpenSourceGithub')}
                </Button>
              </a>
              <Link to="/" className="w-full sm:w-auto">
                <Button variant="ghost" className="border border-white/20 hover:border-white/40 text-white h-11 px-5 gap-2 w-full sm:w-auto">
                  <ArrowLeft className="w-4 h-4 flex-shrink-0" />
                  {t('common.backToHome')}
                </Button>
              </Link>
            </div>
          </AnimatedBorderCard>
        </motion.div>
      </div>
    </SquareBackground>
  );
};

// Helper: convert hex color to RGB string for AnimatedBorderCard
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '99 102 241';
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`;
}

export default ExtensionPage;
