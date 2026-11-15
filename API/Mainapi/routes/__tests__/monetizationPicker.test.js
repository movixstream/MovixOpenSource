'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseUserAgent,
  getParisClock,
  normalizeCountry,
  isAdEligible,
  buildSequenceCycle,
  orderAdsForGesture,
  expandUrlMacros,
  getPlacementCandidates,
  rankAdsForOpening,
  simulateOpenings
} = require('../../utils/monetizationPicker');

// Contrôle indépendant du module testé : jour et heure d'un instant à Paris.
// Les instants des tests sont fixes (UTC) ; ce contrôle garantit qu'ils tombent
// bien à l'heure de Paris annoncée, quel que soit le fuseau du poste.
const PARIS_CHECK_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23'
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parisInstant(iso, expected) {
  const date = new Date(iso);
  const parts = Object.fromEntries(
    PARIS_CHECK_FORMAT.formatToParts(date).map((part) => [part.type, part.value])
  );
  assert.equal(Number(parts.hour) % 24, expected.hour, `${iso} devrait tomber à ${expected.hour} h à Paris`);
  if (expected.day !== undefined) {
    assert.equal(WEEKDAYS.indexOf(parts.weekday), expected.day, `${iso} : mauvais jour à Paris`);
  }
  return date;
}

// Mercredi 15 juillet 2026, midi à Paris.
const NOW = parisInstant('2026-07-15T10:00:00Z', { day: 3, hour: 12 });

function makeAd(letter, overrides = {}) {
  const { schedule, targeting, caps, ...rest } = overrides;
  const slug = letter.toLowerCase();
  return {
    id: `pub${slug.repeat(3)}`,
    name: letter,
    url: `https://regie-${slug}.example/go`,
    enabled: true,
    placements: ['player'],
    audience: 'all',
    weight: 1,
    note: '',
    ...rest,
    schedule: { startAt: null, endAt: null, days: [], hours: null, ...schedule },
    targeting: { devices: [], os: [], countriesMode: 'all', countries: [], ...targeting },
    caps: { perVisitorPerDay: 0, globalPerDay: 0, ...caps }
  };
}

function makeCtx(overrides = {}) {
  return {
    placement: 'player',
    sfw: false,
    device: 'desktop',
    os: 'windows',
    country: 'FR',
    now: NOW,
    visitorCounts: {},
    globalCounts: {},
    ...overrides
  };
}

function makeSettings(ads, playerOverrides = {}) {
  const placement = {
    enabled: true,
    rotation: 'sequence',
    sequenceScope: 'global',
    windowsPerClick: 1,
    fallbackUrl: ''
  };
  return {
    enabled: true,
    adultDefault: true,
    placements: {
      player: { ...placement, ...playerOverrides },
      download: { ...placement },
      livetv: { ...placement },
      swiftflux: { ...placement }
    },
    ads
  };
}

const ADULT_FR_DESKTOP = Object.freeze({ sfw: false, device: 'desktop', os: 'windows', country: 'FR' });

function range(length) {
  return Array.from({ length }, (_, index) => index);
}

function idsOf(ads) {
  return new Set(ads.map((ad) => ad.id));
}

function namesOf(ads) {
  return ads.map((ad) => ad.name);
}

// Première pub (fenêtre 0) de chaque ouverture, une ouverture par base.
function sequenceFirstNames(candidates, bases, eligibleIds = idsOf(candidates)) {
  return bases.map((base) => {
    const ordered = orderAdsForGesture({ candidates, eligibleIds, rotation: 'sequence', base, seed: 'inutile' });
    return ordered[0]?.name ?? null;
  });
}

test('sequence A(3) B(1) C(2) donne A A A B C C A sur 7 ouvertures', () => {
  const candidates = [makeAd('A', { weight: 3 }), makeAd('B'), makeAd('C', { weight: 2 })];

  assert.deepEqual(buildSequenceCycle(candidates), [
    'pubaaa', 'pubaaa', 'pubaaa', 'pubbbb', 'pubccc', 'pubccc'
  ]);
  assert.deepEqual(sequenceFirstNames(candidates, range(7)), ['A', 'A', 'A', 'B', 'C', 'C', 'A']);
});

test('sequence A(1) B(1) alterne A B A B', () => {
  const candidates = [makeAd('A'), makeAd('B')];

  assert.deepEqual(sequenceFirstNames(candidates, range(4)), ['A', 'B', 'A', 'B']);
  // Compteur très grand (worker resté longtemps en vie) ou négatif : toujours dans le cycle.
  assert.deepEqual(sequenceFirstNames(candidates, [1000000001, -1]), ['B', 'B']);
});

