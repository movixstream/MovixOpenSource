import React from 'react';
import { isChunkLoadError, isChunkResponseError, reloadForChunkFailure } from '../routing/lazyWithRetry';
import { captureCrash, isRecoverableError } from '../utils/errorTracking';
import { MovixWordmark } from './brand/MovixWordmark';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  /** GlitchTip event id once the crash has been reported (null = tracking off). */
  eventId: string | null;
  recoverable: boolean;
  reloadScheduled: boolean;
}

/**
 * Recoverable = not a code bug, fixable by a reload (stale chunks after a
 * deploy, browser auto-translate DOM race, React #306…) — the rules live in
 * `isRecoverableError` (utils/errorTracking) so the global SDK filters and this
 * boundary agree. These get a friendly "updating" screen + guarded auto-reload
 * instead of the crash report UI.
 *
 * Real crashes are sent to GlitchTip automatically (captureCrash). The old
 * hardcoded Discord webhook is gone: it shipped in the bundle, so anyone could
 * read it and spam the channel, and every crash was one more message.
 */

/** Chromium-only `performance.memory` (absent from the DOM lib typings). */
type PerformanceWithMemory = Performance & {
  memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
};

function readDeviceInfo() {
  const ua = navigator.userAgent;
  const jsHeap = (performance as PerformanceWithMemory).memory;

  let browser = 'Inconnu';
  if (ua.includes('Firefox/')) {
    browser = 'Firefox ' + (ua.match(/Firefox\/([\d.]+)/)?.[1] ?? '');
  } else if (ua.includes('Edg/')) {
    browser = 'Edge ' + (ua.match(/Edg\/([\d.]+)/)?.[1] ?? '');
  } else if (ua.includes('OPR/') || ua.includes('Opera/')) {
    browser = 'Opera ' + (ua.match(/(?:OPR|Opera)\/([\d.]+)/)?.[1] ?? '');
  } else if (ua.includes('Chrome/')) {
    browser = 'Chrome ' + (ua.match(/Chrome\/([\d.]+)/)?.[1] ?? '');
  } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
    browser = 'Safari ' + (ua.match(/Version\/([\d.]+)/)?.[1] ?? '');
  }

  let os = 'Inconnu';
  if (ua.includes('Windows NT 10')) os = 'Windows 10/11';
  else if (ua.includes('Windows NT')) os = 'Windows';
  else if (ua.includes('Mac OS X')) os = 'macOS ' + (ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '');
  else if (ua.includes('Android')) os = 'Android ' + (ua.match(/Android ([\d.]+)/)?.[1] ?? '');
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS ' + (ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') ?? '');
  else if (ua.includes('Linux')) os = 'Linux';

  let device = 'Desktop';
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
    device = /iPad|Tablet/i.test(ua) ? 'Tablette' : 'Mobile';
  }

  return {
    browser,
    os,
    device,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    url: window.location.href,
    timestamp: new Date().toISOString(),
    userAgent: ua,
    online: navigator.onLine,
    memory: jsHeap
      ? `${Math.round(jsHeap.usedJSHeapSize / 1048576)}MB / ${Math.round(jsHeap.jsHeapSizeLimit / 1048576)}MB`
      : 'N/A',
  };
}

