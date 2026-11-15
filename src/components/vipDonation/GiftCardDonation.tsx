import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AtSign,
  Copy,
  ExternalLink,
  Hash,
  Mail,
  MessageCircle,
  Send,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { VIP_GIFT_CARD_IDS, type VipDonationSettings } from '@/services/vipDonationsService';
import { copyText } from '@/utils/clipboard';
import { VIP_GIFT_CARD_NAMES } from '@/utils/vipDonationsUi';
import {
  formatDonationAmount,
  getDonationContacts,
  getDonationRule,
  getVipDurationForAmount,
  isSafeExternalUrl,
  type DonationContactId
} from './donationUtils';

interface GiftCardDonationProps {
  settings: VipDonationSettings;
  // Montant choisi plus haut, repris dans l'exemple (null s'il est invalide).
  exampleAmount: number | null;
}

const CONTACT_COPY: Record<DonationContactId, { icon: LucideIcon; label: string }> = {
  email: { icon: Mail, label: 'vipDonations.donate.giftCard.contacts.email' },
  discord: { icon: MessageCircle, label: 'vipDonations.donate.giftCard.contacts.discord' },
  telegram: { icon: Send, label: 'vipDonations.donate.giftCard.contacts.telegram' },
  matrixUser: { icon: AtSign, label: 'vipDonations.donate.giftCard.contacts.matrixUser' },
  matrixRoom: { icon: Hash, label: 'vipDonations.donate.giftCard.contacts.matrixRoom' }
};

const StepTitle: React.FC<{ index: number; title: string }> = ({ index, title }) => (
  <h3 className="flex items-center gap-2.5 text-sm font-semibold text-white">
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yellow-400/15 text-xs font-semibold text-yellow-300"
    >
      {index}
    </span>
    {title}
  </h3>
);

const GiftCardDonation: React.FC<GiftCardDonationProps> = ({ settings, exampleAmount }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'fr';

  const rule = getDonationRule(t, locale, settings);
  const exampleDuration = exampleAmount !== null
    ? getVipDurationForAmount(t, exampleAmount, settings.eurosPerVipYear)
    : null;

  const cards = VIP_GIFT_CARD_IDS
    .filter((id) => settings.giftCards[id]?.enabled)
    .map((id) => {
      const url = settings.giftCards[id].url.trim();
      return { id, name: VIP_GIFT_CARD_NAMES[id], url: isSafeExternalUrl(url) ? url : null };
    });

  const contacts = useMemo(() => getDonationContacts(settings.contacts, {
    subject: t('vipDonations.donate.giftCard.mailSubject'),
    body: t('vipDonations.donate.giftCard.mailBody')
  }), [settings.contacts, t]);

  const handleCopy = async (value: string) => {
    if (await copyText(value)) {
      toast.success(t('common.copied'));
    } else {
      toast.error(t('vipDonations.common.copyFailed'));
    }
  };

  return (
    <div className="space-y-7">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 text-sm leading-6 text-white/70">
        <p>{t('vipDonations.donate.giftCard.lead')}</p>
        {rule && (
          <p className="mt-2">{t('vipDonations.donate.giftCard.rule', { rule })}</p>
        )}
        {exampleAmount !== null && exampleDuration && (
          <p className="mt-1 font-medium text-yellow-100">
            {t('vipDonations.donate.giftCard.example', {
              amount: formatDonationAmount(locale, exampleAmount),
              duration: exampleDuration
            })}
          </p>
        )}
      </div>

      <ol className="space-y-7">
        <li>
          <StepTitle index={1} title={t('vipDonations.donate.giftCard.step1Title')} />
          <p className="mt-1.5 text-sm leading-6 text-white/60">{t('vipDonations.donate.giftCard.step1Text')}</p>
          {cards.length > 0 && (
            <ul className="mt-3 grid grid-cols-2 gap-2">
              {cards.map((card) => (
                <li
                  key={card.id}
                  className="flex min-w-0 flex-col justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3"
                >
                  <span className="truncate text-sm font-medium text-white">{card.name}</span>
                  {card.url && (
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('vipDonations.donate.giftCard.buyAria', { name: card.name })}
                      className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-yellow-300 transition-colors hover:text-yellow-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60"
                    >
                      {t('vipDonations.donate.giftCard.buy')}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>

        <li>
          <StepTitle index={2} title={t('vipDonations.donate.giftCard.step2Title')} />
          <p className="mt-1.5 text-sm leading-6 text-white/60">{t('vipDonations.donate.giftCard.step2Text')}</p>
          {contacts.length > 0 && (
            <ul className="mt-3 divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-white/[0.02]">
              {contacts.map((contact) => {
                const Icon = CONTACT_COPY[contact.id].icon;
                const label = t(CONTACT_COPY[contact.id].label);
                const isEmail = contact.id === 'email';
                return (
                  <li key={contact.id} className="flex items-center gap-3 px-3.5 py-3">
                    {/* Couleur pleine + opacité sur les icônes : une couleur
                        translucide éclaircit les croisements de leurs traits. */}
                    <Icon className="h-4 w-4 shrink-0 text-white opacity-50" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white/55">{label}</p>
                      <p className="break-all text-sm font-medium text-white">{contact.value}</p>
                      {contact.id === 'matrixRoom' && (
                        <p className="mt-0.5 text-xs leading-5 text-white/55">
                          {t('vipDonations.donate.giftCard.contacts.matrixRoomHint')}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleCopy(contact.value)}
                        aria-label={t('vipDonations.donate.giftCard.copyAria', { value: contact.value })}
                        title={t('common.copy')}
                        className="group flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60"
                      >
                        <Copy className="h-4 w-4 text-white opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                      </button>
                      {contact.href && (
                        <a
                          href={contact.href}
                          {...(isEmail ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                          aria-label={isEmail
                            ? t('vipDonations.donate.giftCard.writeAria')
                            : t('vipDonations.donate.giftCard.openAria', { label })}
                          className="group inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs font-medium text-white/80 transition-colors hover:border-yellow-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60"
                        >
                          {isEmail
                            ? <Mail className="h-3.5 w-3.5 text-white opacity-80 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                            : <ExternalLink className="h-3.5 w-3.5 text-white opacity-80 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
                          {/* Icône seule sur les petits téléphones : le pseudo garde la place. */}
                          <span className="hidden min-[400px]:inline">
                            {isEmail ? t('vipDonations.donate.giftCard.write') : t('vipDonations.donate.giftCard.open')}
                          </span>
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </li>

        <li>
          <StepTitle index={3} title={t('vipDonations.donate.giftCard.step3Title')} />
          <p className="mt-1.5 text-sm leading-6 text-white/60">{t('vipDonations.donate.giftCard.step3Text')}</p>
        </li>
      </ol>

      <div
        role="note"
        className="flex gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/[0.06] p-3.5 text-xs leading-5 text-yellow-50/80"
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" aria-hidden="true" />
        <p>{t('vipDonations.donate.giftCard.safety')}</p>
      </div>
    </div>
  );
};

export default GiftCardDonation;
