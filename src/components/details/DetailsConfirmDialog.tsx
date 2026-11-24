import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DetailsButton } from './DetailsButton';

export interface DetailsConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Ligne mise en avant sous le titre (libellé de sortie, date de diffusion). */
  highlight?: ReactNode;
  /** Texte d'explication. */
  description: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  /** Appelé au clic sur le bouton rouge ; la fenêtre se ferme d'elle-même. */
  onConfirm: () => void;
}

/**
 * Fenêtre « continuer quand même » : avertissement avant de lancer une lecture
 * incertaine (film pas encore sorti hors cinéma, épisode à venir).
 */
export function DetailsConfirmDialog({
  open, onOpenChange, title, highlight, description, cancelLabel, confirmLabel, onConfirm,
}: DetailsConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-md flex-col gap-0 overflow-y-auto border-white/10 bg-gray-900 backdrop-blur-none">
        <DialogTitle className="mb-2 pr-8 text-xl leading-tight">{title}</DialogTitle>
        {highlight && <p className="mb-3 text-[15px] font-medium text-white">{highlight}</p>}
        <DialogDescription className="mb-6 text-[15px] leading-relaxed text-white/70">{description}</DialogDescription>
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <DetailsButton size="compact" onClick={() => onOpenChange(false)}>{cancelLabel}</DetailsButton>
          <DetailsButton
            size="compact"
            variant="primary"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </DetailsButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DetailsConfirmDialog;
