import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DetailsSelect } from './DetailsSelect';

export interface DetailsLanguageOption {
  /** Code TMDB, `no-text` ou `all`. */
  code: string;
  label: string;
  count: number;
}

export interface DetailsLanguageSelectProps {
  value: string;
  /** Première ligne : « Toutes les langues », puis les langues déjà triées. */
  options: DetailsLanguageOption[];
  onChange: (code: string) => void;
  className?: string;
}

/**
 * Liste des langues de la galerie d'images : le menu des fiches
 * (`DetailsSelect`), filtrable par nom ou par code de langue.
 */
export function DetailsLanguageSelect({ value, options, onChange, className }: DetailsLanguageSelectProps) {
  const { t } = useTranslation();
  return (
    <DetailsSelect
      value={value}
      options={options.map((option) => ({
        value: option.code,
        label: option.label,
        count: option.count,
        pinned: option.code === 'all',
        keywords: [option.code],
      }))}
      onChange={onChange}
      placeholder={options[0]?.label ?? ''}
      searchLabel={t('details.searchLanguage')}
      emptyLabel={t('details.noLanguageFound')}
      icon={<Languages aria-hidden="true" className="size-4 flex-none opacity-80" />}
      className={className}
    />
  );
}

export default DetailsLanguageSelect;
