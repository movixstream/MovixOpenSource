import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import TutoLayout, { TutoSection } from '../../components/TutoLayout';
import TermTooltip from '../../components/TermTooltip';

const MiroirsPage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('help.miroirs.title')} — Movix`;
  }, [t]);

  const telegramUrl =
    import.meta.env.VITE_SUPPORT_TELEGRAM_URL || 'https://t.me/ix_annonces';

  const sections: TutoSection[] = [
    {
      kind: 'text',
      bodyKey: 'help.miroirs.introBody',
      components: {
        1: <TermTooltip tooltipKey="help.glossary.arcom" />,
      },
    },
    {
      kind: 'text',
      titleKey: 'help.miroirs.howTitle',
      bodyKey: 'help.miroirs.howBody',
    },
    {
      kind: 'text',
      titleKey: 'help.miroirs.officialListTitle',
      bodyKey: 'help.miroirs.officialListBody',
      components: {
        1: (
          <a
            href="https://movix.online"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/40 hover:decoration-indigo-400"
          />
        ),
        2: (
          <a
            href="https://rentry.co/movix"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/40 hover:decoration-indigo-400"
          />
        ),
      },
    },
    {
      kind: 'text',
      titleKey: 'help.miroirs.newDeviceTitle',
      bodyKey: 'help.miroirs.newDeviceBody',
      components: {
        1: (
          <a
            href={telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/40 hover:decoration-indigo-400"
          />
        ),
      },
    },
    {
      kind: 'text',
      titleKey: 'help.miroirs.reliabilityTitle',
      bodyKey: 'help.miroirs.reliabilityBody',
    },
    {
      kind: 'text',
      titleKey: 'help.miroirs.limitsTitle',
      bodyKey: 'help.miroirs.limitsBody',
    },
  ];

  return (
    <TutoLayout
      icon={<Globe className="w-10 h-10 text-red-400" />}
      title={t('help.miroirs.title')}
      heroSub={t('help.miroirs.heroSub')}
      sections={sections}
    />
  );
};

export default MiroirsPage;
