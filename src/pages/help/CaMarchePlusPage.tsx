import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ShieldAlert, Shield, Globe, Bug } from 'lucide-react';
import TutoLayout, { TutoSection } from '../../components/TutoLayout';
import TermTooltip from '../../components/TermTooltip';

const CaMarchePlusPage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('help.caMarchePlus.title')} — Movix`;
  }, [t]);

  const telegramUrl =
    import.meta.env.VITE_SUPPORT_TELEGRAM_URL || 'https://t.me/ix_annonces';

  const sections: TutoSection[] = [
    {
      kind: 'causes',
      introKey: 'help.caMarchePlus.intro',
      causes: [
        {
          icon: <ShieldAlert className="w-5 h-5" />,
          titleKey: 'help.caMarchePlus.cause1Title',
          bodyKey: 'help.caMarchePlus.cause1Body',
          bodyComponents: {
            1: <TermTooltip tooltipKey="help.glossary.arcom" />,
          },
          ctas: [
            { labelKey: 'help.caMarchePlus.cause1Cta', href: '/help/dns' },
          ],
        },
        {
          icon: <Shield className="w-5 h-5" />,
          titleKey: 'help.caMarchePlus.cause2Title',
          bodyKey: 'help.caMarchePlus.cause2Body',
          ctas: [
            {
              labelKey: 'help.caMarchePlus.cause2CtaBrave',
              href: 'https://brave.com/',
              external: true,
            },
            {
              labelKey: 'help.caMarchePlus.cause2CtaUblock',
              href: 'https://ublockorigin.com/',
              external: true,
            },
          ],
        },
        {
          icon: <Globe className="w-5 h-5" />,
          titleKey: 'help.caMarchePlus.cause3Title',
          bodyKey: 'help.caMarchePlus.cause3Body',
          ctas: [
            {
              labelKey: 'help.caMarchePlus.cause3CtaMovixHealth',
              href: 'https://movix.online',
              external: true,
            },
            {
              labelKey: 'help.caMarchePlus.cause3CtaRentry',
              href: 'https://rentry.co/movix',
              external: true,
            },
          ],
        },
        {
          icon: <Bug className="w-5 h-5" />,
          titleKey: 'help.caMarchePlus.cause4Title',
          bodyKey: 'help.caMarchePlus.cause4Body',
          ctas: [
            {
              labelKey: 'help.caMarchePlus.cause4Cta',
              href: telegramUrl,
              external: true,
            },
          ],
        },
      ],
    },
  ];

  return (
    <TutoLayout
      icon={<AlertCircle className="w-10 h-10 text-red-400" />}
      title={t('help.caMarchePlus.title')}
      heroSub={t('help.caMarchePlus.heroSub')}
      sections={sections}
    />
  );
};

export default CaMarchePlusPage;
