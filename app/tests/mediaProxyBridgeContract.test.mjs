import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const providerSignedUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
// Fsvid/Vidzy renvoient leur flux leurre (302 vers .../troll/master.m3u8) ou
// une 403 tant que la requête n'a pas un Referer sur un de leurs domaines ET
// un en-tête Sec-Ch-Ua.
const providerSecChUa = '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"';
// Les trois indices client partent ensemble chez un vrai Chrome, avec une
// version majeure identique à celle de l'User-Agent.
const providerClientHints = {
  'Accept-Encoding': 'identity, gzip;q=0, deflate;q=0, br;q=0, zstd;q=0',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Ch-Ua': providerSecChUa,
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};
const { 'Accept-Encoding': mediaEncoding, ...providerExtractionClientHints } = providerClientHints;

async function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

async function importTypeScript(relativePath) {
  const source = await read(relativePath);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

test('Fsvid media headers preserve the user agent used to sign playback URLs', async () => {
  const { applyMediaProxyHeaderRules } = await importTypeScript(
    'src/services/mediaProxyHeaders.ts',
  );
  const sampleFsvidUrl =
    'https://s1.fsvid.lol/hls2/01/00028/example/master.m3u8?t=redacted';

  assert.deepEqual(
    applyMediaProxyHeaderRules(sampleFsvidUrl, {
      origin: 'https://wrong.invalid',
      REFERER: 'https://wrong.invalid/',
    }),
    {
      Origin: 'https://fsvid.lol',
      Referer: 'https://fsvid.lol/',
      ...providerClientHints,
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'User-Agent': providerSignedUserAgent,
    },
  );
  assert.deepEqual(
    applyMediaProxyHeaderRules('https://fsvid.lol/embed-example', {}),
    {
      Origin: 'https://fs13.lol',
      Referer: 'https://fs13.lol/',
      ...providerExtractionClientHints,
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'User-Agent': providerSignedUserAgent,
    },
  );
  assert.deepEqual(
    applyMediaProxyHeaderRules(
      'https://fsvid.lol.attacker.example/master.m3u8',
      { Referer: 'https://movix.fun/' },
    ),
    { Referer: 'https://movix.fun/' },
  );
});

test('Vidzy playback preserves the user agent used to sign playback URLs', async () => {
  const { applyMediaProxyHeaderRules } = await importTypeScript(
    'src/services/mediaProxyHeaders.ts',
  );

  assert.deepEqual(
    applyMediaProxyHeaderRules('https://u14.vidzy.cc/hls/master.m3u8', {
      Origin: 'https://vidzy.org',
      Referer: 'https://vidzy.org/',
      'sec-fetch-dest': 'video',
      'user-agent': 'okhttp/4.12.0',
    }),
    {
      Origin: 'https://vidzy.org',
      Referer: 'https://vidzy.org/',
      ...providerClientHints,
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'User-Agent': providerSignedUserAgent,
    },
  );

  // Sans Referer, le CDN Vidzy répond 403 : on en pose un par défaut.
  assert.deepEqual(
    applyMediaProxyHeaderRules('https://u14.vidzy.cc/hls/master.m3u8', {}),
    {
      Origin: 'https://vidzy.org',
      Referer: 'https://vidzy.org/',
      ...providerClientHints,
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'User-Agent': providerSignedUserAgent,
    },
  );
});

test('Fsvid, Vidzy and Uqload keep browser encoding tokens without requesting compressed bodies', async () => {
  const { applyMediaProxyHeaderRules } = await importTypeScript(
    'src/services/mediaProxyHeaders.ts',
  );
  for (const [host, origin] of [
    ['r1.fsvid.lol', 'https://fsvid.lol'],
    ['u14.vidzy.cc', 'https://vidzy.org'],
    ['strm4.uqload.vc', 'https://uqload.vc'],
    ['strm1.uqload.bz', 'https://uqload.bz'],
  ]) {
    for (const resource of ['master.m3u8', 'seg-1.ts', 'video.mp4']) {
      const input = {
        origin: 'https://movix.tax',
        referer: 'https://movix.tax/',
        'accept-encoding': 'gzip',
        Range: 'bytes=0-1023',
      };
      const headers = applyMediaProxyHeaderRules(`https://${host}/hls/${resource}?t=example`, input);
      assert.equal(headers['Accept-Encoding'], providerClientHints['Accept-Encoding'], host);
      assert.equal(headers.Origin, origin, host);
      assert.equal(headers.Referer, `${origin}/`, host);
      assert.equal(headers.Range, input.Range);
      assert.equal(headers['accept-encoding'], undefined);
      assert.equal(input['accept-encoding'], 'gzip', 'input is not mutated');
    }
  }
  for (const host of ['uqload.vc.attacker.example', 'notuqload.vc', 'media.example']) {
    const input = { 'Accept-Encoding': 'gzip', Referer: 'https://movix.tax/' };
    assert.deepEqual(applyMediaProxyHeaderRules(`https://${host}/master.m3u8`, input), input);
  }
});

test('extraction pages never advertise zstd, including after redirects or with media-looking query strings', async () => {
  const { applyMediaProxyHeaderRules } = await importTypeScript(
    'src/services/mediaProxyHeaders.ts',
  );
  for (const url of [
    'https://fsvid.lol/embed-example.html',
    'https://vidzy.cc/embed-example.html',
    'https://vidzy.org/embed-example.html',
    'https://uqload.is/embed-example.html',
    'https://uqload.vc/embed-example.html',
    'https://uqload.vc/example.html?next=master.m3u8',
  ]) {
    for (const input of [{}, { 'accept-encoding': mediaEncoding }]) {
      const headers = applyMediaProxyHeaderRules(url, input);
      assert.equal(
        Object.keys(headers).some(name => name.toLowerCase() === 'accept-encoding'),
        false,
        `let the extraction transport negotiate a supported encoding: ${url}`,
      );
    }
  }
});

test('media header rules never depend on the URL global', async () => {
  const { applyMediaProxyHeaderRules, hostnameOf } = await importTypeScript(
    'src/services/mediaProxyHeaders.ts',
  );

  // Le `URL` de React Native est un bouchon : ses accesseurs lèvent « not
  // implemented ». Les règles sortaient donc par leur `catch` sur l'appareil,
  // sans poser un seul en-tête, alors que tout passait ici — Node a un vrai
  // `URL`. On reproduit le bouchon pour que ça ne puisse plus se reproduire.
  const realUrl = globalThis.URL;
  globalThis.URL = class BrokenURL {
    constructor() {}
    get hostname() { throw new Error('URL.hostname is not implemented'); }
    get host() { throw new Error('URL.host is not implemented'); }
    get origin() { throw new Error('URL.origin is not implemented'); }
    get protocol() { throw new Error('URL.protocol is not implemented'); }
  };
  try {
    assert.equal(
      applyMediaProxyHeaderRules('https://u14.vidzy.cc/hls/master.m3u8', {})[
        'User-Agent'
      ],
      providerSignedUserAgent,
    );
    assert.equal(
      applyMediaProxyHeaderRules('https://Ny1kZMsN0ytR.tnmr.org/m.m3u8', {})
        .Origin,
      'https://lulustream.com',
    );
  } finally {
    globalThis.URL = realUrl;
  }

  // L'analyseur maison : ce qu'il accepte, et ce qu'il refuse plutôt que de
  // deviner — un `user:pass@` ferait passer le vrai hôte pour un chemin.
  assert.equal(hostnameOf('https://Ny1kZMsN0ytR.TNMR.org/a/b?c=1'), 'ny1kzmsn0ytr.tnmr.org');
  assert.equal(hostnameOf('https://lulustream.com.:443/e/x'), 'lulustream.com');
  assert.equal(hostnameOf('https://user:pass@evil.example/@lulustream.com/x'), 'evil.example');
  assert.equal(hostnameOf('https://[2a06:98c1:3120::6]:443/x'), '[2a06:98c1:3120::6]');
  assert.equal(hostnameOf('/relative/path'), null);
  assert.equal(hostnameOf('https:///no-host'), null);
});

test('LuluStream, Veev and Vidara media requests carry their player origin', async () => {
  const { applyMediaProxyHeaderRules } = await importTypeScript(
    'src/services/mediaProxyHeaders.ts',
  );

  // Ces trois hébergeurs répondent 403 sans Referer sur le domaine de leur
  // lecteur. Les segments partent de domaines frères — Vidara répartit les
  // siens sur *.s1q2105.com — donc la règle doit couvrir toute la grappe.
  const cases = [
    ['https://lulustream.com/e/abcd1234', 'https://lulustream.com'],
    ['https://luluvdo.com/e/abcd1234', 'https://lulustream.com'],
    ['https://streamhihi.com/hls/master.m3u8', 'https://lulustream.com'],
    // Le manifeste LuluStream n'est servi par aucun domaine du lecteur mais par
    // un sous-domaine aléatoire de tnmr.org — relevé sur un 403 de l'appareil.
    ['https://Ny1kZMsN0ytR.tnmr.org/hls2/02/03956/master.m3u8', 'https://lulustream.com'],
    ['https://veev.to/e/abcd1234', 'https://veev.to'],
    ['https://poophq.com/hls/master.m3u8', 'https://veev.to'],
    // Le flux Veev sort de son CDN, pas des domaines du lecteur — relevé sur
    // un 403 de l'appareil, exactement comme tnmr.org pour LuluStream.
    ['https://s-gb-441928.veevcdn.co/FhQBwA89kTN7mmmvgbXQ', 'https://veev.to'],
    ['https://vidara.so/e/abcd1234', 'https://vidara.to'],
    ['https://s25-wyl2.s1q2105.com/hls/seg-1.ts', 'https://vidara.to'],
  ];

  // Ces trois-là lient leur jeton à l'identité du client qui l'a obtenu : la
  // lecture doit rejouer celle de l'extraction, pas le Chrome-desktop de
  // Fsvid/Vidzy. Les indices client ne sont pas fabriqués ici — le pont les
  // pose à l'identique sur l'extraction et sur la lecture.
  const extractionUserAgent = 'Mozilla/5.0 Chrome/143.0.0.0';
  for (const [url, origin] of cases) {
    assert.deepEqual(
      applyMediaProxyHeaderRules(url, {}),
      {
        Origin: origin,
        Referer: `${origin}/`,
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': extractionUserAgent,
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
      },
      `en-têtes attendus pour ${url}`,
    );

    // Un Accept-Language fourni par l'appelant est écrasé, pas relayé : celui
    // de l'appareil (liste de locales du système) n'est pas celui qui a obtenu
    // le jeton, et le CDN répond 403 sur cet écart-là précisément.
    assert.deepEqual(
      applyMediaProxyHeaderRules(url, {
        'accept-language': 'fr-FR,fr;q=0.9,ka-GE;q=0.8,ka;q=0.7',
        'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131.0.0.0',
      }),
      applyMediaProxyHeaderRules(url, {}),
      `identité d'extraction rejouée pour ${url}`,
    );
  }

  const webViewUserAgent =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

  // Les indices client, eux, sont relayés tels quels : le pont les pose à
  // l'identique sur l'extraction et sur la lecture, donc les deux requêtes
  // présentent déjà les mêmes. Aucun indice Chrome-Windows n'est fabriqué
  // par-dessus — un Sec-Ch-Ua Windows sur cet User-Agent-là serait justement
  // l'incohérence que ces CDN sanctionnent.
  assert.deepEqual(
    applyMediaProxyHeaderRules('https://streamhihi.com/hls/master.m3u8', {
      'User-Agent': webViewUserAgent,
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Sec-Ch-Ua': '"Chromium";v="151", "Android WebView";v="151"',
      'Sec-Ch-Ua-Mobile': '?1',
      'Sec-Ch-Ua-Platform': '"Android"',
    }),
    {
      Origin: 'https://lulustream.com',
      Referer: 'https://lulustream.com/',
      'User-Agent': extractionUserAgent,
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Ch-Ua': '"Chromium";v="151", "Android WebView";v="151"',
      'Sec-Ch-Ua-Mobile': '?1',
      'Sec-Ch-Ua-Platform': '"Android"',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
    },
  );

  // Fsvid/Vidzy gardent leur Chrome desktop imposé, identité fournie ou non.
  assert.equal(
    applyMediaProxyHeaderRules('https://u14.vidzy.cc/hls/master.m3u8', {
      'User-Agent': webViewUserAgent,
    })['User-Agent'],
    providerSignedUserAgent,
  );

  // L'apex s1q2105.com n'appartient pas à Vidara : seuls ses sous-domaines
  // servent les segments, comme le dit RE_VIDARA côté relais Python.
  assert.deepEqual(
    applyMediaProxyHeaderRules('https://s1q2105.com/hls/master.m3u8', {
      Referer: 'https://movix.fun/',
    }),
    { Referer: 'https://movix.fun/' },
  );
  // Les apex tnmr.org et veevcdn.co n'appartiennent pas à ces hébergeurs :
  // seuls leurs sous-domaines servent les flux.
  for (const apex of ['https://tnmr.org/hls2/master.m3u8', 'https://veevcdn.co/x']) {
    assert.deepEqual(
      applyMediaProxyHeaderRules(apex, { Referer: 'https://movix.fun/' }),
      { Referer: 'https://movix.fun/' },
      `apex hors règle : ${apex}`,
    );
  }
  // Et un domaine qui se contente de suffixer le nôtre reste hors règle.
  assert.deepEqual(
    applyMediaProxyHeaderRules('https://veev.to.attacker.example/master.m3u8', {
      Referer: 'https://movix.fun/',
    }),
    { Referer: 'https://movix.fun/' },
  );
});
