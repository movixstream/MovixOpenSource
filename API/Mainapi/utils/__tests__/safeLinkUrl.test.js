const assert = require('node:assert/strict');
const test = require('node:test');

const { isHttpUrl, isHttpLinkEntry, isHttpLinkInput } = require('../safeLinkUrl');

test('isHttpUrl : seules les URL absolues http(s) passent', () => {
  assert.equal(isHttpUrl('https://uqload.is/embed-abc.html'), true);
  assert.equal(isHttpUrl('  http://exemple.tld/x  '), true);
  assert.equal(isHttpUrl('HTTPS://EXEMPLE.TLD/'), true);

  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    // Forme utilisée pour passer un filtre naïf sur le nom d'hébergeur.
    "javascript://uqload.is/embed-x.html%0afetch('https://evil.tld')",
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://exemple.tld/uuid',
    '//exemple.tld/x',
    'exemple.tld/x',
    '',
    '   ',
    null,
    undefined,
    42,
    { url: 'https://exemple.tld' },
  ]) {
    assert.equal(isHttpUrl(bad), false, String(bad));
  }
});

test('isHttpLinkEntry : chaîne ou objet stocké, schéma absent toléré', () => {
  assert.equal(isHttpLinkEntry('https://exemple.tld/v'), true);
  assert.equal(isHttpLinkEntry({ url: 'https://exemple.tld/v', label: 'VF' }), true);
  assert.equal(isHttpLinkEntry('//exemple.tld/v'), true);

  assert.equal(isHttpLinkEntry('javascript:alert(1)'), false);
  assert.equal(isHttpLinkEntry({ url: 'javascript:alert(1)' }), false);
  assert.equal(isHttpLinkEntry({ label: 'sans url' }), false);
  assert.equal(isHttpLinkEntry(null), false);
});

test('isHttpLinkInput : lien saisi par l\'équipe, URL absolue exigée', () => {
  assert.equal(isHttpLinkInput('https://exemple.tld/v'), true);
  assert.equal(isHttpLinkInput({ url: 'http://exemple.tld/v', isVip: true }), true);

  assert.equal(isHttpLinkInput('//exemple.tld/v'), false);
  assert.equal(isHttpLinkInput({ url: 'javascript:alert(1)' }), false);
  assert.equal(isHttpLinkInput({}), false);
  assert.equal(isHttpLinkInput(null), false);
});
