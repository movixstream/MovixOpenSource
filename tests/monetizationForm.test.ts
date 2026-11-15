import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Service = typeof import('../src/services/monetizationAdminService.ts');
type Form = typeof import('../src/components/adminMonetization/monetizationForm.ts');
type Settings = import('../src/services/monetizationAdminService.ts').MonetizationSettings;
type Ad = import('../src/services/monetizationAdminService.ts').MonetizationAd;

interface FetchCall { url: string; init: RequestInit }
type FetchAnswer = { status: number; body: unknown };

const transpile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

// Charge le service et les helpers du formulaire transpilés, avec un faux
// MAIN_API, un faux localStorage et un faux fetch : ni navigateur ni Vite.
function loadModules(options: { token?: string | null; answer?: FetchAnswer } = {}) {
  const { token = 'jeton-admin', answer = { status: 200, body: { success: true } } } = options;
  const calls: FetchCall[] = [];
  const fakeFetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    };
  };
  const localStorage = { getItem: (key: string) => (key === 'auth_token' ? token : null) };

  const service = {};
  new Function('exports', 'require', 'localStorage', 'fetch', transpile('../src/services/monetizationAdminService.ts'))(
    service,
    (name: string) => {
      if (name === '../config/runtime') return { MAIN_API: 'https://api.test' };
      throw new Error(`module inattendu : ${name}`);
    },
    localStorage,
    fakeFetch,
  );

  const form = {};
  new Function('exports', 'require', transpile('../src/components/adminMonetization/monetizationForm.ts'))(
    form,
    (name: string) => {
      if (name === '../../services/monetizationAdminService') return service;
      throw new Error(`module inattendu : ${name}`);
    },
  );

  return { service: service as Service, form: form as Form, calls };
}

function validAd(service: Service, overrides: Partial<Ad> = {}): Ad {
  return {
    ...service.createEmptyAd(),
    name: 'Régie 1',
    url: 'https://regie.example/go?sub={placement}&c={country}',
    ...overrides,
  };
}

function settingsWith(service: Service, ads: Ad[]): Settings {
  const { form } = loadModules();
  return { ...form.cloneMonetizationSettings(service.DEFAULT_MONETIZATION_SETTINGS), ads };
}

test('createEmptyAd donne un id unique de 10 caractères hex et des valeurs neutres', () => {
  const { service } = loadModules();
  const ids = new Set<string>();
  for (let index = 0; index < 300; index += 1) {
    const ad = service.createEmptyAd();
    assert.match(ad.id, /^[0-9a-f]{10}$/);
    ids.add(ad.id);
  }
  assert.equal(ids.size, 300);

  const { id: _id, ...rest } = service.createEmptyAd();
  assert.deepEqual(rest, {
    name: '',
    url: '',
    enabled: true,
    placements: ['player'],
    audience: 'all',
    weight: 1,
    schedule: { startAt: null, endAt: null, days: [], hours: null },
    targeting: { devices: [], os: [], countriesMode: 'all', countries: [] },
    caps: { perVisitorPerDay: 0, globalPerDay: 0 },
    note: '',
  });
});

test('les défauts ont 4 emplacements en séquence globale, 1 fenêtre et aucune pub', () => {
  const { service } = loadModules();
  const defaults = service.DEFAULT_MONETIZATION_SETTINGS;
  assert.deepEqual([...service.MONETIZATION_PLACEMENT_IDS], ['player', 'download', 'livetv', 'swiftflux']);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.adultDefault, true);
  assert.deepEqual(defaults.ads, []);
  for (const id of service.MONETIZATION_PLACEMENT_IDS) {
    assert.deepEqual(defaults.placements[id], {
      enabled: true,
      rotation: 'sequence',
      sequenceScope: 'global',
      windowsPerClick: 1,
      fallbackUrl: '',
    });
  }
});

test('la validation accepte des réglages corrects (macros comprises)', () => {
  const { service, form } = loadModules();
  const settings = settingsWith(service, [
    validAd(service),
    validAd(service, {
      name: 'Régie 2',
      placements: ['player', 'swiftflux'],
      weight: 100,
      schedule: { startAt: '2026-10-01T08:00:00.000Z', endAt: '2026-11-01T08:00:00.000Z', days: [0, 6], hours: { from: 22, to: 2 } },
      targeting: { devices: ['mobile'], os: ['android'], countriesMode: 'include', countries: ['FR', 'BE'] },
      caps: { perVisitorPerDay: 3, globalPerDay: 1000000 },
    }),
  ]);
  settings.placements.download.fallbackUrl = 'https://movix.example/merci';
  settings.placements.livetv.windowsPerClick = 3;
  assert.deepEqual(form.validateMonetizationSettings(settings), {});
});

test('la validation refuse une URL vide, non http(s) ou trop longue', () => {
  const { service, form } = loadModules();
  const cases: Array<[string, string]> = [
    ['', 'required'],
    ['ftp://regie.example', 'invalidUrl'],
    ['regie.example', 'invalidUrl'],
    ['javascript:alert(1)', 'invalidUrl'],
    [`https://regie.example/${'a'.repeat(2000)}`, 'tooLong'],
  ];
  for (const [url, code] of cases) {
    const ad = validAd(service, { url });
    const errors = form.validateMonetizationSettings(settingsWith(service, [ad]));
    assert.equal(errors[form.adFieldKey(ad.id, 'url')]?.code, code, url);
  }
});