test('sequence saute la case d\'une pub non éligible et garde l\'ordre des autres', () => {
  const candidates = [makeAd('A'), makeAd('B'), makeAd('C')];
  const eligibleIds = new Set(['pubaaa', 'pubccc']);

  assert.deepEqual(sequenceFirstNames(candidates, range(6), eligibleIds), ['A', 'C', 'C', 'A', 'C', 'C']);
  assert.deepEqual(
    namesOf(orderAdsForGesture({ candidates, eligibleIds, rotation: 'sequence', base: 1, seed: 'x' })),
    ['C', 'A']
  );
  assert.deepEqual(
    orderAdsForGesture({ candidates, eligibleIds: new Set(), rotation: 'sequence', base: 0, seed: 'x' }),
    []
  );
});

test('deux fenêtres du même geste en sequence reçoivent deux pubs différentes', () => {
  const candidates = [makeAd('A', { weight: 3 }), makeAd('B'), makeAd('C', { weight: 2 })];
  const eligibleIds = idsOf(candidates);
  const order = (base) => namesOf(orderAdsForGesture({ candidates, eligibleIds, rotation: 'sequence', base, seed: 'g' }));

  for (const base of range(6)) {
    const names = order(base);
    assert.equal(names.length, 3);
    assert.equal(new Set(names).size, 3, `base ${base} : pub en double`);
  }
  // La fenêtre 0 prend la case courante, les suivantes la prochaine pub différente du cycle.
  assert.deepEqual(order(0), ['A', 'B', 'C']);
  assert.deepEqual(order(4), ['C', 'A', 'B']);
  // Une seule pub éligible : une seule fenêtre servie, la suivante se fermera.
  assert.deepEqual(
    namesOf(orderAdsForGesture({ candidates, eligibleIds: new Set(['pubbbb']), rotation: 'sequence', base: 0, seed: 'g' })),
    ['B']
  );
});

test('random : même seed → même ordre ; 10 000 tirages A(3)/B(1) ≈ 75 % ± 3 %', () => {
  const candidates = [makeAd('A', { weight: 3 }), makeAd('B')];
  const eligibleIds = idsOf(candidates);
  const draw = (seed, base = 0) => namesOf(orderAdsForGesture({ candidates, eligibleIds, rotation: 'random', base, seed }));

  assert.deepEqual(draw('geste1234'), draw('geste1234'));
  // La base ne compte pas en random : seule la seed décide.
  assert.deepEqual(draw('geste1234', 0), draw('geste1234', 7));

  let firstA = 0;
  for (let index = 0; index < 10000; index += 1) {
    const order = draw(`geste${index}`);
    assert.equal(order.length, 2);
    assert.notEqual(order[0], order[1]);
    if (order[0] === 'A') firstA += 1;
  }
  const share = firstA / 10000;
  assert.ok(share >= 0.72 && share <= 0.78, `part de A en première fenêtre : ${share}`);

  // Une pub non éligible n'est jamais tirée, même avec un gros poids.
  const withC = [...candidates, makeAd('C', { weight: 100 })];
  for (let index = 0; index < 200; index += 1) {
    const order = namesOf(orderAdsForGesture({ candidates: withC, eligibleIds, rotation: 'random', base: 0, seed: `s${index}` }));
    assert.ok(!order.includes('C'), `seed s${index} : C tirée`);
  }
});

test('plage 22→2 : 23 h et 1 h éligibles, 3 h non', () => {
  const ad = makeAd('A', { schedule: { hours: { from: 22, to: 2 } } });
  const at = (iso, hour) => isAdEligible(ad, makeCtx({ now: parisInstant(iso, { hour }) }));

  // Été (UTC+2).
  assert.equal(at('2026-07-15T19:00:00Z', 21), false);
  assert.equal(at('2026-07-15T20:00:00Z', 22), true);
  assert.equal(at('2026-07-15T21:00:00Z', 23), true);
  assert.equal(at('2026-07-15T23:00:00Z', 1), true);
  assert.equal(at('2026-07-16T00:00:00Z', 2), false);
  assert.equal(at('2026-07-16T01:00:00Z', 3), false);
  // Hiver (UTC+1).
  assert.equal(at('2026-01-15T22:00:00Z', 23), true);
  assert.equal(at('2026-01-16T00:00:00Z', 1), true);
  assert.equal(at('2026-01-16T02:00:00Z', 3), false);

  const office = makeAd('B', { schedule: { hours: { from: 9, to: 17 } } });
  assert.equal(isAdEligible(office, makeCtx({ now: parisInstant('2026-07-15T14:30:00Z', { hour: 16 }) })), true);
  assert.equal(isAdEligible(office, makeCtx({ now: parisInstant('2026-07-15T15:00:00Z', { hour: 17 }) })), false);

  const evening = makeAd('C', { schedule: { hours: { from: 20, to: 24 } } });
  assert.equal(isAdEligible(evening, makeCtx({ now: parisInstant('2026-07-15T21:00:00Z', { hour: 23 }) })), true);
  assert.equal(isAdEligible(evening, makeCtx({ now: parisInstant('2026-07-16T22:00:00Z', { hour: 0 }) })), false);
});

