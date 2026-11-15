// Confirmation de « Supprimer de l'historique », sur le Dialog Radix du
// projet (comme la bulle « estimé ») : focus posé sur « Annuler » à
// l'ouverture, Échap et clic à l'extérieur ferment, mais pas pendant la
// requête ; Radix rend le focus en fermant (l'onglet choisit où, voir
// onCloseAutoFocus).

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from './ui';

interface DeleteTitleDialogProps {
  open: boolean;
  /** Titre affiché dans la question (repli déjà appliqué). */
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

export default function DeleteTitleDialog({ open, title, busy, onCancel, onConfirm, onCloseAutoFocus }: DeleteTitleDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const blockWhileBusy = (event: Event) => {
    if (busy) event.preventDefault();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent
        className="max-w-md border-0 bg-gray-900 backdrop-blur-none"
        onOpenAutoFocus={(event) => {
          // Action définitive : le focus part sur « Annuler », pas sur « Supprimer ».
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onEscapeKeyDown={blockWhileBusy}
        onPointerDownOutside={blockWhileBusy}
        onInteractOutside={blockWhileBusy}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle className="flex items-start gap-3 pr-6">
            <span className="shrink-0 rounded-full bg-red-500/15 p-2 ring-1 ring-red-500/30">
              <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden="true" />
            </span>
            <span className="pt-1.5">
              {t('profilePage.history.delete.title', { title, defaultValue: 'Supprimer « {{title}} » de l’historique ?' })}
            </span>
          </DialogTitle>
          <DialogDescription className="pt-2 text-[15px] leading-relaxed text-white/70">
            {t('profilePage.history.delete.message', 'Sa progression, ses épisodes vus et ses marques « Déjà vu » seront effacés. Ça impactera aussi tes statistiques (temps visionné). Cette action est définitive.')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={busy ? undefined : onCancel} aria-disabled={busy || undefined}>
            {t('profilePage.history.delete.cancel', 'Annuler')}
          </Button>
          <Button variant="primary" onClick={onConfirm} pending={busy}>
            {t('profilePage.history.delete.confirm', 'Supprimer')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