test('la validation borne le poids à un entier de 1 à 100', () => {
  const { service, form } = loadModules();
  for (const weight of [0, 101, -1, 1.5, Number.NaN]) {
    const ad = validAd(service, { weight });
    const errors = form.validateMonetizationSettings(settingsWith(service, [ad]));
    assert.equal(errors[form.adFieldKey(ad.id, 'weight')]?.code, 'integerRange', String(weight));
  }
  for (const weight of [1, 100]) {
    const ad = validAd(service, { weight });
    assert.deepEqual(form.validateMonetizationSettings(settingsWith(service, [ad])), {});
  }
});

test('la validation exige au moins un emplacement connu et un nom', () => {
  const { service, form } = loadModules();
  const withoutPlacement = validAd(service, { placements: [] });
  const unknownPlacement = validAd(service, { placements: ['banner' as never] });
  const withoutName = validAd(service, { name: '   ' });
  const errors = form.validateMonetizationSettings(
    form.normalizeMonetizationForSave(settingsWith(service, [withoutPlacement, unknownPlacement, withoutName])),
  );
  assert.equal(errors[form.adFieldKey(withoutPlacement.id, 'placements')]?.code, 'placementsRequired');
  assert.equal(errors[form.adFieldKey(unknownPlacement.id, 'placements')]?.code, 'placementsRequired');
  assert.equal(errors[form.adFieldKey(withoutName.id, 'name')]?.code, 'required');
});

test('la validation refuse une plage horaire de même début et fin ou hors bornes', () => {
  const { service, form } = loadModules();
  const hoursCases: Array<[{ from: number; to: number }, string | undefined]> = [
    [{ from: 5, to: 5 }, 'hoursSame'],
    [{ from: 24, to: 2 }, 'hoursRange'],
    [{ from: 3, to: 0 }, 'hoursRange'],
    [{ from: Number.NaN, to: 4 }, 'hoursRange'],
    [{ from: 22, to: 2 }, undefined],
    [{ from: 0, to: 24 }, undefined],
  ];
  for (const [hours, code] of hoursCases) {
    const ad = validAd(service, { schedule: { startAt: null, endAt: null, days: [], hours } });
    const errors = form.validateMonetizationSettings(settingsWith(service, [ad]));
    assert.equal(errors[form.adFieldKey(ad.id, 'hours')]?.code, code, JSON.stringify(hours));
  }
});

test('la validation refuse une fin avant le début, un pays « FRA » et des plafonds hors bornes', () => {
  const { service, form } = loadModules();
  const ad = validAd(service, {
    schedule: { startAt: '2026-10-10T10:00:00.000Z', endAt: '2026-10-10T10:00:00.000Z', days: [], hours: null },
    targeting: { devices: [], os: [], countriesMode: 'exclude', countries: ['FR', 'FRA'] },
    caps: { perVisitorPerDay: -1, globalPerDay: 1000001 },
    note: 'x'.repeat(501),
  });
  const errors = form.validateMonetizationSettings(settingsWith(service, [ad]));
  assert.equal(errors[form.adFieldKey(ad.id, 'endAt')]?.code, 'endBeforeStart');
  assert.equal(errors[form.adFieldKey(ad.id, 'countries')]?.code, 'invalidCountry');
  assert.equal(errors[form.adFieldKey(ad.id, 'perVisitorPerDay')]?.code, 'integerRange');
  assert.equal(errors[form.adFieldKey(ad.id, 'globalPerDay')]?.code, 'integerRange');
  assert.equal(errors[form.adFieldKey(ad.id, 'note')]?.code, 'tooLong');
});

test('comme le serveur : une date sans fuseau est refusée', () => {
  const { service, form } = loadModules();
  const ad = validAd(service, {
    schedule: { startAt: '2026-10-10T10:00', endAt: '2026-10-11T10:00:00+02:00', days: [], hours: null },
  });
  const errors = form.validateMonetizationSettings(settingsWith(service, [ad]));
  assert.equal(errors[form.adFieldKey(ad.id, 'startAt')]?.code, 'invalidDate');
  assert.equal(errors[form.adFieldKey(ad.id, 'endAt')], undefined);

  // Un champ datetime-local passe par fromDateTimeLocalValue, qui rend une date ISO avec fuseau.
  const iso = form.fromDateTimeLocalValue('2026-10-10T10:00');
  assert.match(String(iso), /Z$/);
  assert.equal(form.toDateTimeLocalValue(iso), '2026-10-10T10:00');
  assert.equal(form.buildTestAdUrl('https://regie.example/?s={placement}&c={country}', 'download'), 'https://regie.example/?s=download&c=FR');
});

test('la validation des emplacements refuse 4 fenêtres et une URL de secours ftp', () => {
  const { service, form } = loadModules();
  const settings = settingsWith(service, []);
  settings.placements.player.windowsPerClick = 4;
  settings.placements.download.windowsPerClick = 0;
  settings.placements.swiftflux.fallbackUrl = 'ftp://x';
  const errors = form.validateMonetizationSettings(settings);
  assert.equal(errors[form.placementFieldKey('player', 'windowsPerClick')]?.code, 'integerRange');
  assert.equal(errors[form.placementFieldKey('download', 'windowsPerClick')]?.code, 'integerRange');
  assert.equal(errors[form.placementFieldKey('swiftflux', 'fallbackUrl')]?.code, 'invalidUrl');
  assert.equal(errors[form.placementFieldKey('livetv', 'fallbackUrl')], undefined);
});

