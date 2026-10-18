'use strict';

const test = require('node:test');
const { mock, beforeEach } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const axios = require('axios');

// Aucun appel réseau : la chaîne de require de vipDonations charge proxyManager.
mock.method(axios, 'get', async (url) => {
  if (String(url).startsWith('https://api.proxyscrape.com/')) return { data: '' };
  throw new Error(`Requête HTTP inattendue : ${url}`);
});

// Journaux attendus pendant ces tests (dotenv, proxys, repli des réglages).
const EXPECTED_LOG_PREFIXES = ['[dotenv@', '[WIFLIX FREE PROXY]', '[VIP]', 'VIP donation settings'];
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  mock.method(console, level, (...args) => {
    const message = String(args[0] ?? '');
    if (EXPECTED_LOG_PREFIXES.some((prefix) => message.startsWith(prefix))) return;
    original(...args);
  });
}

const settingsModule = require('../../utils/vipDonationSettings');
const {
  DEFAULT_VIP_DONATION_SETTINGS,
  VIP_DONATION_METHOD_IDS,
  VIP_GIFT_CARD_IDS,
  VIP_DONATION_CONTACT_KEYS,
  VIP_DONATION_SETTINGS_CACHE_TTL_MS,
  MAX_VIP_MONTHS,
  getDefaultVipDonationSettings,
  mergeStoredSettings,
  validateSettingsInput,
  getVipMonthsForAmount,
  resolveDonationAmount,
  getVipDonationAvailability,
  ensureVipDonationSettingsTable,
  loadVipDonationSettings,
  saveVipDonationSettings,
  resetVipDonationSettingsCache
} = settingsModule;
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
const {
  createVipInvoice,
  ensureVipDonationsTables,
  buildDurationLabel
} = require('../../utils/vipDonations');

const SAVED_AT = '2026-10-12T08:30:00.000Z';

beforeEach(() => {
  resetVipDonationSettingsCache();
});

