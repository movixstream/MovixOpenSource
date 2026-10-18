// Avancement « ≈ 47 % · estimé » des lecteurs qui n'enregistrent pas la
// position, et la bulle qui explique ce calcul. Partagés par la grille
// « En cours » et l'onglet « Historique » du profil.

import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from './ui';

interface EstimatedProgressButtonProps {
  percent: number;
  onClick: () => void;
  className?: string;
}

/**
 * « ≈ 47 % · estimé » souligné en pointillés ; ouvre l'explication. Zone de
 * clic agrandie (≥ 32 px de haut) par un padding compensé par des marges
 * négatives : la mise en page ne bouge pas, et un doigt un peu à côté
 * touche encore le bouton plutôt que la ligne qui le porte.
 */
export function EstimatedProgressButton({ percent, onClick, className = '' }: EstimatedProgressButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group/estimate -mx-1.5 -my-2 inline-flex min-h-[32px] items-center gap-1 rounded-md px-1.5 py-2 underline decoration-dotted underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${className}`}
      aria-haspopup="dialog"
    >
      {t('profilePage.progress.estimated', { percent, defaultValue: '≈ {{percent}} % · estimé' })}
      <Info className="h-3.5 w-3.5 shrink-0 text-white opacity-60 group-hover/estimate:opacity-100" aria-hidden="true" />
    </button>
  );
}

/** Explication de l'avancement estimé (une seule par liste). */
export function EstimateInfoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-0 bg-gray-900 backdrop-blur-none">
        <DialogHeader>
          <DialogTitle>{t('profilePage.estimate.title', 'Pourquoi « estimé » ?')}</DialogTitle>
          <DialogDescription className="pt-2 text-[15px] leading-relaxed text-white/70">
            {t('profilePage.estimate.intro', 'Certains lecteurs n’enregistrent pas où tu t’es arrêté. Pour ces films, on calcule un avancement approximatif :')}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-[15px] leading-relaxed text-white/80">
          <li>{t('profilePage.estimate.how', 'le temps que tu as passé sur la page du film, divisé par sa durée.')}</li>
          <li>{t('profilePage.estimate.limit', 'Ce temps compte aussi les pauses, les pubs et le choix de la source : le chiffre est souvent un peu trop haut.')}</li>
          <li>{t('profilePage.estimate.rewatch', 'Si tu as déjà vu le film, les visionnages s’additionnent.')}</li>
        </ul>
        <p className="text-sm text-white/55">
          {t('profilePage.estimate.tip', 'Avec le lecteur Movix (HLS), l’avancement est exact.')}
        </p>
        <div className="flex justify-end">
          <Button variant="light" onClick={() => onOpenChange(false)}>{t('profilePage.estimate.ok', 'Compris')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