test('la validation limite la liste à 50 pubs', () => {
  const { service, form } = loadModules();
  const fifty = Array.from({ length: 50 }, (_, index) => validAd(service, { name: `Pub ${index}` }));
  assert.deepEqual(form.validateMonetizationSettings(settingsWith(service, fifty)), {});

  const fiftyOne = [...fifty, validAd(service, { name: 'Pub 51' })];
  assert.equal(form.validateMonetizationSettings(settingsWith(service, fiftyOne)).ads?.code, 'tooManyAds');
});

test('la validation signale un id de pub en double', () => {
  const { service, form } = loadModules();
  const first = validAd(service);
  const twin = validAd(service, { id: first.id, name: 'Copie' });
  const errors = form.validateMonetizationSettings(settingsWith(service, [first, twin]));
  assert.equal(errors.ads?.code, 'duplicateId');
});

test('normalizeMonetizationForSave nettoie les textes, les pays et les doublons', () => {
  const { service, form } = loadModules();
  const ad = validAd(service, {
    name: '  Régie 1  ',
    url: '  https://regie.example/a  ',
    placements: ['player', 'download', 'player'],
    note: '  mémo  ',
    targeting: { devices: ['mobile', 'mobile'], os: ['ios'], countriesMode: 'include', countries: ['fr', ' be', 'FR', ''] },
    schedule: { startAt: null, endAt: null, days: [3, 1, 3], hours: null },
  });
  const settings = settingsWith(service, [ad]);
  settings.placements.player.fallbackUrl = '  https://movix.example  ';
  const normalized = form.normalizeMonetizationForSave(settings);
  const [saved] = normalized.ads;
  assert.equal(saved.name, 'Régie 1');
  assert.equal(saved.url, 'https://regie.example/a');
  assert.equal(saved.note, 'mémo');
  assert.deepEqual(saved.placements, ['player', 'download']);
  assert.deepEqual(saved.targeting.devices, ['mobile']);
  assert.deepEqual(saved.targeting.countries, ['FR', 'BE']);
  assert.deepEqual(saved.schedule.days, [1, 3]);
  assert.equal(normalized.placements.player.fallbackUrl, 'https://movix.example');
  // Le brouillon d'origine n'est pas modifié.
  assert.equal(ad.name, '  Régie 1  ');
});

test('getChangedMonetizationSections détecte chaque section modifiée', () => {
  const { service, form } = loadModules();
  const reference = settingsWith(service, [validAd(service, { name: 'A' }), validAd(service, { name: 'B' })]);
  const same = form.cloneMonetizationSettings(reference);
  assert.deepEqual(form.getChangedMonetizationSections(same, reference), []);

  const general = form.cloneMonetizationSettings(reference);
  general.adultDefault = false;
  assert.deepEqual(form.getChangedMonetizationSections(general, reference), ['general']);

  const placements = form.cloneMonetizationSettings(reference);
  placements.placements.livetv.rotation = 'random';
  assert.deepEqual(form.getChangedMonetizationSections(placements, reference), ['placements']);

  const weight = form.cloneMonetizationSettings(reference);
  weight.ads[1].weight = 3;
  assert.deepEqual(form.getChangedMonetizationSections(weight, reference), ['ads']);

  const reordered = form.cloneMonetizationSettings(reference);
  reordered.ads.reverse();
  assert.deepEqual(form.getChangedMonetizationSections(reordered, reference), ['ads']);

  const nested = form.cloneMonetizationSettings(reference);
  nested.ads[0].targeting.countries.push('FR');
  assert.deepEqual(form.getChangedMonetizationSections(nested, reference), ['ads']);
  // Le clone est profond : la référence n'a pas bougé.
  assert.deepEqual(reference.ads[0].targeting.countries, []);

  const both = form.cloneMonetizationSettings(reference);
  both.enabled = false;
  both.ads = [];
  assert.deepEqual(form.getChangedMonetizationSections(both, reference), ['general', 'ads']);
});

test('normalizeMonetizationSettings complète une réponse partielle sans planter', () => {
  const { service } = loadModules();
  const settings = service.normalizeMonetizationSettings({
    enabled: false,
    placements: { player: { rotation: 'random', windowsPerClick: 2 }, download: 'cassé' },
    ads: [{ id: 'abc123def0', name: 'Régie', url: 'https://regie.example', placements: ['download'] }, null, 'pub'],
  });
  assert.equal(settings.enabled, false);
  assert.equal(settings.adultDefault, true);
  assert.equal(settings.placements.player.rotation, 'random');
  assert.equal(settings.placements.player.windowsPerClick, 2);
  assert.equal(settings.placements.player.sequenceScope, 'global');
  assert.deepEqual(settings.placements.download, service.DEFAULT_MONETIZATION_SETTINGS.placements.download);
  assert.equal(settings.ads.length, 1);
  assert.equal(settings.ads[0].audience, 'all');
  assert.equal(settings.ads[0].weight, 1);
  assert.deepEqual(settings.ads[0].targeting.countries, []);
});

