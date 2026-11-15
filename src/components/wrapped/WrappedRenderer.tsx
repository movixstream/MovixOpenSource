import { lazy, Suspense } from 'react';
import { Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WrappedData } from '@/services/wrappedService';
import type { WrappedVersion } from '@/types/wrapped';
import '@fontsource/archivo-black/latin-400.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';

const WrappedA = lazy(() => import('./legacy/WrappedPageA'));
const WrappedB = lazy(() => import('./WrappedExperience'));

export function WrappedLoading({ year, onClose }: { year: number; onClose: () => void }) {
    const { t } = useTranslation();
    return (
        <main className="fixed inset-0 z-50 flex h-[100dvh] items-center justify-center bg-[#080a0b] font-[Inter,Arial,sans-serif] text-[#f4efe6] sm:p-4 lg:p-6" data-lenis-prevent>
            <div className="flex h-full w-full max-w-[1240px] flex-col overflow-hidden bg-[#101318] sm:max-h-[940px] sm:rounded-2xl">
                <header className="flex shrink-0 items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] lg:px-7 lg:pt-5">
                    <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" aria-label={t('wrappedStory.close')}>
                        <X className="h-5 w-5 text-white opacity-90 transition-[color,opacity]" />
                    </button>
                    <p className="flex items-center gap-3 text-sm font-bold tracking-tight"><span className="font-['Archivo_Black']">MOVIX</span><span className="h-3 w-px bg-white/25" aria-hidden="true" /><span className="font-normal text-white/60">Wrapped {year}</span></p>
                    <span className="w-11 shrink-0" aria-hidden="true" />
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <div className="flex min-h-full flex-col items-center justify-center gap-7 px-6 py-12 text-center" role="status">
                        <Loader2 className="h-12 w-12 shrink-0 text-[#a9dfff] motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
                        <div className="max-w-lg space-y-4">
                            <h1 className="text-balance font-['Archivo_Black'] text-3xl leading-tight tracking-tight sm:text-5xl">{t('wrapped.preparingWrapped')}</h1>
                            <p className="text-pretty text-sm leading-relaxed text-white/65 sm:text-base">{t('wrapped.analyzingYear')}</p>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}

export default function WrappedRenderer({ data, version, onClose }: { data: WrappedData; version: WrappedVersion; onClose: () => void }) {
    const Experience = version === 'A' ? WrappedA : WrappedB;
    return <div className="contents" data-wrapped-version={version}>
        <Suspense fallback={<WrappedLoading year={data.year} onClose={onClose} />}>
            <Experience data={data} onClose={onClose} />
        </Suspense>
    </div>;
}
