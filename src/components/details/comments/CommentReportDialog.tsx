import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { DetailsButton } from '../DetailsButton';
import { DETAILS_PRESS } from '../layout';

export interface CommentReportReason {
  value: string;
  label: string;
}

export interface CommentReportDialogProps {
  open: boolean;
  onClose: () => void;
  reasons: CommentReportReason[];
  reason: string;
  onReasonChange: (reason: string) => void;
  details: string;
  onDetailsChange: (details: string) => void;
  submitting: boolean;
  onSubmit: () => void;
}

/** Fenêtre de signalement d'un commentaire ou d'une réponse : un motif, puis un détail libre. */
export function CommentReportDialog({
  open, onClose, reasons, reason, onReasonChange, details, onDetailsChange, submitting, onSubmit,
}: CommentReportDialogProps) {
  const { t } = useTranslation();
  const title = t('comments.reportTitle');

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-md flex-col gap-0 overflow-y-auto border-white/10 bg-gray-900 backdrop-blur-none"
      >
        <DialogTitle className="mb-4 pr-8 text-xl leading-tight">{title}</DialogTitle>
        <div role="radiogroup" aria-label={title} className="mb-3 grid gap-2">
          {reasons.map((option) => {
            const selected = option.value === reason;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onReasonChange(option.value)}
                className={cn(
                  'flex min-h-11 items-center justify-between gap-3 rounded-xl border px-4 text-left text-sm font-medium',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                  DETAILS_PRESS,
                  selected
                    ? 'border-white/40 bg-white/[.14] text-white'
                    : 'border-white/10 bg-white/[.04] text-white/80 hover:bg-white/10 hover:text-white',
                )}
              >
                {option.label}
                {selected && <Check aria-hidden="true" className="size-4 flex-none text-white" />}
              </button>
            );
          })}
        </div>
        {/* 16 px sous 640 px : en dessous, Safari sur iPhone zoome dans le champ. */}
        <textarea
          value={details}
          onChange={(event) => onDetailsChange(event.target.value.slice(0, 500))}
          placeholder={t('comments.reportDetailsPlaceholder')}
          aria-label={t('comments.reportDetailsPlaceholder')}
          rows={3}
          className="mb-5 block w-full flex-none resize-none rounded-xl border border-white/[.12] bg-white/[.04] px-4 py-3 text-base text-white transition-colors duration-200 placeholder:text-white/45 focus:border-white/30 focus:outline-none focus:ring-0 motion-reduce:transition-none sm:text-sm"
        />
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <DetailsButton size="compact" onClick={onClose}>{t('common.cancel')}</DetailsButton>
          <DetailsButton size="compact" variant="primary" disabled={!reason || submitting} onClick={onSubmit}>
            {submitting ? t('common.loading') : t('comments.reportSubmit')}
          </DetailsButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CommentReportDialog;