test('previewMonetization envoie le brouillon avec le jeton et rend les ouvertures', async () => {
  const openings = [{ adId: 'abc123def0', name: 'Régie' }, { adId: null, name: null }];
  const { service, calls } = loadModules({ answer: { status: 200, body: { success: true, openings } } });
  const settings = service.DEFAULT_MONETIZATION_SETTINGS;
  const result = await service.previewMonetization({
    settings,
    placement: 'player',
    profile: { sfw: true, device: 'mobile', os: 'android', country: 'FR' },
    count: 12,
  });
  assert.deepEqual(result, openings);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.test/api/admin/monetization/preview');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer jeton-admin');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    settings,
    placement: 'player',
    profile: { sfw: true, device: 'mobile', os: 'android', country: 'FR' },
    count: 12,
  });
});

test('previewMonetization : un brouillon refusé (400) remonte statusCode 400', async () => {
  const { service } = loadModules({ answer: { status: 400, body: { success: false, error: 'Pub « A » : URL invalide' } } });
  await assert.rejects(
    service.previewMonetization({
      settings: service.DEFAULT_MONETIZATION_SETTINGS,
      placement: 'download',
      profile: { sfw: false, device: 'desktop', os: 'windows', country: null },
      count: 12,
    }),
    (error: Error & { statusCode?: number }) => error.statusCode === 400 && error.message === 'Pub « A » : URL invalide',
  );
});

test('les appels admin refusent de partir sans jeton', async () => {
  const { service, calls } = loadModules({ token: null });
  await assert.rejects(service.getAdminMonetizationSettings(), /jeton|token/i);
  assert.equal(calls.length, 0);
});

test('summarizeMonetizationStats compte aujourd’hui, 7 jours, emplacements et « sans pub »', () => {
  const { form } = loadModules();
  // 12 h UTC le 23 octobre 2026 = 14 h à Paris, même jour.
  const now = new Date('2026-10-23T12:00:00.000Z');
  const summary = form.summarizeMonetizationStats([
    { date: '2026-10-23', counts: { 'aaa111|player': 4, 'bbb222|download': 1, 'none|player': 2 } },
    { date: '2026-10-20', counts: { 'aaa111|swiftflux': 3 } },
    { date: '2026-10-10', counts: { 'aaa111|player': 5, 'none|livetv': 1 } },
    { date: '2026-09-01', counts: { 'aaa111|player': 100 } },
  ], now);

  assert.equal(summary.todayKey, '2026-10-23');
  assert.equal(summary.today.served, 5);
  assert.equal(summary.today.none, 2);
  assert.deepEqual(summary.perAd.aaa111, { today: 4, week: 7, month: 12 });
  assert.deepEqual(summary.perAd.bbb222, { today: 1, week: 1, month: 1 });
  assert.deepEqual(summary.perPlacement.player, { served: 9, none: 2 });
  assert.deepEqual(summary.perPlacement.swiftflux, { served: 3, none: 0 });
  assert.deepEqual(summary.perPlacement.livetv, { served: 0, none: 1 });
  assert.equal(summary.days.length, 14);
  assert.equal(summary.days[0].date, '2026-10-10');
  assert.equal(summary.days[13].date, '2026-10-23');
  assert.deepEqual(summary.days[13], { date: '2026-10-23', served: 5, none: 2 });
  assert.deepEqual(summary.days[12], { date: '2026-10-22', served: 0, none: 0 });
});

// ─── Statistiques : périodes, regroupement, variations ─────────────────────

// 12 h UTC le 23 octobre 2026 = 14 h à Paris, même jour.
const STATS_NOW = new Date('2026-10-23T12:00:00.000Z');

test('getStatsPeriodRange : périodes glissantes en jours de Paris, période précédente collée et de même longueur', () => {
  const { form } = loadModules();
  const today = form.getParisDateKey(STATS_NOW);
  assert.equal(today, '2026-10-23');

  assert.deepEqual(form.getStatsPeriodRange('7d', { today }), {
    from: '2026-10-17', to: '2026-10-23', previousFrom: '2026-10-10', previousTo: '2026-10-16',
  });
  assert.deepEqual(form.getStatsPeriodRange('30d', { today }), {
    from: '2026-09-24', to: '2026-10-23', previousFrom: '2026-08-25', previousTo: '2026-09-23',
  });
  assert.deepEqual(form.getStatsPeriodRange('90d', { today }), {
    from: '2026-07-26', to: '2026-10-23', previousFrom: '2026-04-27', previousTo: '2026-07-25',
  });
  for (const preset of ['7d', '30d', '90d'] as const) {
    const range = form.getStatsPeriodRange(preset, { today });
    assert.equal(
      form.countStatsDays(range.from, range.to),
      form.countStatsDays(String(range.previousFrom), String(range.previousTo)),
      preset,
    );
  }
});

