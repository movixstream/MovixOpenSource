import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Flame,
  SearchX,
  Keyboard,
  FileWarning,
  PackageX,
  HardDrive,
  VideoOff,
} from 'lucide-react';
import TutoLayout, { TutoSection } from '../../components/TutoLayout';
import TermTooltip from '../../components/TermTooltip';
import TutoLink from '../../components/TutoLink';

const TvFirePage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('help.tvFire.title')} — Movix`;
  }, [t]);

  const sections: TutoSection[] = [
    {
      kind: 'text',
      bodyKey: 'help.tvFire.introBody',
      components: {
        1: <TermTooltip tooltipKey="help.glossary.apk" />,
        2: <TutoLink to="/app-tv" />,
      },
    },
    { kind: 'text', titleKey: 'help.tvFire.beforeTitle', bodyKey: 'help.tvFire.beforeBody' },
    {
      kind: 'steps',
      titleKey: 'help.tvFire.installTitle',
      stepKeys: [
        'help.tvFire.step1',
        'help.tvFire.step2',
        'help.tvFire.step3',
        'help.tvFire.step4',
        'help.tvFire.step5',
        'help.tvFire.step6',
        'help.tvFire.step7',
      ],
      components: {
        1: <TutoLink to="/app-tv#installer" />,
      },
    },
    {
      kind: 'steps',
      titleKey: 'help.tvFire.linkTitle',
      stepKeys: ['help.tvFire.link1', 'help.tvFire.link2', 'help.tvFire.link3'],
      components: {
        1: <TutoLink to="/app-tv#relier" />,
      },
    },
    {
      kind: 'text',
      bodyKey: 'help.tvFire.linkBody',
      components: {
        1: <TutoLink to="/settings#sessions" />,
      },
    },
    { kind: 'text', titleKey: 'help.tvFire.updateTitle', bodyKey: 'help.tvFire.updateBody' },
    { kind: 'text', titleKey: 'help.tvFire.troubleTitle', bodyKey: 'help.tvFire.troubleIntro' },
    {
      kind: 'causes',
      causes: [
        {
          icon: <SearchX className="w-5 h-5" />,
          titleKey: 'help.tvFire.causeOptionsTitle',
          bodyKey: 'help.tvFire.causeOptionsBody',
        },
        {
          icon: <Keyboard className="w-5 h-5" />,
          titleKey: 'help.tvFire.causeCodeTitle',
          bodyKey: 'help.tvFire.causeCodeBody',
          ctas: [{ labelKey: 'help.tvFire.causeCodeCta', href: '/app-tv#installer' }],
        },
        {
          icon: <FileWarning className="w-5 h-5" />,
          titleKey: 'help.tvFire.causeParseTitle',
          bodyKey: 'help.tvFire.causeParseBody',
        },
        {
          icon: <PackageX className="w-5 h-5" />,
          titleKey: 'help.tvFire.causeNotInstalledTitle',
          bodyKey: 'help.tvFire.causeNotInstalledBody',
        },
        {
          icon: <HardDrive className="w-5 h-5" />,
          titleKey: 'help.tvFire.causeStorageTitle',
          bodyKey: 'help.tvFire.causeStorageBody',
        },
        {
          icon: <VideoOff className="w-5 h-5" />,
          titleKey: 'help.tvFire.causeVideoTitle',
          bodyKey: 'help.tvFire.causeVideoBody',
          ctas: [{ labelKey: 'help.tvFire.causeVideoCta', href: '/help/vip' }],
        },
      ],
    },
  ];

  return (
    <TutoLayout
      icon={<Flame className="w-10 h-10 text-orange-400" />}
      title={t('help.tvFire.title')}
      heroSub={t('help.tvFire.heroSub')}
      sections={sections}
    />
  );
};

export default TvFirePage;