function setEnv(t, values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function withDefaults(overrides = {}) {
  return { ...getDefaultVipDonationSettings(), ...overrides };
}

function storedRow(overrides = {}) {
  return {
    settings_json: JSON.stringify(withDefaults(overrides)),
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
    failWrite: null,
    selectGate: null
  };
  const pool = {
    async execute(sql, params = []) {
      if (/^\s*CREATE TABLE/i.test(sql)) {
        state.ddl.push(sql);
        return [{}, []];
      }
      if (/FROM vip_donation_settings/i.test(sql)) {
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
      if (/INSERT INTO vip_donation_settings/i.test(sql)) {
        assert.match(sql, /ON DUPLICATE KEY UPDATE/);
        if (state.failWrite) throw state.failWrite;
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

function assertSettingsError(input, message, current) {
  assert.throws(
    () => validateSettingsInput(input, current),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'VIP_DONATION_SETTINGS_INVALID');
      assert.equal(error.message, message);
      return true;
    }
  );
}

function assertAmountError(amountInput, settings, message) {
  assert.throws(
    () => resolveDonationAmount(amountInput, settings),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'VIP_DONATION_AMOUNT_INVALID');
      assert.equal(error.message, message);
      return true;
    },
    `montant ${JSON.stringify(amountInput)}`
  );
}

// ---------------------------------------------------------------------------
// Valeurs par défaut et calcul de durée
// ---------------------------------------------------------------------------

test('les valeurs par défaut sont figées et suivent la forme du frontend', () => {
  const defaults = DEFAULT_VIP_DONATION_SETTINGS;
  assert.ok(Object.isFrozen(defaults));
  assert.ok(Object.isFrozen(defaults.suggestedAmounts));
  assert.ok(Object.isFrozen(defaults.methods.btc));
  assert.ok(Object.isFrozen(defaults.giftCards.eneba));
  assert.ok(Object.isFrozen(defaults.contacts));
  assert.deepEqual(Object.keys(defaults), [
    'donationsEnabled',
    'pausedMessage',
    'giftOptionEnabled',
    'freeAmountEnabled',
    'minAmountEur',
    'maxAmountEur',
    'eurosPerVipYear',
    'suggestedAmounts',
    'defaultAmountEur',
    'defaultMethod',
    'methods',
    'giftCards',
    'contacts'
  ]);
  assert.deepEqual(Object.keys(defaults.methods), [...VIP_DONATION_METHOD_IDS]);
  assert.deepEqual(Object.keys(defaults.giftCards), [...VIP_GIFT_CARD_IDS]);
  assert.deepEqual(Object.keys(defaults.contacts), [...VIP_DONATION_CONTACT_KEYS]);
  assert.deepEqual(defaults.giftCards, {
    google_play: { enabled: true, url: 'https://www.amazon.fr/dp/B0FTV4P7FZ' },
    amazon: { enabled: true, url: 'https://www.amazon.fr/dp/B07S2GM42J' },
    paysafecard: { enabled: true, url: 'https://www.paysafecard.com/fr-fr/trouver-un-point-de-vente/' },
    eneba: { enabled: true, url: 'https://www.eneba.com/fr/store/eneba-gift-cards' }
  });

  const copy = getDefaultVipDonationSettings();
  assert.equal(Object.isFrozen(copy), false);
  copy.methods.btc.enabled = false;
  copy.suggestedAmounts.push(50);
  assert.equal(defaults.methods.btc.enabled, true);
  assert.deepEqual(defaults.suggestedAmounts, [5, 10, 20]);
});

test('la durée suit le taux : 5 € = 12 mois, arrondi au mois supérieur', () => {
  for (const [amountEur, months] of [
    [5, 12],
    [7, 17],
    [8, 20],
    [10, 24],
    [15, 36],
    [20, 48],
    [500, 1200]
  ]) {
    assert.equal(getVipMonthsForAmount(amountEur, 5), months, `${amountEur} €`);
  }
  assert.equal(getVipMonthsForAmount(5, 4), 15);
  assert.equal(getVipMonthsForAmount(12.3, 5), 30);
  assert.equal(getVipMonthsForAmount(1, 12), 1);
  assert.equal(getVipMonthsForAmount(1, 13), 1);
  assert.equal(getVipMonthsForAmount(1, 1000), 1);
  // (0,1 × 12) / 0,1 vaut 12,000000000000002 en flottant : la marge garde 12.
  assert.equal(getVipMonthsForAmount(0.1, 0.1), 12);

  for (const [amountEur, rate] of [
    [Number.NaN, 5],
    ['7', 5],
    [7, '5'],
    [0, 5],
    [-5, 5],
    [7, 0],
    [7, -1],
    [Infinity, 5],
    [7, Infinity]
  ]) {
    assert.equal(getVipMonthsForAmount(amountEur, rate), 0, `${amountEur} € à ${rate}`);
  }
});

test('vipYears tient dans un DECIMAL(5,2) et redonne exactement les mois à la livraison', () => {
  assert.ok(MAX_VIP_MONTHS >= 1200);
  // À 12 € les 12 mois, chaque euro vaut un mois : on parcourt toutes les durées.
  const oneEuroPerMonth = withDefaults({ minAmountEur: 1, maxAmountEur: 20000, eurosPerVipYear: 12 });

  for (let months = 1; months <= MAX_VIP_MONTHS; months += 1) {
    const donation = resolveDonationAmount(months, oneEuroPerMonth);
    assert.equal(donation.vipMonths, months);
    // Relu depuis MySQL : DECIMAL(5,2) renvoyé en texte à deux décimales.
    const storedYears = Number(donation.vipYears.toFixed(2));
    assert.equal(storedYears, donation.vipYears, `${months} mois`);
    assert.ok(storedYears <= 999.99, `${months} mois`);
    // Même conversion que deliverInvoiceIfReady.
    assert.equal(Math.max(1, Math.round(storedYears * 12)), months, `${months} mois`);
    const expectedLabel = months % 12 === 0
      ? `${months / 12} ${months / 12 > 1 ? 'ans' : 'an'}`
      : `${months} mois`;
    assert.equal(buildDurationLabel(storedYears), expectedLabel);
  }

  assertAmountError(
    MAX_VIP_MONTHS + 1,
    oneEuroPerMonth,
    'Montant invalide : ce don dépasse la durée VIP maximale.'
  );
});

// ---------------------------------------------------------------------------
// Montant d'un don
// ---------------------------------------------------------------------------

test('un montant libre entier donne la durée au taux réglé', () => {
  assert.deepEqual(resolveDonationAmount(7), { amountEur: 7, vipMonths: 17, vipYears: 1.42 });
  assert.deepEqual(resolveDonationAmount(8, withDefaults()), { amountEur: 8, vipMonths: 20, vipYears: 1.67 });
  assert.deepEqual(resolveDonationAmount(5, withDefaults()), { amountEur: 5, vipMonths: 12, vipYears: 1 });
  assert.deepEqual(resolveDonationAmount('10', withDefaults()), { amountEur: 10, vipMonths: 24, vipYears: 2 });
  assert.deepEqual(resolveDonationAmount(' 20 ', withDefaults()), { amountEur: 20, vipMonths: 48, vipYears: 4 });
  assert.deepEqual(resolveDonationAmount('7.00', withDefaults()), { amountEur: 7, vipMonths: 17, vipYears: 1.42 });
  assert.deepEqual(resolveDonationAmount(500, withDefaults()), { amountEur: 500, vipMonths: 1200, vipYears: 100 });
  assert.deepEqual(
    resolveDonationAmount(5, withDefaults({ eurosPerVipYear: 4 })),
    { amountEur: 5, vipMonths: 15, vipYears: 1.25 }
  );
});

test('un montant hors bornes ou non entier est refusé avec un message clair', () => {
  const settings = withDefaults();
  for (const amountEur of [4, 501, 0, -5, '4', '1000']) {
    assertAmountError(amountEur, settings, 'Montant invalide : choisis un montant entre 5 € et 500 €.');
  }
  for (const amountEur of [7.5, '7.5', 'abc', '', '  ', null, undefined, true, Number.NaN, Infinity, '1e3', '0x10', '-5', [7], { amount: 7 }]) {
    assertAmountError(amountEur, settings, 'Montant invalide : le don doit être un nombre entier d\'euros.');
  }
  assertAmountError(
    10,
    withDefaults({ minAmountEur: 20, maxAmountEur: 50, suggestedAmounts: [20], defaultAmountEur: 20 }),
    'Montant invalide : choisis un montant entre 20 € et 50 €.'
  );
});

test('sans montant libre, seuls les montants proposés passent', () => {
  const settings = withDefaults({ freeAmountEnabled: false });
  assert.deepEqual(resolveDonationAmount(10, settings), { amountEur: 10, vipMonths: 24, vipYears: 2 });
  assert.deepEqual(resolveDonationAmount('20', settings), { amountEur: 20, vipMonths: 48, vipYears: 4 });
  for (const amountEur of [7, 15, 499]) {
    assertAmountError(
      amountEur,
      settings,
      'Montant invalide : choisis l\'un des montants proposés (5 €, 10 €, 20 €).'
    );
  }
});

test('un petit don donne au moins 1 mois, un réglage qui n\'en donne aucun est refusé', () => {
  // 5 € à 100 € les 12 mois = 0,6 mois, arrondi au mois supérieur.
  assert.deepEqual(
    resolveDonationAmount(5, withDefaults({ eurosPerVipYear: 100 })),
    { amountEur: 5, vipMonths: 1, vipYears: 0.08 }
  );
  // Garde-fou pour des réglages non normalisés : 0 € ou taux nul.
  for (const [amountEur, settings] of [
    [0, withDefaults({ minAmountEur: 0 })],
    [5, withDefaults({ eurosPerVipYear: 0 })]
  ]) {
    assertAmountError(
      amountEur,
      settings,
      'Montant invalide : ce don est trop petit pour offrir au moins 1 mois de VIP.'
    );
  }
});

// ---------------------------------------------------------------------------
// Lecture tolérante d'une ligne stockée
// ---------------------------------------------------------------------------

test('une ligne absente, illisible ou d\'un autre type donne les valeurs par défaut', () => {
  for (const raw of [null, undefined, '', 'pas du json', '[1,2]', '42', 42, [], true, { }]) {
    assert.deepEqual(mergeStoredSettings(raw), DEFAULT_VIP_DONATION_SETTINGS, JSON.stringify(raw));
  }
});

test('une ligne d\'une ancienne version garde ses valeurs et complète le reste', () => {
  const merged = mergeStoredSettings(JSON.stringify({
    donationsEnabled: false,
    minAmountEur: 3,
    suggestedAmounts: [3, 8],
    defaultAmountEur: 8,
    methods: { btc: { enabled: false } },
    giftCards: { amazon: { url: 'https://www.amazon.fr/autre' } },
    contacts: { telegramUsername: '  NouveauPseudo  ' }
  }));

  assert.deepEqual(merged, {
    ...withDefaults(),
    donationsEnabled: false,
    minAmountEur: 3,
    suggestedAmounts: [3, 8],
    defaultAmountEur: 8,
    methods: { ...DEFAULT_VIP_DONATION_SETTINGS.methods, btc: { enabled: false } },
    giftCards: {
      ...DEFAULT_VIP_DONATION_SETTINGS.giftCards,
      amazon: { enabled: true, url: 'https://www.amazon.fr/autre' }
    },
    contacts: { ...DEFAULT_VIP_DONATION_SETTINGS.contacts, telegramUsername: 'NouveauPseudo' }
  });
});

test('les clés inconnues disparaissent et les types faux reprennent la valeur par défaut', () => {
  const merged = mergeStoredSettings({
    futureOption: true,
    donationsEnabled: 'false',
    pausedMessage: 12,
    giftOptionEnabled: 0,
    minAmountEur: '5',
    maxAmountEur: 2000,
    eurosPerVipYear: 4.5,
    suggestedAmounts: 'beaucoup',
    defaultAmountEur: null,
    defaultMethod: 'paypal',
    methods: { cryptogate: { enabled: 'oui' }, paypal: { enabled: true }, btc: null },
    giftCards: {
      amazon: { enabled: 'non', url: 'javascript:alert(1)' },
      steam: { enabled: true, url: 'https://store.steampowered.com' },
      eneba: { url: 'ftp://eneba.com' }
    },
    contacts: { email: 'pas-un-email', discordUrl: 'discord.com/users/1', matrixUserId: 7, extra: 'x' }
  });

  assert.deepEqual(merged, DEFAULT_VIP_DONATION_SETTINGS);
  assert.equal(Object.hasOwn(merged, 'futureOption'), false);
  assert.equal(Object.hasOwn(merged.methods, 'paypal'), false);
  assert.equal(Object.hasOwn(merged.giftCards, 'steam'), false);
  assert.equal(Object.hasOwn(merged.contacts, 'extra'), false);

  for (const broken of [
    { methods: null, giftCards: 'x', contacts: 5 },
    { methods: [], giftCards: [], contacts: [] },
    { suggestedAmounts: [null, 'x', {}, Number.NaN] }
  ]) {
    assert.deepEqual(mergeStoredSettings(broken), DEFAULT_VIP_DONATION_SETTINGS);
  }
});

test('une ligne incohérente redevient utilisable', () => {
  // Minimum au-dessus du maximum : bornes par défaut.
  const swapped = mergeStoredSettings({ minAmountEur: 600, maxAmountEur: 550 });
  assert.equal(swapped.minAmountEur, 5);
  assert.equal(swapped.maxAmountEur, 500);

  // Montants suggérés filtrés, dédoublonnés, triés et limités à six.
  const suggested = mergeStoredSettings({
    minAmountEur: 10,
    maxAmountEur: 100,
    suggestedAmounts: [200, 50, 5, 50, 10, 20, 30, 40, 60, 70]
  });
  assert.deepEqual(suggested.suggestedAmounts, [10, 20, 30, 40, 50, 60]);
  assert.equal(suggested.defaultAmountEur, 10);

  // Plus aucun montant suggéré valable : on garde le minimum.
  const noSuggestion = mergeStoredSettings({ minAmountEur: 30, maxAmountEur: 40, suggestedAmounts: [5] });
  assert.deepEqual(noSuggestion.suggestedAmounts, [30]);
  assert.equal(noSuggestion.defaultAmountEur, 30);

  // Sans montant libre, le montant par défaut doit être proposé.
  const fixed = mergeStoredSettings({ freeAmountEnabled: false, suggestedAmounts: [10, 20], defaultAmountEur: 5 });
  assert.equal(fixed.defaultAmountEur, 10);

  // Liens vides et e-mail vide restent vides (choix de l'admin).
  const cleared = mergeStoredSettings({
    giftCards: { amazon: { enabled: false, url: '' } },
    contacts: { email: '', discordUrl: '' }
  });
  assert.deepEqual(cleared.giftCards.amazon, { enabled: false, url: '' });
  assert.equal(cleared.contacts.email, '');
  assert.equal(cleared.contacts.discordUrl, '');
});

test('la lecture tolérante ne change rien à des réglages valides', () => {
  const custom = validateSettingsInput({
    donationsEnabled: false,
    pausedMessage: 'Retour très bientôt',
    freeAmountEnabled: false,
    minAmountEur: 2,
    maxAmountEur: 80,
    eurosPerVipYear: 6,
    suggestedAmounts: [2, 6, 12],
    defaultAmountEur: 6,
    defaultMethod: 'giftcard',
    methods: { cryptogate: { enabled: false } },
    giftCards: { eneba: { enabled: false, url: '' } },
    contacts: { discordUsername: '', discordUrl: '' }
  });
  assert.deepEqual(mergeStoredSettings(JSON.stringify(custom)), custom);
  assert.deepEqual(mergeStoredSettings(DEFAULT_VIP_DONATION_SETTINGS), DEFAULT_VIP_DONATION_SETTINGS);
});

// ---------------------------------------------------------------------------
// Validation stricte des enregistrements admin
// ---------------------------------------------------------------------------

test('des réglages complets valides ressortent normalisés', () => {
  const result = validateSettingsInput(getDefaultVipDonationSettings());
  assert.deepEqual(result, DEFAULT_VIP_DONATION_SETTINGS);
  assert.deepEqual(Object.keys(result), Object.keys(DEFAULT_VIP_DONATION_SETTINGS));

  const normalized = validateSettingsInput(withDefaults({
    pausedMessage: '  Pause pour maintenance  ',
    suggestedAmounts: [20, 5, 10],
    contacts: {
      ...DEFAULT_VIP_DONATION_SETTINGS.contacts,
      email: '  contact@example.test  ',
      telegramUsername: '',
      discordUrl: ''
    },
    giftCards: { ...DEFAULT_VIP_DONATION_SETTINGS.giftCards, amazon: { enabled: true, url: '  ' } }
  }));
  assert.equal(normalized.pausedMessage, 'Pause pour maintenance');
  assert.deepEqual(normalized.suggestedAmounts, [5, 10, 20]);
  assert.equal(normalized.contacts.email, 'contact@example.test');
  assert.equal(normalized.contacts.telegramUsername, '');
  assert.equal(normalized.contacts.discordUrl, '');
  assert.equal(normalized.giftCards.amazon.url, '');
  assert.equal(
    validateSettingsInput({ pausedMessage: `  ${'x'.repeat(500)}  ` }).pausedMessage.length,
    500
  );
});

test('une entrée partielle garde les valeurs actuelles pour les clés absentes', () => {
  const current = validateSettingsInput({
    minAmountEur: 3,
    suggestedAmounts: [3, 9],
    defaultAmountEur: 9,
    giftCards: { amazon: { enabled: true, url: 'https://www.amazon.fr/actuel' } }
  });

  const result = validateSettingsInput({
    donationsEnabled: false,
    methods: { btc: { enabled: false } },
    giftCards: { amazon: { enabled: false } },
    unknownKey: 'ignorée'
  }, current);

  assert.deepEqual(result, {
    ...current,
    donationsEnabled: false,
    methods: { ...current.methods, btc: { enabled: false } },
    giftCards: { ...current.giftCards, amazon: { enabled: false, url: 'https://www.amazon.fr/actuel' } }
  });
  assert.equal(Object.hasOwn(result, 'unknownKey'), false);
  assert.deepEqual(
    Object.keys(validateSettingsInput({ methods: { paypal: { enabled: true } } }).methods),
    [...VIP_DONATION_METHOD_IDS]
  );
});

test('arrondi au mois supérieur, tout minimum d\'au moins 1 € donne au moins un mois', () => {
  // Même au taux maximal (1000 € les 12 mois), 1 € donne 1 mois.
  for (const [minAmountEur, eurosPerVipYear] of [[1, 12], [1, 13], [5, 100], [1, 1000]]) {
    const settings = validateSettingsInput({
      minAmountEur,
      eurosPerVipYear,
      suggestedAmounts: [minAmountEur],
      defaultAmountEur: minAmountEur
    });
    assert.equal(settings.minAmountEur, minAmountEur);
    assert.equal(settings.eurosPerVipYear, eurosPerVipYear);
    assert.equal(
      resolveDonationAmount(minAmountEur, settings).vipMonths,
      1,
      `${minAmountEur} € à ${eurosPerVipYear} € les 12 mois`
    );
  }
});

test('chaque réglage invalide est refusé avec un message en français', () => {
  const cases = [
    [null, 'Réglages invalides : un objet JSON est attendu.'],
    [[], 'Réglages invalides : un objet JSON est attendu.'],
    ['{}', 'Réglages invalides : un objet JSON est attendu.'],
    [{ donationsEnabled: 'false' }, 'Réglage invalide : « Dons activés » doit valoir true ou false.'],
    [{ giftOptionEnabled: 1 }, 'Réglage invalide : « Option pour offrir » doit valoir true ou false.'],
    [{ freeAmountEnabled: null }, 'Réglage invalide : « Montant libre » doit valoir true ou false.'],
    [{ pausedMessage: 42 }, 'Réglage invalide : « Message de pause » doit être un texte.'],
    [{ pausedMessage: 'x'.repeat(501) }, 'Le message de pause ne doit pas dépasser 500 caractères.'],
    [{ minAmountEur: 5.5 }, 'Réglage invalide : « Montant minimum » doit être un nombre entier.'],
    [{ minAmountEur: '5' }, 'Réglage invalide : « Montant minimum » doit être un nombre entier.'],
    [{ maxAmountEur: null }, 'Réglage invalide : « Montant maximum » doit être un nombre entier.'],
    [{ eurosPerVipYear: '5' }, 'Réglage invalide : « Euros pour 12 mois de VIP » doit être un nombre entier.'],
    [{ minAmountEur: 0 }, 'Le montant minimum doit être compris entre 1 € et 1000 €.'],
    [{ maxAmountEur: 1001 }, 'Le montant maximum doit être compris entre 1 € et 1000 €.'],
    [{ maxAmountEur: 0 }, 'Le montant maximum doit être compris entre 1 € et 1000 €.'],
    [{ minAmountEur: 30, maxAmountEur: 20 }, 'Le montant minimum ne peut pas dépasser le montant maximum.'],
    [{ eurosPerVipYear: 0 }, 'Le nombre d\'euros pour 12 mois de VIP doit être compris entre 1 € et 1000 €.'],
    [{ eurosPerVipYear: 1001 }, 'Le nombre d\'euros pour 12 mois de VIP doit être compris entre 1 € et 1000 €.'],
    [{ suggestedAmounts: '5,10' }, 'Réglage invalide : « Montants suggérés » doit être une liste.'],
    [{ suggestedAmounts: [] }, 'Indique entre 1 et 6 montants suggérés.'],
    [{ suggestedAmounts: [5, 6, 7, 8, 9, 10, 11] }, 'Indique entre 1 et 6 montants suggérés.'],
    [{ suggestedAmounts: [5, 7.5] }, 'Les montants suggérés doivent être des nombres entiers.'],
    [{ suggestedAmounts: [5, '10'] }, 'Les montants suggérés doivent être des nombres entiers.'],
    [{ suggestedAmounts: [4, 10] }, 'Les montants suggérés doivent être compris entre 5 € et 500 €.'],
    [{ suggestedAmounts: [10, 501] }, 'Les montants suggérés doivent être compris entre 5 € et 500 €.'],
    [{ suggestedAmounts: [10, 10] }, 'Les montants suggérés ne doivent pas contenir de doublon.'],
    [{ defaultAmountEur: 7.5 }, 'Réglage invalide : « Montant par défaut » doit être un nombre entier.'],
    [{ defaultAmountEur: 501 }, 'Le montant par défaut doit être compris entre 5 € et 500 €.'],
    [{ defaultAmountEur: 4 }, 'Le montant par défaut doit être compris entre 5 € et 500 €.'],
    [
      { freeAmountEnabled: false, defaultAmountEur: 7 },
      'Sans montant libre, le montant par défaut doit faire partie des montants suggérés.'
    ],
    [{ defaultMethod: 'paypal' }, 'Le moyen de paiement par défaut est inconnu.'],
    [{ defaultMethod: null }, 'Le moyen de paiement par défaut est inconnu.'],
    [{ methods: [] }, 'Réglage invalide : « Moyens de paiement » doit être un objet.'],
    [{ methods: true }, 'Réglage invalide : « Moyens de paiement » doit être un objet.'],
    [{ methods: { btc: true } }, 'Réglage invalide : « Moyen Bitcoin » doit être un objet.'],
    [{ methods: { btc: { enabled: 'non' } } }, 'Réglage invalide : « Moyen Bitcoin » doit valoir true ou false.'],
    [{ methods: { giftcard: { enabled: null } } }, 'Réglage invalide : « Moyen Carte cadeau » doit valoir true ou false.'],
    [{ giftCards: 'x' }, 'Réglage invalide : « Cartes cadeaux » doit être un objet.'],
    [{ giftCards: { amazon: [] } }, 'Réglage invalide : « Carte Amazon » doit être un objet.'],
    [{ giftCards: { amazon: { enabled: 1 } } }, 'Réglage invalide : « Carte Amazon » doit valoir true ou false.'],
    [{ giftCards: { eneba: { url: 12 } } }, 'Réglage invalide : « Lien d\'achat Eneba » doit être un texte.'],
    [{ contacts: [] }, 'Réglage invalide : « Contacts » doit être un objet.'],
    [{ contacts: { email: 'pas-un-email' } }, 'L\'adresse e-mail de contact est invalide.'],
    [{ contacts: { email: 'a b@example.test' } }, 'L\'adresse e-mail de contact est invalide.'],
    [
      { contacts: { telegramUsername: 'x'.repeat(201) } },
      'Le contact « Pseudo Telegram » doit être un texte de 200 caractères au plus.'
    ],
    [
      { contacts: { matrixUserId: null } },
      'Le contact « Identifiant Matrix » doit être un texte de 200 caractères au plus.'
    ],
    [
      { contacts: { discordUrl: 'discord.com/users/1' } },
      'Le contact « Lien Discord » doit être vide ou un lien http:// ou https://.'
    ],
    [
      { contacts: { matrixRoomUrl: 'javascript:alert(1)' } },
      'Le contact « Lien du salon Matrix » doit être vide ou un lien http:// ou https://.'
    ]
  ];

  for (const [input, message] of cases) {
    assertSettingsError(input, message);
  }

  const giftCardUrlMessage = 'Le lien d\'achat de la carte Amazon doit être vide ou commencer par http:// ou https:// (500 caractères au plus).';
  for (const url of [
    'javascript:alert(1)',
    'ftp://example.com/carte',
    'www.amazon.fr/carte',
    'https://exa mple.com',
    'https://',
    `https://example.com/${'a'.repeat(500)}`
  ]) {
    assertSettingsError({ giftCards: { amazon: { url } } }, giftCardUrlMessage);
  }
});

// ---------------------------------------------------------------------------
// Disponibilité selon l'environnement
// ---------------------------------------------------------------------------

const AVAILABILITY_ENV = {
  VIP_CRYPTOGATE_ENABLED: undefined,
  VIP_CRYPTOGATE_API_KEY: undefined,
  VIP_CRYPTOGATE_WEBHOOK_SECRET: undefined,
  VIP_BTC_XPUB: undefined,
  VIP_LTC_XPUB: undefined
};

test('la disponibilité reflète la configuration du serveur', (t) => {
  setEnv(t, AVAILABILITY_ENV);
  assert.deepEqual(getVipDonationAvailability(), { cryptogate: false, giftcard: true, btc: false, ltc: false });

  process.env.VIP_CRYPTOGATE_ENABLED = 'true';
  process.env.VIP_CRYPTOGATE_API_KEY = 'cle-api';
  assert.equal(getVipDonationAvailability().cryptogate, false, 'secret webhook manquant');
  process.env.VIP_CRYPTOGATE_WEBHOOK_SECRET = '   ';
  assert.equal(getVipDonationAvailability().cryptogate, false, 'secret webhook vide');
  process.env.VIP_CRYPTOGATE_WEBHOOK_SECRET = 'secret';
  for (const flag of ['true', 'TRUE', '1', 'yes', ' on ']) {
    process.env.VIP_CRYPTOGATE_ENABLED = flag;
    assert.equal(getVipDonationAvailability().cryptogate, true, flag);
  }
  for (const flag of ['false', '0', 'off', '']) {
    process.env.VIP_CRYPTOGATE_ENABLED = flag;
    assert.equal(getVipDonationAvailability().cryptogate, false, flag);
  }
  process.env.VIP_CRYPTOGATE_ENABLED = 'true';
  process.env.VIP_CRYPTOGATE_API_KEY = '';
  assert.equal(getVipDonationAvailability().cryptogate, false, 'clé API vide');

  process.env.VIP_BTC_XPUB = 'zpub-de-test';
  process.env.VIP_LTC_XPUB = '  ';
  assert.deepEqual(getVipDonationAvailability(), { cryptogate: false, giftcard: true, btc: true, ltc: false });
  process.env.VIP_LTC_XPUB = 'Ltub-de-test';
  assert.equal(getVipDonationAvailability().ltc, true);
});

// ---------------------------------------------------------------------------
// Table MySQL
// ---------------------------------------------------------------------------

test('la table vip_donation_settings est déclarée dans le schéma et créée depuis cette définition', async () => {
  const table = getTable('vip_donation_settings');
  assert.ok(table);
  assert.equal(table.group, 'vip');
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
  await ensureVipDonationSettingsTable(pool);
  assert.deepEqual(state.ddl, [renderCreateTable(table)]);
});

test('le planificateur ne voit aucune dérive sur la table telle que MySQL la décrit', async () => {
  const table = getTable('vip_donation_settings');
  const columnRow = (name, type, nullable, defaultValue, extra, characterSet = null, collation = null) => ({
    TABLE_NAME: 'vip_donation_settings',
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
      TABLE_NAME: 'vip_donation_settings',
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
      TABLE_NAME: 'vip_donation_settings',
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

  const emptyPlan = planSchema([table], { lowerCaseTableNames: 0, tableCount: 0, tables: new Map() });
  assert.equal(emptyPlan.operations.length, 1);
  assert.equal(emptyPlan.operations[0].kind, 'create_table');
  assert.equal(emptyPlan.operations[0].sql, renderCreateTable(table));
});

test('le démarrage des tables VIP crée aussi la table des réglages', async () => {
  const executed = [];
  await ensureVipDonationsTables({
    async execute(sql) {
      executed.push(sql);
      return [[], []];
    }
  });
  assert.ok(executed.includes(renderCreateTable(getTable('vip_donation_settings'))));
});

// ---------------------------------------------------------------------------
// Lecture, cache et enregistrement
// ---------------------------------------------------------------------------

test('sans ligne en base, les valeurs par défaut sont servies puis mises en cache', async () => {
  const { pool, state } = createSettingsPool();
  const first = await loadVipDonationSettings(pool);
  assert.deepEqual(first, { settings: DEFAULT_VIP_DONATION_SETTINGS, updatedAt: null, updatedBy: null });

  first.settings.methods.btc.enabled = false;
  const second = await loadVipDonationSettings(pool);
  assert.equal(second.settings.methods.btc.enabled, true, 'copie indépendante du cache');
  assert.equal(state.selects, 1);
});

test('une ligne enregistrée est relue avec sa date ISO et son auteur', async () => {
  const { pool } = createSettingsPool({ row: storedRow({ pausedMessage: 'Maintenance' }) });
  const loaded = await loadVipDonationSettings(pool);
  assert.equal(loaded.settings.pausedMessage, 'Maintenance');
  assert.equal(loaded.updatedAt, SAVED_AT);
  assert.equal(loaded.updatedBy, 'admin-1');
});

test('fresh contourne le cache et le rafraîchit', async () => {
  const { pool, state } = createSettingsPool({ row: storedRow() });
  await loadVipDonationSettings(pool);
  state.row = storedRow({ donationsEnabled: false });

  assert.equal((await loadVipDonationSettings(pool)).settings.donationsEnabled, true);
  assert.equal((await loadVipDonationSettings(pool, { fresh: true })).settings.donationsEnabled, false);
  assert.equal((await loadVipDonationSettings(pool)).settings.donationsEnabled, false);
  assert.equal(state.selects, 2);
});

test('des lectures simultanées partagent une seule requête', async () => {
  const { pool, state } = createSettingsPool({ row: storedRow() });
  const gate = deferred();
  state.selectGate = gate.promise;
  const reads = [loadVipDonationSettings(pool), loadVipDonationSettings(pool), loadVipDonationSettings(pool)];
  gate.resolve();
  const results = await Promise.all(reads);

  assert.equal(state.selects, 1);
  results[0].settings.methods.btc.enabled = false;
  assert.equal(results[1].settings.methods.btc.enabled, true);
});

test('le cache expire après 10 s et garde la dernière version si la base tombe ensuite', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { pool, state } = createSettingsPool({ row: storedRow({ pausedMessage: 'v1' }) });

  await loadVipDonationSettings(pool);
  t.mock.timers.tick(VIP_DONATION_SETTINGS_CACHE_TTL_MS - 1);
  await loadVipDonationSettings(pool);
  assert.equal(state.selects, 1);

  state.row = storedRow({ pausedMessage: 'v2' });
  t.mock.timers.tick(2);
  assert.equal((await loadVipDonationSettings(pool)).settings.pausedMessage, 'v2');
  assert.equal(state.selects, 2);

  t.mock.timers.tick(VIP_DONATION_SETTINGS_CACHE_TTL_MS + 1);
  state.failSelect = new Error('MySQL indisponible');
  assert.equal((await loadVipDonationSettings(pool)).settings.pausedMessage, 'v2');
  assert.equal(state.selects, 3);

  // Pendant la panne, une seule nouvelle tentative par délai.
  t.mock.timers.tick(VIP_DONATION_SETTINGS_CACHE_TTL_MS - 1);
  assert.equal((await loadVipDonationSettings(pool)).settings.pausedMessage, 'v2');
  assert.equal(state.selects, 3);
  t.mock.timers.tick(2);
  assert.equal((await loadVipDonationSettings(pool)).settings.pausedMessage, 'v2');
  assert.equal(state.selects, 4);

  await assert.rejects(loadVipDonationSettings(pool, { fresh: true }), /MySQL indisponible/);

  state.failSelect = null;
  state.row = storedRow({ pausedMessage: 'v3' });
  t.mock.timers.tick(VIP_DONATION_SETTINGS_CACHE_TTL_MS + 1);
  assert.equal((await loadVipDonationSettings(pool)).settings.pausedMessage, 'v3');
});

test('sans version connue, une base injoignable fait échouer la lecture', async () => {
  const { pool, state } = createSettingsPool();
  state.failSelect = new Error('MySQL indisponible');
  await assert.rejects(loadVipDonationSettings(pool), /MySQL indisponible/);
});

test('l\'enregistrement valide, écrit la ligne id = 1 et sert le cache tout de suite', async () => {
  const { pool, state } = createSettingsPool({ row: storedRow() });
  await loadVipDonationSettings(pool);

  const saved = await saveVipDonationSettings(
    pool,
    withDefaults({ donationsEnabled: false, suggestedAmounts: [20, 5] }),
    'admin-42'
  );

  assert.equal(state.writes.length, 1);
  const [id, settingsJson, updatedBy] = state.writes[0];
  assert.equal(id, 1);
  assert.equal(updatedBy, 'admin-42');
  assert.deepEqual(JSON.parse(settingsJson), saved.settings);
  assert.deepEqual(saved.settings.suggestedAmounts, [5, 20]);
  assert.equal(saved.settings.donationsEnabled, false);
  assert.equal(saved.updatedAt, SAVED_AT);
  assert.equal(saved.updatedBy, 'admin-42');

  const selectsAfterSave = state.selects;
  const cached = await loadVipDonationSettings(pool);
  assert.equal(state.selects, selectsAfterSave);
  assert.equal(cached.settings.donationsEnabled, false);
});

test('un enregistrement invalide n\'écrit rien', async () => {
  const { pool, state } = createSettingsPool();
  await assert.rejects(
    saveVipDonationSettings(pool, withDefaults({ minAmountEur: 0 }), 'admin-42'),
    { statusCode: 400, code: 'VIP_DONATION_SETTINGS_INVALID' }
  );
  assert.equal(state.writes.length, 0);
});

test('si la relecture échoue après l\'écriture, les valeurs écrites sont renvoyées', async () => {
  const { pool, state } = createSettingsPool();
  state.failSelect = new Error('relecture impossible');
  const saved = await saveVipDonationSettings(pool, withDefaults({ pausedMessage: 'Pause' }), null);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0][2], null);
  assert.equal(saved.settings.pausedMessage, 'Pause');
  assert.equal(saved.updatedBy, null);
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('une lecture lancée avant un enregistrement n\'écrase pas le cache', async () => {
  const { pool, state } = createSettingsPool({ row: storedRow({ pausedMessage: 'ancien' }) });
  const gate = deferred();
  state.selectGate = gate.promise;
  const slowRead = loadVipDonationSettings(pool);

  await saveVipDonationSettings(pool, withDefaults({ pausedMessage: 'nouveau' }), 'admin-42');
  gate.resolve();
  assert.equal((await slowRead).settings.pausedMessage, 'ancien');

  const selects = state.selects;
  assert.equal((await loadVipDonationSettings(pool)).settings.pausedMessage, 'nouveau');
  assert.equal(state.selects, selects);
});

// ---------------------------------------------------------------------------
// Création d'invoice : réglages appliqués
// ---------------------------------------------------------------------------

const CRYPTOGATE_ENV = {
  VIP_CRYPTOGATE_ENABLED: 'true',
  VIP_CRYPTOGATE_API_KEY: 'cle-api-test',
  VIP_CRYPTOGATE_WEBHOOK_SECRET: 'secret-webhook-test',
  VIP_LEGACY_PAYMENT_CREATION_ENABLED: 'false'
};

function createInvoicePool({ storedSettings = null, settingsError = null } = {}) {
  const state = { settingsReads: 0, insertParams: null, events: [] };
  const connection = {
    async beginTransaction() {},
    async execute(sql, params = []) {
      if (/INSERT INTO vip_invoices/i.test(sql)) {
        state.insertParams = params;
        return [{ insertId: 77, affectedRows: 1 }, []];
      }
      if (/INSERT INTO vip_invoice_events/i.test(sql)) {
        state.events.push(JSON.parse(params[5]));
        return [{ insertId: 1, affectedRows: 1 }, []];
      }
      throw new Error(`SQL inattendu : ${sql}`);
    },
    async commit() {},
    async rollback() {},
    release() {}
  };
  const pool = {
    async getConnection() {
      return connection;
    },
    async execute(sql) {
      if (/FROM vip_donation_settings/i.test(sql)) {
        state.settingsReads += 1;
        if (settingsError) throw settingsError;
        return [storedSettings
          ? [{ settings_json: JSON.stringify(storedSettings), updated_by: 'admin-1', updated_at: new Date(SAVED_AT) }]
          : [], []];
      }
      if (/SELECT \* FROM vip_invoices WHERE id = \?/i.test(sql)) {
        return [[{ id: 77, public_id: 'inv_test', status: 'awaiting_payment' }], []];
      }
      throw new Error(`SQL inattendu : ${sql}`);
    }
  };
  return { pool, state };
}

function createCryptoGateClient() {
  const calls = [];
  return {
    calls,
    async createPayment(input) {
      calls.push(input);
      return {
        paymentId: `pay_${calls.length}`,
        checkoutUrl: `https://crypto-gate.cc/checkout/pay_${calls.length}`
      };
    }
  };
}

function donate(pool, payload, cryptoGateClient = createCryptoGateClient()) {
  return createVipInvoice(
    pool,
    {
      paymentMethod: 'cryptogate',
      recipientMode: 'self',
      payerEmail: 'donateur@example.test',
      ...payload
    },
    { cryptoGateClient, ipAddress: '203.0.113.7' }
  );
}

function isDonationError(statusCode, code, message) {
  return (error) => {
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  };
}

test('un don CryptoGate porte un libellé de don et la durée au taux réglé', async (t) => {
  setEnv(t, CRYPTOGATE_ENV);
  const { pool, state } = createInvoicePool();
  const client = createCryptoGateClient();

  const invoice = await donate(pool, { amountEur: 7 }, client);
  assert.equal(invoice.public_id, 'inv_test');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].amount, 7);
  assert.equal(client.calls[0].currency, 'EUR');
  assert.equal(client.calls[0].label, 'Don Movix');
  assert.equal(client.calls[0].description, 'Don à Movix - merci : 17 mois de VIP');
  assert.equal(state.insertParams[1], 7);
  assert.equal(state.insertParams[3], 1.42);
  assert.deepEqual(state.events[0], {
    paymentMethod: 'cryptogate',
    paymentId: 'pay_1',
    packEur: 7,
    vipYears: 1.42,
    recipientMode: 'self'
  });

  // Réglages lus une seule fois grâce au cache.
  await donate(pool, { amountEur: 10 }, client);
  assert.equal(client.calls[1].description, 'Don à Movix - merci : 2 ans de VIP');
  assert.equal(state.settingsReads, 1);
});

test('le taux et les bornes viennent des réglages enregistrés', async (t) => {
  setEnv(t, CRYPTOGATE_ENV);
  const { pool, state } = createInvoicePool({
    storedSettings: withDefaults({ eurosPerVipYear: 4, minAmountEur: 3, suggestedAmounts: [3, 5] })
  });
  const client = createCryptoGateClient();

  await donate(pool, { amountEur: 3 }, client);
  assert.equal(client.calls[0].description, 'Don à Movix - merci : 9 mois de VIP');
  assert.equal(state.insertParams[3], 0.75);
  await donate(pool, { amountEur: 5 }, client);
  assert.equal(client.calls[1].description, 'Don à Movix - merci : 15 mois de VIP');
  assert.equal(state.insertParams[3], 1.25);
});

test('amountEur prime sur packEur, qui reste accepté seul', async (t) => {
  setEnv(t, CRYPTOGATE_ENV);
  const { pool } = createInvoicePool();
  const client = createCryptoGateClient();

  await donate(pool, { amountEur: 12, packEur: 5 }, client);
  await donate(pool, { packEur: 7 }, client);
  await donate(pool, { amountEur: '15', packEur: 5 }, client);
  assert.deepEqual(client.calls.map((call) => call.amount), [12, 7, 15]);
});

test('un montant refusé ne contacte jamais le prestataire', async (t) => {
  setEnv(t, CRYPTOGATE_ENV);
  const { pool, state } = createInvoicePool();
  const client = createCryptoGateClient();

  await assert.rejects(
    donate(pool, { amountEur: 4 }, client),
    isDonationError(400, 'VIP_DONATION_AMOUNT_INVALID', 'Montant invalide : choisis un montant entre 5 € et 500 €.')
  );
  await assert.rejects(
    donate(pool, { amountEur: 7.5 }, client),
    isDonationError(400, 'VIP_DONATION_AMOUNT_INVALID', 'Montant invalide : le don doit être un nombre entier d\'euros.')
  );
  await assert.rejects(
    donate(pool, {}, client),
    isDonationError(400, 'VIP_DONATION_AMOUNT_INVALID', 'Montant invalide : le don doit être un nombre entier d\'euros.')
  );
  assert.equal(client.calls.length, 0);
  assert.equal(state.insertParams, null);
});

test('les dons en pause bloquent tous les moyens (503)', async (t) => {
  setEnv(t, CRYPTOGATE_ENV);
  const { pool, state } = createInvoicePool({ storedSettings: withDefaults({ donationsEnabled: false }) });
  const client = createCryptoGateClient();

  for (const paymentMethod of ['cryptogate', 'btc', 'ltc']) {
    await assert.rejects(
      donate(pool, { amountEur: 7, paymentMethod, coin: paymentMethod === 'cryptogate' ? null : paymentMethod }, client),
      isDonationError(503, 'VIP_DONATIONS_PAUSED', 'Les dons sont en pause pour le moment.')
    );
  }
  assert.equal(client.calls.length, 0);
  assert.equal(state.insertParams, null);
});

test('un moyen coupé par l\'admin est refusé (403) avant tout appel externe', async (t) => {
  setEnv(t, CRYPTOGATE_ENV);
  const { pool } = createInvoicePool({
    storedSettings: withDefaults({
      methods: {
        cryptogate: { enabled: false },
        giftcard: { enabled: true },
        btc: { enabled: false },
        ltc: { enabled: false }
      }
    })
  });
  const client = createCryptoGateClient();

  for (const paymentMethod of ['cryptogate', 'btc', 'ltc']) {
    await assert.rejects(
      donate(pool, { amountEur: 7, paymentMethod }, client),
      isDonationError(403, 'VIP_METHOD_DISABLED', 'Ce moyen de paiement est désactivé pour le moment.')
    );
  }
  assert.equal(client.calls.length, 0);
});

test('l\'option pour offrir coupée refuse les dons offerts mais pas les autres', async (t) => {
  setEnv(t, CRYPTOGATE_ENV);
  const { pool } = createInvoicePool({ storedSettings: withDefaults({ giftOptionEnabled: false }) });
  const client = createCryptoGateClient();

  await assert.rejects(
    donate(pool, { amountEur: 7, recipientMode: 'gift' }, client),
    isDonationError(403, 'VIP_GIFT_OPTION_DISABLED', 'L\'option « pour offrir » est désactivée pour le moment.')
  );
  assert.equal(client.calls.length, 0);
  await donate(pool, { amountEur: 7, recipientMode: 'self' }, client);
  assert.equal(client.calls.length, 1);
});

test('la carte cadeau ne crée jamais d\'invoice, même avec un coin', async (t) => {
  setEnv(t, CRYPTOGATE_ENV);
  const { pool, state } = createInvoicePool();
  for (const coin of [null, 'btc', 'ltc']) {
    await assert.rejects(
      donate(pool, { amountEur: 7, paymentMethod: 'giftcard', coin }),
      (error) => error.statusCode === 400 && error.message === 'Paramètres d\'invoice invalides'
    );
  }
  assert.equal(state.settingsReads, 0);
});

test('les moyens historiques restent fermés par leur propre interrupteur', async (t) => {
  setEnv(t, CRYPTOGATE_ENV);
  const { pool, state } = createInvoicePool();
  for (const paymentMethod of ['paygate_hosted', 'payblis']) {
    await assert.rejects(
      donate(pool, { amountEur: 7, paymentMethod }),
      (error) => error.statusCode === 410 && error.code === 'VIP_LEGACY_PAYMENT_RETIRED'
    );
  }
  assert.equal(state.settingsReads, 0);
});

test('des réglages illisibles sans version connue bloquent la création (503)', async (t) => {
  setEnv(t, CRYPTOGATE_ENV);
  const { pool } = createInvoicePool({ settingsError: new Error('Table absente') });
  const client = createCryptoGateClient();
  await assert.rejects(
    donate(pool, { amountEur: 7 }, client),
    isDonationError(
      503,
      'VIP_DONATION_SETTINGS_UNAVAILABLE',
      'Les dons sont momentanément indisponibles. Réessaie dans quelques instants.'
    )
  );
  assert.equal(client.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Routes HTTP (module réel, dépendances isolées)
// ---------------------------------------------------------------------------

function loadRouter({ pool, admin = true, createInvoice } = {}) {
  const filename = path.resolve(__dirname, '../vipDonations.js');
  const rateLimit = () => (_req, _res, next) => next();
  rateLimit.ipKeyGenerator = (ip) => ip;
  const isAdmin = (req, res, next) => {
    if (!admin) {
      return res.status(403).json({ success: false, error: 'Accès refusé - Droits admin requis' });
    }
    req.admin = { userId: 'admin-42', userType: 'oauth', role: 'admin' };
    return next();
  };
  const dependencies = {
    express,
    'express-rate-limit': rateLimit,
    '../mysqlPool': { getPool: () => pool },
    '../middleware/auth': { isAdmin, getAuthIfValid: async () => null },
    '../utils/redisRateLimitStore': { createRedisRateLimitStore: () => ({}) },
    '../utils/turnstile': { verifyTurnstileFromRequest: async () => ({ valid: true }) },
    '../utils/vipDonations': {
      createVipInvoice: createInvoice || (async () => {
        throw new Error('createVipInvoice inattendu');
      }),
      serializePublicInvoice: (invoice) => invoice,
      getClientIp: () => '203.0.113.7'
    },
    '../utils/vipDonationSettings': settingsModule
  };
  const sandboxModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: sandboxModule,
    exports: sandboxModule.exports,
    Buffer,
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.ok(name in dependencies, `Dépendance non isolée : ${name}`);
      return dependencies[name];
    }
  }, { filename });
  return { router: sandboxModule.exports.router, isAdmin };
}

async function callRoute(router, method, routePath, { body = {} } = {}) {
  const layer = router.stack.find((entry) => entry.route?.path === routePath && entry.route.methods[method]);
  assert.ok(layer, `Route absente : ${method.toUpperCase()} ${routePath}`);
  const req = {
    method: method.toUpperCase(),
    body,
    query: {},
    params: {},
    headers: {},
    ip: '203.0.113.7',
    protocol: 'https',
    get: () => 'api.movix.test'
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    set(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      // Copie dans ce contexte : le module tourne dans un autre contexte vm.
      this.body = JSON.parse(JSON.stringify(payload));
      return this;
    }
  };
  for (const handlerLayer of layer.route.stack) {
    let proceed = false;
    await handlerLayer.handle(req, res, () => {
      proceed = true;
    });
    if (!proceed) break;
  }
  return { res, handlers: layer.route.stack.map((entry) => entry.handle) };
}

test('GET /vip/donation-settings renvoie réglages, disponibilité et date, sans auteur', async (t) => {
  setEnv(t, { ...AVAILABILITY_ENV, VIP_BTC_XPUB: 'zpub-de-test' });
  const { pool } = createSettingsPool({ row: storedRow({ pausedMessage: 'Pause' }) });
  const { router } = loadRouter({ pool });

  const { res } = await callRoute(router, 'get', '/vip/donation-settings');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(res.body).sort(), ['availability', 'settings', 'success', 'updatedAt']);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.settings, withDefaults({ pausedMessage: 'Pause' }));
  assert.deepEqual(res.body.availability, { cryptogate: false, giftcard: true, btc: true, ltc: false });
  assert.equal(res.body.updatedAt, SAVED_AT);
});