test('getStatsPeriodRange : mois calendaires et 12 mois comparés au même découpage un cran avant', () => {
  const { form } = loadModules();
  const today = '2026-10-23';

  // Ce mois-ci : du 1er à aujourd'hui, comparé aux mêmes jours du mois d'avant.
  assert.deepEqual(form.getStatsPeriodRange('thisMonth', { today }), {
    from: '2026-10-01', to: '2026-10-23', previousFrom: '2026-09-01', previousTo: '2026-09-23',
  });
  // Le 31 mars, le mois d'avant s'arrête au 28 février.
  assert.deepEqual(form.getStatsPeriodRange('thisMonth', { today: '2026-03-31' }), {
    from: '2026-03-01', to: '2026-03-31', previousFrom: '2026-02-01', previousTo: '2026-02-28',
  });
  // Mois dernier : le mois entier, comparé au mois entier d'avant.
  assert.deepEqual(form.getStatsPeriodRange('lastMonth', { today }), {
    from: '2026-09-01', to: '2026-09-30', previousFrom: '2026-08-01', previousTo: '2026-08-31',
  });
  // En janvier, le mois dernier est décembre de l'année d'avant.
  assert.deepEqual(form.getStatsPeriodRange('lastMonth', { today: '2027-01-15' }), {
    from: '2026-12-01', to: '2026-12-31', previousFrom: '2026-11-01', previousTo: '2026-11-30',
  });
  // 12 mois : 12 mois calendaires (le mois en cours compris), comparés à l'année d'avant.
  assert.deepEqual(form.getStatsPeriodRange('12m', { today }), {
    from: '2025-11-01', to: '2026-10-23', previousFrom: '2024-11-01', previousTo: '2025-10-23',
  });
  assert.deepEqual(form.getStatsPeriodRange('12m', { today: '2028-02-29' }), {
    from: '2027-03-01', to: '2028-02-29', previousFrom: '2026-03-01', previousTo: '2027-02-28',
  });
});

test('getStatsPeriodRange : aujourd’hui, hier, cette semaine, cette année', () => {
  const { form } = loadModules();
  // Vendredi 23 octobre 2026.
  const today = '2026-10-23';
  assert.deepEqual(form.getStatsPeriodRange('today', { today }), {
    from: '2026-10-23', to: '2026-10-23', previousFrom: '2026-10-22', previousTo: '2026-10-22',
  });
  assert.deepEqual(form.getStatsPeriodRange('yesterday', { today }), {
    from: '2026-10-22', to: '2026-10-22', previousFrom: '2026-10-21', previousTo: '2026-10-21',
  });
  // Semaine du lundi 19 au vendredi 23, comparée aux mêmes jours de la semaine d'avant.
  assert.deepEqual(form.getStatsPeriodRange('thisWeek', { today }), {
    from: '2026-10-19', to: '2026-10-23', previousFrom: '2026-10-12', previousTo: '2026-10-16',
  });
  // Un lundi : la semaine ne compte qu'un jour.
  assert.deepEqual(form.getStatsPeriodRange('thisWeek', { today: '2026-10-19' }), {
    from: '2026-10-19', to: '2026-10-19', previousFrom: '2026-10-12', previousTo: '2026-10-12',
  });
  assert.deepEqual(form.getStatsPeriodRange('thisYear', { today }), {
    from: '2026-01-01', to: '2026-10-23', previousFrom: '2025-01-01', previousTo: '2025-10-23',
  });
  assert.deepEqual([...form.STATS_PERIOD_PRESETS], [
    'today', 'yesterday', '7d', '30d', 'thisWeek', 'thisMonth', 'lastMonth', 'thisYear',
  ]);
});

test('getStatsCustomRange : dates remises dans l’ordre, écart borné, période d’avant collée', () => {
  const { form } = loadModules();
  assert.deepEqual(form.getStatsCustomRange('2026-10-19', '2026-10-23'), {
    from: '2026-10-19', to: '2026-10-23', previousFrom: '2026-10-14', previousTo: '2026-10-18',
  });
  assert.deepEqual(form.getStatsCustomRange('2026-10-23', '2026-10-19'), {
    from: '2026-10-19', to: '2026-10-23', previousFrom: '2026-10-14', previousTo: '2026-10-18',
  });
  assert.deepEqual(form.getStatsCustomRange('2026-10-05', '2026-10-05'), {
    from: '2026-10-05', to: '2026-10-05', previousFrom: '2026-10-04', previousTo: '2026-10-04',
  });
  // Plus de 1 100 jours : la fin est gardée, le début rapproché.
  const capped = form.getStatsCustomRange('2020-01-01', '2026-10-23');
  assert.equal(capped.to, '2026-10-23');
  assert.equal(form.countStatsDays(capped.from, capped.to), form.STATS_MAX_RANGE_DAYS);
});

test('getStatsPeriodRange : « tout » part du premier jour en base, sans période précédente', () => {
  const { form } = loadModules();
  const today = '2026-10-23';
  assert.deepEqual(form.getStatsPeriodRange('all', { today, firstDate: '2026-06-25' }), {
    from: '2026-06-25', to: '2026-10-23', previousFrom: null, previousTo: null,
  });
  // Rien en base (ou serveur trop ancien) : aujourd'hui seulement.
  assert.deepEqual(form.getStatsPeriodRange('all', { today, firstDate: null }), {
    from: '2026-10-23', to: '2026-10-23', previousFrom: null, previousTo: null,
  });
  assert.deepEqual(form.getStatsPeriodRange('all', { today }), {
    from: '2026-10-23', to: '2026-10-23', previousFrom: null, previousTo: null,
  });
  // Premier jour dans le futur (horloge décalée) : ramené à aujourd'hui.
  assert.equal(form.getStatsPeriodRange('all', { today, firstDate: '2026-10-30' }).from, '2026-10-23');
  // Le serveur refuse plus de 1 100 jours : « tout » est borné.
  const capped = form.getStatsPeriodRange('all', { today, firstDate: '2020-01-01' });
  assert.equal(form.countStatsDays(capped.from, capped.to), form.STATS_MAX_RANGE_DAYS);
});

