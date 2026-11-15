// Menu « ⋯ » d'une ligne de l'historique : marquer comme vu (film, épisode,
// saison, série entière) ou retirer de « Vu ». Bouton de 40 px posé
// au-dessus du lien étiré de la ligne (son clic ne relance pas le lecteur) ;
// menu Radix, donc flèches, Entrée et Échap au clavier.

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { MarkAction } from './watchMarks';

interface HistoryRowActionsProps {
  /** Repère du bouton (`data-history-actions`) : l'onglet y pose le focus quand une ligne part. */
  rowKey: string;
  title: string;
  actions: MarkAction[];
  onAction: (action: MarkAction) => void;
  /** « Supprimer de l'historique » (toujours en dernier, après confirmation). */
  onDelete: () => void;
}

export default function HistoryRowActions({ rowKey, title, actions, onAction, onDelete }: HistoryRowActionsProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labels: Record<MarkAction, string> = {
    markMovie: t('profilePage.history.actions.markMovie', 'Marquer comme vu'),
    markEpisode: t('profilePage.history.actions.markEpisode', 'Marquer l’épisode comme vu'),
    markSeason: t('profilePage.history.actions.markSeason', 'Marquer la saison comme vue'),
    markSeries: t('profilePage.history.actions.markSeries', 'Marquer la série comme vue'),
    unmark: t('profilePage.history.actions.unmark', 'Retirer de « Vu »'),
  };
  const menuLabel = t('profilePage.history.actions.menu', { title, defaultValue: 'Actions pour « {{title}} »' });

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          data-history-actions={rowKey}
          aria-label={menuLabel}
          title={menuLabel}
          className="relative z-10 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-[background-color,transform] duration-150 hover:bg-white/10 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 data-[state=open]:bg-white/10 [&_svg]:opacity-70 hover:[&_svg]:opacity-100"
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[14rem]"
        // La ligne a quitté la liste (titre terminé) : Radix rendrait le focus
        // à un bouton disparu, donc à <body>. L'onglet le pose lui-même sur
        // la ligne voisine.
        onCloseAutoFocus={(event) => {
          if (!triggerRef.current?.isConnected) event.preventDefault();
        }}
      >
        {actions.map((action) => (
          <DropdownMenuItem key={action} onSelect={() => onAction(action)} className="min-h-10 px-3 text-[15px]">
            {labels[action]}
          </DropdownMenuItem>
        ))}
        {actions.length > 0 && <DropdownMenuSeparator className="my-1 h-px bg-white/10" />}
        <DropdownMenuItem
          onSelect={onDelete}
          className="min-h-10 gap-2 px-3 text-[15px] text-red-300 hover:bg-red-600/20 focus:bg-red-600/20 focus:text-red-200"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {t('profilePage.history.actions.delete', 'Supprimer de l’historique')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
