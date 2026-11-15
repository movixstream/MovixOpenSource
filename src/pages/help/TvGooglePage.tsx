import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MonitorPlay,
  SearchX,
  Keyboard,
  ShieldAlert,
  FileWarning,
  PackageX,
  VideoOff,
} from 'lucide-react';
import TutoLayout, { TutoSection } from '../../components/TutoLayout';
import TermTooltip from '../../components/TermTooltip';
import TutoLink from '../../components/TutoLink';

const TvGooglePage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('help.tvGoogle.title')} — Movix`;
  }, [t]);

  const sections: TutoSection[] = [
    {
      kind: 'text',
      bodyKey: 'help.tvGoogle.introBody',
      components: {
        1: <TermTooltip tooltipKey="help.glossary.apk" />,
        2: <TutoLink to="/app-tv" />,
      },
    },
    {
      kind: 'text',
      titleKey: 'help.tvGoogle.beforeTitle',
      bodyKey: 'help.tvGoogle.beforeBody',
      components: {
        1: <TutoLink to="/help/android-tv" />,
      },
    },
    {
      kind: 'steps',
      titleKey: 'help.tvGoogle.installTitle',
      stepKeys: [
        'help.tvGoogle.step1',
        'help.tvGoogle.step2',
        'help.tvGoogle.step3',
        'help.tvGoogle.step4',
        'help.tvGoogle.step5',
        'help.tvGoogle.step6',
        'help.tvGoogle.step7',
      ],
      components: {
        1: <TutoLink to="/app-tv#installer" />,
      },
    },
    {
      kind: 'steps',
      titleKey: 'help.tvGoogle.linkTitle',
      stepKeys: ['help.tvGoogle.link1', 'help.tvGoogle.link2', 'help.tvGoogle.link3'],
      components: {
        1: <TutoLink to="/app-tv#relier" />,
      },
    },
    {
      kind: 'text',
      bodyKey: 'help.tvGoogle.linkBody',
      components: {
        1: <TutoLink to="/settings#sessions" />,
      },
    },
    { kind: 'text', titleKey: 'help.tvGoogle.updateTitle', bodyKey: 'help.tvGoogle.updateBody' },
    { kind: 'text', titleKey: 'help.tvGoogle.troubleTitle', bodyKey: 'help.tvGoogle.troubleIntro' },
    {
      kind: 'causes',
      causes: [
        {
          icon: <SearchX className="w-5 h-5" />,
          titleKey: 'help.tvGoogle.causeOptionsTitle',
          bodyKey: 'help.tvGoogle.causeOptionsBody',
        },
        {
          icon: <Keyboard className="w-5 h-5" />,
          titleKey: 'help.tvGoogle.causeCodeTitle',
          bodyKey: 'help.tvGoogle.causeCodeBody',
          ctas: [{ labelKey: 'help.tvGoogle.causeCodeCta', href: '/app-tv#installer' }],
        },
        {
          icon: <ShieldAlert className="w-5 h-5" />,
          titleKey: 'help.tvGoogle.causePlayProtectTitle',
          bodyKey: 'help.tvGoogle.causePlayProtectBody',
        },
        {
          icon: <FileWarning className="w-5 h-5" />,
          titleKey: 'help.tvGoogle.causeParseTitle',
          bodyKey: 'help.tvGoogle.causeParseBody',
        },
        {
          icon: <PackageX className="w-5 h-5" />,
          titleKey: 'help.tvGoogle.causeNotInstalledTitle',
          bodyKey: 'help.tvGoogle.causeNotInstalledBody',
        },
        {
          icon: <VideoOff className="w-5 h-5" />,
          titleKey: 'help.tvGoogle.causeVideoTitle',
          bodyKey: 'help.tvGoogle.causeVideoBody',
          ctas: [{ labelKey: 'help.tvGoogle.causeVideoCta', href: '/help/vip' }],
        },
      ],
    },
  ];

  return (
    <TutoLayout
      icon={<MonitorPlay className="w-10 h-10 text-blue-400" />}
      title={t('help.tvGoogle.title')}
      heroSub={t('help.tvGoogle.heroSub')}
      sections={sections}
    />
  );
};

export default TvGooglePage;
