import assert from 'node:assert/strict';
import test from 'node:test';
import { baseMimeType, isMovixAppWebView, saveWrappedFile, shareWrappedFile } from '../src/utils/wrappedShareFile.ts';

const blob = new Blob(['film'], { type: 'video/mp4' });

function deps({ canShare = true, shareError = null as Error | null, inApp = false, withShare = true } = {}) {
    const shared: { title?: string; text?: string; files: File[] }[] = [];
    const downloads: string[] = [];
    return {
        shared,
        downloads,
        deps: {
            inApp,
            download: (_blob: Blob, name: string) => { downloads.push(name); },
            navigator: {
                canShare: () => canShare,
                ...(withShare ? {
                    share: async (data: { title?: string; text?: string; files: File[] }) => {
                        if (shareError) throw shareError;
                        shared.push(data);
                    },
                } : {}),
            },
        },
    };
}

test('le type envoyé au partage n’a plus ses codecs', async () => {
    assert.equal(baseMimeType('video/mp4;codecs=avc1.42E01E,mp4a.40.2'), 'video/mp4');
    assert.equal(baseMimeType('video/webm; codecs=vp9,opus'), 'video/webm');
    assert.equal(baseMimeType('IMAGE/PNG'), 'image/png');

    const d = deps();
    assert.equal(await shareWrappedFile({ blob, name: 'film.mp4', type: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', title: 'Titre' }, d.deps), 'shared');
    assert.equal(d.shared[0].files[0].type, 'video/mp4');
    assert.equal(d.shared[0].files[0].name, 'film.mp4');
    assert.equal(d.shared[0].title, 'Titre');
    // Pas de champ texte vide ajouté au partage d'un film.
    assert.ok(!('text' in d.shared[0]));
    assert.deepEqual(d.downloads, []);
});

test('partage indisponible ou refusé par le système : le fichier est téléchargé', async () => {
    const unsupported = deps({ canShare: false });
    assert.equal(await shareWrappedFile({ blob, name: 'a.png', type: 'image/png' }, unsupported.deps), 'downloaded');
    assert.deepEqual(unsupported.downloads, ['a.png']);

    const noShare = deps({ withShare: false });
    assert.equal(await shareWrappedFile({ blob, name: 'b.png', type: 'image/png' }, noShare.deps), 'downloaded');

    // Geste expiré après un long export, type refusé… : jamais de fichier perdu.
    const refused = deps({ shareError: new DOMException('Refusé', 'NotAllowedError') });
    assert.equal(await shareWrappedFile({ blob, name: 'c.mp4', type: 'video/mp4' }, refused.deps), 'downloaded');
    assert.deepEqual(refused.downloads, ['c.mp4']);
});

test('partage annulé par l’utilisateur : ni téléchargement ni erreur', async () => {
    const cancelled = deps({ shareError: new DOMException('Annulé', 'AbortError') });
    assert.equal(await shareWrappedFile({ blob, name: 'a.png', type: 'image/png' }, cancelled.deps), 'cancelled');
    assert.deepEqual(cancelled.downloads, []);
});

test('dans l’application, aucun faux téléchargement : l’appelant est prévenu', async () => {
    const app = deps({ canShare: false, inApp: true });
    assert.equal(await shareWrappedFile({ blob, name: 'a.png', type: 'image/png' }, app.deps), 'unavailable');
    assert.equal(saveWrappedFile(blob, 'a.png', app.deps), false);
    assert.deepEqual(app.downloads, []);

    // La feuille de partage du système, quand elle existe, reste utilisée dans l'application.
    const appWithShare = deps({ inApp: true });
    assert.equal(await shareWrappedFile({ blob, name: 'a.png', type: 'image/png' }, appWithShare.deps), 'shared');

    const browser = deps();
    assert.equal(saveWrappedFile(blob, 'a.png', browser.deps), true);
    assert.deepEqual(browser.downloads, ['a.png']);
});

test('l’application se reconnaît à son pont WebView', () => {
    assert.equal(isMovixAppWebView({ ReactNativeWebView: { postMessage() {} } }), true);
    assert.equal(isMovixAppWebView({}), false);
    assert.equal(isMovixAppWebView(undefined), false);
});
