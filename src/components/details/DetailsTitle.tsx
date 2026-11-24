import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface DetailsTitleProps {
  /** Titre affiché en texte, et texte alternatif du logo. */
  title: string;
  /** Logo TMDB du titre ; absent ou en erreur, le titre s'écrit en texte. */
  logoUrl?: string | null;
  className?: string;
}

/** Titre de la fiche : logo TMDB s'il existe, sinon `h1` en texte. */
export function DetailsTitle({ title, logoUrl, className }: DetailsTitleProps) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  useEffect(() => { setFailedLogo(null); }, [logoUrl]);
  const showLogo = Boolean(logoUrl) && failedLogo !== logoUrl;

  return (
    <h1 className={cn('min-w-0', className)}>
      {showLogo ? (
        <img
          src={logoUrl ?? undefined}
          alt={title}
          draggable={false}
          decoding="async"
          onError={() => setFailedLogo(logoUrl ?? null)}
          className="block h-auto max-h-[86px] w-auto max-w-[270px] object-contain object-left md:max-h-[120px] md:max-w-[min(440px,70vw)] 2xl:max-h-[150px] 2xl:max-w-[560px]"
        />
      ) : (
        <span className="block text-balance text-3xl font-bold leading-[1.1] tracking-[-0.01em] text-white md:text-5xl 2xl:text-6xl">
          {title}
        </span>
      )}
    </h1>
  );
}

export default DetailsTitle;