function getDeviceInfo() {
  try {
    return readDeviceInfo();
  } catch {
    // Firefox peut invalider screen/navigator lors d'un changement de document.
    // Le panneau d'erreur doit rester affichable sans ces détails facultatifs.
    return {
      browser: 'Inconnu', os: 'Inconnu', device: 'Inconnu', screen: 'N/A',
      viewport: 'N/A', language: 'N/A', url: '', userAgent: '', online: false,
      timestamp: new Date().toISOString(), memory: 'N/A',
    };
  }
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, eventId: null, recoverable: false, reloadScheduled: true };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Decide recoverability synchronously so the soft screen renders on the
    // first frame — no flash of the crash UI before componentDidCatch runs.
    return { hasError: true, error, recoverable: isRecoverableError(error, true) };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    if (isRecoverableError(error, true)) {
      // Not a code bug — recover quietly with a guarded reload (the budget in
      // reloadForChunkFailure caps attempts so this can never loop).
      // Un chunk abîmé détecté au rendu vide d'abord le cache d'assets, sinon
      // le rechargement resservirait la même copie.
      const reloadScheduled = reloadForChunkFailure({ purgeAssetCache: isChunkResponseError(error) });
      this.setState({ recoverable: true, reloadScheduled });
      return;
    }
    console.error('[ErrorBoundary]', error, errorInfo);
    // Sent automatically to GlitchTip (with the component stack): no button,
    // no user action. Null when tracking is off (dev build, no DSN).
    this.setState({ eventId: captureCrash(error, errorInfo) });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Recoverable errors (stale chunk after deploy, translate DOM race, #306):
    // friendly "updating" screen + guarded auto-reload — no crash report.
    if (this.state.recoverable) {
      const { error, reloadScheduled } = this.state;
      const isChunk = isChunkLoadError(error);
      const title = isChunk ? 'Mise à jour de Movix' : 'Rechargement';
      const body = reloadScheduled
        ? isChunk
          ? 'Une nouvelle version est disponible. Rechargement en cours…'
          : 'Un souci d’affichage temporaire est survenu. Rechargement en cours…'
        : 'Le rechargement automatique a échoué. Réessaie manuellement.';
      return (
        <div style={{ minHeight: '100vh', backgroundColor: '#000', color: '#f3f4f6', fontFamily: 'ui-sans-serif, system-ui, sans-serif', padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <MovixWordmark style={{ display: 'block', height: 44, width: 'auto', margin: '0 auto 24px', color: '#f4f4f0' }} />
            {reloadScheduled && (
              <div style={{ width: 40, height: 40, margin: '0 auto 24px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#dc2626', borderRadius: '50%', animation: 'movix-eb-spin 0.8s linear infinite' }} />
            )}
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>{title}</h1>
            <p style={{ margin: '12px 0 0', fontSize: 14, color: '#9ca3af', lineHeight: 1.5 }}>{body}</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
              <button onClick={this.handleReload} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', backgroundColor: '#dc2626', color: '#fff' }}>Recharger</button>
              <button onClick={this.handleGoHome} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #333', fontWeight: 600, fontSize: 14, cursor: 'pointer', backgroundColor: 'transparent', color: '#9ca3af' }}>Accueil</button>
            </div>
          </div>
          <style>{`@keyframes movix-eb-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      );
    }

    const { error, errorInfo, eventId } = this.state;
    const info = getDeviceInfo();

    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#000', color: '#f3f4f6', fontFamily: 'ui-sans-serif, system-ui, sans-serif', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 700, width: '100%' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#fff' }}>Movix a rencontré une erreur</h1>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: '#9ca3af' }}>Une erreur inattendue s'est produite. Les détails sont affichés ci-dessous.</p>
            </div>
          </div>

          {/* Error message */}
          <div style={{ backgroundColor: '#1c1c1c', border: '1px solid #dc2626', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Erreur</p>
            <p style={{ margin: '8px 0 0', fontSize: 15, color: '#fca5a5', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>
              {error?.message ?? 'Erreur inconnue'}
            </p>
          </div>

          {/* Stack trace */}
          <details style={{ marginBottom: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#9ca3af', padding: '8px 0' }}>Stack Trace</summary>
            <pre style={{ backgroundColor: '#111', borderRadius: 8, padding: 12, fontSize: 12, color: '#d4d4d8', overflow: 'auto', maxHeight: 240, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {error?.stack ?? 'Aucune stack trace disponible'}
            </pre>
          </details>

          {/* Component stack */}
          {errorInfo?.componentStack && (
            <details style={{ marginBottom: 16 }}>
              <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#9ca3af', padding: '8px 0' }}>Component Stack</summary>
              <pre style={{ backgroundColor: '#111', borderRadius: 8, padding: 12, fontSize: 12, color: '#d4d4d8', overflow: 'auto', maxHeight: 200, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {errorInfo.componentStack}
              </pre>
            </details>
          )}

          {/* Device info */}
          <details style={{ marginBottom: 24 }} open>
            <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#9ca3af', padding: '8px 0' }}>Informations de l'appareil</summary>
            <div style={{ backgroundColor: '#111', borderRadius: 8, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, fontSize: 13 }}>
              {[
                ['Navigateur', info.browser],
                ['Systeme', info.os],
                ['Appareil', info.device],
                ['Ecran', info.screen],
                ['Viewport', info.viewport],
                ['Langue', info.language],
                ['En ligne', info.online ? 'Oui' : 'Non'],
                ['Memoire', info.memory],
              ].map(([label, value]) => (
                <div key={label}>
                  <p style={{ margin: 0, color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                  <p style={{ margin: '2px 0 0', color: '#e5e7eb' }}>{value}</p>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ margin: 0, color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>URL</p>
                <p style={{ margin: '2px 0 0', color: '#e5e7eb', wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{info.url}</p>
              </div>
            </div>
          </details>

          {/* Report status: sent automatically when tracking is on */}
          {eventId && (
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#9ca3af' }}>
              Rapport envoyé automatiquement · référence{' '}
              <code style={{ fontFamily: 'ui-monospace, monospace', color: '#e5e7eb' }}>{eventId}</code>
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                backgroundColor: '#dc2626',
                color: '#fff',
              }}
            >
              Recharger la page
            </button>

            <button
              onClick={this.handleGoHome}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid #333',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                backgroundColor: 'transparent',
                color: '#9ca3af',
              }}
            >
              Retour à l'accueil
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
