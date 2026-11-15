'use strict';

const test = require('node:test');
const { mock, beforeEach } = test;
const assert = require('node:assert/strict');

// Journaux attendus pendant ces tests (repli des réglages quand la base tombe).
const EXPECTED_LOG_PREFIXES = ['[Pubs]'];
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  mock.method(console, level, (...args) => {
    const message = String(args[0] ?? '');
    if (EXPECTED_LOG_PREFIXES.some((prefix) => message.startsWith(prefix))) return;
    original(...args);
  });
}

const {
  PLACEMENT_IDS,
  MAX_ADS,
  MONETIZATION_ERROR_CODES,
  MONETIZATION_SETTINGS_TABLE,
  MONETIZATION_SETTINGS_CACHE_TTL_MS,
  DEFAULT_MONETIZATION_SETTINGS,
  getDefaultMonetizationSettings,
  mergeStoredSettings,
  validateSettingsInput,
  isAdLiveNow,
  buildPublicConfig,
  ensureMonetizationSettingsTable,
  loadMonetizationSettings,
  saveMonetizationSettings,
  resetMonetizationSettingsCache
} = require('../../utils/monetizationSettings');
const { getTable, renderCreateTable } = require('../../db/schema');
const { planSchema } = require('../../db/schemaPlanner');
const {
  loadSchemaMetadata,
  LOWER_CASE_TABLE_NAMES_SQL,
  TABLES_SQL,
  COLUMNS_SQL,
  INDEXES_SQL,
  FOREIGN_KEYS_SQL
} = require('../../db/schemaMetadata');

const SAVED_AT = '2026-10-23T08:30:00.000Z';
const NOW = new Date('2026-10-23T12:00:00.000Z');

beforeEach(() => {
  resetMonetizationSettingsCache();
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const EMPTY_SCHEDULE = Object.freeze({ startAt: null, endAt: null, days: [], hours: null });

// Pub complète et valide ; chaque test ne change que ce qui l'intéresse.
function makeAd(overrides = {}) {
  return {
    id: 'regie1abc',
    name: 'Régie 1',
    url: 'https://regie.example.test/go?sub={placement}&c={country}',
    enabled: true,
    placements: ['player'],
    audience: 'all',
    weight: 1,
    schedule: { ...EMPTY_SCHEDULE, days: [] },
    targeting: { devices: [], os: [], countriesMode: 'all', countries: [] },
    caps: { perVisitorPerDay: 0, globalPerDay: 0 },
    note: '',
    ...overrides
  };
}

function withAds(ads, overrides = {}) {
  return { ...getDefaultMonetizationSettings(), ads, ...overrides };
}

function storedRow(settings) {
  return {
    settings_json: JSON.stringify(settings),
    updated_by: 'admin-1',
    updated_at: new Date(SAVED_AT)
  };
}

// Fausse base limitée à la table des réglages.
function createSettingsPool({ row = null } = {}) {
  const state = {
    row,
    selects: 0,
    writes: [],
    ddl: [],
    failSelect: null,
    selectGate: null
  };
  const pool = {
    async execute(sql, params = []) {
      if (/^\s*CREATE TABLE/i.test(sql)) {
        state.ddl.push(sql);
        return [{}, []];
      }
      if (/FROM monetization_settings/i.test(sql)) {
        state.selects += 1;
        assert.deepEqual(params, [1]);
        if (state.failSelect) throw state.failSelect;
        const snapshot = state.row ? { ...state.row } : null;
        if (state.selectGate) {
          const gate = state.selectGate;
          state.selectGate = null;
          await gate;
        }
        return [snapshot ? [snapshot] : [], []];
      }
      if (/INSERT INTO monetization_settings/i.test(sql)) {
        assert.match(sql, /ON DUPLICATE KEY UPDATE/);
        state.writes.push(params);
        state.row = {
          settings_json: params[1],
          updated_by: params[2],
          updated_at: new Date(SAVED_AT)
        };
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`SQL inattendu : ${sql}`);
    }
  };
  return { pool, state };
}

function assertSettingsError(input, pattern, current) {
  assert.throws(
    () => validateSettingsInput(input, current),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'MONETIZATION_SETTINGS_INVALID');
      assert.match(error.message, pattern);
      return true;
    },
    `entrée ${pattern}`
  );
}

// ---------------------------------------------------------------------------
// Valeurs par défaut
// ---------------------------------------------------------------------------

