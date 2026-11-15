import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  resolveHeroPromoAsset,
  uploadHeroPromoImage,
  type HeroPromoImageKind
} from '../../services/heroPromoService';
import { SettingsField, invalidInputClass, settingsInputClass } from '../adminVipDonations/SettingsUi';
import { Input } from '../ui/input';

interface HeroPromoImageFieldProps {
  id: string;
  label: string;
  hint: string;
  kind: HeroPromoImageKind;
  value: string;
  error?: string | null;
  onChange: (next: string) => void;
}

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/avif,image/gif';

// Image d'une promo : envoi d'un fichier (réduit et converti par le
// navigateur) ou lien https:// collé à la main, avec miniature.
const HeroPromoImageField: React.FC<HeroPromoImageFieldProps> = ({ id, label, hint, kind, value, error, onChange }) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewUrl = value ? resolveHeroPromoAsset(value.trim()) : '';

  const upload = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const path = await uploadHeroPromoImage(file, kind);
      setPreviewFailed(false);
      onChange(path);
      toast.success(t('heroPromo.admin.fields.uploaded'));
    } catch (uploadError) {
      toast.error(uploadError instanceof Error && uploadError.message ? uploadError.message : t('heroPromo.admin.fields.uploadError'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const thumbClass = kind === 'mobile' ? 'aspect-[9/16] w-24' : kind === 'logo' ? 'aspect-[2/1] w-40' : 'aspect-video w-40';

  return (
    <SettingsField id={id} label={label} hint={hint} error={error}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          'flex flex-col gap-3 rounded-xl border border-dashed p-3 transition-colors sm:flex-row sm:items-center',
          dragging ? 'border-amber-300/60 bg-amber-300/[0.06]' : error ? 'border-red-400/40' : 'border-white/15 bg-black/20'
        )}
      >
        <div
          className={cn(
            'relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10',
            kind === 'logo' ? 'bg-[repeating-conic-gradient(#262626_0%_25%,#171717_0%_50%)] bg-[length:16px_16px]' : 'bg-black/40',
            thumbClass
          )}
        >
          {previewUrl && !previewFailed ? (
            <img
              src={previewUrl}
              alt=""
              className={cn('h-full w-full', kind === 'logo' ? 'object-contain p-1' : 'object-cover')}
              onError={() => setPreviewFailed(true)}
              onLoad={() => setPreviewFailed(false)}
            />
          ) : (
            <ImagePlus className="h-6 w-6 text-white opacity-30" aria-hidden="true" />
          )}
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/60">
              <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-medium text-white/80 transition-colors hover:border-white/30 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 disabled:opacity-40"
            >
              <Upload className="h-3.5 w-3.5 text-white opacity-70" aria-hidden="true" />
              {uploading
                ? t('heroPromo.admin.fields.uploading')
                : value ? t('heroPromo.admin.fields.replace') : t('heroPromo.admin.fields.upload')}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                disabled={uploading}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-400/25 px-3 text-xs font-medium text-red-200 transition-colors hover:border-red-400/45 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-300" aria-hidden="true" />
                {t('heroPromo.admin.fields.remove')}
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              className="hidden"
              tabIndex={-1}
              onChange={(event) => void upload(event.target.files?.[0])}
            />
          </div>
          <Input
            id={id}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={t('heroPromo.admin.fields.urlPlaceholder')}
            onChange={(event) => {
              setPreviewFailed(false);
              onChange(event.target.value);
            }}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={`${id}-message`}
            className={cn(settingsInputClass, 'h-9 min-w-0 text-xs', error && invalidInputClass)}
          />
          <p className="text-[11px] leading-4 text-white/35">{t('heroPromo.admin.fields.dropHint')}</p>
        </div>
      </div>
    </SettingsField>
  );
};

export default HeroPromoImageField;
