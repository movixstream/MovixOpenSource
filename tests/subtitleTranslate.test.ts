import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resetPreferredTranslateEndpoint,
  textToTranslateHtml,
  translateHtmlToText,
  translateSubtitleTexts,
  type TranslatePost,
  type TranslateRequest,
} from '../src/services/subtitles/translate.ts';

type Service = 'gtx' | 'dict' | 'microsoft' | 'translateHtml';

function serviceOf(request: TranslateRequest): Service {
  if (request.url.includes('edge.microsoft.com')) return 'microsoft';
  if (request.url.includes('translateHtml')) return 'translateHtml';
  if (request.url.endsWith('/translate_a/t')) return 'dict';
  return 'gtx';
}

// Faux services : « traduisent » en majuscules, avec la forme de réponse de chacun.
function fakeServices(refuse: (request: TranslateRequest) => boolean, opts: { dropSeparator?: boolean } = {}) {
  const calls: TranslateRequest[] = [];
  const post: TranslatePost = async (request) => {
    calls.push(request);
    if (refuse(request)) throw new Error('Network Error');
    switch (serviceOf(request)) {
      case 'microsoft':
        return (JSON.parse(request.body as string) as string[])
          .map(text => ({ translations: [{ text: text.toUpperCase(), to: request.params?.to }] }));
      case 'translateHtml': {
        const [[html]] = JSON.parse(request.body as string) as [[string[]]];
        // Comme Google : le JSON arrive en texte et les apostrophes en entités.
        return JSON.stringify([html.map(text => text.toUpperCase().replace(/'/g, '&#39;')), html.map(() => 'en')]);
      }
      case 'dict':
        return (request.body as URLSearchParams).getAll('q').map(text => [text.toUpperCase(), 'en']);
      default: {
        let joined = (request.body as URLSearchParams).get('q')!.toUpperCase();
        if (opts.dropSeparator) joined = joined.replace('||||', '');
        return [[[joined, null, null, null, 10]], null, 'en'];
      }
    }
  };
  return { calls, post, services: () => calls.map(serviceOf) };
}

test.beforeEach(() => resetPreferredTranslateEndpoint());

test('un seul appel groupé quand le point d’accès principal répond', async () => {
  const fake = fakeServices(() => false);
  const result = await translateSubtitleTexts(['<i>Hello</i>', 'Bye\nnow'], 'fr', fake.post);

  assert.deepEqual(fake.services(), ['gtx']);
  assert.equal(fake.calls[0].url, 'https://translate.googleapis.com/translate_a/single');
  assert.equal(result.get('<i>Hello</i>'), 'HELLO');
  assert.equal(result.get('Bye\nnow'), 'BYE\nNOW');
});

test('Google bloqué : Microsoft prend le relais et reste en tête', async () => {
  const fake = fakeServices(request => serviceOf(request) === 'gtx');

  const first = await translateSubtitleTexts(['Hello', 'Bye\nnow'], 'zh', fake.post);
  assert.deepEqual([...first.values()], ['HELLO', 'BYE\nNOW']);
  assert.deepEqual(fake.services(), ['gtx', 'microsoft']);
  assert.equal(fake.calls[1].params?.to, 'zh-Hans');
  assert.deepEqual(JSON.parse(fake.calls[1].body as string), ['Hello', 'Bye\nnow']);

  fake.calls.length = 0;
  await translateSubtitleTexts(['Again'], 'fr', fake.post);
  assert.deepEqual(fake.services(), ['microsoft']);
  assert.equal(fake.calls[0].params?.to, 'fr');
});

test('séparateur perdu : un autre point d’accès, jamais une requête par réplique', async () => {
  const fake = fakeServices(() => false, { dropSeparator: true });
  const texts = Array.from({ length: 80 }, (_, i) => `Line ${i}`);
  const result = await translateSubtitleTexts(texts, 'fr', fake.post);

  assert.deepEqual(fake.services(), ['gtx', 'microsoft']);
  assert.equal(JSON.parse(fake.calls[1].body as string).length, 80);
  assert.equal(result.get('Line 42'), 'LINE 42');
});

test('gtx et Microsoft refusés : translateHtml, retours à la ligne et caractères spéciaux rendus', async () => {
  const fake = fakeServices(request => ['gtx', 'microsoft'].includes(serviceOf(request)));
  const result = await translateSubtitleTexts(["It's Tom & Jerry\n1 < 2"], 'fr', fake.post);

  assert.deepEqual(fake.services(), ['gtx', 'microsoft', 'translateHtml']);
  assert.equal(fake.calls[2].headers?.['Content-Type'], 'application/json+protobuf');
  assert.equal(result.get("It's Tom & Jerry\n1 < 2"), "IT'S TOM & JERRY\n1 < 2");
});

test('tout est refusé : un essai par point d’accès, aucun résultat', async () => {
  const fake = fakeServices(() => true);
  const result = await translateSubtitleTexts(['Hello', 'Bye'], 'fr', fake.post);

  assert.deepEqual(fake.services(), ['gtx', 'microsoft', 'translateHtml', 'dict', 'gtx']);
  assert.equal(result.size, 0);
});

test('les répliques sans texte ne partent pas', async () => {
  const fake = fakeServices(request => serviceOf(request) === 'gtx');
  const result = await translateSubtitleTexts(['<i></i>', 'Hello', '  '], 'fr', fake.post);

  assert.deepEqual(JSON.parse(fake.calls[1].body as string), ['Hello']);
  assert.deepEqual([...result.entries()], [['Hello', 'HELLO']]);
});

test('aller-retour HTML de translateHtml', () => {
  assert.equal(textToTranslateHtml('A & B\n<i>'), 'A &amp; B<br>&lt;i&gt;');
  assert.equal(
    translateHtmlToText('C&#39;est<br> ici &amp; là &#x2014; &quot;ok&quot; <b>fin</b>'),
    'C\'est\nici & là — "ok" fin',
  );
});