test('getStatsPeriodRange suit le jour de Paris, pas celui d’UTC', () => {
  const { form } = loadModules();
  // 23 h 30 UTC le 31 octobre = 0 h 30 à Paris le 1er novembre (heure d'hiver).
  const today = form.getParisDateKey(new Date('2026-10-31T23:30:00.000Z'));
  assert.equal(today, '2026-11-01');
  assert.deepEqual(form.getStatsPeriodRange('thisMonth', { today }), {
    from: '2026-11-01', to: '2026-11-01', previousFrom: '2026-10-01', previousTo: '2026-10-01',
  });
});

test('regroupement : jour jusqu’à 92 jours, semaine jusqu’à 731, mois toujours ; choix automatique', () => {
  const { form } = loadModules();
  const to = '2026-10-23';
  const span = (days: number) => form.shiftDateKey(to, -(days - 1));

  assert.equal(form.countStatsDays(span(92), to), 92);
  assert.deepEqual(form.getAllowedStatsGranularities(span(7), to), ['day', 'week', 'month']);
  assert.deepEqual(form.getAllowedStatsGranularities(span(92), to), ['day', 'week', 'month']);
  assert.deepEqual(form.getAllowedStatsGranularities(span(93), to), ['week', 'month']);
  assert.deepEqual(form.getAllowedStatsGranularities(span(731), to), ['week', 'month']);
  assert.deepEqual(form.getAllowedStatsGranularities(span(732), to), ['month']);

  assert.equal(form.getDefaultStatsGranularity(span(1), to), 'day');
  assert.equal(form.getDefaultStatsGranularity(span(31), to), 'day');
  assert.equal(form.getDefaultStatsGranularity(span(32), to), 'week');
  assert.equal(form.getDefaultStatsGranularity(span(92), to), 'week');
  assert.equal(form.getDefaultStatsGranularity(span(93), to), 'month');

  // Un choix interdit pour la période retombe sur le choix automatique.
  assert.equal(form.resolveStatsGranularity(null, span(30), to), 'day');
  assert.equal(form.resolveStatsGranularity('month', span(30), to), 'month');
  assert.equal(form.resolveStatsGranularity('week', span(357), to), 'week');
  assert.equal(form.resolveStatsGranularity('day', span(357), to), 'month');
});

test('computeStatsChange : variation relative, null sans base de comparaison', () => {
  const { form } = loadModules();
  assert.equal(form.computeStatsChange(150, 100), 0.5);
  assert.equal(form.computeStatsChange(50, 100), -0.5);
  assert.equal(form.computeStatsChange(100, 100), 0);
  assert.equal(form.computeStatsChange(10, 0), null);
  assert.equal(form.computeStatsChange(0, 0), null);
  assert.equal(form.computeStatsChange(10, null), null);
});

const PERIOD_DAYS = [
  // Période précédente du 30 jours (25 août → 23 septembre).
  { date: '2026-08-25', counts: { 'aaa111|player': 10 } },
  { date: '2026-09-10', counts: { 'aaa111|player': 20, 'bbb222|download': 5, 'none|player': 4 } },
  // Période (24 septembre → 23 octobre).
  { date: '2026-09-24', counts: { 'aaa111|player': 3 } },
  { date: '2026-09-30', counts: { 'aaa111|player': 6, 'none|livetv': 2 } },
  { date: '2026-10-02', counts: { 'bbb222|download': 4 } },
  { date: '2026-10-20', counts: { 'aaa111|swiftflux': 7, 'ccc333|player': 8 } },
  { date: '2026-10-23', counts: { 'aaa111|player': 4, 'bbb222|download': 1, 'none|player': 2 } },
  // Hors de tout : ignoré.
  { date: '2026-10-24', counts: { 'aaa111|player': 999 } },
];

test('buildMonetizationPeriodStats par semaine : lundis, semaines à cheval sur deux mois, bords coupés', () => {
  const { form } = loadModules();
  const range = form.getStatsPeriodRange('30d', { today: '2026-10-23' });
  const view = form.buildMonetizationPeriodStats(PERIOD_DAYS, {
    ...range, granularity: 'week', placement: 'all', today: '2026-10-23',
  });

  assert.equal(view.granularity, 'week');
  assert.deepEqual(
    view.buckets.map((bucket) => [bucket.key, bucket.from, bucket.to, bucket.days, bucket.partial]),
    [
      // Jeudi 24 septembre : la semaine du lundi 21 est coupée au début.
      ['2026-09-21', '2026-09-24', '2026-09-27', 4, true],
      // Semaine à cheval sur septembre et octobre : entière.
      ['2026-09-28', '2026-09-28', '2026-10-04', 7, false],
      ['2026-10-05', '2026-10-05', '2026-10-11', 7, false],
      ['2026-10-12', '2026-10-12', '2026-10-18', 7, false],
      // Vendredi 23 octobre : semaine en cours, coupée à la fin.
      ['2026-10-19', '2026-10-19', '2026-10-23', 5, true],
    ],
  );
  const crossing = view.buckets[1];
  assert.deepEqual(crossing.byAd, { aaa111: 6, bbb222: 4 });
  assert.equal(crossing.served, 10);
  assert.equal(crossing.none, 2);
  assert.deepEqual(view.buckets[2].byAd, {});
  assert.equal(view.buckets[2].served, 0);
});