test('jours : days [1] (lundi) refuse un dimanche à Paris', () => {
  // Samedi 22 h 30 en UTC, mais déjà dimanche 0 h 30 à Paris.
  const sunday = parisInstant('2026-10-17T22:30:00Z', { day: 0, hour: 0 });
  const monday = parisInstant('2026-10-18T22:30:00Z', { day: 1, hour: 0 });
  const withDays = (days) => makeAd('A', { schedule: { days } });

  assert.equal(isAdEligible(withDays([1]), makeCtx({ now: sunday })), false);
  assert.equal(isAdEligible(withDays([0]), makeCtx({ now: sunday })), true);
  assert.equal(isAdEligible(withDays([6]), makeCtx({ now: sunday })), false);
  assert.equal(isAdEligible(withDays([1]), makeCtx({ now: monday })), true);
  assert.equal(isAdEligible(withDays([]), makeCtx({ now: sunday })), true);
});

test('getParisClock lit le jour, l\'heure et la date à Paris', () => {
  assert.deepEqual(getParisClock(new Date('2026-10-17T22:30:00Z')), { day: 0, hour: 0, dateKey: '2026-10-18' });
  assert.deepEqual(getParisClock(new Date('2026-01-01T12:00:00Z')), { day: 4, hour: 13, dateKey: '2026-01-01' });
  assert.deepEqual(getParisClock(new Date('2026-12-31T23:30:00Z')), { day: 5, hour: 0, dateKey: '2027-01-01' });
});

test('ciblage : include [FR] refuse BE et null ; exclude [FR] accepte null', () => {
  const include = makeAd('A', { targeting: { countriesMode: 'include', countries: ['FR'] } });
  const exclude = makeAd('B', { targeting: { countriesMode: 'exclude', countries: ['FR'] } });

  assert.equal(isAdEligible(include, makeCtx({ country: 'FR' })), true);
  assert.equal(isAdEligible(include, makeCtx({ country: 'fr' })), true);
  assert.equal(isAdEligible(include, makeCtx({ country: 'BE' })), false);
  assert.equal(isAdEligible(include, makeCtx({ country: null })), false);
  // « XX » = pays inconnu pour Cloudflare, « T1 » = Tor : traités comme null.
  assert.equal(isAdEligible(include, makeCtx({ country: 'XX' })), false);
  assert.equal(isAdEligible(exclude, makeCtx({ country: 'FR' })), false);
  assert.equal(isAdEligible(exclude, makeCtx({ country: 'BE' })), true);
  assert.equal(isAdEligible(exclude, makeCtx({ country: null })), true);
  assert.equal(isAdEligible(exclude, makeCtx({ country: 'T1' })), true);

  assert.equal(normalizeCountry(' be '), 'BE');
  assert.equal(normalizeCountry('XX'), null);
  assert.equal(normalizeCountry('FRA'), null);
  assert.equal(normalizeCountry(undefined), null);

  const appleMobile = makeAd('C', { targeting: { devices: ['mobile', 'tablet'], os: ['ios'] } });
  assert.equal(isAdEligible(appleMobile, makeCtx({ device: 'tablet', os: 'ios' })), true);
  assert.equal(isAdEligible(appleMobile, makeCtx({ device: 'desktop', os: 'ios' })), false);
  assert.equal(isAdEligible(appleMobile, makeCtx({ device: 'mobile', os: 'android' })), false);
});

test('audience : sfw=true refuse adult ; sfw=false refuse sfw', () => {
  const adult = makeAd('A', { audience: 'adult' });
  const sfw = makeAd('B', { audience: 'sfw' });
  const everyone = makeAd('C', { audience: 'all' });

  assert.equal(isAdEligible(adult, makeCtx({ sfw: true })), false);
  assert.equal(isAdEligible(adult, makeCtx({ sfw: false })), true);
  assert.equal(isAdEligible(sfw, makeCtx({ sfw: false })), false);
  assert.equal(isAdEligible(sfw, makeCtx({ sfw: true })), true);
  assert.equal(isAdEligible(everyone, makeCtx({ sfw: true })), true);
  assert.equal(isAdEligible(everyone, makeCtx({ sfw: false })), true);
});

