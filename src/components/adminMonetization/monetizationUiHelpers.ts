import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, PlayCircle, Tv, Zap, type LucideIcon } from 'lucide-react';

import type { PlacementId } from '../../services/monetizationAdminService';
import { formatMonetizationIssue, type MonetizationIssue } from './monetizationForm';

// Fonctions partagées par les composants de l'onglet « Publicités ». Rangées
// hors de MonetizationUi.tsx pour que le rechargement à chaud (fast refresh)
// garde ce fichier-là composé uniquement de composants.

export const useMonetizationText = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  return {
    t,
    locale,
    issueText: (issue: MonetizationIssue | undefined) => formatMonetizationIssue(t, issue, locale),
    modifiedLabel: (modified: boolean) => (modified ? t('admin.monetization.modified') : null)
  };
};

export const PLACEMENT_ICONS: Record<PlacementId, LucideIcon> = {
  player: PlayCircle,
  download: Download,
  livetv: Tv,
  swiftflux: Zap
};

// Une couleur par pub (selon sa place dans la liste), reprise par l'aperçu, la
// liste et le graphique des statistiques. Palette catégorielle vérifiée sur le
// fond sombre de l'admin (écart pour les daltoniens ≥ 8 entre voisines,
// contraste ≥ 3:1) : l'ordre fait partie du réglage, ne pas le mélanger. Au-delà
// de 8 pubs, gris neutre (la lettre garde l'identité), jamais une couleur
// recyclée.
export const AD_SERIES_COLORS = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767'
] as const;
// Pub supprimée ou au-delà de la 8e.
export const AD_NEUTRAL_COLOR = '#6b6b66';

export const getAdColor = (index: number): string => (
  index >= 0 && index < AD_SERIES_COLORS.length ? AD_SERIES_COLORS[index] : AD_NEUTRAL_COLOR
);

const relativeLuminance = (hex: string) => {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

// Lettre lisible sur la pastille : blanc ou presque noir, le plus contrasté.
export const getAdColorStyle = (index: number): { backgroundColor: string; color: string } => {
  const backgroundColor = getAdColor(index);
  const luminance = relativeLuminance(backgroundColor);
  const onWhite = 1.05 / (luminance + 0.05);
  const onInk = (luminance + 0.05) / 0.0534;
  return { backgroundColor, color: onWhite >= onInk ? '#ffffff' : '#0b0b0b' };
};

// Garde le texte tapé tant que sa valeur analysée ne change pas, et se
// resynchronise quand la valeur change de l'extérieur (annulation, défauts).
export function useSyncedText<T>(value: T, format: (value: T) => string, parse: (text: string) => T) {
  const [text, setText] = useState(() => format(value));

  useEffect(() => {
    setText((current) => (JSON.stringify(parse(current)) === JSON.stringify(value) ? current : format(value)));
    // `format` et `parse` sont des fonctions pures passées à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return [text, setText] as const;
}

export const formatInteger = (locale: string, value: number) => {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
};