test('buildMonetizationPeriodStats par mois : 12 mois calendaires, février et mars séparés, mois en cours partiel', () => {
  const { form } = loadModules();
  const range = form.getStatsPeriodRange('12m', { today: '2026-10-23' });
  const view = form.buildMonetizationPeriodStats([
    { date: '2026-02-28', counts: { 'aaa111|player': 5 } },
    { date: '2026-03-01', counts: { 'aaa111|player': 7 } },
    { date: '2026-10-23', counts: { 'aaa111|player': 1 } },
  ], { ...range, granularity: 'month', placement: 'all', today: '2026-10-23' });

  assert.equal(view.buckets.length, 12);
  assert.deepEqual(
    [view.buckets[0].key, view.buckets[0].from, view.buckets[0].to, view.buckets[0].days, view.buckets[0].partial],
    ['2025-11-01', '2025-11-01', '2025-11-30', 30, false],
  );
  const february = view.buckets.find((bucket) => bucket.key === '2026-02-01');
  const march = view.buckets.find((bucket) => bucket.key === '2026-03-01');
  assert.equal(february?.served, 5);
  assert.equal(february?.days, 28);
  assert.equal(march?.served, 7);
  const last = view.buckets[11];
  assert.deepEqual([last.key, last.from, last.to, last.days, last.partial], ['2026-10-01', '2026-10-01', '2026-10-23', 23, true]);
});

test('buildMonetizationPeriodStats : totaux, meilleure journée, pubs du jour et période précédente', () => {
  const { form } = loadModules();
  const range = form.getStatsPeriodRange('30d', { today: '2026-10-23' });
  const view = form.buildMonetizationPeriodStats(PERIOD_DAYS, {
    ...range, granularity: 'day', placement: 'all', today: '2026-10-23', firstDate: '2026-08-01',
  });

  assert.equal(view.buckets.length, 30);
  assert.equal(view.buckets[0].key, '2026-09-24');
  assert.equal(view.buckets[29].key, '2026-10-23');
  assert.ok(view.buckets.every((bucket) => bucket.days === 1 && !bucket.partial));
  assert.deepEqual(view.buckets[29].byAd, { aaa111: 4, bbb222: 1 });
  assert.equal(view.buckets[29].none, 2);

  assert.deepEqual(view.current, {
    from: '2026-09-24',
    to: '2026-10-23',
    days: 30,
    served: 33,
    none: 4,
    average: 33 / 30,
    bestDay: { date: '2026-10-20', count: 15 },
  });
  assert.equal(view.includesToday, true);
  assert.deepEqual(view.perAd.aaa111, { period: 20, today: 4 });
  assert.deepEqual(view.perAd.bbb222, { period: 5, today: 1 });
  assert.deepEqual(view.perAd.ccc333, { period: 8, today: 0 });
  assert.deepEqual(view.perPlacement.player, { served: 21, none: 2 });
  assert.deepEqual(view.perPlacement.livetv, { served: 0, none: 2 });

  assert.deepEqual(view.previous, {
    from: '2026-08-25',
    to: '2026-09-23',
    days: 30,
    served: 35,
    none: 4,
    average: 35 / 30,
    bestDay: { date: '2026-09-10', count: 25 },
    complete: true,
  });
  assert.equal(view.changes.served, (33 - 35) / 35);
  assert.equal(view.changes.average, (33 / 30 - 35 / 30) / (35 / 30));
  assert.equal(view.changes.bestDay, (15 - 25) / 25);
  assert.equal(view.changes.none, 0);
});

test('buildMonetizationPeriodStats : le filtre d’emplacement vaut partout sauf pour la ventilation par emplacement', () => {
  const { form } = loadModules();
  const range = form.getStatsPeriodRange('30d', { today: '2026-10-23' });
  const view = form.buildMonetizationPeriodStats(PERIOD_DAYS, {
    ...range, granularity: 'week', placement: 'player', today: '2026-10-23', firstDate: '2026-08-01',
  });

  assert.equal(view.current.served, 21);
  assert.equal(view.current.none, 2);
  assert.deepEqual(view.current.bestDay, { date: '2026-10-20', count: 8 });
  assert.equal(view.perAd.bbb222, undefined);
  assert.deepEqual(view.perAd.aaa111, { period: 13, today: 4 });
  assert.deepEqual(view.buckets[1].byAd, { aaa111: 6 });
  assert.equal(view.buckets[1].none, 0);
  // La période précédente suit le même filtre.
  assert.equal(view.previous?.served, 30);
  assert.equal(view.previous?.none, 4);
  // La ventilation par emplacement ignore le filtre.
  assert.deepEqual(view.perPlacement.download, { served: 5, none: 0 });
  assert.deepEqual(view.perPlacement.swiftflux, { served: 7, none: 0 });
});

test('buildMonetizationPeriodStats : variation d’un groupe sur la moyenne par jour du groupe précédent', () => {
  const { form } = loadModules();
  const range = form.getStatsPeriodRange('30d', { today: '2026-10-23' });
  const view = form.buildMonetizationPeriodStats(PERIOD_DAYS, {
    ...range, granularity: 'week', placement: 'all', today: '2026-10-23',
  });
  const [first, second, third, fourth, fifth] = view.buckets;
  assert.equal(first.change, null);
  // 3 ouvertures en 4 jours, puis 10 en 7 jours.
  assert.equal(second.change, (10 / 7 - 3 / 4) / (3 / 4));
  assert.equal(third.change, -1);
  // Rien la semaine d'avant : pas de pourcentage.
  assert.equal(fourth.change, null);
  assert.equal(fifth.change, null);
});

