import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceFunction } from './helpers/sourceFunction.mjs';

const window = { location: { href: 'https://movix.test/watch/movie/550' } };
const safeEmbedUrl = sourceFunction('src/utils/safeEmbedUrl.ts', 'safeEmbedUrl', { window, URL });

test('une URL d’embed http(s) est rendue telle quelle', () => {
  for (const url of [
    'https://uqload.is/embed-abc.html',
    'http://exemple.tld/v?x=1#t',
    '//exemple.tld/embed/1',
    '/embed/local',
  ]) {
    assert.equal(safeEmbedUrl(url), url);
  }
});

test('javascript:, data: et consorts ne deviennent jamais un src d’iframe', () => {
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    // Passe un filtre naïf sur le nom d'hébergeur.
    "javascript://uqload.is/embed-x.html%0afetch('https://evil.test')",
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'blob:https://movix.test/uuid',
    'file:///etc/passwd',
  ]) {
    assert.equal(safeEmbedUrl(url), '', url);
  }
});

test('valeur absente ou illisible : chaîne vide', () => {
  assert.equal(safeEmbedUrl(null), '');
  assert.equal(safeEmbedUrl(undefined), '');
  assert.equal(safeEmbedUrl(''), '');
  assert.equal(safeEmbedUrl('https://exa mple.tld:99999/'), '');
});
