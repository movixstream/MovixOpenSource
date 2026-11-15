import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clapperboard,
  Flag,
  HandCoins,
  HelpCircle,
  KeyRound,
  Link2,
  ListOrdered,
  MessageSquare,
  Plug,
  ShieldCheck,
  Sparkles,
  Sprout,
  Users,
  Wrench
} from 'lucide-react';

import AdminComments from './AdminComments';
import AdminHelpFeedback from './AdminHelpFeedback';
import AdminLinkSubmissions from './Greenlight/AdminLinkSubmissions';
import AdminWishboard from './Greenlight/AdminWishboard';
import AdminOAuthApps from './AdminOAuthApps';
import AdminReports from './AdminReports';
import AdminSharedLists from './AdminSharedLists';
import AdminTeam from './AdminTeam';
import AdminVipDonationSettings from './AdminVipDonationSettings';
import StreamingLinksManager from './StreamingLinksManager';
import VipInvoicesManager from './VipInvoicesManager';
import VipKeysManager from './VipKeysManager';
import AnimatedBorderCard from './ui/animated-border-card';
import ShinyText from './ui/shiny-text';

type AdminSection =
  | 'links'
  | 'vip-keys'
  | 'vip-invoices'
  | 'vip-donation-settings'
  | 'oauth-apps'
  | 'wishboard'
  | 'link-submissions'
  | 'comments'
  | 'shared-lists'
  | 'reports'
  | 'help-feedback'
  | 'team';

interface AdminDashboardProps {
  role: 'admin' | 'uploader';
}

