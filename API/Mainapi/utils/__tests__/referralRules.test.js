'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../referralRules');
const settingsModule = require('../referralSettings');

const SETTINGS = { requiredMinutes: 60, requiredDays: 2 };

test('generateReferralCode : 8 caractères de l’alphabet sans 0, O, 1, I ni L', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = rules.generateReferralCode();
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  }
});

test('generateReferralCode : les octets du tour incomplet (≥ 248) sont ignorés', () => {
  // 248 et plus sont rejetés, 0 → « A », 30 → « 9 ».
  const bytes = [255, 250, 248, 0, 30, 0, 30, 0, 30, 0, 30, 0, 0, 0, 0, 0];
  const code = rules.generateReferralCode(() => Buffer.from(bytes));
  assert.equal(code, 'A9A9A9A9');
});

test('normalizeReferralCode : minuscules, espaces, tirets et lien complet', () => {
  assert.equal(rules.normalizeReferralCode('abcd-2345'), 'ABCD2345');
  assert.equal(rules.normalizeReferralCode('  ab cd 23 45 '), 'ABCD2345');
  assert.equal(rules.normalizeReferralCode('https://movix.dog/?ref=abcd2345'), 'ABCD2345');
  assert.equal(rules.normalizeReferralCode('https://movix.dog/movie/1?lang=fr&ref=ABCD2345#top'), 'ABCD2345');
});

test('normalizeReferralCode : refuse les codes impossibles', () => {
  for (const input of ['', 'ABC', 'ABCD23456', 'ABCD0OIL', null, 42, 'x'.repeat(400), 'https://movix.dog/?ref=%E0%A4%A']) {
    assert.equal(rules.normalizeReferralCode(input), null, String(input));
  }
});

test('parisDateKey : le jour change à minuit heure de Paris, pas en UTC', () => {
  // 22 h 30 UTC le 7 novembre = 23 h 30 à Paris (UTC+1).
  assert.equal(rules.parisDateKey(new Date('2026-11-07T22:30:00Z')), '2026-11-07');
  assert.equal(rules.parisDateKey(new Date('2026-11-07T23:30:00Z')), '2026-11-08');
});

test('viewingDayKey : une soirée qui passe minuit reste le même jour, le jour change à 5 h', () => {
  // 23 h 30 puis 0 h 30 à Paris : la même soirée.
  assert.equal(rules.viewingDayKey(new Date('2026-11-07T22:30:00Z')), '2026-11-07');
  assert.equal(rules.viewingDayKey(new Date('2026-11-07T23:30:00Z')), '2026-11-07');
  // 4 h 59 à Paris : encore la nuit du 7. À 5 h, le 8 commence.
  assert.equal(rules.viewingDayKey(new Date('2026-11-08T03:59:00Z')), '2026-11-07');
  assert.equal(rules.viewingDayKey(new Date('2026-11-08T04:00:00Z')), '2026-11-08');
});

test('resolveAccountCreatedAt : la plus ancienne date valable, null sans trace', () => {
  const result = rules.resolveAccountCreatedAt(
    '2026-11-05T10:00:00Z', null, 'pas une date', new Date('2026-11-01T08:00:00Z'), Date.parse('2026-11-03T00:00:00Z')
  );
  assert.equal(result.toISOString(), '2026-11-01T08:00:00.000Z');
  assert.equal(rules.resolveAccountCreatedAt(null, undefined, ''), null);
});

test('isWithinClaimWindow : 7 jours après la création, pas un de plus', () => {
  const created = new Date('2026-11-01T12:00:00Z');
  assert.equal(rules.isWithinClaimWindow(created, new Date('2026-11-08T12:00:00Z'), 7), true);
  assert.equal(rules.isWithinClaimWindow(created, new Date('2026-11-08T12:00:01Z'), 7), false);
  assert.equal(rules.isWithinClaimWindow(null, new Date(), 7), false);
});

test('isGoalReached : il faut le temps ET le nombre de jours', () => {
  assert.equal(rules.isGoalReached({ watchSeconds: 3600, watchDays: 1 }, SETTINGS), false);
  assert.equal(rules.isGoalReached({ watchSeconds: 3599, watchDays: 2 }, SETTINGS), false);
  assert.equal(rules.isGoalReached({ watchSeconds: 3600, watchDays: 2 }, SETTINGS), true);
});

test('extendExpiry : ajoute à la fin actuelle, ou à maintenant si la clé a expiré', () => {
  const now = Date.parse('2026-11-07T00:00:00Z');
  assert.equal(rules.extendExpiry(now + rules.DAY_MS, now, 2), now + 3 * rules.DAY_MS);
  assert.equal(rules.extendExpiry(now - rules.DAY_MS, now, 2), now + 2 * rules.DAY_MS);
  assert.equal(rules.extendExpiry('pas un nombre', now, 2), now + 2 * rules.DAY_MS);
});

test('buildDurationLabel : singulier et pluriel', () => {
  assert.equal(rules.buildDurationLabel(1), '1 jour (parrainage)');
  assert.equal(rules.buildDurationLabel(2), '2 jours (parrainage)');
});

test('réglages : coupés par défaut, ligne illisible → valeurs par défaut', () => {
  assert.deepEqual(settingsModule.mergeStoredSettings('{pas du json'), settingsModule.DEFAULT_REFERRAL_SETTINGS);
  assert.equal(settingsModule.DEFAULT_REFERRAL_SETTINGS.enabled, false);
  const merged = settingsModule.mergeStoredSettings({ enabled: true, rewardDays: 500, requiredMinutes: 90 });
  assert.equal(merged.enabled, true);
  assert.equal(merged.rewardDays, 2);
  assert.equal(merged.requiredMinutes, 90);
});

test('réglages : un enregistrement partiel garde le reste', () => {
  const current = { ...settingsModule.DEFAULT_REFERRAL_SETTINGS, rewardDays: 3 };
  const saved = settingsModule.validateSettingsInput({ enabled: true }, current);
  assert.equal(saved.enabled, true);
  assert.equal(saved.rewardDays, 3);
});

test('réglages : ancienneté du parrain de 3 jours par défaut, 0 pour ne rien demander', () => {
  assert.equal(settingsModule.DEFAULT_REFERRAL_SETTINGS.minReferrerAccountDays, 3);
  // Ligne enregistrée avant l'ajout du réglage : la valeur par défaut s'applique.
  assert.equal(settingsModule.mergeStoredSettings({ enabled: true, rewardDays: 2 }).minReferrerAccountDays, 3);
  assert.equal(settingsModule.validateSettingsInput({ minReferrerAccountDays: 0 }).minReferrerAccountDays, 0);
  assert.throws(() => settingsModule.validateSettingsInput({ minReferrerAccountDays: 91 }), /Ancienneté du compte du parrain/);
});

test('réglages : valeurs hors bornes refusées avec un message clair', () => {
  assert.throws(() => settingsModule.validateSettingsInput({ enabled: 'oui' }), /Parrainage activé/);
  assert.throws(() => settingsModule.validateSettingsInput({ rewardDays: 0 }), /Jours de VIP offerts/);
  assert.throws(() => settingsModule.validateSettingsInput({ requiredMinutes: 1.5 }), /Minutes de visionnage/);
  assert.throws(() => settingsModule.validateSettingsInput({ requiredMinutes: 2, requiredDays: 3 }), /une minute de visionnage par jour/);
  assert.throws(() => settingsModule.validateSettingsInput(null), /objet JSON/);
});
