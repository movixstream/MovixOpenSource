import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useProfile } from '@/context/ProfileContext';
import { fetchWrappedData, type WrappedResponse } from '@/services/wrappedService';
import type { WrappedSession, WrappedVersion } from '@/types/wrapped';
import { formatWrappedDuration } from '@/utils/wrappedPresentation';
import { defaultWrappedYear, getWrappedExperiment } from '@/utils/wrappedExperiment';
import WrappedRenderer, { WrappedLoading } from '@/components/wrapped/WrappedRenderer';

const WrappedTestPreview = lazy(() => import('@/components/wrapped/WrappedTestPreview'));

function readSession(): WrappedSession {
    try {
        return {
            token: localStorage.getItem('auth_token'),
            profileId: localStorage.getItem('selected_profile_id'),
            collectionEnabled: localStorage.getItem('privacy_data_collection') !== 'false',
        };
    } catch {
        return { token: null, profileId: null, collectionEnabled: false };
    }
}

function WrappedGate({ title, children, onClose }: { title: string; children?: ReactNode; onClose: () => void }) {
    const { t } = useTranslation();
    return (
        <main className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto bg-[#101318] px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-[#f4efe6]" data-lenis-prevent>
            <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label={t('wrappedStory.close')}><X className="h-5 w-5" /></button>
            <div className="mx-auto flex min-h-[75dvh] max-w-lg flex-col justify-center gap-6 py-8">
                <p className="font-semibold text-[#a9dfff]">MOVIX WRAPPED</p>
                <h1 className="text-balance text-4xl font-black leading-tight tracking-tight">{title}</h1>
                {children}
            </div>
        </main>
    );
}

function WrappedContent({ year, session, version, onClose }: { year: number; session: WrappedSession; version: WrappedVersion; onClose: () => void }) {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const [response, setResponse] = useState<WrappedResponse | null>(null);
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setResponse(null);
        setFailed(false);
        const timeout = setTimeout(() => { controller.abort(); setFailed(true); }, 20000);
        fetchWrappedData(year, { signal: controller.signal, session }).then(result => {
            clearTimeout(timeout);
            if (controller.signal.aborted) return;
            if (!result.success) setFailed(true);
            else setResponse(result);
        }).catch(() => {
            clearTimeout(timeout);
            if (!controller.signal.aborted) setFailed(true);
        });
        return () => { clearTimeout(timeout); controller.abort(); };
    }, [year, session, retry]);

    if (failed) return <WrappedGate title={t('wrappedStory.loadErrorTitle')} onClose={onClose}>
        <p className="text-white/75">{t('wrappedStory.loadErrorCaption')}</p>
        <button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-12 rounded-xl bg-[#a9dfff] px-6 font-bold text-[#101318]">{t('wrappedStory.retry')}</button>
    </WrappedGate>;

    if (!response) return <WrappedLoading year={year} onClose={onClose} />;

    if (!response.wrapped) {
        const progress = response.progress;
        return <WrappedGate title={t('wrapped.notEnoughDataYet')} onClose={onClose}>
            <p className="text-white/75">{t('wrapped.notEnoughDataForYear', { year })}</p>
            {progress && <section aria-label={t('wrapped.unlockRequirementsTitle')} className="space-y-4">
                <p className="text-sm text-[#a9dfff]">{t('wrapped.progressPercent', { percent: progress.completionPercent })}</p>
                <div className="h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full bg-[#a9dfff]" style={{ width: `${Math.min(100, Math.max(0, progress.completionPercent))}%` }} /></div>
                <dl className="space-y-3">{(['minutes', 'uniqueTitles', 'sessions', 'activeDays'] as const).map((key, i) => <div key={key} className="flex justify-between gap-4 text-sm">
                    <dt className="text-white/75">{t(`wrapped.${['requirementWatchTime', 'requirementTitles', 'requirementSessions', 'requirementActiveDays'][i]}`)}</dt>
                    <dd className="text-right font-semibold">{key === 'minutes' ? formatWrappedDuration(progress.current[key], i18n.language) : progress.current[key]} / {key === 'minutes' ? formatWrappedDuration(progress.requirements[key], i18n.language) : progress.requirements[key]}</dd>
                </div>)}</dl>
            </section>}
            <button type="button" onClick={() => navigate('/')} className="min-h-12 rounded-xl bg-[#a9dfff] px-6 font-bold text-[#101318]">{t('wrapped.backToHome')}</button>
        </WrappedGate>;
    }

    return <WrappedRenderer data={response.wrapped} version={version} onClose={onClose} />;
}