test('GET /vip/donation-settings sert les valeurs par défaut si la base échoue', async (t) => {
  setEnv(t, AVAILABILITY_ENV);
  const { pool, state } = createSettingsPool();
  state.failSelect = new Error('MySQL indisponible');
  const { router } = loadRouter({ pool });

  const { res } = await callRoute(router, 'get', '/vip/donation-settings');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    settings: JSON.parse(JSON.stringify(DEFAULT_VIP_DONATION_SETTINGS)),
    availability: { cryptogate: false, giftcard: true, btc: false, ltc: false },
    updatedAt: null
  });
});

test('les routes admin des réglages passent par isAdmin', async () => {
  const { pool, state } = createSettingsPool({ row: storedRow() });
  const { router, isAdmin } = loadRouter({ pool, admin: false });

  for (const method of ['get', 'put']) {
    const { res, handlers } = await callRoute(router, method, '/admin/vip-donation-settings', {
      body: { settings: { donationsEnabled: false } }
    });
    assert.ok(handlers.includes(isAdmin), `${method.toUpperCase()} sans isAdmin`);
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(state.selects, 0);
  assert.equal(state.writes.length, 0);
});

test('GET /admin/vip-donation-settings relit la base et expose l\'auteur', async (t) => {
  setEnv(t, AVAILABILITY_ENV);
  const { pool, state } = createSettingsPool({ row: storedRow() });
  const { router } = loadRouter({ pool });

  await callRoute(router, 'get', '/vip/donation-settings');
  state.row = { ...storedRow({ donationsEnabled: false }), updated_by: 'admin-7' };

  const { res } = await callRoute(router, 'get', '/admin/vip-donation-settings');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(res.body).sort(), ['availability', 'settings', 'success', 'updatedAt', 'updatedBy']);
  assert.equal(res.body.settings.donationsEnabled, false);
  assert.equal(res.body.updatedAt, SAVED_AT);
  assert.equal(res.body.updatedBy, 'admin-7');
  assert.equal(state.selects, 2);
});

