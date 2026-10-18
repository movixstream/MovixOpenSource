import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TV_APP_DOWNLOADER_CODE } from '@/config/tvApp';
import { SplitFlapCode } from './SplitFlapCode';
import type { TvAppRelease } from './useTvAppRelease';

// ─── Chemin de menus en pastilles ───────────────────────────────────────────
interface PathTrailProps {
  items: string[];
  caption?: string;
  className?: string;
}

/**
 * Chemin de menus de la télé, en pastilles. La dernière est remplie de blanc,
 * comme l'élément sélectionné dans les listes de l'appli : c'est là qu'on appuie.
 */
export function PathTrail({ items, caption, className }: PathTrailProps) {
  if (items.length === 0) return null;
  return (
    <div className={className}>
      {caption && <p className="mb-2.5 text-sm font-medium text-zinc-400">{caption}</p>}
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2.5">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item}-${index}`} className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-semibold leading-snug',
                  last ? 'bg-white text-zinc-950' : 'bg-white/[0.07] text-zinc-100 ring-1 ring-inset ring-white/10',
                )}
              >
                {item}
              </span>
              {!last && <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Bouton copier ──────────────────────────────────────────────────────────
const copyText = async (value: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Presse-papiers refusé : on tente l'ancienne méthode.
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    document.body.removeChild(area);
    return done;
  } catch {
    return false;
  }
};

export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const handleCopy = async () => {
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 active:scale-[0.98]"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? t('tvApp.install.steps.code.copied') : t('tvApp.install.steps.code.copy')}</span>
    </button>
  );
}

// ─── Code Downloader ou adresse de l'APK ────────────────────────────────────
interface DownloaderTargetProps {
  calm: boolean;
  release: TvAppRelease;
}

export function DownloaderTarget({ calm, release }: DownloaderTargetProps) {
  const { t } = useTranslation();
  const code = TV_APP_DOWNLOADER_CODE?.trim() || null;
  const fileLine = release.versionName
    ? release.sizeLabel
      ? t('tvApp.install.steps.code.file', { version: release.versionName, size: release.sizeLabel })
      : t('tvApp.install.steps.code.fileVersion', { version: release.versionName })
    : null;

  return (
    <div>
      {code && (
        <>
          <p className="mb-3 text-sm font-medium text-zinc-400">{t('tvApp.install.steps.code.codeLabel')}</p>
          <div className="flex flex-wrap items-center gap-4">
            <SplitFlapCode code={code} calm={calm} className="[--tv-flap-size:36px] sm:[--tv-flap-size:52px]" />
            <CopyButton value={code} label={t('tvApp.install.steps.code.copyCode')} />
          </div>
        </>
      )}
      <p className={`mb-3 text-sm font-medium text-zinc-400 ${code ? 'mt-6' : ''}`}>
        {t(code ? 'tvApp.install.steps.code.urlLabelOr' : 'tvApp.install.steps.code.urlLabel')}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 select-all break-all rounded-xl bg-black/40 px-4 py-3 font-mono text-sm leading-relaxed text-white ring-1 ring-inset ring-white/10">
          {release.apkUrl}
        </p>
        <CopyButton value={release.apkUrl} label={t('tvApp.install.steps.code.copyUrl')} />
      </div>
      {fileLine && <p className="mt-4 text-sm text-zinc-400">{fileLine}</p>}
      {release.notes && (
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          {t('tvApp.install.steps.code.notes', { notes: release.notes })}
        </p>
      )}
    </div>
  );
}
