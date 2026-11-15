import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceFunction } from './helpers/sourceFunction.mjs';

class FakeElement {
  focused = false;
  focus() { this.focused = true; }
}

// Document minimal : enregistre la zone de texte et la commande « copy ».
const createDocument = (execResult: boolean | Error) => {
  const copied: string[] = [];
  let attached: { value: string } | null = null;
  const previous = new FakeElement();
  const document = {
    body: {
      appendChild(node: { value: string }) { attached = node; },
    },
    activeElement: previous,
    createElement() {
      const node = {
        value: '', style: {} as Record<string, string>,
        setAttribute() {}, select() {}, setSelectionRange() {},
        remove() { attached = null; },
      };
      return node;
    },
    execCommand(command: string) {
      if (execResult instanceof Error) throw execResult;
      if (command === 'copy' && attached) copied.push(attached.value);
      return execResult;
    },
  };
  return { document, copied, previous, isAttached: () => attached !== null };
};

const loadCopyText = (navigator: object, document: object) => {
  const copyWithTextarea = sourceFunction('src/utils/clipboard.ts', 'copyWithTextarea', { document, HTMLElement: FakeElement });
  return sourceFunction('src/utils/clipboard.ts', 'copyText', { navigator, copyWithTextarea });
};

test('sans API Clipboard (PS4), la copie passe par une zone de texte au lieu de planter', async () => {
  const { document, copied, previous, isAttached } = createDocument(true);
  const copyText = loadCopyText({}, document);
  assert.equal(await copyText('https://movix.test/watchparty/join/ABC'), true);
  assert.deepEqual(copied, ['https://movix.test/watchparty/join/ABC']);
  assert.equal(isAttached(), false, 'la zone de texte temporaire est retirée');
  assert.equal(previous.focused, true, 'le focus revient à l’élément précédent');
});

test('l’API Clipboard est utilisée quand elle existe', async () => {
  const written: string[] = [];
  const { document, copied } = createDocument(true);
  const copyText = loadCopyText({ clipboard: { writeText: async (text: string) => { written.push(text); } } }, document);
  assert.equal(await copyText('code'), true);
  assert.deepEqual(written, ['code']);
  assert.deepEqual(copied, []);
});

test('un refus de l’API Clipboard tente le repli, un double échec renvoie false sans lever', async () => {
  const refused = { clipboard: { writeText: async () => { throw new DOMException('Refusé', 'NotAllowedError'); } } };
  const ok = createDocument(true);
  assert.equal(await loadCopyText(refused, ok.document)('lien'), true);
  assert.deepEqual(ok.copied, ['lien']);

  const failing = createDocument(new Error('execCommand indisponible'));
  assert.equal(await loadCopyText(refused, failing.document)('lien'), false);
  assert.equal(failing.isAttached(), false);
  assert.equal(await loadCopyText({}, { body: null })('lien'), false, 'document sans body');
});
