import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Tv2,
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

const TvAndroidPage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('help.tvAndroid.title')} — Movix`;
  }, [t]);

  const sections: TutoSection[] = [
    {
      kind: 'text',
      bodyKey: 'help.tvAndroid.introBody',
      components: {
        1: <TermTooltip tooltipKey="help.glossary.apk" />,
        2: <TutoLink to="/app-tv" />,
      },
    },
    {
      kind: 'text',
      titleKey: 'help.tvAndroid.beforeTitle',
      bodyKey: 'help.tvAndroid.beforeBody',
      components: {
        1: <TutoLink to="/help/google-tv" />,
      },
    },
    {
      kind: 'steps',
      titleKey: 'help.tvAndroid.installTitle',
      stepKeys: [
        'help.tvAndroid.step1',
        'help.tvAndroid.step2',
        'help.tvAndroid.step3',
        'help.tvAndroid.step4',
        'help.tvAndroid.step5',
        'help.tvAndroid.step6',
        'help.tvAndroid.step7',
      ],
      components: {
        1: <TutoLink to="/app-tv#installer" />,
      },
    },
    {
      kind: 'steps',
      titleKey: 'help.tvAndroid.linkTitle',
      stepKeys: ['help.tvAndroid.link1', 'help.tvAndroid.link2', 'help.tvAndroid.link3'],
      components: {
        1: <TutoLink to="/app-tv#relier" />,
      },
    },
    {
      kind: 'text',
      bodyKey: 'help.tvAndroid.linkBody',
      components: {
        1: <TutoLink to="/settings#sessions" />,
      },
    },
    { kind: 'text', titleKey: 'help.tvAndroid.updateTitle', bodyKey: 'help.tvAndroid.updateBody' },
    { kind: 'text', titleKey: 'help.tvAndroid.troubleTitle', bodyKey: 'help.tvAndroid.troubleIntro' },
    {
      kind: 'causes',
      causes: [
        {
          icon: <SearchX className="w-5 h-5" />,
          titleKey: 'help.tvAndroid.causeOptionsTitle',
          bodyKey: 'help.tvAndroid.causeOptionsBody',
        },
        {
          icon: <Keyboard className="w-5 h-5" />,
          titleKey: 'help.tvAndroid.causeCodeTitle',
          bodyKey: 'help.tvAndroid.causeCodeBody',
          ctas: [{ labelKey: 'help.tvAndroid.causeCodeCta', href: '/app-tv#installer' }],
        },
        {
          icon: <ShieldAlert className="w-5 h-5" />,
          titleKey: 'help.tvAndroid.causePlayProtectTitle',
          bodyKey: 'help.tvAndroid.causePlayProtectBody',
        },
        {
          icon: <FileWarning className="w-5 h-5" />,
          titleKey: 'help.tvAndroid.causeParseTitle',
          bodyKey: 'help.tvAndroid.causeParseBody',
        },
        {
          icon: <PackageX className="w-5 h-5" />,
          titleKey: 'help.tvAndroid.causeNotInstalledTitle',
          bodyKey: 'help.tvAndroid.causeNotInstalledBody',
        },
        {
          icon: <VideoOff className="w-5 h-5" />,
          titleKey: 'help.tvAndroid.causeVideoTitle',
          bodyKey: 'help.tvAndroid.causeVideoBody',
          ctas: [{ labelKey: 'help.tvAndroid.causeVideoCta', href: '/help/vip' }],
        },
      ],
    },
  ];

  return (
    <TutoLayout
      icon={<Tv2 className="w-10 h-10 text-green-400" />}
      title={t('help.tvAndroid.title')}
      heroSub={t('help.tvAndroid.heroSub')}
      sections={sections}
    />
  );
};

export default TvAndroidPage;