test('les défauts ont 4 emplacements en sequence/global/1 fenêtre et aucune pub', () => {
  assert.deepEqual([...PLACEMENT_IDS], ['player', 'download', 'livetv', 'swiftflux']);
  assert.ok(Object.isFrozen(PLACEMENT_IDS));
  assert.equal(MAX_ADS, 50);
  assert.deepEqual(MONETIZATION_ERROR_CODES, { settingsInvalid: 'MONETIZATION_SETTINGS_INVALID' });
  assert.equal(MONETIZATION_SETTINGS_TABLE, 'monetization_settings');
  assert.equal(MONETIZATION_SETTINGS_CACHE_TTL_MS, 10000);

  const defaults = DEFAULT_MONETIZATION_SETTINGS;
  assert.deepEqual(defaults, {
    enabled: true,
    adultDefault: true,
    placements: Object.fromEntries(PLACEMENT_IDS.map((id) => [id, {
      enabled: true,
      rotation: 'sequence',
      sequenceScope: 'global',
      windowsPerClick: 1,
      fallbackUrl: ''
    }])),
    ads: []
  });
  assert.deepEqual(Object.keys(defaults.placements), [...PLACEMENT_IDS]);
  assert.ok(Object.isFrozen(defaults));
  assert.ok(Object.isFrozen(defaults.placements.swiftflux));
  assert.ok(Object.isFrozen(defaults.ads));

  const copy = getDefaultMonetizationSettings();
  assert.equal(Object.isFrozen(copy), false);
  copy.placements.player.windowsPerClick = 3;
  copy.ads.push(makeAd());
  assert.equal(defaults.placements.player.windowsPerClick, 1);
  assert.equal(defaults.ads.length, 0);
});

// ---------------------------------------------------------------------------
// Validation stricte des enregistrements admin
// ---------------------------------------------------------------------------

test('validateSettingsInput génère un id de 10 caractères hex pour une pub sans id', () => {
  const { id: _ignored, ...withoutId } = makeAd();
  const result = validateSettingsInput({
    ads: [
      withoutId,
      { ...withoutId, name: 'Régie 2', id: null },
      { ...withoutId, name: 'Régie 3', id: '' },
      makeAd({ id: 'gardemoi1', name: 'Régie 4' })
    ]
  });

  const ids = result.ads.map((ad) => ad.id);
  for (const id of ids.slice(0, 3)) {
    assert.match(id, /^[0-9a-f]{10}$/);
  }
  assert.equal(ids[3], 'gardemoi1');
  assert.equal(new Set(ids).size, 4, 'identifiants uniques');
  assert.deepEqual(result.ads.map((ad) => ad.name), ['Régie 1', 'Régie 2', 'Régie 3', 'Régie 4']);
});

test('validateSettingsInput complète une pub minimale et normalise ses champs', () => {
  const result = validateSettingsInput({
    ads: [{
      id: 'minimal01',
      name: '  Régie minimale  ',
      url: '  https://regie.example.test/x?s={placement}  ',
      placements: ['download', 'player']
    }, makeAd({
      id: 'complete1',
      schedule: { startAt: '2026-10-23T14:00:00+02:00', endAt: '2026-11-01T00:00:00Z', days: [6, 0, 6], hours: { from: 22, to: 2 } },
      targeting: { devices: ['mobile', 'mobile'], os: ['ios'], countriesMode: 'include', countries: [' fr', 'BE', 'FR'] },
      caps: { perVisitorPerDay: 2, globalPerDay: 1000000 },
      // Ancien champ retiré : ignoré, sans erreur.
      referrer: 'origin',
      note: '  Mémo  '
    })]
  });

  assert.deepEqual(result.ads[0], {
    id: 'minimal01',
    name: 'Régie minimale',
    url: 'https://regie.example.test/x?s={placement}',
    enabled: true,
    placements: ['download', 'player'],
    audience: 'all',
    weight: 1,
    schedule: { startAt: null, endAt: null, days: [], hours: null },
    targeting: { devices: [], os: [], countriesMode: 'all', countries: [] },
    caps: { perVisitorPerDay: 0, globalPerDay: 0 },
    note: ''
  });
  assert.deepEqual(result.ads[1].schedule, {
    startAt: '2026-10-23T12:00:00.000Z',
    endAt: '2026-11-01T00:00:00.000Z',
    days: [0, 6],
    hours: { from: 22, to: 2 }
  });
  assert.deepEqual(result.ads[1].targeting, {
    devices: ['mobile'],
    os: ['ios'],
    countriesMode: 'include',
    countries: ['FR', 'BE']
  });
  assert.deepEqual(result.ads[1].caps, { perVisitorPerDay: 2, globalPerDay: 1000000 });
  assert.equal(Object.hasOwn(result.ads[1], 'referrer'), false);
  assert.equal(result.ads[1].note, 'Mémo');
  assert.equal(Object.hasOwn(validateSettingsInput({ ads: [makeAd({ extra: 1 })] }).ads[0], 'extra'), false);
});