test('GET /admin/vip-donation-settings répond 500 si la base échoue', async () => {
  const { pool, state } = createSettingsPool();
  state.failSelect = new Error('MySQL indisponible');
  const { router } = loadRouter({ pool });

  const { res } = await callRoute(router, 'get', '/admin/vip-donation-settings');
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { success: false, error: 'Impossible de récupérer les réglages des dons' });
});

test('PUT /admin/vip-donation-settings valide, enregistre et renvoie la forme complète', async (t) => {
  setEnv(t, AVAILABILITY_ENV);
  const { pool, state } = createSettingsPool({
    row: storedRow({ minAmountEur: 3, suggestedAmounts: [3, 9], defaultAmountEur: 9 })
  });
  const { router } = loadRouter({ pool });

  const { res } = await callRoute(router, 'put', '/admin/vip-donation-settings', {
    body: { settings: { donationsEnabled: false, suggestedAmounts: [20, 3, 9], methods: { btc: { enabled: false } } } }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(res.body).sort(), ['availability', 'settings', 'success', 'updatedAt', 'updatedBy']);
  assert.equal(res.body.success, true);
  assert.equal(res.body.settings.donationsEnabled, false);
  assert.equal(res.body.settings.minAmountEur, 3, 'valeur actuelle conservée');
  assert.deepEqual(res.body.settings.suggestedAmounts, [3, 9, 20]);
  assert.equal(res.body.settings.methods.btc.enabled, false);
  assert.equal(res.body.settings.methods.cryptogate.enabled, true);
  assert.deepEqual(res.body.availability, { cryptogate: false, giftcard: true, btc: false, ltc: false });
  assert.equal(res.body.updatedAt, SAVED_AT);
  assert.equal(res.body.updatedBy, 'admin-42');
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0][2], 'admin-42');

  // La page publique de ce worker voit le changement sans relire la base.
  const selects = state.selects;
  const publicRead = await callRoute(router, 'get', '/vip/donation-settings');
  assert.equal(publicRead.res.body.settings.donationsEnabled, false);
  assert.equal(state.selects, selects);
});

