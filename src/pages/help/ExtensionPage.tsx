import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Puzzle, AlertTriangle } from 'lucide-react';
import TutoLayout, { TutoSection } from '../../components/TutoLayout';
import TutoLink from '../../components/TutoLink';

const MOVIX_OPEN_SOURCE_GITHUB_URL = 'https://github.com/movixstream/MovixOpenSource';

const ExtensionPage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('help.extension.title')} — Movix`;
  }, [t]);

  const sections: TutoSection[] = [
    {
      kind: 'text',
      bodyKey: 'help.extension.introBody',
      components: {
        1: <TutoLink to="/extension" />,
      },
    },
    {
      kind: 'text',
      titleKey: 'help.extension.chromeTitle',
      bodyKey: 'help.extension.chromeBody',
      components: {
        1: <TutoLink to="/extension" />,
        2: (
          <a
            href={MOVIX_OPEN_SOURCE_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/40 hover:decoration-indigo-400"
          />
        ),
      },
    },
    {
      kind: 'text',
      titleKey: 'help.extension.firefoxTitle',
      bodyKey: 'help.extension.firefoxBody',
      components: {
        1: <TutoLink to="/extension" />,
        2: (
          <a
            href={MOVIX_OPEN_SOURCE_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/40 hover:decoration-indigo-400"
          />
        ),
      },
    },
    { kind: 'text', titleKey: 'help.extension.permissionsTitle', bodyKey: 'help.extension.permissionsBody' },
    {
      kind: 'text',
      titleKey: 'help.extension.limitsTitle',
      bodyKey: 'help.extension.limitsBody',
      titleIcon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
    },
  ];

  return (
    <TutoLayout
      icon={<Puzzle className="w-10 h-10 text-orange-400" />}
      title={t('help.extension.title')}
      heroSub={t('help.extension.heroSub')}
      sections={sections}
    />
  );
};

export default ExtensionPage;