interface DashboardSection {
  id: AdminSection;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  highlight: string;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ role }) => {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<AdminSection>('links');

  const allSections = useMemo<DashboardSection[]>(
    () => [
      {
        id: 'team',
        title: t('admin.team.cardTitle', 'Admins & Uploaders'),
        description: t('admin.team.cardDesc', 'Gérer l\'équipe, ajouter des uploaders et voir leur historique'),
        icon: Users,
        accent: 'text-sky-300',
        highlight: '56 189 248'
      },
      {
        id: 'links',
        title: t('admin.manageMoviesSeries'),
        description: t('admin.manageStreamingLinksDesc'),
        icon: Clapperboard,
        accent: 'text-blue-300',
        highlight: '59 130 246'
      },
      {
        id: 'vip-keys',
        title: t('admin.manageVipKeys'),
        description: t('admin.manageVipKeysDesc'),
        icon: KeyRound,
        accent: 'text-emerald-300',
        highlight: '16 185 129'
      },
      {
        id: 'vip-invoices',
        title: t('vipDonations.admin.dashboardTitle'),
        description: t('vipDonations.admin.dashboardDescription'),
        icon: Sparkles,
        accent: 'text-yellow-300',
        highlight: '234 179 8'
      },
      {
        id: 'vip-donation-settings',
        title: t('vipDonations.settings.dashboardTitle'),
        description: t('vipDonations.settings.dashboardDescription'),
        icon: HandCoins,
        accent: 'text-amber-300',
        highlight: '245 158 11'
      },
      {
        id: 'oauth-apps',
        title: t('adminOauthApps.cardTitle'),
        description: t('adminOauthApps.cardDesc'),
        icon: Plug,
        accent: 'text-purple-300',
        highlight: '168 85 247'
      },
      {
        id: 'wishboard',
        title: t('admin.wishboardGreenlight'),
        description: t('admin.manageContentRequests'),
        icon: Sprout,
        accent: 'text-red-300',
        highlight: '239 68 68'
      },
      {
        id: 'link-submissions',
        title: t('admin.submittedLinks'),
        description: t('admin.reviewSubmittedLinksDesc'),
        icon: Link2,
        accent: 'text-teal-300',
        highlight: '20 184 166'
      },
      {
        id: 'comments',
        title: t('admin.manageComments'),
        description: t('admin.manageCommentsDesc'),
        icon: MessageSquare,
        accent: 'text-fuchsia-300',
        highlight: '217 70 239'
      },
      {
        id: 'shared-lists',
        title: t('admin.sharedLists'),
        description: t('admin.manageSharedListsDesc'),
        icon: ListOrdered,
        accent: 'text-orange-300',
        highlight: '249 115 22'
      },
      {
        id: 'reports',
        title: t('admin.reports', 'Signalements'),
        description: t('admin.manageReportsDesc', 'Gérer les signalements de commentaires et listes'),
        icon: Flag,
        accent: 'text-rose-300',
        highlight: '244 63 94'
      },
      {
        id: 'help-feedback',
        title: t('admin.helpFeedback.sectionTitle'),
        description: t('admin.helpFeedback.sectionDesc'),
        icon: HelpCircle,
        accent: 'text-sky-300',
        highlight: '56 189 248'
      }
    ],
    [t]
  );

  const sections = useMemo(() => {
    if (role === 'uploader') {
      return allSections.filter((section) => (
        section.id === 'links'
        || section.id === 'wishboard'
        || section.id === 'link-submissions'
      ));
    }

    return allSections;
  }, [allSections, role]);

  const activeSectionMeta = sections.find((section) => section.id === activeSection) || sections[0];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center rounded-full bg-white/5 p-3 ring-1 ring-white/10 mb-4">
          <Wrench className="h-7 w-7 text-white" />
        </div>
        <div className="mb-2 flex justify-center">
          <ShinyText
            text={role === 'uploader' ? t('admin.uploaderSpace') : t('admin.movixAdministration')}
            speed={2}
            color="#ffffff"
            shineColor="#fbbf24"
            className="text-4xl font-bold"
          />
        </div>
        <p className="text-lg text-gray-400">
          {role === 'uploader'
            ? t('admin.streamingLinksManagement')
            : t('admin.adminInterface')}
        </p>
      </div>

      {sections.length > 1 && (
        <div className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;

            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className="text-left"
              >
                <AnimatedBorderCard
                  highlightColor={section.highlight}
                  backgroundColor="10 10 10"
                  className={`h-full p-5 transition-all ${
                    isActive
                      ? 'scale-[1.02] shadow-[0_18px_45px_rgba(0,0,0,0.22)]'
                      : 'opacity-90 hover:opacity-100'
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                        <Icon className={`h-6 w-6 ${section.accent}`} />
                      </div>
                      {isActive && (
                        <span className="inline-flex h-3 w-3 rounded-full bg-white/80" aria-hidden="true">
                        </span>
                      )}
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-white">{section.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-white/52">{section.description}</p>
                    </div>
                  </div>
                </AnimatedBorderCard>
              </button>
            );
          })}
        </div>
      )}

      {activeSection === 'vip-invoices' && role === 'admin' ? (
        <div>
          <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
            <ShieldCheck className="h-6 w-6 text-yellow-300" />
            {t('vipDonations.admin.dashboardTitle')}
          </h2>
          <VipInvoicesManager />
        </div>
      ) : (
        <AnimatedBorderCard
          highlightColor={activeSectionMeta?.highlight || '234 179 8'}
          backgroundColor="10 10 10"
          className="p-6 md:p-7"
        >
          {activeSection === 'team' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Users className="h-6 w-6 text-sky-300" />
                {t('admin.team.cardTitle', 'Admins & Uploaders')}
              </h2>
              <AdminTeam />
            </div>
          )}

          {activeSection === 'links' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Clapperboard className="h-6 w-6 text-blue-300" />
                {t('admin.manageMoviesSeries')}
              </h2>
              <StreamingLinksManager />
            </div>
          )}

          {activeSection === 'vip-keys' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <KeyRound className="h-6 w-6 text-emerald-300" />
                {t('admin.manageVipKeys')}
              </h2>
              <VipKeysManager />
            </div>
          )}

          {activeSection === 'vip-donation-settings' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <HandCoins className="h-6 w-6 text-amber-300" />
                {t('vipDonations.settings.dashboardTitle')}
              </h2>
              <AdminVipDonationSettings />
            </div>
          )}

          {activeSection === 'wishboard' && (role === 'admin' || role === 'uploader') && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Sprout className="h-6 w-6 text-red-300" />
                {t('admin.wishboardGreenlight')}
              </h2>
              <AdminWishboard />
            </div>
          )}

          {activeSection === 'link-submissions' && (role === 'admin' || role === 'uploader') && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Link2 className="h-6 w-6 text-teal-300" />
                {t('admin.userSubmittedLinks')}
              </h2>
              <AdminLinkSubmissions />
            </div>
          )}

          {activeSection === 'comments' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <MessageSquare className="h-6 w-6 text-fuchsia-300" />
                {t('admin.manageComments')}
              </h2>
              <AdminComments />
            </div>
          )}

          {activeSection === 'shared-lists' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <ListOrdered className="h-6 w-6 text-orange-300" />
                {t('admin.sharedLists')}
              </h2>
              <AdminSharedLists />
            </div>
          )}

          {activeSection === 'reports' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Flag className="h-6 w-6 text-rose-300" />
                {t('admin.reports', 'Signalements')}
              </h2>
              <AdminReports />
            </div>
          )}

          {activeSection === 'help-feedback' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <HelpCircle className="h-6 w-6 text-sky-300" />
                {t('admin.helpFeedback.sectionTitle')}
              </h2>
              <AdminHelpFeedback />
            </div>
          )}

          {activeSection === 'oauth-apps' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Plug className="h-6 w-6 text-purple-300" />
                {t('adminOauthApps.cardTitle')}
              </h2>
              <AdminOAuthApps />
            </div>
          )}
        </AnimatedBorderCard>
      )}
    </div>
  );
};

export default AdminDashboard;