test('PUT /admin/vip-donation-settings refuse un réglage invalide (400) sans rien écrire', async () => {
  const { pool, state } = createSettingsPool();
  const { router } = loadRouter({ pool });

  for (const [body, error] of [
    [{ settings: { minAmountEur: 0 } }, 'Le montant minimum doit être compris entre 1 € et 1000 €.'],
    [{}, 'Réglages invalides : un objet JSON est attendu.'],
    [{ settings: 'oui' }, 'Réglages invalides : un objet JSON est attendu.']
  ]) {
    const { res } = await callRoute(router, 'put', '/admin/vip-donation-settings', { body });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { success: false, error });
  }
  assert.equal(state.writes.length, 0);
});

test('PUT /admin/vip-donation-settings répond 500 si l\'écriture échoue', async () => {
  const { pool, state } = createSettingsPool();
  state.failWrite = new Error('Écriture refusée');
  const { router } = loadRouter({ pool });

  const { res } = await callRoute(router, 'put', '/admin/vip-donation-settings', {
    body: { settings: { donationsEnabled: false } }
  });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { success: false, error: 'Impossible d\'enregistrer les réglages des dons' });
});

test('POST /vip/invoices transmet amount_eur, ou pack_eur à défaut', async () => {
  const payloads = [];
  const { router } = loadRouter({
    pool: {},
    createInvoice: async (_pool, payload) => {
      payloads.push(payload);
      return { publicId: 'inv_test' };
    }
  });

  for (const body of [
    { amount_eur: 12, pack_eur: 5 },
    { pack_eur: 7 },
    { amount_eur: null, pack_eur: 10 }
  ]) {
    const { res } = await callRoute(router, 'post', '/vip/invoices', {
      body: { ...body, payment_method: 'cryptogate', recipient_mode: 'self' }
    });
    assert.equal(res.statusCode, 201);
  }
  assert.deepEqual(payloads.map((payload) => payload.amountEur), [12, 7, 10]);
  assert.equal(payloads[0].paymentMethod, 'cryptogate');
});

test('POST /vip/invoices expose les codes des refus de don, pas les codes internes', async () => {
  let nextError = null;
  const { router } = loadRouter({
    pool: {},
    createInvoice: async () => {
      throw nextError;
    }
  });
  const fail = (message, statusCode, code) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
  };

  nextError = fail('Les dons sont en pause pour le moment.', 503, 'VIP_DONATIONS_PAUSED');
  let { res } = await callRoute(router, 'post', '/vip/invoices', { body: { amount_eur: 7 } });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    success: false,
    error: 'Les dons sont en pause pour le moment.',
    code: 'VIP_DONATIONS_PAUSED'
  });

  nextError = fail('Configuration CryptoGate incomplète', 503, 'CRYPTOGATE_API_KEY_MISSING');
  ({ res } = await callRoute(router, 'post', '/vip/invoices', { body: { amount_eur: 7 } }));
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { success: false, error: 'Configuration CryptoGate incomplète' });
});
