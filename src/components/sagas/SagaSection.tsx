import React from 'react';
import { cn } from '@/lib/utils';

interface SagaSectionProps {
  title: string;
  /** Lien ou réglages alignés à droite du titre. */
  aside?: React.ReactNode;
  /** Première section sous la grande image : marge du haut plus courte. */
  first?: boolean;
  children: React.ReactNode;
}

/** Section de la page d'une collection : titre, éventuel contrôle à droite, contenu. */
export const SagaSection: React.FC<SagaSectionProps> = ({ title, aside, first = false, children }) => (
  <section className={cn('pt-[34px]', first ? 'md:pt-10' : 'md:pt-16 2xl:pt-20')}>
    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 md:mb-[22px]">
      <h2 className="text-xl font-bold leading-[1.2] tracking-[-0.01em] text-white md:text-2xl md:leading-[1.2] 2xl:text-[28px]">
        {title}
      </h2>
      {aside}
    </div>
    {children}
  </section>
);
