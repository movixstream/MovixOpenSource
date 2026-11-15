import React from 'react';

import { cn } from '@/lib/utils';

// Logos Bitcoin et Litecoin de l'ancienne page de don (images Wikimedia).
export const CRYPTO_LOGO_URLS = {
  btc: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/1280px-Bitcoin.svg.png',
  ltc: 'https://upload.wikimedia.org/wikipedia/commons/f/f8/LTC-400.png'
} as const;

export type CryptoLogoCoin = keyof typeof CRYPTO_LOGO_URLS;

// Décoratif : le nom du moyen est toujours écrit à côté.
export const CryptoLogo: React.FC<{ coin: CryptoLogoCoin; className?: string }> = ({ coin, className }) => (
  <img
    src={CRYPTO_LOGO_URLS[coin]}
    alt=""
    aria-hidden="true"
    loading="lazy"
    decoding="async"
    draggable={false}
    className={cn('object-contain', className)}
  />
);

// Carte cadeau : une carte barrée d'un ruban et de son nœud, au même trait que
// les icônes lucide.
export const GiftCardIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <rect x="2" y="7" width="20" height="13" rx="2" />
    <path d="M2 12h20" />
    <path d="M12 12c-1.4-2.6-4.3-3.6-4.3-1.6 0 1.3 2.3 1.6 4.3 1.6" />
    <path d="M12 12c1.4-2.6 4.3-3.6 4.3-1.6 0 1.3-2.3 1.6-4.3 1.6" />
    <path d="m12 12-2.3 3" />
    <path d="m12 12 2.3 3" />
  </svg>
);