test('une pub en pause, hors emplacement ou hors de ses dates n\'est pas éligible', () => {
  assert.equal(isAdEligible(makeAd('A', { enabled: false }), makeCtx()), false);
  assert.equal(isAdEligible(makeAd('A', { placements: ['download'] }), makeCtx()), false);
  assert.equal(isAdEligible(makeAd('A', { placements: ['download', 'player'] }), makeCtx()), true);

  const future = makeAd('A', { schedule: { startAt: '2026-07-15T10:00:01.000Z' } });
  const started = makeAd('A', { schedule: { startAt: '2026-07-15T10:00:00.000Z' } });
  const expired = makeAd('A', { schedule: { endAt: '2026-07-15T10:00:00.000Z' } });
  const running = makeAd('A', { schedule: { startAt: '2026-07-01T00:00:00.000Z', endAt: '2026-08-01T00:00:00.000Z' } });
  assert.equal(isAdEligible(future, makeCtx()), false);
  assert.equal(isAdEligible(started, makeCtx()), true);
  assert.equal(isAdEligible(expired, makeCtx()), false);
  assert.equal(isAdEligible(running, makeCtx()), true);
});

test('plafonds : perVisitorPerDay 2 refuse à 2 ; globalPerDay 0 = illimité', () => {
  const perVisitor = makeAd('A', { caps: { perVisitorPerDay: 2, globalPerDay: 0 } });
  assert.equal(isAdEligible(perVisitor, makeCtx({ visitorCounts: { pubaaa: 1 } })), true);
  assert.equal(isAdEligible(perVisitor, makeCtx({ visitorCounts: { pubaaa: 2 } })), false);
  assert.equal(isAdEligible(perVisitor, makeCtx({ globalCounts: { pubaaa: 999999 } })), true);

  const global = makeAd('B', { caps: { perVisitorPerDay: 0, globalPerDay: 3 } });
  assert.equal(isAdEligible(global, makeCtx({ globalCounts: { pubbbb: 2 } })), true);
  assert.equal(isAdEligible(global, makeCtx({ globalCounts: { pubbbb: 3 } })), false);
  assert.equal(isAdEligible(global, makeCtx({ visitorCounts: { pubbbb: 1000 } })), true);
});

test('parseUserAgent : iPhone → mobile/ios ; iPad → tablet/ios ; Android sans « Mobile » → tablet/android ; Windows → desktop/windows ; Googlebot → isBot', () => {
  const cases = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      { device: 'mobile', os: 'ios', isBot: false }],
    ['Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
      { device: 'tablet', os: 'ios', isBot: false }],
    ['Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      { device: 'tablet', os: 'android', isBot: false }],
    ['Mozilla/5.0 (Android 14; Tablet; rv:131.0) Gecko/131.0 Firefox/131.0',
      { device: 'tablet', os: 'android', isBot: false }],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      { device: 'mobile', os: 'android', isBot: false }],
    // Téléphone Cubot : « bot » dans le modèle, ce n'est pas un robot.
    ['Mozilla/5.0 (Linux; Android 12; CUBOT KINGKONG 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      { device: 'mobile', os: 'android', isBot: false }],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      { device: 'desktop', os: 'windows', isBot: false }],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      { device: 'desktop', os: 'mac', isBot: false }],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
      { device: 'desktop', os: 'linux', isBot: false }],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      { device: 'desktop', os: 'other', isBot: false }],
    ['', { device: 'desktop', os: 'other', isBot: false }],
    [undefined, { device: 'desktop', os: 'other', isBot: false }]
  ];
  for (const [ua, expected] of cases) {
    assert.deepEqual(parseUserAgent(ua), expected, `UA : ${ua}`);
  }

  const bots = [
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.69 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'TelegramBot (like TwitterBot)',
    'WhatsApp/2.23.20.0',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
    'curl/8.4.0',
    'python-requests/2.32.3'
  ];
  for (const ua of bots) {
    assert.equal(parseUserAgent(ua).isBot, true, `robot non reconnu : ${ua}`);
  }
});