function WrappedLivePage({ version }: { version: WrappedVersion }) {
    const { t, i18n } = useTranslation();
    const { year: yearParam } = useParams<{ year?: string }>();
    const navigate = useNavigate();
    const { currentProfile, isLoading: profileLoading } = useProfile();
    const [session, setSession] = useState(readSession);
    const currentYear = new Date().getFullYear();
    const year = yearParam ? Number(yearParam) : defaultWrappedYear();
    const onClose = useCallback(() => {
        if (window.history.state?.idx > 0) navigate(-1);
        else navigate('/');
    }, [navigate]);

    useEffect(() => {
        const refresh = () => {
            const next = readSession();
            setSession(previous => previous.token === next.token && previous.profileId === next.profileId && previous.collectionEnabled === next.collectionEnabled ? previous : next);
        };
        const events = ['storage', 'auth-changed', 'authStateChanged', 'sync_storage_updated', 'focus'];
        events.forEach(event => window.addEventListener(event, refresh));
        refresh();
        return () => events.forEach(event => window.removeEventListener(event, refresh));
    }, [currentProfile?.id]);

    // Tous les hooks de la page sont exécutés avant les écrans d'accès.
    if (!session.token) return <WrappedGate title={t('wrapped.loginRequired')} onClose={onClose}>
        <p className="text-white/75">{t('wrapped.loginRequiredDesc')}</p>
        <button type="button" onClick={() => navigate('/login-bip39')} className="min-h-12 rounded-xl bg-[#a9dfff] px-6 font-bold text-[#101318]">{t('wrapped.loginAction')}</button>
        <button type="button" onClick={() => navigate('/create-account')} className="min-h-11 underline underline-offset-4">{t('wrapped.createAccountAction')}</button>
    </WrappedGate>;

    if (!session.collectionEnabled) return <WrappedGate title={t('wrapped.dataCollectionDisabled')} onClose={onClose}>
        <p className="text-white/75">{t('wrapped.dataCollectionDisabledDesc')}</p>
        <button type="button" onClick={() => navigate('/settings')} className="min-h-12 rounded-xl bg-[#a9dfff] px-6 font-bold text-[#101318]">{t('wrapped.goToSettings')}</button>
    </WrappedGate>;

    if (!Number.isInteger(year) || year < 2024 || year > currentYear) return <WrappedGate title={t('wrappedStory.invalidYear')} onClose={onClose}>
        <button type="button" onClick={() => navigate('/wrapped', { replace: true })} className="min-h-12 rounded-xl bg-[#a9dfff] px-6 font-bold text-[#101318]">{t('wrappedStory.currentYear')}</button>
    </WrappedGate>;

    if (profileLoading) return <WrappedLoading year={year} onClose={onClose} />;

    // Le remount isole aussi l'index, les requêtes et les blobs lors d'un changement de compte.
    return <WrappedContent key={`${year}:${currentProfile?.id}:${session.profileId}:${session.token}:${i18n.language}`} year={year} session={session} version={version} onClose={onClose} />;
}

export default function WrappedPage() {
    const { search } = useLocation();
    const { year: yearParam } = useParams<{ year?: string }>();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const onClose = useCallback(() => {
        if (window.history.state?.idx > 0) navigate(-1);
        else navigate('/');
    }, [navigate]);
    const experiment = getWrappedExperiment(search);
    const currentYear = new Date().getFullYear();
    const year = yearParam ? Number(yearParam) : defaultWrappedYear();

    // Le mode test ne monte jamais les hooks de profil ni le chargement du compte.
    if (!experiment.test) return <WrappedLivePage version={experiment.version} />;
    if (!Number.isInteger(year) || year < 2024 || year > currentYear) return <WrappedGate title={t('wrappedStory.invalidYear')} onClose={onClose} />;

    return <Suspense fallback={<WrappedLoading year={year} onClose={onClose} />}>
        <WrappedTestPreview key={year} year={year} version={experiment.version} onClose={onClose} />
    </Suspense>;
}