test('validateSettingsInput refuse : URL non http(s), poids 0 ou 101, emplacement inconnu, aucun emplacement, id en double, 51 pubs, hours from = to, endAt ≤ startAt, pays « FRA », windowsPerClick 4, fallbackUrl « ftp://x »', () => {
  const schedule = (values) => ({ ...EMPTY_SCHEDULE, days: [], ...values });
  const fiftyOne = Array.from({ length: 51 }, (_, index) => makeAd({
    id: `pub${String(index).padStart(4, '0')}`,
    name: `Pub ${index}`
  }));
  const cases = [
    [{ ads: [makeAd({ url: 'ftp://regie.example.test/go' })] }, /^Pub « Régie 1 » : URL invalide/],
    [{ ads: [makeAd({ url: 'javascript:alert(1)' })] }, /^Pub « Régie 1 » : URL invalide/],
    [{ ads: [makeAd({ url: 'regie.example.test/go' })] }, /^Pub « Régie 1 » : URL invalide/],
    [{ ads: [makeAd({ url: `https://regie.example.test/${'a'.repeat(2000)}` })] }, /^Pub « Régie 1 » : URL invalide/],
    [{ ads: [makeAd({ url: '' })] }, /^Pub « Régie 1 » : URL invalide/],
    [{ ads: [makeAd({ weight: 0 })] }, /^Pub « Régie 1 » : le poids/],
    [{ ads: [makeAd({ weight: 101 })] }, /^Pub « Régie 1 » : le poids/],
    [{ ads: [makeAd({ weight: 1.5 })] }, /^Pub « Régie 1 » : le poids/],
    [{ ads: [makeAd({ placements: ['player', 'home'] })] }, /^Pub « Régie 1 » : emplacement « home » inconnu/],
    [{ ads: [makeAd({ placements: [] })] }, /^Pub « Régie 1 » : choisis au moins un emplacement/],
    [{ ads: [makeAd({ placements: 'player' })] }, /^Pub « Régie 1 » : choisis au moins un emplacement/],
    [{ ads: [makeAd({ placements: ['player', 'player'] })] }, /^Pub « Régie 1 » : emplacement « player » en double/],
    [{ ads: [makeAd(), makeAd({ name: 'Régie 2' })] }, /^Pub « Régie 2 » : l'identifiant « regie1abc » est déjà utilisé/],
    [{ ads: [makeAd({ id: 'ABC' })] }, /^Pub « Régie 1 » : identifiant invalide/],
    [{ ads: fiftyOne }, /50 pubs au plus/],
    [{ ads: [makeAd({ schedule: schedule({ hours: { from: 5, to: 5 } }) })] }, /^Pub « Régie 1 » : plage horaire invalide/],
    [{ ads: [makeAd({ schedule: schedule({ hours: { from: 24, to: 2 } }) })] }, /^Pub « Régie 1 » : plage horaire invalide/],
    [{ ads: [makeAd({ schedule: schedule({ hours: { from: 3, to: 0 } }) })] }, /^Pub « Régie 1 » : plage horaire invalide/],
    [
      { ads: [makeAd({ schedule: schedule({ startAt: '2026-10-23T12:00:00Z', endAt: '2026-10-23T12:00:00Z' }) })] },
      /^Pub « Régie 1 » : la date de fin doit être après la date de début/
    ],
    [
      { ads: [makeAd({ schedule: schedule({ startAt: '2026-10-24T00:00:00Z', endAt: '2026-10-23T00:00:00Z' }) })] },
      /^Pub « Régie 1 » : la date de fin doit être après la date de début/
    ],
    [{ ads: [makeAd({ schedule: schedule({ startAt: 'demain' }) })] }, /^Pub « Régie 1 » : date de début invalide/],
    [{ ads: [makeAd({ schedule: schedule({ days: [7] }) })] }, /^Pub « Régie 1 » : jours invalides/],
    [
      { ads: [makeAd({ targeting: { devices: [], os: [], countriesMode: 'include', countries: ['FRA'] } })] },
      /^Pub « Régie 1 » : pays « FRA » invalide/
    ],
    [
      { ads: [makeAd({ targeting: { devices: ['tv'], os: [], countriesMode: 'all', countries: [] } })] },
      /^Pub « Régie 1 » : appareil « tv » inconnu/
    ],
    [{ ads: [makeAd({ audience: 'kids' })] }, /^Pub « Régie 1 » : public/],
    [{ ads: [makeAd({ caps: { perVisitorPerDay: -1, globalPerDay: 0 } })] }, /^Pub « Régie 1 » : plafond/],
    [{ ads: [makeAd({ name: '   ' })] }, /^Pub n° 1 : le nom/],
    [{ ads: [makeAd({ name: 'x'.repeat(81) })] }, /^Pub n° 1 : le nom/],
    [{ ads: [makeAd({ note: 'x'.repeat(501) })] }, /^Pub « Régie 1 » : la note/],
    [{ ads: ['pas une pub'] }, /^Pub n° 1 : un objet est attendu/],
    [{ ads: 'aucune' }, /« Pubs » doit être une liste/],
    [{ placements: { player: { windowsPerClick: 4 } } }, /^Emplacement « Lecteur » : le nombre de fenêtres par clic/],
    [{ placements: { player: { windowsPerClick: 0 } } }, /^Emplacement « Lecteur » : le nombre de fenêtres par clic/],
    [{ placements: { download: { fallbackUrl: 'ftp://x' } } }, /^Emplacement « Téléchargement » : URL de secours invalide/],
    [{ placements: { livetv: { rotation: 'shuffle' } } }, /^Emplacement « TV en direct » : rotation inconnue/],
    [{ placements: { player: { rotation: 'priority' } } }, /^Emplacement « Lecteur » : rotation inconnue/],
    [{ placements: { swiftflux: { sequenceScope: 'user' } } }, /^Emplacement « SwiftFlux » : portée/],
    [{ placements: { player: 'oui' } }, /« Emplacement Lecteur » doit être un objet/],
    [{ enabled: 'oui' }, /« Pubs activées » doit valoir true ou false/],
    [{ adultDefault: 1 }, /« Pubs \+18 par défaut » doit valoir true ou false/],
    [null, /un objet JSON est attendu/],
    [[], /un objet JSON est attendu/]
  ];

  for (const [input, pattern] of cases) {
    assertSettingsError(input, pattern);
  }
});

test('validateSettingsInput garde current pour les clés absentes et remplace ads quand il est fourni', () => {
  const current = validateSettingsInput({
    enabled: false,
    placements: { player: { rotation: 'random', fallbackUrl: 'https://secours.example.test' } },
    ads: [makeAd()]
  });

  const partial = validateSettingsInput({
    adultDefault: false,
    placements: { download: { windowsPerClick: 2 }, inconnu: { enabled: false } },
    futureOption: true
  }, current);
  assert.deepEqual(partial, {
    ...current,
    adultDefault: false,
    placements: {
      ...current.placements,
      download: { ...current.placements.download, windowsPerClick: 2 }
    }
  });
  assert.equal(partial.placements.player.rotation, 'random');
  assert.equal(partial.placements.player.fallbackUrl, 'https://secours.example.test');
  assert.deepEqual(partial.ads, current.ads);
  assert.equal(Object.hasOwn(partial, 'futureOption'), false);
  assert.equal(Object.hasOwn(partial.placements, 'inconnu'), false);

  const replaced = validateSettingsInput({ ads: [makeAd({ id: 'regie2xyz', name: 'Régie 2' })] }, current);
  assert.equal(replaced.enabled, false);
  assert.deepEqual(replaced.ads.map((ad) => ad.id), ['regie2xyz']);
  assert.deepEqual(validateSettingsInput({ ads: [] }, current).ads, []);

  // Des réglages complets valides ressortent identiques.
  assert.deepEqual(validateSettingsInput(structuredClone(current)), current);
  assert.deepEqual(validateSettingsInput(getDefaultMonetizationSettings()), DEFAULT_MONETIZATION_SETTINGS);
});

// ---------------------------------------------------------------------------
// Lecture tolérante d'une ligne stockée
// ---------------------------------------------------------------------------

test('mergeStoredSettings tolère du JSON cassé et écarte une pub sans URL', () => {
  for (const raw of [null, undefined, '', '{pas du json', '[1,2]', '42', 42, [], true, {}]) {
    assert.deepEqual(mergeStoredSettings(raw), DEFAULT_MONETIZATION_SETTINGS, JSON.stringify(raw));
  }

  const { url: _url, ...withoutUrl } = makeAd({ id: 'sansurl1' });
  const { id: _id, ...withoutId } = makeAd({ name: 'Sans id' });
  const merged = mergeStoredSettings(JSON.stringify({
    enabled: 'oui',
    adultDefault: false,
    placements: {
      player: { enabled: 'non', rotation: 'bogus', sequenceScope: 'visitor', windowsPerClick: 9, fallbackUrl: 'https://secours.example.test' },
      download: null,
      // Ancien mode retiré : relu comme une séquence.
      livetv: { rotation: 'priority', fallbackUrl: 'javascript:alert(1)' },
      inconnu: { enabled: false }
    },
    ads: [
      makeAd(),
      withoutUrl,
      makeAd({ id: 'jsurl123', url: 'javascript:alert(1)' }),
      'pas une pub',
      null,
      withoutId,
      makeAd({ name: 'Doublon' }),
      makeAd({ id: 'seulhome', placements: ['home'] }),
      makeAd({ id: 'publicko', audience: 'kids' }),
      { id: 'minimal2', name: 'Minimale', url: 'https://regie2.example.test', placements: ['livetv'] }
    ],
    futureOption: 1
  }));

  assert.equal(merged.enabled, true);
  assert.equal(merged.adultDefault, false);
  assert.deepEqual(merged.placements.player, {
    enabled: true,
    rotation: 'sequence',
    sequenceScope: 'visitor',
    windowsPerClick: 1,
    fallbackUrl: 'https://secours.example.test'
  });
  assert.deepEqual(merged.placements.download, DEFAULT_MONETIZATION_SETTINGS.placements.download);
  assert.equal(merged.placements.livetv.fallbackUrl, '');
  assert.equal(merged.placements.livetv.rotation, 'sequence');
  assert.deepEqual(Object.keys(merged.placements), [...PLACEMENT_IDS]);
  assert.equal(Object.hasOwn(merged, 'futureOption'), false);
  assert.deepEqual(merged.ads.map((ad) => ad.id), ['regie1abc', 'minimal2']);
  assert.deepEqual(merged.ads[1].targeting, { devices: [], os: [], countriesMode: 'all', countries: [] });

  // Champs de premier niveau d'un mauvais type : valeurs par défaut.
  assert.deepEqual(mergeStoredSettings({ placements: [], ads: 'x' }), DEFAULT_MONETIZATION_SETTINGS);

  // Au-delà de 50 pubs, seules les 50 premières sont gardées.
  const many = Array.from({ length: 60 }, (_, index) => makeAd({ id: `pub${String(index).padStart(4, '0')}` }));
  assert.equal(mergeStoredSettings({ ads: many }).ads.length, MAX_ADS);

  // Des réglages valides ressortent inchangés.
  const valid = validateSettingsInput({ ads: [makeAd(), makeAd({ id: 'regie2xyz', audience: 'adult' })] });
  assert.deepEqual(mergeStoredSettings(JSON.stringify(valid)), valid);
});

// ---------------------------------------------------------------------------
// Pub en ligne et config publique
// ---------------------------------------------------------------------------

test('isAdLiveNow suit enabled, startAt et endAt', () => {
  const at = (startAt, endAt) => makeAd({ schedule: { ...EMPTY_SCHEDULE, days: [], startAt, endAt } });
  assert.equal(isAdLiveNow(makeAd(), NOW), true);
  assert.equal(isAdLiveNow(makeAd({ enabled: false }), NOW), false);
  assert.equal(isAdLiveNow(at('2026-10-23T12:00:00.000Z', null), NOW), true, 'début = maintenant');
  assert.equal(isAdLiveNow(at('2026-10-23T12:00:01.000Z', null), NOW), false, 'pas encore commencée');
  assert.equal(isAdLiveNow(at(null, '2026-10-23T12:00:00.000Z'), NOW), false, 'fin = maintenant');
  assert.equal(isAdLiveNow(at(null, '2026-10-23T12:00:01.000Z'), NOW), true);
  assert.equal(isAdLiveNow(at('2026-10-01T00:00:00.000Z', '2026-10-22T00:00:00.000Z'), NOW), false, 'expirée');

  // Bornes alignées sur le picker : startAt inclus, endAt exclu, à la milliseconde.
  const window = at('2026-10-23T12:00:00.000Z', '2026-10-23T13:00:00.000Z');
  assert.equal(isAdLiveNow(window, new Date('2026-10-23T11:59:59.999Z')), false, 'juste avant le début');
  assert.equal(isAdLiveNow(window, new Date('2026-10-23T12:00:00.000Z')), true, 'pile au début');
  assert.equal(isAdLiveNow(window, new Date('2026-10-23T12:59:59.999Z')), true, 'juste avant la fin');
  assert.equal(isAdLiveNow(window, new Date('2026-10-23T13:00:00.000Z')), false, 'pile à la fin');
  // Comme le picker, une date illisible n'est pas une borne.
  assert.equal(isAdLiveNow(at('pas une date', 'toujours pas'), NOW), true);
  // Ni les jours ni les heures ne comptent ici.
  assert.equal(isAdLiveNow(makeAd({ schedule: { ...EMPTY_SCHEDULE, days: [1], hours: { from: 1, to: 2 } } }), NOW), true);
  assert.equal(isAdLiveNow(null, NOW), false);
});

test('buildPublicConfig : 2 pubs adult + 1 sfw sur player → adultCount 2, sfwCount 1 ; seulement des adult → sfwCount 0', () => {
  const settings = validateSettingsInput({
    placements: { player: { windowsPerClick: 3 } },
    ads: [
      makeAd({ id: 'adulte01', audience: 'adult' }),
      makeAd({ id: 'adulte02', audience: 'adult', placements: ['player', 'livetv'] }),
      makeAd({ id: 'sfw00001', audience: 'sfw' }),
      makeAd({ id: 'touslesm', audience: 'all', placements: ['swiftflux'] })
    ]
  });

  const config = buildPublicConfig(settings, NOW);
  assert.deepEqual(config, {
    enabled: true,
    adultDefault: true,
    placements: {
      player: { active: true, adultCount: 2, sfwCount: 1, windowsPerClick: 3 },
      download: { active: false, adultCount: 0, sfwCount: 0, windowsPerClick: 1 },
      livetv: { active: true, adultCount: 1, sfwCount: 0, windowsPerClick: 1 },
      swiftflux: { active: true, adultCount: 1, sfwCount: 1, windowsPerClick: 1 }
    }
  });

  const adultOnly = buildPublicConfig(validateSettingsInput({
    adultDefault: false,
    ads: [makeAd({ id: 'adulte01', audience: 'adult' })]
  }), NOW);
  assert.equal(adultOnly.adultDefault, false);
  assert.deepEqual(adultOnly.placements.player, { active: true, adultCount: 1, sfwCount: 0, windowsPerClick: 1 });
});

test('buildPublicConfig : pub expirée (endAt passé) ou en pause non comptée ; enabled false → tous active: false', () => {
  const ads = [
    makeAd({ id: 'expiree1', schedule: { ...EMPTY_SCHEDULE, days: [], endAt: '2026-10-22T00:00:00.000Z' } }),
    makeAd({ id: 'enpause1', enabled: false }),
    makeAd({ id: 'future01', schedule: { ...EMPTY_SCHEDULE, days: [], startAt: '2026-10-24T00:00:00.000Z' } }),
    makeAd({ id: 'enligne1', placements: ['download'], audience: 'sfw' })
  ];
  const settings = validateSettingsInput({ ads });

  const config = buildPublicConfig(settings, NOW);
  assert.deepEqual(config.placements.player, { active: false, adultCount: 0, sfwCount: 0, windowsPerClick: 1 });
  assert.deepEqual(config.placements.download, { active: true, adultCount: 0, sfwCount: 1, windowsPerClick: 1 });

  // Plus tard, la pub « future » compte à son tour.
  assert.equal(buildPublicConfig(settings, new Date('2026-10-24T00:00:00.000Z')).placements.player.adultCount, 1);

  const off = buildPublicConfig({ ...settings, enabled: false }, NOW);
  assert.equal(off.enabled, false);
  for (const id of PLACEMENT_IDS) {
    assert.equal(off.placements[id].active, false, id);
  }

  const placementOff = buildPublicConfig(validateSettingsInput({
    placements: { download: { enabled: false } }
  }, settings), NOW);
  assert.equal(placementOff.placements.download.active, false);

  // Réglages absents ou abîmés : config des défauts, sans exception.
  for (const broken of [null, {}, { ads: 'x', placements: null }]) {
    const fallback = buildPublicConfig(broken, NOW);
    assert.deepEqual(Object.keys(fallback.placements), [...PLACEMENT_IDS]);
    assert.equal(fallback.placements.player.active, false);
  }
});

test('buildPublicConfig ne contient aucune URL', () => {
  const settings = validateSettingsInput({
    placements: Object.fromEntries(PLACEMENT_IDS.map((id) => [id, { fallbackUrl: `https://secours.example.test/${id}` }])),
    ads: [
      makeAd(),
      makeAd({ id: 'regie2xyz', name: 'Régie 2', url: 'http://autre.example.test/?v={visitor}', placements: [...PLACEMENT_IDS] })
    ]
  });
  const json = JSON.stringify(buildPublicConfig(settings, NOW));
  assert.equal(json.includes('http'), false);
  assert.equal(json.includes('example.test'), false);
  assert.equal(json.includes('regie'), false, 'ni identifiant ni nom de pub');
});

// ---------------------------------------------------------------------------
// Table MySQL
// ---------------------------------------------------------------------------

test('la table monetization_settings est déclarée dans le schéma et créée depuis cette définition', async () => {
  const table = getTable('monetization_settings');
  assert.ok(table);
  assert.equal(table.group, 'monetization');
  assert.equal(table.wrapped, false);
  assert.deepEqual(table.primaryKey, ['id']);
  assert.deepEqual(table.indexes, []);
  assert.deepEqual(table.foreignKeys, []);
  assert.equal(table.options, 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
  assert.deepEqual(table.columns.map((column) => [column.name, column.definition]), [
    ['id', 'TINYINT UNSIGNED NOT NULL'],
    ['settings_json', 'LONGTEXT NOT NULL'],
    ['updated_by', 'VARCHAR(255) DEFAULT NULL'],
    ['created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
    ['updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP']
  ]);

  const { pool, state } = createSettingsPool();
  await ensureMonetizationSettingsTable(pool);
  assert.deepEqual(state.ddl, [renderCreateTable(table)]);
});

test('le planificateur ne voit aucune dérive sur la table telle que MySQL la décrit', async () => {
  const table = getTable('monetization_settings');
  const columnRow = (name, type, nullable, defaultValue, extra, characterSet = null, collation = null) => ({
    TABLE_NAME: 'monetization_settings',
    COLUMN_NAME: name,
    COLUMN_TYPE: type,
    IS_NULLABLE: nullable ? 'YES' : 'NO',
    COLUMN_DEFAULT: defaultValue,
    EXTRA: extra,
    CHARACTER_SET_NAME: characterSet,
    COLLATION_NAME: collation
  });
  // Réponses d'INFORMATION_SCHEMA d'un MySQL 8 après le CREATE TABLE du démarrage.
  const rowsBySql = new Map([
    [LOWER_CASE_TABLE_NAMES_SQL, [{ LOWER_CASE_TABLE_NAMES: 0 }]],
    [TABLES_SQL, [{
      TABLE_NAME: 'monetization_settings',
      ENGINE: 'InnoDB',
      CHARACTER_SET_NAME: 'utf8mb4',
      TABLE_COLLATION: 'utf8mb4_unicode_ci'
    }]],
    [COLUMNS_SQL, [
      columnRow('id', 'tinyint unsigned', false, null, ''),
      columnRow('settings_json', 'longtext', false, null, '', 'utf8mb4', 'utf8mb4_unicode_ci'),
      columnRow('updated_by', 'varchar(255)', true, null, '', 'utf8mb4', 'utf8mb4_unicode_ci'),
      columnRow('created_at', 'timestamp', true, 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'),
      columnRow('updated_at', 'timestamp', true, 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP')
    ]],
    [INDEXES_SQL, [{
      TABLE_NAME: 'monetization_settings',
      INDEX_NAME: 'PRIMARY',
      NON_UNIQUE: 0,
      COLUMN_NAME: 'id',
      EXPRESSION: null,
      SUB_PART: null,
      COLLATION: 'A',
      INDEX_TYPE: 'BTREE',
      IS_VISIBLE: 'YES',
      SEQ_IN_INDEX: 1
    }]],
    [FOREIGN_KEYS_SQL, []]
  ]);
  const metadata = await loadSchemaMetadata({
    async execute(sql) {
      assert.ok(rowsBySql.has(sql), 'requête de métadonnées inattendue');
      return [rowsBySql.get(sql), []];
    }
  });

  assert.deepEqual(planSchema([table], metadata), { operations: [], drift: [] });
});

// ---------------------------------------------------------------------------
// Lecture, cache et enregistrement
// ---------------------------------------------------------------------------

test('save puis load relit la base, cache 10 s, fresh force la relecture', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { pool, state } = createSettingsPool();

  const empty = await loadMonetizationSettings(pool);
  assert.deepEqual(empty, { settings: DEFAULT_MONETIZATION_SETTINGS, updatedAt: null, updatedBy: null });
  assert.equal(state.selects, 1);

  const { id: _id, ...withoutId } = makeAd({ name: 'Nouvelle' });
  const saved = await saveMonetizationSettings(pool, withAds([makeAd(), withoutId]), 'admin-42');
  assert.equal(state.writes.length, 1);
  const [rowId, settingsJson, updatedBy] = state.writes[0];
  assert.equal(rowId, 1);
  assert.equal(updatedBy, 'admin-42');
  assert.deepEqual(JSON.parse(settingsJson), saved.settings);
  assert.equal(saved.updatedAt, SAVED_AT);
  assert.equal(saved.updatedBy, 'admin-42');
  assert.equal(saved.settings.ads[0].id, 'regie1abc');
  const generatedId = saved.settings.ads[1].id;
  assert.match(generatedId, /^[0-9a-f]{10}$/);
  assert.equal(state.selects, 2, 'relecture après écriture');

  // Le worker qui enregistre sert tout de suite la nouvelle version, sans requête.
  const cached = await loadMonetizationSettings(pool);
  assert.equal(state.selects, 2);
  assert.deepEqual(cached, saved);
  cached.settings.ads.pop();
  assert.equal((await loadMonetizationSettings(pool)).settings.ads.length, 2, 'copie indépendante du cache');

  // Une autre écriture (autre worker) n'est vue qu'après 10 s… ou avec fresh.
  state.row = storedRow(withAds([makeAd({ id: 'autrepub1' })], { enabled: false }));
  t.mock.timers.tick(MONETIZATION_SETTINGS_CACHE_TTL_MS - 1);
  assert.equal((await loadMonetizationSettings(pool)).settings.enabled, true);
  assert.equal(state.selects, 2);

  const fresh = await loadMonetizationSettings(pool, { fresh: true });
  assert.equal(fresh.settings.enabled, false);
  assert.deepEqual(fresh.settings.ads.map((ad) => ad.id), ['autrepub1']);
  assert.equal(fresh.updatedBy, 'admin-1');
  assert.equal(state.selects, 3);

  state.row = storedRow(withAds([], { adultDefault: false }));
  assert.equal((await loadMonetizationSettings(pool)).settings.adultDefault, true, 'cache rafraîchi par fresh');
  t.mock.timers.tick(MONETIZATION_SETTINGS_CACHE_TTL_MS + 1);
  assert.equal((await loadMonetizationSettings(pool)).settings.adultDefault, false);
  assert.equal(state.selects, 4);

  // Base en panne : dernière version gardée, une seule tentative par délai.
  state.failSelect = new Error('MySQL indisponible');
  t.mock.timers.tick(MONETIZATION_SETTINGS_CACHE_TTL_MS + 1);
  assert.equal((await loadMonetizationSettings(pool)).settings.adultDefault, false);
  assert.equal(state.selects, 5);
  assert.equal((await loadMonetizationSettings(pool)).settings.adultDefault, false);
  assert.equal(state.selects, 5);
  await assert.rejects(loadMonetizationSettings(pool, { fresh: true }), /MySQL indisponible/);
});

test('des lectures simultanées partagent une seule requête', async () => {
  const { pool, state } = createSettingsPool({ row: storedRow(withAds([makeAd()])) });
  const gate = deferred();
  state.selectGate = gate.promise;
  const reads = [loadMonetizationSettings(pool), loadMonetizationSettings(pool), loadMonetizationSettings(pool)];
  gate.resolve();
  const results = await Promise.all(reads);

  assert.equal(state.selects, 1);
  results[0].settings.ads.pop();
  assert.equal(results[1].settings.ads.length, 1);
});

test('une ligne en base corrompue est lue sans exception', async () => {
  const { pool } = createSettingsPool({
    row: { settings_json: '{"enabled":false,"ads":[{"id":"cassee01"}', updated_by: null, updated_at: null }
  });
  const loaded = await loadMonetizationSettings(pool);
  assert.deepEqual(loaded, { settings: DEFAULT_MONETIZATION_SETTINGS, updatedAt: null, updatedBy: null });
});

test('sans version connue, une base injoignable fait échouer la lecture', async () => {
  const { pool, state } = createSettingsPool();
  state.failSelect = new Error('MySQL indisponible');
  await assert.rejects(loadMonetizationSettings(pool), /MySQL indisponible/);
});

test('un enregistrement invalide n\'écrit rien', async () => {
  const { pool, state } = createSettingsPool();
  await assert.rejects(
    saveMonetizationSettings(pool, withAds([makeAd({ url: 'ftp://x' })]), 'admin-42'),
    { statusCode: 400, code: 'MONETIZATION_SETTINGS_INVALID' }
  );
  assert.equal(state.writes.length, 0);
});

test('si la relecture échoue après l\'écriture, les valeurs écrites sont renvoyées', async () => {
  const { pool, state } = createSettingsPool();
  state.failSelect = new Error('relecture impossible');
  const saved = await saveMonetizationSettings(pool, withAds([makeAd()], { enabled: false }), null);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0][2], null);
  assert.equal(saved.settings.enabled, false);
  assert.equal(saved.updatedBy, null);
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('une lecture lancée avant un enregistrement n\'écrase pas le cache', async () => {
  const { pool, state } = createSettingsPool({ row: storedRow(withAds([], { enabled: true })) });
  const gate = deferred();
  state.selectGate = gate.promise;
  const slowRead = loadMonetizationSettings(pool);

  await saveMonetizationSettings(pool, withAds([], { enabled: false }), 'admin-42');
  gate.resolve();
  assert.equal((await slowRead).settings.enabled, true);

  const selects = state.selects;
  assert.equal((await loadMonetizationSettings(pool)).settings.enabled, false);
  assert.equal(state.selects, selects);
});
