import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Crown, Gift, Ticket } from 'lucide-react';
import TutoLayout, { TutoSection } from '../../components/TutoLayout';
import TutoLink from '../../components/TutoLink';

const VipHelpPage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('help.vip.title')} — Movix`;
  }, [t]);

  const sections: TutoSection[] = [
    {
      kind: 'text',
      bodyKey: 'help.vip.introBody',
      components: {
        1: <TutoLink to="/vip" />,
      },
    },
    {
      kind: 'text',
      titleKey: 'help.vip.perksTitle',
      bodyKey: 'help.vip.perksBody',
      components: {
        1: <TutoLink to="/help/watchparty" />,
      },
    },
    {
      kind: 'table',
      titleKey: 'help.vip.packsTitle',
      introKey: 'help.vip.packsIntro',
      headerKeys: ['help.vip.packsHeaderAmount', 'help.vip.packsHeaderDuration'],
      rowKeys: [
        ['help.vip.pack5Amount', 'help.vip.pack5Duration'],
        ['help.vip.pack7Amount', 'help.vip.pack7Duration'],
        ['help.vip.pack10Amount', 'help.vip.pack10Duration'],
        ['help.vip.pack15Amount', 'help.vip.pack15Duration'],
        ['help.vip.pack20Amount', 'help.vip.pack20Duration'],
      ],
    },
    {
      kind: 'text',
      titleKey: 'help.vip.paymentTitle',
      bodyKey: 'help.vip.paymentBody',
    },
    {
      kind: 'steps',
      titleKey: 'help.vip.stepsTitle',
      stepKeys: [
        'help.vip.step1',
        'help.vip.step2',
        'help.vip.step3',
        'help.vip.step4',
      ],
    },
    {
      kind: 'text',
      titleKey: 'help.vip.giftCardTitle',
      bodyKey: 'help.vip.giftCardBody',
      titleIcon: <Ticket className="w-5 h-5 text-amber-300" />,
      components: {
        1: <TutoLink to="/vip" />,
      },
    },
    {
      kind: 'text',
      titleKey: 'help.vip.giftTitle',
      bodyKey: 'help.vip.giftBody',
      titleIcon: <Gift className="w-5 h-5 text-pink-400" />,
      components: {
        1: <TutoLink to="/vip" />,
      },
    },
    {
      kind: 'text',
      titleKey: 'help.vip.invoicesTitle',
      bodyKey: 'help.vip.invoicesBody',
      components: {
        1: <TutoLink to="/vip/invoices" />,
      },
    },
    {
      kind: 'text',
      titleKey: 'help.vip.limitsTitle',
      bodyKey: 'help.vip.limitsBody',
    },
  ];

  return (
    <TutoLayout
      icon={<Crown className="w-10 h-10 text-yellow-400" />}
      title={t('help.vip.title')}
      heroSub={t('help.vip.heroSub')}
      sections={sections}
    />
  );
};

export default VipHelpPage;
