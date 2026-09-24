import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, AlertTriangle } from 'lucide-react';
import TutoLayout, { TutoSection } from '../../components/TutoLayout';

const MOVIX_OPEN_SOURCE_GITHUB_URL = 'https://github.com/movixstream/MovixOpenSource';
const MOVIX_LICENSE_URL = 'https://creativecommons.org/licenses/by-nc/4.0/';

const OpenSourcePage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('help.openSource.title')} — Movix`;
  }, [t]);

  const repoLink = (
    <a
      href={MOVIX_OPEN_SOURCE_GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/40 hover:decoration-indigo-400"
    />
  );

  const licenseLink = (
    <a
      href={MOVIX_LICENSE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/40 hover:decoration-indigo-400"
    />
  );

  const sections: TutoSection[] = [
    {
      kind: 'text',
      bodyKey: 'help.openSource.introBody',
      components: { 1: repoLink, 2: licenseLink },
    },
    {
      kind: 'text',
      titleKey: 'help.openSource.contentTitle',
      bodyKey: 'help.openSource.contentBody',
      components: { 1: repoLink },
    },
    {
      kind: 'text',
      titleKey: 'help.openSource.whyTitle',
      bodyKey: 'help.openSource.whyBody',
    },
    {
      kind: 'text',
      titleKey: 'help.openSource.selfhostTitle',
      bodyKey: 'help.openSource.selfhostBody',
      components: { 1: repoLink },
    },
    {
      kind: 'text',
      titleKey: 'help.openSource.contribTitle',
      bodyKey: 'help.openSource.contribBody',
      components: { 1: repoLink },
    },
    {
      kind: 'text',
      titleKey: 'help.openSource.limitsTitle',
      bodyKey: 'help.openSource.limitsBody',
      titleIcon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
      components: { 1: licenseLink },
    },
  ];

  return (
    <TutoLayout
      icon={<Github className="w-10 h-10 text-gray-300" />}
      title={t('help.openSource.title')}
      heroSub={t('help.openSource.heroSub')}
      sections={sections}
    />
  );
};

export default OpenSourcePage;
