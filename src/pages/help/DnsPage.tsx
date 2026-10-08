import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldAlert,
  Smartphone,
  Monitor,
  AppleIcon,
  TerminalSquare,
  ExternalLink,
} from 'lucide-react';
import TutoLayout, { TutoSection } from '../../components/TutoLayout';
import FaiTooltip from '../../components/FaiTooltip';

const EXTERNAL_RESOURCES: Array<{
  labelKey: string;
  href: string;
}> = [
  { labelKey: 'helpDns.otherCfOfficial', href: 'https://one.one.one.one/' },
  {
    labelKey: 'helpDns.otherCfSetup',
    href: 'https://developers.cloudflare.com/1.1.1.1/setup/',
  },
  { labelKey: 'helpDns.otherChangeTonDns', href: 'https://changetondns.fr/' },
  { labelKey: 'helpDns.otherMirrorsMovixHealth', href: 'https://movix.online' },
  { labelKey: 'helpDns.otherMirrors', href: 'https://rentry.co/movix' },
  {
    labelKey: 'helpDns.otherTelegram',
    href: import.meta.env.VITE_SUPPORT_TELEGRAM_URL || 'https://t.me/ix_annonces',
  },
];

const INSTALL_TARGETS: Array<{
  key: 'Ios' | 'Android' | 'Windows' | 'Mac' | 'Linux';
  icon: React.ReactNode;
  storeUrl?: string;
  storeLabel?: string;
}> = [
  {
    key: 'Ios',
    icon: <Smartphone className="w-5 h-5" />,
    storeUrl: 'https://apps.apple.com/app/1-1-1-1-faster-internet/id1423538627',
    storeLabel: 'App Store',
  },
  {
    key: 'Android',
    icon: <Smartphone className="w-5 h-5" />,
    storeUrl:
      'https://play.google.com/store/apps/details?id=com.cloudflare.onedotonedotonedotone',
    storeLabel: 'Play Store',
  },
  {
    key: 'Windows',
    icon: <Monitor className="w-5 h-5" />,
    storeUrl: 'https://one.one.one.one/',
    storeLabel: 'one.one.one.one',
  },
  {
    key: 'Mac',
    icon: <AppleIcon className="w-5 h-5" />,
    storeUrl: 'https://one.one.one.one/',
    storeLabel: 'one.one.one.one',
  },
  {
    key: 'Linux',
    icon: <TerminalSquare className="w-5 h-5" />,
  },
];

const DnsPage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('helpDns.title')} — Movix`;
  }, [t]);

  const renderInstallGrid = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {INSTALL_TARGETS.map((target) => (
        <div
          key={target.key}
          className="rounded-lg border border-white/10 bg-white/5 p-4"
        >
          <div className="flex items-center gap-2 mb-2 text-white">
            <span className="text-red-400">{target.icon}</span>
            <h3 className="font-semibold">
              {t(`helpDns.install${target.key}`)}
            </h3>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed mb-3">
            {t(`helpDns.install${target.key}Body`)}
          </p>
          {target.storeUrl && (
            <a
              href={target.storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-red-400 hover:text-red-300 underline-offset-2 hover:underline"
            >
              {target.storeLabel}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      ))}
    </div>
  );

  const renderResourcesList = () => (
    <ul className="space-y-2">
      {EXTERNAL_RESOURCES.map((r) => (
        <li key={r.labelKey}>
          <a
            href={r.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-zinc-300 hover:text-white transition-colors"
          >
            <ExternalLink className="w-4 h-4 text-red-400" />
            {t(r.labelKey)}
          </a>
        </li>
      ))}
    </ul>
  );

  const sections: TutoSection[] = [
    {
      kind: 'text',
      titleKey: 'helpDns.whyTitle',
      bodyKey: 'helpDns.whyBody',
      components: { 1: <FaiTooltip /> },
    },
    {
      kind: 'text',
      titleKey: 'helpDns.solutionTitle',
      bodyKey: 'helpDns.solutionBody',
    },
    {
      kind: 'visual',
      render: renderInstallGrid,
    },
    {
      kind: 'visual',
      render: renderResourcesList,
    },
  ];

  return (
    <TutoLayout
      icon={<ShieldAlert className="w-10 h-10 text-red-400" />}
      title={t('helpDns.title')}
      heroSub={t('helpDns.heroSub')}
      sections={sections}
    />
  );
};

export default DnsPage;
