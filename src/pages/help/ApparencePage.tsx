import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import TutoLayout, { TutoSection } from '../../components/TutoLayout';

const ApparencePage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('help.apparence.title')} — Movix`;
  }, [t]);

  const sections: TutoSection[] = [
    { kind: 'text', bodyKey: 'help.apparence.introBody' },
    {
      kind: 'text',
      titleKey: 'help.apparence.bgStyleTitle',
      bodyKey: 'help.apparence.bgStyleBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.bgColorTitle',
      bodyKey: 'help.apparence.bgColorBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.smoothScrollTitle',
      bodyKey: 'help.apparence.smoothScrollBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.scrollPositionTitle',
      bodyKey: 'help.apparence.scrollPositionBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.soundTitle',
      bodyKey: 'help.apparence.soundBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.commentsTitle',
      bodyKey: 'help.apparence.commentsBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.heroTitle',
      bodyKey: 'help.apparence.heroBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.ambientTitle',
      bodyKey: 'help.apparence.ambientBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.screensaverTitle',
      bodyKey: 'help.apparence.screensaverBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.introAnimationTitle',
      bodyKey: 'help.apparence.introAnimationBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.sidebarTitle',
      bodyKey: 'help.apparence.sidebarBody',
    },
    {
      kind: 'text',
      titleKey: 'help.apparence.limitsTitle',
      bodyKey: 'help.apparence.limitsBody',
    },
  ];

  return (
    <TutoLayout
      icon={<Palette className="w-10 h-10 text-purple-400" />}
      title={t('help.apparence.title')}
      heroSub={t('help.apparence.heroSub')}
      sections={sections}
    />
  );
};

export default ApparencePage;