test('buildMonetizationPeriodStats : période précédente avant le premier jour en base = pas de variation', () => {
  const { form } = loadModules();
  const range = form.getStatsPeriodRange('30d', { today: '2026-10-23' });
  const view = form.buildMonetizationPeriodStats(PERIOD_DAYS, {
    ...range, granularity: 'day', placement: 'all', today: '2026-10-23', firstDate: '2026-09-01',
  });
  assert.equal(view.previous?.complete, false);
  assert.deepEqual(view.changes, { served: null, average: null, bestDay: null, none: null });

  // « Tout » : aucune période précédente.
  const all = form.getStatsPeriodRange('all', { today: '2026-10-23', firstDate: '2026-08-25' });
  const allView = form.buildMonetizationPeriodStats(PERIOD_DAYS, {
    ...all, granularity: 'month', placement: 'all', today: '2026-10-23', firstDate: '2026-08-25',
  });
  assert.equal(allView.previous, null);
  assert.deepEqual(allView.changes, { served: null, average: null, bestDay: null, none: null });
  assert.equal(allView.current.served, 68);
  assert.deepEqual(allView.buckets.map((bucket) => [bucket.key, bucket.partial]), [
    ['2026-08-01', true],
    ['2026-09-01', false],
    ['2026-10-01', true],
  ]);

  // Le mois dernier n'inclut pas aujourd'hui.
  const lastMonth = form.getStatsPeriodRange('lastMonth', { today: '2026-10-23' });
  const lastMonthView = form.buildMonetizationPeriodStats(PERIOD_DAYS, {
    ...lastMonth, granularity: 'day', placement: 'all', today: '2026-10-23',
  });
  assert.equal(lastMonthView.includesToday, false);
  assert.equal(lastMonthView.perAd.aaa111.today, 0);
  assert.equal(lastMonthView.current.bestDay?.date, '2026-09-10');
});

test('getMonetizationStats envoie from et to et rend jours, bornes, aujourd’hui et premier jour', async () => {
  const body = {
    success: true,
    from: '2026-10-22',
    to: '2026-10-23',
    today: '2026-10-23',
    firstDate: '2026-06-25',
    days: [
      { date: '2026-10-23', counts: { 'aaa111|player': '4', 'none|player': 0 } },
      { date: '2026-10-22', counts: {} },
    ],
  };
  const { service, calls } = loadModules({ answer: { status: 200, body } });
  const result = await service.getMonetizationStats({ from: '2026-10-22', to: '2026-10-23' });
  assert.equal(calls[0].url, 'https://api.test/api/admin/monetization/stats?from=2026-10-22&to=2026-10-23');
  assert.deepEqual(result, {
    from: '2026-10-22',
    to: '2026-10-23',
    today: '2026-10-23',
    firstDate: '2026-06-25',
    days: [
      { date: '2026-10-22', counts: {} },
      { date: '2026-10-23', counts: { 'aaa111|player': 4 } },
    ],
  });
});

test('getMonetizationStats : nombre de jours = ancien paramètre, réponse d’un ancien serveur tolérée', async () => {
  const body = { success: true, days: [{ date: '2026-10-23', counts: { 'aaa111|player': 2 } }, { date: '2026-10-22', counts: {} }] };
  const { service, calls } = loadModules({ answer: { status: 200, body } });
  const result = await service.getMonetizationStats(30);
  assert.equal(calls[0].url, 'https://api.test/api/admin/monetization/stats?days=30');
  assert.equal(result.today, null);
  assert.equal(result.firstDate, null);
  assert.equal(result.from, '2026-10-22');
  assert.equal(result.to, '2026-10-23');
  assert.equal(result.days.length, 2);

  // Bornes demandées reprises quand le serveur ne les renvoie pas.
  const ranged = await service.getMonetizationStats({ from: '2026-09-24', to: '2026-10-23' });
  assert.equal(ranged.from, '2026-09-24');
  assert.equal(ranged.to, '2026-10-23');
});

test('getAdWeightMeaning suit la rotation des emplacements de la pub', () => {
  const { service, form } = loadModules();
  const settings = settingsWith(service, []);
  settings.placements.download.rotation = 'random';
  assert.equal(form.getAdWeightMeaning(validAd(service, { placements: ['player'] }), settings), 'sequence');
  assert.equal(form.getAdWeightMeaning(validAd(service, { placements: ['download'] }), settings), 'random');
  assert.equal(form.getAdWeightMeaning(validAd(service, { placements: ['livetv', 'swiftflux'] }), settings), 'sequence');
  assert.equal(form.getAdWeightMeaning(validAd(service, { placements: ['player', 'download'] }), settings), 'mixed');
});

test('le mode « priority » n’existe plus : relu et envoyé comme « sequence »', () => {
  const { service, form } = loadModules();
  assert.deepEqual([...service.MONETIZATION_ROTATION_MODES], ['sequence', 'random']);

  const read = service.normalizeMonetizationSettings({ placements: { livetv: { rotation: 'priority' } } });
  assert.equal(read.placements.livetv.rotation, 'sequence');

  const draft = settingsWith(service, []);
  (draft.placements.player as { rotation: string }).rotation = 'priority';
  assert.equal(form.normalizeMonetizationForSave(draft).placements.player.rotation, 'sequence');
});
