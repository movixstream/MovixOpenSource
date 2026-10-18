import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListPlus,
  MessageCircle,
  Shield,
  Unlock,
  Zap,
  type LucideIcon
} from 'lucide-react';

import { cn } from '@/lib/utils';

// Clés `vip.*` déjà traduites, reprises de l'ancienne page VIP. `note` s'affiche
// en italique sous la description.
const PERKS: ReadonlyArray<{ icon: LucideIcon; title: string; description: string; note?: string }> = [
  { icon: Zap, title: 'vip.adFreePlayers', description: 'vip.adFreePlayersDesc' },
  { icon: Shield, title: 'vip.noAdBeforeContent', description: 'vip.noAdBeforeContentDesc' },
  { icon: ListPlus, title: 'vip.priorityRequests', description: 'vip.priorityRequestsDesc' },
  { icon: MessageCircle, title: 'vip.vipCommentTag', description: 'vip.vipCommentTagDesc' },
  {
    icon: Unlock,
    title: 'vip.debridService',
    description: 'vip.debridServiceDesc',
    note: 'vipDonations.donate.perkAvailability'
  }
];

const DonationPerks: React.FC = () => {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="vip-perks-title">
      <h2 id="vip-perks-title" className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
        {t('vipDonations.donate.perksTitle')}
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-white/60">{t('vipDonations.donate.perksSubtitle')}</p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {PERKS.map(({ icon: Icon, title, description, note }, index) => (
          <li
            key={title}
            className={cn(
              'flex gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4',
              // Nombre impair : la dernière carte prend toute la ligne.
              index === PERKS.length - 1 && PERKS.length % 2 === 1 && 'sm:col-span-2'
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-400">
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="font-medium leading-snug text-white">{t(title)}</p>
              <p className="mt-1 text-sm leading-relaxed text-white/60">{t(description)}</p>
              {note && <p className="mt-1 text-xs italic leading-5 text-white/45">{t(note)}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default DonationPerks;
