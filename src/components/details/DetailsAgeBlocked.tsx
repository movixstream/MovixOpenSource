import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getClassificationLabel } from '@/utils/certificationUtils';
import { DetailsButton } from './DetailsButton';

export interface DetailsAgeBlockedProps {
  /** Classification du contenu (`FR` ou `US`). */
  certification: string;
  /** Âge maximal autorisé par le profil courant. */
  ageRestriction: number;
}

/**
 * Écran qui remplace la fiche quand le profil n'a pas l'âge du contenu. Sans
 * image : il remet lui-même la marge haute (`pt-20`).
 */
export function DetailsAgeBlocked({ certification, ageRestriction }: DetailsAgeBlockedProps): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 pb-10 pt-20">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-600/20">
          <Lock aria-hidden="true" className="h-10 w-10 text-red-500" />
        </div>
        <h2 className="mb-3 text-2xl font-bold text-white">{t('details.contentBlocked')}</h2>
        <p className="mb-6 text-white/60">
          {t('details.contentBlockedDesc', { rating: getClassificationLabel(certification, t), age: ageRestriction })}
        </p>
        <DetailsButton variant="primary" size="compact" onClick={() => navigate(-1)}>
          {t('details.goBack')}
        </DetailsButton>
      </div>
    </div>
  );
}
