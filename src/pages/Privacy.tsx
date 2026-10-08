import {
  Cloud,
  Crown,
  Database,
  MessageSquare,
  Settings,
  Shield,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LegalDocumentPage, { LegalSection } from '../components/legal/LegalDocumentPage';

const CONTACT_EMAIL = 'movixstreaming@gmail.com';
const TELEGRAM_URL = 'https://t.me/ix_annonces';

const Privacy = () => {
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
      id: 'local-storage',
      title: t('privacyPolicyPage.sections.localStorage.title'),
      icon: Database,
      paragraphs: getOptionalStringArray('privacyPolicyPage.sections.localStorage.paragraphs'),
      bullets: getOptionalStringArray('privacyPolicyPage.sections.localStorage.bullets'),
      note: getOptionalString('privacyPolicyPage.sections.localStorage.note'),
    },
    {
      id: 'accounts-sync',
      title: t('privacyPolicyPage.sections.accountsSync.title'),
      icon: Users,
      paragraphs: getOptionalStringArray('privacyPolicyPage.sections.accountsSync.paragraphs'),
      bullets: getOptionalStringArray('privacyPolicyPage.sections.accountsSync.bullets'),
      note: getOptionalString('privacyPolicyPage.sections.accountsSync.note'),
    },
    {
      id: 'usage-history',
      title: t('privacyPolicyPage.sections.usageHistory.title'),
      icon: Cloud,
      paragraphs: getOptionalStringArray('privacyPolicyPage.sections.usageHistory.paragraphs'),
      bullets: getOptionalStringArray('privacyPolicyPage.sections.usageHistory.bullets'),
      note: getOptionalString('privacyPolicyPage.sections.usageHistory.note'),
    },
    {
      id: 'community-watchparty',
      title: t('privacyPolicyPage.sections.communityWatchparty.title'),
      icon: MessageSquare,
      paragraphs: getOptionalStringArray('privacyPolicyPage.sections.communityWatchparty.paragraphs'),
      bullets: getOptionalStringArray('privacyPolicyPage.sections.communityWatchparty.bullets'),
      note: getOptionalString('privacyPolicyPage.sections.communityWatchparty.note'),
    },
    {
      id: 'security-support',
      title: t('privacyPolicyPage.sections.securitySupport.title'),
      icon: ShieldCheck,
      paragraphs: getOptionalStringArray('privacyPolicyPage.sections.securitySupport.paragraphs'),
      bullets: getOptionalStringArray('privacyPolicyPage.sections.securitySupport.bullets'),
      note: getOptionalString('privacyPolicyPage.sections.securitySupport.note'),
    },
    {
      id: 'third-parties',
      title: t('privacyPolicyPage.sections.thirdParties.title'),
      icon: Crown,
      paragraphs: getOptionalStringArray('privacyPolicyPage.sections.thirdParties.paragraphs'),
      bullets: getOptionalStringArray('privacyPolicyPage.sections.thirdParties.bullets'),
      note: getOptionalString('privacyPolicyPage.sections.thirdParties.note'),
    },
    {
      id: 'controls-contact',
      title: t('privacyPolicyPage.sections.controlsContact.title'),
      icon: Settings,
      paragraphs: getOptionalStringArray('privacyPolicyPage.sections.controlsContact.paragraphs'),
      bullets: getOptionalStringArray('privacyPolicyPage.sections.controlsContact.bullets'),
      note: getOptionalString('privacyPolicyPage.sections.controlsContact.note'),
    },
  ];

  return (
    <LegalDocumentPage
      title={t('privacyPolicyPage.title')}
      eyebrow={t('privacyPolicyPage.eyebrow')}
      lastUpdated={t('privacyPolicyPage.lastUpdated')}
      seoTitle={t('privacyPolicyPage.seoTitle')}
      seoDescription={t('privacyPolicyPage.seoDescription')}
      canonicalPath="/privacy"
      heroIcon={Shield}
      intro={getStringArray('privacyPolicyPage.intro')}
      summaryItems={getStringArray('privacyPolicyPage.summaryItems')}
      sections={sections}
      supportCard={{
        title: t('privacyPolicyPage.supportCard.title'),
        paragraphs: getStringArray('privacyPolicyPage.supportCard.paragraphs'),
        actions: [
          { label: t('privacyPolicyPage.supportCard.actions.settings'), to: '/settings', variant: 'primary' },
          { label: t('privacyPolicyPage.supportCard.actions.terms'), to: '/terms-of-service', variant: 'secondary' },
          { label: t('privacyPolicyPage.supportCard.actions.email'), href: `mailto:${CONTACT_EMAIL}`, variant: 'ghost' },
          { label: t('privacyPolicyPage.supportCard.actions.telegram'), href: TELEGRAM_URL, external: true, variant: 'ghost' },
        ],
      }}
      footerNote={t('privacyPolicyPage.footerNote')}
    />
  );
};

export default Privacy;
