/**
 * Index du catalogue d'anime-sama (utils/animeSamaIndex.js) : la tâche de fond
 * qui lit le sitemap, les fiches et le planning.
 *
 * Modes de défaillance couverts ici. Le scénario de bout en bout
 * (`scripts/e2e/animeSamaLive.js`) lit le vrai site et écrit dans une vraie
 * base MySQL : il prouve que les pages du jour sont comprises et que les
 * requêtes SQL (recherche par ID TMDB, filtres, pagination) rendent les bonnes
 * lignes. Il ne peut ni casser le sitemap d'anime-sama, ni avancer l'horloge
 * d'un jour, ni lancer deux serveurs. Ces cas-là sont joués ici contre un faux
 * site et une base en mémoire.
 *
 *  1. Chaque passage relit les 2 500 fiches au lieu des seules fiches dues
 *     (nouvelles, ou lues il y a plus d'un jour).
 *  2. Un sitemap cassé (page de vérification, panne) ou tronqué fait passer
 *     tout le catalogue pour retiré : page Animes vide, plus de fiche par ID TMDB.
 *  3. Une fiche illisible (page de vérification, 503) écrase une fiche connue
 *     par du vide et lui fait perdre son ID TMDB.
 *  4. Quand anime-sama bloque, le passage continue de demander des milliers de
 *     fiches.
 *  5. Une œuvre retirée du site reste proposée ; une œuvre qui revient reste
 *     cachée ; un ID TMDB retiré de la fiche reste en base.
 *  6. Un planning illisible efface la semaine ; une sortie retirée du planning
 *     reste affichée ; les semaines passées sont effacées.
 *  7. Deux serveurs lisent le catalogue en même temps ; un passage qui plante
 *     garde le verrou.
 *  8. Une panne de la base ou du site fait tomber le worker (promesse rejetée
 *     sans gestion dans une tâche de fond).
 *  9. Une fiche sans ID TMDB reste introuvable par ID alors qu'elle publie son
 *     ID AniList ou MyAnimeList. À l'inverse : la correspondance est demandée
 *     pour les 2 500 fiches, ou remplace l'ID que le site publie lui-même.
 * 10. Le service de correspondance en panne efface un lien déjà rangé, compte
 *     comme une fiche illisible (et interrompt le passage), remplit les logs
 *     d'une ligne par fiche, ou fait lever la tâche.
 * 11. Une fiche reliée par correspondance prend la page TMDB d'une œuvre que
 *     le site relie déjà à cet ID (film ou saison à part rangé sous la série).
 * 12. Une correspondance retirée ou corrigée par le service reste en base.
 * 13. Le planning du site s'arrête au dimanche de la semaine en cours : le
 *     calendrier n'a plus aucune sortie d'anime au-delà. La semaine suivante
 *     est donc prévue en recopiant la dernière semaine connue. Ce qui peut mal
 *     tourner : une sortie prévue reste à côté de la vraie une fois la semaine
 *     publiée ; l'heure de sortie n'est pas décalée (le site range alors la
 *     sortie au mauvais jour) ; le numéro d'épisode n'avance pas, ou avance mal
 *     pour deux épisodes par semaine ; un film repasse chaque semaine ; une
 *     sortie « reportée » reste reportée ; la prévision s'étend sans fin.
 * 14. Index en retard de plusieurs jours : des sorties « prévues » sont
 *     inventées dans le passé.
 * 15. Une fenêtre qui ne couvre que la semaine suivante ne reçoit rien, parce
 *     que la semaine recopiée est hors de la fenêtre demandée.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createAnimeSamaIndex } = require('../animeSamaIndex');

const SITE = 'https://anime-sama.invalid/';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 10, 13, 12, 0, 0);

const httpError = status => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: '' } });
const CHALLENGE = '<!doctype html><title>Un instant…</title><p>Vérification du navigateur</p>';

function ficheHtml({ name, tmdb = null, anilist = null, mal = null, seasons = ['saison1/vostfr'], scans = false }) {
  return [
    `<h1 id="titreOeuvre" class="oe-titre">${name}</h1>`,
    '<script>var OE_BASE = "/catalogue/x/"; function panneauAnime(nom, url) {}</script>',
    tmdb ? `<a href="https://www.themoviedb.org/${tmdb[0]}/${tmdb[1]}">TMDB</a>` : '',
    anilist ? `<a href="https://anilist.co/anime/${anilist}">AniList</a>` : '',
    mal ? `<a href="https://myanimelist.net/anime/${mal}">MyAnimeList</a>` : '',
    '<script>',
    ...seasons.map((target, rank) => `panneauAnime("Saison ${rank + 1}", "${target}");`),
    scans ? 'panneauScan("Scans", "scan/vf");' : '',
    '</script>',
  ].join('\n');
}

const sitemapXml = slugs => `<urlset>${slugs.map(slug => `<url><loc>${SITE}catalogue/${slug}/</loc></url>`).join('')}</urlset>`;

// `days` : [['09/11', [{ slug, name, lien, ts, classes, label }]], …]
function planningHtml(days) {
  return days.map(([date, cards]) => [
    `<h2 class="titreJours">Jour</h2><p>${date}</p>`,
    ...cards.map(card => [
      `<div class="as-carte planning-card ${card.classes || 'Anime VOSTFR'}" data-url="/catalogue/${card.slug}/" data-lien="${card.lien || 'saison1/vostfr'}" data-nom="${card.name || card.slug}"${card.ts ? ` data-release-ts="${card.ts}"` : ''}>`,
      `<div class="as-carte-info"><span>${card.label || 'Saison 1'}</span></div></div>`,
    ].join('')),
  ].join('\n')).join('\n');
}

// Base en mémoire, avec les mêmes opérations que le magasin MySQL.
function createStore() {
  const titles = new Map();
  const planning = new Map();
  const store = {
    titles, planning, down: false,
    check() { if (store.down) throw new Error('ECONNREFUSED'); },
    async listKnown() { store.check(); return [...titles].map(([slug, title]) => ({ slug, checkedAt: title.checkedAt, missingSince: title.missingSince })); },
    // `keepTmdb` : le lien TMDB déjà rangé reste, quoi que dise la fiche.
    async saveTitle(slug, fiche, at, { keepTmdb = false } = {}) {
      store.check();
      const known = titles.get(slug);
      const saved = keepTmdb ? { ...fiche, tmdb: known?.fiche.tmdb ?? null } : fiche;
      titles.set(slug, { fiche: saved, firstSeenAt: known?.firstSeenAt ?? at, checkedAt: at, missingSince: null });
    },
    // Œuvres visibles (au moins une saison, encore sur le site) reliées à cet ID.
    async findByTmdb(type, id) {
      store.check();
      return [...titles]
        .filter(([, title]) => title.missingSince === null && (title.fiche.seasons || []).length > 0
          && title.fiche.tmdb?.type === type && title.fiche.tmdb?.id === id)
        .map(([slug, title]) => ({ slug, name: title.fiche.name }));
    },
    async setMissing(slugs, at) {
      store.check();
      for (const slug of slugs) { const title = titles.get(slug); if (title && title.missingSince === null) title.missingSince = at; }
    },
    async replacePlanning(days, entries) {
      store.check();
      for (const [key, entry] of planning) if (days.includes(entry.day)) planning.delete(key);
      for (const entry of entries) planning.set(`${entry.day}|${entry.slug}|${entry.seasonPath}|${entry.lang}`, entry);
    },
    async prune() { store.check(); },
    // Sorties rangées entre deux jours, avec le lien TMDB de l'œuvre.
    async readPlanning({ from, to }) {
      store.check();
      const entries = [...planning.values()]
        .filter(entry => entry.day >= from && entry.day <= to)
        .sort((a, b) => a.day.localeCompare(b.day) || a.slug.localeCompare(b.slug))
        .map(entry => ({ ...entry, tmdb: titles.get(entry.slug)?.fiche.tmdb ?? null, posterPath: null, image: '' }));
      return { updatedAt: entries.length ? START : null, entries };
    },
    // Dernier jour pour lequel une sortie est rangée, ou null.
    async lastPlanningDay() {
      store.check();
      return [...planning.values()].reduce((last, entry) => (last === null || entry.day > last ? entry.day : last), null);
    },
  };
  return store;
}

function setup({ slugs = ['alpha', 'beta', 'gamma'], lock = null, ...options } = {}) {
  const clock = { now: START };
  const site = {
    sitemap: slugs,
    fiches: Object.fromEntries(slugs.map((slug, rank) => [slug, { name: slug, tmdb: ['tv', 100 + rank] }])),
    planning: planningHtml([['13/11', [{ slug: slugs[0] }]]]),
    calls: [],
  };
  const answer = (value) => {
    if (value instanceof Error) throw value;
    return { status: 200, data: value };
  };
  const request = async ({ url }) => {
    const { pathname } = new URL(url);
    site.calls.push(pathname);
    if (pathname === '/sitemap.xml') return answer(Array.isArray(site.sitemap) ? sitemapXml(site.sitemap) : site.sitemap);
    if (pathname === '/planning/') return answer(site.planning);
    const slug = pathname.split('/')[2];
    const fiche = site.fiches[slug];
    if (fiche === undefined) throw httpError(404);
    return answer(fiche instanceof Error || typeof fiche === 'string' ? fiche : ficheHtml(fiche));
  };
  const store = createStore();
  const logs = [];
  const record = (...args) => logs.push(args.join(' '));
  const index = createAnimeSamaIndex({
    store, request, siteUrl: SITE, now: () => clock.now, sleep: async () => {},
    logger: { log: record, warn: record, error: record },
    ...(lock ? { acquireLock: lock } : {}),
    ...options,
  });
  return {
    site, store, index, clock, logs,
    ficheCalls: () => site.calls.filter(pathname => /^\/catalogue\/[^/]+\/$/.test(pathname)).map(pathname => pathname.split('/')[2]),
    forget() { site.calls.length = 0; logs.length = 0; },
    tmdbOf: slug => store.titles.get(slug)?.fiche.tmdb ?? null,
    visible: () => [...store.titles].filter(([, title]) => title.missingSince === null).map(([slug]) => slug).sort(),
  };
}

test('premier passage : chaque fiche du sitemap est lue une fois et rangée avec son ID TMDB', async () => {
  const h = setup();
  h.site.fiches.gamma = { name: 'Gamma', seasons: [], scans: true };
  const report = await h.index.runOnce();

  assert.deepEqual(h.ficheCalls().sort(), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(h.tmdbOf('alpha'), { type: 'tv', id: 100 });
  assert.equal(h.store.titles.get('alpha').fiche.seasons.length, 1);
  assert.equal(h.store.titles.get('gamma').fiche.seasons.length, 0, 'une œuvre en scans seulement est rangée sans anime');
  assert.equal(report.saved, 3);
  assert.deepEqual(h.logs.filter(line => /échou|illisible/.test(line)), []);
});

test('une fiche n’est relue qu’au bout d’un jour ; une nouvelle œuvre est lue au passage suivant', async () => {
  const h = setup();
  await h.index.runOnce();

  h.clock.now += HOUR; h.forget();
  h.site.sitemap = ['alpha', 'beta', 'gamma', 'delta'];
  h.site.fiches.delta = { name: 'Delta', tmdb: ['movie', 7] };
  await h.index.runOnce();
  assert.deepEqual(h.ficheCalls(), ['delta'], 'seule la nouvelle œuvre coûte une requête');
  assert.deepEqual(h.tmdbOf('delta'), { type: 'movie', id: 7 });

  h.clock.now += DAY; h.forget();
  await h.index.runOnce();
  assert.deepEqual(h.ficheCalls().sort(), ['alpha', 'beta', 'delta', 'gamma']);
});

test('sitemap cassé ou tronqué : aucune œuvre ne passe pour retirée', async () => {
  const slugs = Array.from({ length: 200 }, (_, rank) => `oeuvre-${rank}`);
  const h = setup({ slugs });
  await h.index.runOnce();
  assert.equal(h.visible().length, 200);

  for (const broken of [CHALLENGE, '', httpError(503), sitemapXml(slugs.slice(0, 20))]) {
    h.clock.now += 2 * DAY; h.forget();
    h.site.sitemap = broken;
    await h.index.runOnce();
    assert.equal(h.visible().length, 200, 'le catalogue reste entier');
  }
  // Illisible : rien n'est lu. Tronqué : seules les fiches listées le sont.
  h.clock.now += 2 * DAY; h.forget();
  h.site.sitemap = CHALLENGE;
  await h.index.runOnce();
  assert.deepEqual(h.ficheCalls(), []);
  assert.equal(h.logs.filter(line => line.includes('Sitemap')).length, 1);
});

test('une œuvre retirée du site est cachée ; revenue, elle est relue tout de suite', async () => {
  const slugs = Array.from({ length: 100 }, (_, rank) => `oeuvre-${rank}`);
  const h = setup({ slugs });
  await h.index.runOnce();

  h.clock.now += HOUR; h.forget();
  h.site.sitemap = slugs.slice(1);
  await h.index.runOnce();
  assert.equal(h.visible().includes('oeuvre-0'), false);
  assert.equal(h.visible().length, 99);

  h.clock.now += HOUR; h.forget();
  h.site.sitemap = slugs;
  await h.index.runOnce();
  assert.deepEqual(h.ficheCalls(), ['oeuvre-0']);
  assert.equal(h.visible().length, 100);
});

test('une fiche supprimée (404) est cachée sans compter comme une panne', async () => {
  const slugs = Array.from({ length: 60 }, (_, rank) => `oeuvre-${rank}`);
  const h = setup({ slugs });
  await h.index.runOnce();

  h.clock.now += 2 * DAY; h.forget();
  for (const slug of slugs.slice(0, 10)) delete h.site.fiches[slug];
  const report = await h.index.runOnce();
  assert.equal(h.visible().length, 50);
  assert.equal(h.ficheCalls().length, 60, 'dix 404 d’affilée n’arrêtent pas le passage');
  assert.equal(report.aborted, false);
});

test('une fiche illisible garde ce qu’on savait d’elle ; un ID TMDB retiré par le site est retiré', async () => {
  const h = setup();
  await h.index.runOnce();

  h.clock.now += 2 * DAY; h.forget();
  h.site.fiches.alpha = CHALLENGE;
  h.site.fiches.beta = httpError(503);
  h.site.fiches.gamma = { name: 'gamma' };
  await h.index.runOnce();
  assert.deepEqual(h.tmdbOf('alpha'), { type: 'tv', id: 100 });
  assert.deepEqual(h.tmdbOf('beta'), { type: 'tv', id: 101 });
  assert.equal(h.tmdbOf('gamma'), null);
  assert.deepEqual(h.visible(), ['alpha', 'beta', 'gamma']);

  // Les fiches illisibles restent dues : elles sont relues au passage suivant.
  h.clock.now += HOUR; h.forget();
  h.site.fiches.alpha = { name: 'alpha', tmdb: ['tv', 100] };
  h.site.fiches.beta = { name: 'beta', tmdb: ['tv', 101] };
  await h.index.runOnce();
  assert.deepEqual(h.ficheCalls().sort(), ['alpha', 'beta']);
});

test('anime-sama bloque : le passage s’arrête après quelques échecs d’affilée et reprend plus tard', async () => {
  const slugs = Array.from({ length: 80 }, (_, rank) => `oeuvre-${String(rank).padStart(2, '0')}`);
  const h = setup({ slugs });
  for (const slug of slugs.slice(10)) h.site.fiches[slug] = httpError(403);
  const report = await h.index.runOnce();

  assert.equal(report.aborted, true);
  assert.equal(report.saved, 10);
  assert(h.ficheCalls().length <= 20, `${h.ficheCalls().length} fiches demandées pendant le blocage`);
  assert.equal(h.logs.filter(line => line.includes('interrompu')).length, 1);

  h.clock.now += HOUR; h.forget();
  for (const slug of slugs.slice(10)) h.site.fiches[slug] = { name: slug, tmdb: ['tv', 5] };
  await h.index.runOnce();
  assert.equal(h.ficheCalls().length, 70, 'seules les fiches jamais lues sont demandées');
  assert.equal(h.visible().length, 80);
});

test('planning : les jours de la page sont remplacés, les autres gardés ; une page illisible ne change rien', async () => {
  const h = setup();
  h.site.planning = planningHtml([
    ['12/11', [{ slug: 'alpha', ts: 1794500000 }, { slug: 'beta' }]],
    ['13/11', [{ slug: 'gamma', classes: 'Anime VF pl-sorti' }, { slug: 'manga', classes: 'Scans VF' }]],
  ]);
  await h.index.runOnce();
  const keys = () => [...h.store.planning.keys()].sort();
  assert.deepEqual(keys(), [
    '2026-11-12|alpha|saison1|vostfr', '2026-11-12|beta|saison1|vostfr', '2026-11-13|gamma|saison1|vf',
  ]);
  assert.equal(h.store.planning.get('2026-11-12|alpha|saison1|vostfr').releaseAt, 1794500000);
  assert.equal(h.store.planning.get('2026-11-13|gamma|saison1|vf').state, 'released');

  // La semaine suivante : beta n'est plus annoncé le 19, la semaine passée reste.
  h.clock.now += 7 * DAY;
  h.site.planning = planningHtml([['19/11', [{ slug: 'alpha' }]], ['20/11', []]]);
  await h.index.runOnce();
  assert.deepEqual(keys(), [
    '2026-11-12|alpha|saison1|vostfr', '2026-11-12|beta|saison1|vostfr', '2026-11-13|gamma|saison1|vf',
    '2026-11-19|alpha|saison1|vostfr',
  ]);

  // Une sortie retirée d'un jour encore affiché disparaît.
  h.site.planning = planningHtml([['19/11', []], ['20/11', []]]);
  await h.index.runOnce();
  assert.equal(keys().includes('2026-11-19|alpha|saison1|vostfr'), false);

  for (const broken of [CHALLENGE, httpError(503)]) {
    h.site.planning = broken;
    await h.index.runOnce();
    assert.equal(keys().length, 3);
  }
});

test('un seul serveur lit le catalogue à la fois ; le verrou est rendu même quand le passage plante', async () => {
  let held = false; let released = 0;
  const lock = async () => {
    if (held) return null;
    held = true;
    return { renew: async () => true, release: async () => { held = false; released += 1; } };
  };
  const h = setup({ lock });
  held = true;
  assert.equal(await h.index.runOnce(), null, 'un autre serveur travaille déjà');
  assert.deepEqual(h.site.calls, []);

  held = false;
  h.store.down = true;
  await h.index.runOnce();
  assert.equal(released, 1);
  assert.equal(held, false);

  h.store.down = false;
  await h.index.runOnce();
  assert.deepEqual(h.visible(), ['alpha', 'beta', 'gamma']);
});

test('pannes : ni le site ni la base ne font lever la tâche de fond', async () => {
  const h = setup();
  h.site.sitemap = httpError(503);
  h.site.planning = httpError(503);
  await assert.doesNotReject(h.index.runOnce());
  h.store.down = true;
  await assert.doesNotReject(h.index.runOnce());
  await assert.doesNotReject(h.index.recordTitle('alpha', { valid: true, name: 'Alpha', seasons: [] }));
});

test('une fiche lue par la source est rangée ; une page qui n’est pas une fiche ne l’est pas', async () => {
  const h = setup();
  await h.index.recordTitle('alpha', { valid: true, name: 'Alpha', tmdb: { type: 'tv', id: 9 }, seasons: [{ name: 'Saison 1', path: 'saison1', lang: 'vostfr' }] });
  await h.index.recordTitle('beta', { valid: false, name: '', seasons: [] });
  await h.index.recordTitle('Pas Un Slug', { valid: true, name: 'X', seasons: [] });
  await h.index.recordTitle('gamma', null);
  assert.deepEqual([...h.store.titles.keys()], ['alpha']);
  assert.deepEqual(h.tmdbOf('alpha'), { type: 'tv', id: 9 });
});

// Faux service de correspondance : `links` range les réponses par ID AniList.
function linker(links = {}) {
  const service = { links, asked: [], down: false };
  service.resolve = async (ids) => {
    service.asked.push(ids);
    if (service.down) throw new Error('délai dépassé');
    return service.links[ids.anilistId] ?? null;
  };
  return service;
}

test('une fiche sans ID TMDB est reliée par son ID AniList ou MAL ; les autres fiches ne sont pas demandées', async () => {
  const service = linker({ 500: { type: 'tv', id: 313068 } });
  const h = setup({ resolveTmdb: service.resolve });
  h.site.fiches.alpha = { name: 'alpha', tmdb: ['tv', 100], anilist: 1, mal: 2 };
  h.site.fiches.beta = { name: 'beta', anilist: 500, mal: 600 };
  h.site.fiches.gamma = { name: 'gamma' };
  await h.index.runOnce();

  assert.deepEqual(h.tmdbOf('alpha'), { type: 'tv', id: 100 }, 'l’ID que le site publie reste');
  assert.deepEqual(h.tmdbOf('beta'), { type: 'tv', id: 313068 });
  assert.equal(h.tmdbOf('gamma'), null);
  assert.deepEqual(service.asked, [{ anilistId: 500, malId: 600 }]);
});

test('correspondance : œuvre inconnue sans lien, lien retiré ou corrigé suivi, ID du site prioritaire', async () => {
  const service = linker({ 500: { type: 'tv', id: 313068 }, 501: { type: 'movie', id: 7 } });
  const h = setup({ resolveTmdb: service.resolve });
  h.site.fiches.alpha = { name: 'alpha', anilist: 500 };
  h.site.fiches.beta = { name: 'beta', anilist: 501 };
  h.site.fiches.gamma = { name: 'gamma', mal: 777 };
  await h.index.runOnce();
  assert.deepEqual(h.tmdbOf('beta'), { type: 'movie', id: 7 });
  assert.equal(h.tmdbOf('gamma'), null);

  // Le service corrige alpha et retire beta ; le site publie enfin l'ID de gamma.
  h.clock.now += 2 * DAY;
  service.links[500] = { type: 'tv', id: 999 };
  delete service.links[501];
  h.site.fiches.gamma = { name: 'gamma', mal: 777, tmdb: ['tv', 42] };
  await h.index.runOnce();
  assert.deepEqual(h.tmdbOf('alpha'), { type: 'tv', id: 999 });
  assert.equal(h.tmdbOf('beta'), null);
  assert.deepEqual(h.tmdbOf('gamma'), { type: 'tv', id: 42 });
});

test('service de correspondance en panne : les liens rangés restent et le passage va au bout', async () => {
  const slugs = Array.from({ length: 12 }, (_, rank) => `oeuvre-${String(rank).padStart(2, '0')}`);
  const service = linker(Object.fromEntries(slugs.map((_, rank) => [rank + 1, { type: 'tv', id: 9000 + rank }])));
  const h = setup({ slugs, resolveTmdb: service.resolve });
  slugs.forEach((slug, rank) => { h.site.fiches[slug] = { name: slug, anilist: rank + 1 }; });
  await h.index.runOnce();
  assert.deepEqual(h.tmdbOf('oeuvre-03'), { type: 'tv', id: 9003 });

  h.clock.now += 2 * DAY; h.forget();
  service.down = true;
  h.site.sitemap = [...slugs, 'nouvelle'];
  h.site.fiches.nouvelle = { name: 'nouvelle', anilist: 99 };
  const report = await h.index.runOnce();
  assert.equal(report.aborted, false, 'une panne de la correspondance n’est pas une fiche illisible');
  assert.equal(report.failed, 0);
  assert.equal(report.saved, 13);
  slugs.forEach((slug, rank) => assert.deepEqual(h.tmdbOf(slug), { type: 'tv', id: 9000 + rank }));
  assert.equal(h.tmdbOf('nouvelle'), null);
  assert.equal(h.visible().includes('nouvelle'), true, 'la nouvelle œuvre est rangée, sans lien pour l’instant');
  assert.equal(h.logs.filter(line => line.includes('indisponible')).length, 1, 'une ligne de log pour la panne, pas une par fiche');

  // Service revenu : la nouvelle œuvre est reliée au passage suivant.
  h.clock.now += 2 * DAY;
  service.down = false;
  service.links[99] = { type: 'movie', id: 77 };
  await h.index.runOnce();
  assert.deepEqual(h.tmdbOf('nouvelle'), { type: 'movie', id: 77 });
});

test('une fiche reliée par correspondance ne prend pas la page d’une œuvre déjà reliée à cet ID', async () => {
  const service = linker({ 500: { type: 'tv', id: 100 } });
  const h = setup({ slugs: ['alpha', 'alpha-le-film'], resolveTmdb: service.resolve });
  h.site.fiches['alpha-le-film'] = { name: 'Alpha, le film', anilist: 500 };
  await h.index.runOnce();
  assert.deepEqual(h.tmdbOf('alpha'), { type: 'tv', id: 100 });
  assert.equal(h.tmdbOf('alpha-le-film'), null);

  // Lue avant l'œuvre que le site relie, elle lui rend la page à sa relecture.
  const late = setup({ slugs: ['alpha-le-film', 'alpha'], resolveTmdb: service.resolve });
  late.site.fiches['alpha-le-film'] = { name: 'Alpha, le film', anilist: 500 };
  late.site.fiches.alpha = { name: 'alpha', tmdb: ['tv', 100] };
  await late.index.runOnce();
  assert.deepEqual(late.tmdbOf('alpha-le-film'), { type: 'tv', id: 100 }, 'seule à porter cet ID quand elle est lue');
  late.clock.now += 2 * DAY;
  await late.index.runOnce();
  assert.deepEqual(late.tmdbOf('alpha'), { type: 'tv', id: 100 });
  assert.equal(late.tmdbOf('alpha-le-film'), null);
});

test('une fiche lue par la source passe par la même correspondance, sans jamais lever', async () => {
  const service = linker({ 500: { type: 'tv', id: 313068 } });
  const h = setup({ resolveTmdb: service.resolve });
  const fiche = { valid: true, name: 'Beta', tmdb: null, anilistId: 500, malId: 600, seasons: [{ name: 'Saison 1', path: 'saison1', lang: 'vostfr' }] };
  assert.equal(await h.index.recordTitle('beta', fiche), true);
  assert.deepEqual(h.tmdbOf('beta'), { type: 'tv', id: 313068 });
  assert.deepEqual(service.asked, [{ anilistId: 500, malId: 600 }]);

  service.down = true;
  assert.equal(await h.index.recordTitle('beta', fiche), true);
  assert.deepEqual(h.tmdbOf('beta'), { type: 'tv', id: 313068 }, 'la panne ne retire pas le lien');
  assert.equal(await h.index.recordTitle('delta', { ...fiche, name: 'Delta', anilistId: 900 }), true);
  assert.equal(h.tmdbOf('delta'), null);
});

// Semaine publiée par le site, du lundi 09/11 au dimanche 15/11. L'horloge des
// essais est au vendredi 13.
const WEEK = [
  ['09/11', [{ slug: 'alpha', ts: 1794232200, label: 'Saison 1 · Épisode 6', classes: 'Anime VOSTFR pl-sorti' }]],
  ['10/11', []], ['11/11', []], ['12/11', []],
  ['13/11', [
    { slug: 'beta', lien: 'saison2/vf', label: 'Saison 2 · Épisode 12', classes: 'Anime VF pl-sorti' },
    { slug: 'gamma', lien: 'film/vostfr', label: 'Film' },
  ]],
  ['14/11', []],
  ['15/11', [{ slug: 'alpha', label: 'Saison 1 · Épisode 7', classes: 'Anime VOSTFR pl-retard' }]],
];
const brief = planning => planning.entries
  .map(entry => `${entry.day} ${entry.slug} ${entry.seasonPath} ${entry.lang} « ${entry.label} » ${entry.state}${entry.estimated ? ' prévu' : ''}`)
  .sort();

test('semaine suivante : les sorties de la semaine connue sont prévues sept jours plus tard', async () => {
  const h = setup();
  h.site.planning = planningHtml(WEEK);
  await h.index.runOnce();

  // La fenêtre ne couvre que la semaine suivante : la semaine recopiée est hors fenêtre.
  const next = await h.index.readPlanning({ from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(brief(next), [
    // Deux épisodes d'alpha par semaine : les numéros avancent de deux.
    '2026-11-16 alpha saison1 vostfr « Saison 1 · Épisode 8 » scheduled prévu',
    '2026-11-20 beta saison2 vf « Saison 2 · Épisode 13 » scheduled prévu',
    '2026-11-22 alpha saison1 vostfr « Saison 1 · Épisode 9 » scheduled prévu',
  ], 'le film ne repasse pas, la sortie reportée redevient une sortie prévue');
  const monday = next.entries.find(entry => entry.day === '2026-11-16');
  assert.equal(monday.releaseAt, 1794232200 + 7 * 24 * 3600, 'l’heure de sortie suit le jour');
  assert.deepEqual(monday.tmdb, { type: 'tv', id: 100 });
  assert.equal(next.entries.find(entry => entry.day === '2026-11-20').releaseAt, null);

  // À cheval sur les deux semaines : les vraies sorties, puis les prévues.
  assert.deepEqual(brief(await h.index.readPlanning({ from: '2026-11-13', to: '2026-11-17' })), [
    '2026-11-13 beta saison2 vf « Saison 2 · Épisode 12 » released',
    '2026-11-13 gamma film vostfr « Film » scheduled',
    '2026-11-15 alpha saison1 vostfr « Saison 1 · Épisode 7 » delayed',
    '2026-11-16 alpha saison1 vostfr « Saison 1 · Épisode 8 » scheduled prévu',
  ]);
  // Rien avant la semaine connue, rien au-delà d'une semaine de prévision.
  assert.deepEqual(brief(await h.index.readPlanning({ from: '2026-11-02', to: '2026-11-08' })), []);
  assert.deepEqual(brief(await h.index.readPlanning({ from: '2026-11-23', to: '2026-12-31' })), []);
});

test('le site publie la semaine suivante : ses sorties remplacent les prévues, la prévision avance', async () => {
  const h = setup();
  h.site.planning = planningHtml(WEEK);
  await h.index.runOnce();

  // Lundi 16 : alpha n'a plus qu'un épisode par semaine, beta fait une pause,
  // et le reste de la semaine publiée est vide.
  h.clock.now += 3 * DAY;
  h.site.planning = planningHtml([
    ['16/11', [{ slug: 'alpha', label: 'Saison 1 · Épisode 8', classes: 'Anime VOSTFR pl-sorti' }]],
    ['17/11', []], ['18/11', []], ['19/11', []], ['20/11', []], ['21/11', []], ['22/11', []],
  ]);
  await h.index.runOnce();

  assert.deepEqual(brief(await h.index.readPlanning({ from: '2026-11-16', to: '2026-11-22' })), [
    '2026-11-16 alpha saison1 vostfr « Saison 1 · Épisode 8 » released',
  ], 'aucune sortie prévue ne reste dans une semaine que le site a publiée');
  assert.deepEqual(brief(await h.index.readPlanning({ from: '2026-11-23', to: '2026-11-29' })), [
    '2026-11-23 alpha saison1 vostfr « Saison 1 · Épisode 9 » scheduled prévu',
  ]);
});

test('index en retard : aucune sortie prévue dans le passé', async () => {
  const h = setup();
  h.site.planning = planningHtml(WEEK);
  await h.index.runOnce();
  h.site.planning = CHALLENGE;

  // Mercredi 18, le planning n'a pas pu être relu depuis vendredi.
  h.clock.now = Date.UTC(2026, 10, 18, 9, 0, 0);
  await h.index.runOnce();
  assert.deepEqual(brief(await h.index.readPlanning({ from: '2026-11-14', to: '2026-11-30' })), [
    '2026-11-15 alpha saison1 vostfr « Saison 1 · Épisode 7 » delayed',
    '2026-11-20 beta saison2 vf « Saison 2 · Épisode 13 » scheduled prévu',
    '2026-11-22 alpha saison1 vostfr « Saison 1 · Épisode 9 » scheduled prévu',
  ], 'la sortie prévue lundi 16, jamais confirmée, n’est pas affichée après coup');

  // Dix jours plus tard : toute la semaine prévue est passée.
  h.clock.now = Date.UTC(2026, 10, 25, 9, 0, 0);
  assert.deepEqual(brief(await h.index.readPlanning({ from: '2026-11-14', to: '2026-11-30' })), [
    '2026-11-15 alpha saison1 vostfr « Saison 1 · Épisode 7 » delayed',
  ]);
});

test('planning jamais lu : aucune sortie, aucune prévision', async () => {
  const h = setup();
  assert.deepEqual((await h.index.readPlanning({ from: '2026-11-01', to: '2026-11-30' })).entries, []);
});

test('la tâche de fond ne démarre que sur le worker désigné', async () => {
  const h = setup();
  assert.equal(h.index.start({ isOwner: false }), false);
  const started = h.index.start({ isOwner: true, firstDelayMs: 5, intervalMs: 60000 });
  assert.equal(started, true);
  assert.equal(h.index.start({ isOwner: true }), false, 'un second démarrage ne double pas la tâche');
  await new Promise(resolve => setTimeout(resolve, 60));
  h.index.stop();
  assert.deepEqual(h.visible(), ['alpha', 'beta', 'gamma']);
});