test('expandUrlMacros encode les valeurs et vide les macros inconnues de valeur', () => {
  const url = 'https://regie.example/c?p={placement}&geo={country}&dev={device}&os={os}&hl={lang}&sub={visitor}&r={rand}&t={ts}&x={autre}';

  assert.equal(
    expandUrlMacros(url, {
      placement: 'player',
      country: 'FR',
      device: 'mobile',
      os: 'ios',
      lang: 'fr',
      visitor: 'a&b c/d',
      rand: 42,
      ts: 0
    }),
    'https://regie.example/c?p=player&geo=FR&dev=mobile&os=ios&hl=fr&sub=a%26b%20c%2Fd&r=42&t=0&x={autre}'
  );
  // Valeur absente ou null : macro vidée. Macro qui n'existe pas : laissée telle quelle.
  assert.equal(
    expandUrlMacros(url, { placement: 'download', country: null }),
    'https://regie.example/c?p=download&geo=&dev=&os=&hl=&sub=&r=&t=&x={autre}'
  );
  assert.equal(expandUrlMacros('https://r.example/{placement}/{PLACEMENT}', { placement: 'livetv' }), 'https://r.example/livetv/livetv');
  assert.equal(expandUrlMacros('https://r.example/sans-macro', {}), 'https://r.example/sans-macro');
});

test('simulateOpenings sur A(2) B(1) rend A A B A A B', () => {
  const settings = makeSettings([makeAd('A', { weight: 2 }), makeAd('B')]);
  const openings = simulateOpenings({ settings, placement: 'player', profile: ADULT_FR_DESKTOP, count: 6, now: NOW });

  assert.deepEqual(openings.map((opening) => opening.name), ['A', 'A', 'B', 'A', 'A', 'B']);
  assert.deepEqual(openings[0], { adId: 'pubaaa', name: 'A' });
  assert.deepEqual(openings[2], { adId: 'pubbbb', name: 'B' });
  // 12 ouvertures par défaut.
  assert.equal(simulateOpenings({ settings, placement: 'player', profile: ADULT_FR_DESKTOP, now: NOW }).length, 12);
});

test('simulateOpenings compte les plafonds en mémoire et rend null quand rien ne sort', () => {
  const profile = ADULT_FR_DESKTOP;
  const names = (settings, placement = 'player') =>
    simulateOpenings({ settings, placement, profile, count: 6, now: NOW }).map((opening) => opening.name);

  const perVisitor = makeSettings([makeAd('A', { weight: 2, caps: { perVisitorPerDay: 2 } }), makeAd('B')]);
  assert.deepEqual(names(perVisitor), ['A', 'A', 'B', 'B', 'B', 'B']);

  const global = makeSettings([makeAd('A'), makeAd('B', { caps: { globalPerDay: 1 } })]);
  assert.deepEqual(names(global), ['A', 'B', 'A', 'A', 'A', 'A']);

  const random = makeSettings([makeAd('A', { weight: 3 }), makeAd('B')], { rotation: 'random' });
  assert.deepEqual(names(random), names(random));

  const empty = { adId: null, name: null };
  const adultOnly = makeSettings([makeAd('A', { audience: 'adult' })]);
  assert.deepEqual(
    simulateOpenings({ settings: adultOnly, placement: 'player', profile: { ...profile, sfw: true }, count: 3, now: NOW }),
    [empty, empty, empty]
  );
  assert.deepEqual(names(makeSettings([makeAd('A')], { enabled: false })), [null, null, null, null, null, null]);
  assert.deepEqual(names({ ...makeSettings([makeAd('A')]), enabled: false }), [null, null, null, null, null, null]);
  assert.deepEqual(names(makeSettings([makeAd('A')]), 'inconnu'), [null, null, null, null, null, null]);
});

test('rankAdsForOpening : le cycle ne garde que les pubs de l\'audience et du ciblage du visiteur', () => {
  const settings = makeSettings([
    makeAd('A', { audience: 'adult' }),
    makeAd('B', { audience: 'sfw' }),
    makeAd('C'),
    makeAd('D', { targeting: { countriesMode: 'include', countries: ['BE'] } })
  ]);
  const first = (profile, base) => rankAdsForOpening({
    settings,
    placement: 'player',
    profile,
    now: NOW,
    base,
    seed: 'x',
    visitorCounts: {},
    globalCounts: {}
  })[0]?.name ?? null;

  // A et C seulement pour un adulte en France : A C A C, pas A C C A.
  assert.deepEqual(range(4).map((base) => first(ADULT_FR_DESKTOP, base)), ['A', 'C', 'A', 'C']);
  assert.deepEqual(range(4).map((base) => first({ ...ADULT_FR_DESKTOP, sfw: true }, base)), ['B', 'C', 'B', 'C']);
  assert.deepEqual(
    namesOf(getPlacementCandidates({ settings, placement: 'player', profile: { ...ADULT_FR_DESKTOP, country: 'be' }, now: NOW })),
    ['A', 'C', 'D']
  );
});
