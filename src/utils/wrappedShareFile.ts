// Partage et téléchargement des fichiers du Wrapped (images PNG, film). Une
// seule version pour les images et le film ; navigateur et téléchargement
// sont injectables pour les tests.

/** « video/mp4;codecs=avc1… » → « video/mp4 ». La feuille de partage du système compare le type exact et refuse un type suivi de ses codecs. */
export function baseMimeType(mime: string): string {
    return mime.split(';')[0].trim().toLowerCase();
}

/**
 * Dans l'application mobile, la page tourne dans une WebView sans gestion des
 * téléchargements : un lien vers un blob ne produit aucun fichier.
 */
export function isMovixAppWebView(scope: unknown = typeof window === 'undefined' ? undefined : window): boolean {
    return Boolean(scope && (scope as { ReactNativeWebView?: unknown }).ReactNativeWebView);
}

/**
 * Télécharge un Blob par un lien. L'adresse reste valable une minute : iOS
 * Safari demande une confirmation avant de lire le fichier, et une adresse
 * révoquée au bout d'une seconde faisait échouer le téléchargement.
 */
export function downloadBlob(blob: Blob, name: string, revokeAfterMs = 60_000): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
}

export type WrappedShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'unavailable';

interface ShareNavigator {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { title?: string; text?: string; files: File[] }) => Promise<void>;
}

export interface WrappedShareDeps {
    navigator: ShareNavigator;
    download: (blob: Blob, name: string) => void;
    inApp: boolean;
}

/**
 * Enregistre le fichier, sauf dans l'application où rien ne serait écrit.
 * @returns `false` quand l'enregistrement n'est pas possible ici.
 */
export function saveWrappedFile(blob: Blob, name: string, deps: Pick<WrappedShareDeps, 'download' | 'inApp'> = { download: downloadBlob, inApp: isMovixAppWebView() }): boolean {
    if (deps.inApp) return false;
    deps.download(blob, name);
    return true;
}

/**
 * Feuille de partage du système si elle accepte ce fichier, sinon
 * téléchargement. Un refus du système (type non accepté, geste expiré après un
 * long export) retombe aussi sur le téléchargement : le fichier n'est jamais
 * perdu. Seule l'annulation par l'utilisateur ne fait rien.
 */
export async function shareWrappedFile(
    file: { blob: Blob; name: string; type: string; title?: string; text?: string },
    deps: WrappedShareDeps = { navigator, download: downloadBlob, inApp: isMovixAppWebView() },
): Promise<WrappedShareOutcome> {
    const type = baseMimeType(file.type);
    const shareable = new File([file.blob], file.name, { type });
    if (deps.navigator.share && deps.navigator.canShare?.({ files: [shareable] })) {
        try {
            await deps.navigator.share({ title: file.title, ...(file.text ? { text: file.text } : {}), files: [shareable] });
            return 'shared';
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
        }
    }
    return saveWrappedFile(file.blob, file.name, deps) ? 'downloaded' : 'unavailable';
}
