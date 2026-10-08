import {
  Ban,
  Crown,
  FileText,
  Link2,
  MessageSquare,
  Scale,
  Shield,
  Tv,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LegalDocumentPage, { LegalSection } from '../components/legal/LegalDocumentPage';

const CONTACT_EMAIL = 'movixstreaming@gmail.com';
const TELEGRAM_URL = 'https://t.me/ix_annonces';

const TermsOfService = () => {
  const { t } = useTranslation();

  const getStringArray = (key: string): string[] => {
    const value = t(key, { returnObjects: true });
    return Array.isArray(value) ? (value as string[]) : [];
  };

  const getOptionalStringArray = (key: string): string[] | undefined => {
    const value = t(key, { returnObjects: true });
    return Array.isArray(value) && value.length > 0 ? (value as string[]) : undefined;
  };

  const getOptionalString = (key: string): string | undefined => {
    const value = t(key);
    return value === key ? undefined : value;
  };

  const sections: LegalSection[] = [
    {
      id: 'scope',
      title: t('termsOfServicePage.sections.scope.title'),
      icon: FileText,
      paragraphs: getOptionalStringArray('termsOfServicePage.sections.scope.paragraphs'),
      bullets: getOptionalStringArray('termsOfServicePage.sections.scope.bullets'),
      note: getOptionalString('termsOfServicePage.sections.scope.note'),
    },
    {
      id: 'accounts',
      title: t('termsOfServicePage.sections.accounts.title'),
      icon: Shield,
      paragraphs: getOptionalStringArray('termsOfServicePage.sections.accounts.paragraphs'),
      bullets: getOptionalStringArray('termsOfServicePage.sections.accounts.bullets'),
      note: getOptionalString('termsOfServicePage.sections.accounts.note'),
    },
    {
      id: 'acceptable-use',
      title: t('termsOfServicePage.sections.acceptableUse.title'),
      icon: Ban,
      paragraphs: getOptionalStringArray('termsOfServicePage.sections.acceptableUse.paragraphs'),
      bullets: getOptionalStringArray('termsOfServicePage.sections.acceptableUse.bullets'),
      note: getOptionalString('termsOfServicePage.sections.acceptableUse.note'),
    },
    {
      id: 'third-party-services',
      title: t('termsOfServicePage.sections.thirdPartyServices.title'),
      icon: Link2,
      paragraphs: getOptionalStringArray('termsOfServicePage.sections.thirdPartyServices.paragraphs'),
      bullets: getOptionalStringArray('termsOfServicePage.sections.thirdPartyServices.bullets'),
      note: getOptionalString('termsOfServicePage.sections.thirdPartyServices.note'),
    },
    {
      id: 'community',
      title: t('termsOfServicePage.sections.community.title'),
      icon: MessageSquare,
      paragraphs: getOptionalStringArray('termsOfServicePage.sections.community.paragraphs'),
      bullets: getOptionalStringArray('termsOfServicePage.sections.community.bullets'),
      note: getOptionalString('termsOfServicePage.sections.community.note'),
    },
    {
      id: 'watchparty',
      title: t('termsOfServicePage.sections.watchparty.title'),
      icon: Tv,
      paragraphs: getOptionalStringArray('termsOfServicePage.sections.watchparty.paragraphs'),
      bullets: getOptionalStringArray('termsOfServicePage.sections.watchparty.bullets'),
      note: getOptionalString('termsOfServicePage.sections.watchparty.note'),
    },
    {
      id: 'vip',
      title: t('termsOfServicePage.sections.vip.title'),
      icon: Crown,
      paragraphs: getOptionalStringArray('termsOfServicePage.sections.vip.paragraphs'),
      bullets: getOptionalStringArray('termsOfServicePage.sections.vip.bullets'),
      note: getOptionalString('termsOfServicePage.sections.vip.note'),
    },
    {
      id: 'changes-liability',
      title: t('termsOfServicePage.sections.changesLiability.title'),
      icon: Wrench,
      paragraphs: getOptionalStringArray('termsOfServicePage.sections.changesLiability.paragraphs'),
      bullets: getOptionalStringArray('termsOfServicePage.sections.changesLiability.bullets'),
      note: getOptionalString('termsOfServicePage.sections.changesLiability.note'),
    },
  ];

  return (
    <LegalDocumentPage
      title={t('termsOfServicePage.title')}
      eyebrow={t('termsOfServicePage.eyebrow')}
      lastUpdated={t('termsOfServicePage.lastUpdated')}
      seoTitle={t('termsOfServicePage.seoTitle')}
      seoDescription={t('termsOfServicePage.seoDescription')}
      canonicalPath="/terms-of-service"
      heroIcon={Scale}
      intro={getStringArray('termsOfServicePage.intro')}
      summaryItems={getStringArray('termsOfServicePage.summaryItems')}
      sections={sections}
      supportCard={{
        title: t('termsOfServicePage.supportCard.title'),
        paragraphs: getStringArray('termsOfServicePage.supportCard.paragraphs'),
        actions: [
          { label: t('termsOfServicePage.supportCard.actions.privacy'), to: '/privacy', variant: 'primary' },
          { label: t('termsOfServicePage.supportCard.actions.contact'), href: `mailto:${CONTACT_EMAIL}`, variant: 'ghost' },
          { label: t('termsOfServicePage.supportCard.actions.telegram'), href: TELEGRAM_URL, external: true, variant: 'ghost' },
        ],
      }}
      footerNote={t('termsOfServicePage.footerNote')}
    />
  );
};

export default TermsOfService;
