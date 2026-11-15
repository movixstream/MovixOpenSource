/**
 * Lecture des pages d'anime-sama (fiche d'œuvre, page de saison, planning,
 * sitemap).
 *
 * Modes de défaillance couverts ici, et pourquoi le scénario de bout en bout
 * (`scripts/e2e/animeSamaLive.js`, site réel) ne les voit pas : il ne lit que
 * les pages du jour de quelques titres, alors que chacun de ces cas dépend
 * d'une forme de page précise, rare ou passée.
 *
 *  1. Fiche : l'exemple `panneauAnime("nom", …)` du mode d'emploi, en
 *     commentaire, devient une fausse saison et décale toutes les autres.
 *  2. Fiche : une saison masquée par anime-sama (`<!--panneauAnime(…)-->`,
 *     `//panneauAnime(…)`, ou tout un bloc HTML en commentaire) reste servie.
 *  3. Fiche : une page qui n'est pas une fiche (404, page de vérification)
 *     passe pour « une œuvre sans anime » — l'appelant viderait alors le cache.
 *  4. Fiche : l'ID TMDB est pris sur une image `image.tmdb.org`, ou l'ID AniList
 *     du manga est pris pour celui de l'anime.
 *  5. Saison : une case vide (`""`) saute et décale les lecteurs sur l'épisode
 *     d'avant.
 *  6. Saison : un lien marqué supprimé (`epsMeta`, 2e valeur 1 ou 2) est
 *     demandé à `/api/lien.php` pour rien.
 *  7. Saison : une page sans table `languesDispo` ni liste passe pour une
 *     saison vidée par le site.
 *  8. Planning : une carte de scans entre dans le calendrier des animes ; une
 *     sortie sans heure perd son jour.
 *  9. Sitemap : une page de saison est prise pour une œuvre.
 * 10. Fiche : anime-sama coupe ses genres au trait d'union (« Science-fiction »
 *     devient « Science » puis « fiction ») : le catalogue proposerait de faux
 *     genres, et le vrai resterait introuvable.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTitlePage,
  parseSeasonPage,
  parsePlanningPage,
  parseSitemap,
} = require('../animeSamaPages');

// Fiche après la refonte de 2026-10 (extraits de /catalogue/firefly-wedding/).
const ficheHead = [
  '<script>',
  '/* Cartes des saisons / scans, appelées depuis l\'index.php de chaque œuvre :',
  '   panneauAnime("nom", "saison1/vostfr"); panneauScan("nom", "scan/vf"); */',
  'var OE_BASE = "\\/catalogue\\/firefly-wedding\\/";',
  'function panneauAnime(nom, url) { oePanneau(nom, url, false); }',
  'function panneauScan(nom, url) { oePanneau(nom, url, true); }',
  '</script>',
  '<div class="oe-affiche">',
  '  <img src="https://image.tmdb.org/t/p/w342/1RXEvHmis1oKTAWtKOrzJqenpb6.jpg" alt="Firefly Wedding" decoding="async">',
  '</div>',
  '<h1 id="titreOeuvre" class="oe-titre">Firefly Wedding</h1>',
  '<p id="titreAlter" class="oe-alters">Hotaru no Yomeiri, Les Noces des lucioles</p>',
  '<p class="oe-meta">2026<span class="oe-point">·</span>Série TV<span class="oe-point">·</span>david production<span class="oe-point">·</span>En cours</p>',
  '<a class="oe-note" href="https://anilist.co/manga/159142" target="_blank">Manga</a>',
  '<script type="application/ld+json">{"@context":"https://schema.org","@type":"TVSeries","name":"Firefly Wedding","url":"https://anime-sama.to/catalogue/firefly-wedding/","image":"https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/contenu/firefly-wedding.jpg","alternateName":["Hotaru no Yomeiri","Les Noces des lucioles"],"description":"Satoko, une fille de bonne famille à l\'ère Meiji.","genre":["Drame","Historique","Romance","Josei"]}</script>',
  '<p class="oe-sous-titre">Anime</p>            <dl class="oe-infos">',
  '  <dt>Format</dt><dd>Série TV</dd>',
  '  <dt>Statut</dt><dd>En cours</dd>',
  '  <dt>Épisodes</dt><dd>12</dd>',
  '  <dt>Sur le site</dt><dd>9 épisodes VOSTFR · 3 en VF</dd>',
  '</dl>',
  '<p class="oe-sous-titre">Manga d’origine</p>            <dl class="oe-infos">',
  '  <dt>Format</dt><dd>Manga</dd>',
  '  <dt>Statut</dt><dd>Terminé</dd>',
  '</dl>',
  '<ul class="oe-liens">',
  '  <li><a href="https://anilist.co/anime/205909" target="_blank" rel="noopener nofollow">AniList</a></li>',
  '  <li><a href="https://myanimelist.net/anime/63293" target="_blank" rel="noopener nofollow">MyAnimeList</a></li>',
  '  <li><a href="https://www.themoviedb.org/tv/320909" target="_blank" rel="noopener nofollow">TMDB</a></li>',
  '  <li><a href="https://myanimelist.net/manga/154679" target="_blank" rel="noopener nofollow">MyAnimeList</a></li>',
  '</ul>',
].join('\n');

const animeBlock = lines => [
  '<!-- ANIME -->',
  '<h2 class="text-white">Anime</h2>',
  '<div class="flex flex-wrap">',
  '  <script>',
  '  /*panneauAnime("nom", "url"); -> on en met autant qu\'on veut à la ligne*/',
  ...lines.map(line => `  ${line}`),
  '  </script>',
  '</div>',
].join('\n');

const scanBlock = [
  '<h2 class="text-white">Manga</h2>',
  '<div class="flex flex-wrap">',
  '  <script>',
  '  /*panneauScan("nom", "url"); -> on en met autant qu\'on veut à la ligne*/',
  '  panneauScan("Scans", "scan/vf");',
  '  </script>',
  '</div>',
].join('\n');

test('fiche : nom, autres noms, genres, identifiants externes et saisons visibles', () => {
  const fiche = parseTitlePage(`${ficheHead}\n${animeBlock([
    'panneauAnime("Saison 1", "saison1/vostfr");',
    'panneauAnime("Saison 2", "saison2/vf")',
    'panneauAnime("Films", "film/vostfr");',
  ])}\n${scanBlock}`);

  assert.equal(fiche.valid, true);
  assert.equal(fiche.name, 'Firefly Wedding');
  assert.deepEqual(fiche.altNames, ['Hotaru no Yomeiri', 'Les Noces des lucioles']);
  assert.deepEqual(fiche.genres, ['Drame', 'Historique', 'Romance', 'Josei']);
  assert.equal(fiche.synopsis, "Satoko, une fille de bonne famille à l'ère Meiji.");
  assert.deepEqual(fiche.tmdb, { type: 'tv', id: 320909 });
  assert.equal(fiche.anilistId, 205909, 'l’ID de l’anime, pas celui du manga placé avant');
  assert.equal(fiche.malId, 63293);
  assert.equal(fiche.posterPath, '/1RXEvHmis1oKTAWtKOrzJqenpb6.jpg');
  assert.equal(fiche.format, 'Série TV');
  assert.equal(fiche.status, 'En cours');
  assert.equal(fiche.year, 2026);
  assert.deepEqual(fiche.languages, ['vostfr', 'vf']);
  assert.deepEqual(fiche.seasons, [
    { name: 'Saison 1', path: 'saison1', lang: 'vostfr' },
    { name: 'Saison 2', path: 'saison2', lang: 'vf' },
    { name: 'Films', path: 'film', lang: 'vostfr' },
  ]);
  assert.equal(fiche.hiddenSeasons, 0);
  assert.equal(fiche.hasScans, true);
});

test('fiche : un genre coupé au trait d’union par le site est recollé', () => {
  const withGenres = genres => parseTitlePage(ficheHead.replace('"genre":["Drame","Historique","Romance","Josei"]', `"genre":${JSON.stringify(genres)}`)
    + animeBlock(['panneauAnime("Saison 1", "saison1/vostfr");'])).genres;

  // Listes relevées sur les fiches de Frieren et de Dragon Ball Z.
  assert.deepEqual(
    withGenres(['Shônen', 'Slice of Life', 'Action', 'Science', 'fiction', 'Fantastique']),
    ['Shônen', 'Slice of Life', 'Action', 'Science-fiction', 'Fantastique'],
  );
  assert.deepEqual(
    withGenres(['Aliens / Extra', 'terrestres', 'Arts martiaux', 'Super pouvoirs', 'Science', 'fiction', 'Kaï']),
    ['Aliens / Extra-terrestres', 'Arts martiaux', 'Super pouvoirs', 'Science-fiction', 'Kaï'],
  );
  // Rien à recoller : un genre entier, ou un morceau sans rien devant lui.
  assert.deepEqual(withGenres(['Science-fiction', 'Drame']), ['Science-fiction', 'Drame']);
  assert.deepEqual(withGenres(['fiction', 'Drame']), ['fiction', 'Drame']);
});

test('fiche : un film porte un ID TMDB de film ; sans lien TMDB, rien n’est inventé', () => {
  const movie = parseTitlePage(ficheHead.replace('themoviedb.org/tv/320909', 'themoviedb.org/movie/1295026')
    + animeBlock(['panneauAnime("Film", "film/vostfr");']));
  assert.deepEqual(movie.tmdb, { type: 'movie', id: 1295026 });

  // L'affiche reste une image TMDB : son adresse ne doit pas servir d'identifiant.
  const none = parseTitlePage(ficheHead.replace(/\s*<li><a href="https:\/\/www\.themoviedb\.org[^\n]*/, '')
    + animeBlock(['panneauAnime("Saison 1", "saison1/vostfr");']));
  assert.equal(none.tmdb, null);
  assert.equal(none.posterPath, '/1RXEvHmis1oKTAWtKOrzJqenpb6.jpg');
  assert.equal(none.valid, true);
});

test('fiche : le mode d’emploi et les saisons masquées ne sont pas des saisons', () => {
  // Formes relevées sur le site : ligne `<!--…-->` dans un script (Danshi
  // Koukousei no Nichijou), `<!--` sans fermeture, `//`, et bloc HTML entier
  // mis en commentaire (section Manga de la même fiche).
  const fiche = parseTitlePage([
    ficheHead,
    '<!-- panneauAnime("Ancienne", "saison9/vostfr"); -->',
    animeBlock([
      'panneauAnime("Saga 1 East Blue [Episode 1 à 61]", "saison1/vostfr");',
      '<!--panneauAnime("Film", "film/vostfr");-->',
      '<!--\tpanneauAnime("OAV", "oav/vostfr");',
      '// panneauAnime("Retirée", "saison8/vostfr");',
      'panneauAnime("Kai - Saga 1 (East Blue)", "kai/vf");',
    ]),
    '<!-- <h2>Manga</h2>',
    '<div>',
    '  <script>',
    '  panneauScan("Scans", "scan/vf");',
    '  </script>',
    '</div> -->',
  ].join('\n'));

  assert.deepEqual(fiche.seasons.map(season => [season.name, season.path, season.lang]), [
    ['Saga 1 East Blue [Episode 1 à 61]', 'saison1', 'vostfr'],
    ['Kai - Saga 1 (East Blue)', 'kai', 'vf'],
  ]);
  assert.equal(fiche.hiddenSeasons, 4);
  assert.equal(fiche.hasScans, false, 'le bloc Manga est en commentaire');
});

test('fiche : toutes les saisons masquées ou seulement des scans, la fiche reste lisible et sans anime', () => {
  const masked = parseTitlePage(`${ficheHead}\n${animeBlock(['<!--panneauAnime("Saison 1", "saison1/vostfr");-->'])}`);
  assert.equal(masked.valid, true);
  assert.deepEqual(masked.seasons, []);
  assert.equal(masked.hiddenSeasons, 1);

  const scansOnly = parseTitlePage(`${ficheHead}\n${scanBlock}`);
  assert.equal(scansOnly.valid, true);
  assert.deepEqual(scansOnly.seasons, []);
  assert.equal(scansOnly.hiddenSeasons, 0);
  assert.equal(scansOnly.hasScans, true);
});

test('fiche : une page qui n’est pas une fiche n’est jamais « une œuvre sans anime »', () => {
  const notFound = '<!doctype html><html><head><title>Page introuvable</title></head><body><h1>404</h1></body></html>';
  const challenge = '<html><head><title>Just a moment...</title></head><body class="cf-wrapper">Cloudflare</body></html>';
  // Page de saison : elle porte aussi `id="titreOeuvre"`, mais aucun panneau.
  const seasonPage = '<h1 id="titreOeuvre" class="ct-titre">Firefly Wedding</h1><script>var languesDispo = ["vostfr"];</script>';
  for (const page of [notFound, challenge, seasonPage, '', null, undefined, 42]) {
    const fiche = parseTitlePage(page);
    assert.equal(fiche.valid, false);
    assert.deepEqual(fiche.seasons, []);
    assert.equal(fiche.tmdb, null);
  }
});

test('fiche : un lien de saison absolu ou préfixé par le slug donne le même chemin', () => {
  const fiche = parseTitlePage(`${ficheHead}\n${animeBlock([
    'panneauAnime("Saison 1", "/catalogue/firefly-wedding/saison1/vostfr/");',
    'panneauAnime("Saison 2", "https://anime-sama.to/catalogue/firefly-wedding/saison2/vf");',
    'panneauAnime("Saison 3", "saison3/vostfr/");',
  ])}`);
  assert.deepEqual(fiche.seasons.map(season => [season.path, season.lang]), [
    ['saison1', 'vostfr'], ['saison2', 'vf'], ['saison3', 'vostfr'],
  ]);
});

// Page de saison depuis le 2026-11-12 (/catalogue/firefly-wedding/saison1/vostfr/).
const seasonHtml = [
  '<h1 id="titreOeuvre" class="ct-titre">Firefly Wedding</h1>',
  '<script data-source="bdd">var eps1 = ["lien:78928","lien:78932","lien:279587"];',
  'var eps2 = ["lien:78927","lien:78931","lien:279590"];',
  'var eps3 = ["lien:78929","lien:78933","lien:279588"];',
  'var eps4 = ["","lien:267672",""];',
  'var epsMeta = {"78927":["uqload.vc"],"78928":["ansembed.net"],"78929":["teresapoliticallearn.com",2],"78931":["uqload.vc"],"78932":["ansembed.net"],"78933":["megankiddifference.com",1],"267672":["sendvid.com"],"279590":["uqload.vc"],"279587":["ansembed.net"],"279588":["susanexpectcare.com"]};',
  'var epsJeton = "2242.1794848400.3db240177904f650cf87b421";',
  'var epsOrdreFinal = true;',
  '</script>',
  '<script>',
  'var languesDispo = ["vostfr","vf"];',
  'var lecteursInfos = {"ansembed.net":{"nom":"Vidmoly","hd":true},"sibnet.ru":{"nom":"Sibnet","mort":true}};',
  '</script>',
].join('\n');

test('saison : lecteurs par épisode, cases vides gardées à leur place, liens supprimés marqués', () => {
  const page = parseSeasonPage(seasonHtml);
  assert.equal(page.valid, true);
  assert.deepEqual(page.langs, ['vostfr', 'vf']);
  assert.equal(page.token, '2242.1794848400.3db240177904f650cf87b421');
  assert.equal(page.episodeCount, 3);
  assert.deepEqual(page.episodes, [
    [
      { id: '78928', host: 'ansembed.net', removed: false },
      { id: '78927', host: 'uqload.vc', removed: false },
      { id: '78929', host: 'teresapoliticallearn.com', removed: true },
    ],
    [
      { id: '78932', host: 'ansembed.net', removed: false },
      { id: '78931', host: 'uqload.vc', removed: false },
      { id: '78933', host: 'megankiddifference.com', removed: true },
      { id: '267672', host: 'sendvid.com', removed: false },
    ],
    [
      { id: '279587', host: 'ansembed.net', removed: false },
      { id: '279590', host: 'uqload.vc', removed: false },
      { id: '279588', host: 'susanexpectcare.com', removed: false },
    ],
  ]);
});

test('saison : une adresse écrite en clair (ancien format) reste un lecteur', () => {
  const page = parseSeasonPage([
    '<script>var languesDispo = ["vostfr"];</script>',
    "<script>var eps1 = ['https://a.invalid/1', 'https://a.invalid/2',];",
    'var eps2 = ["lien:5", ""];',
    'var epsJeton = "1.2.abc";</script>',
  ].join('\n'));
  assert.deepEqual(page.episodes, [
    [{ url: 'https://a.invalid/1' }, { id: '5', host: null, removed: false }],
    [{ url: 'https://a.invalid/2' }],
  ]);
});

test('saison : vidée par le site, illisible ou autre page', () => {
  // Saison masquée (Danshi Koukousei no Nichijou) : la page existe, sans liste.
  const emptied = parseSeasonPage('<h1 id="titreOeuvre">X</h1><script>var languesDispo = ["vostfr"];\nvar lecteursInfos = {};</script>');
  assert.equal(emptied.valid, true);
  assert.equal(emptied.episodeCount, 0);
  assert.deepEqual(emptied.episodes, []);
  assert.equal(emptied.token, null);

  for (const page of ['<!doctype html><title>Page introuvable</title>', '<script>var lecteursInfos = {};</script>', '', null]) {
    const parsed = parseSeasonPage(page);
    assert.equal(parsed.valid, false);
    assert.equal(parsed.episodeCount, 0);
    assert.equal(parsed.langs, null);
  }

  // Table des langues illisible ou vide : la liste des lecteurs suffit à
  // reconnaître la page, mais aucune langue n'est annoncée.
  const noLangs = parseSeasonPage('<script>var languesDispo = ["vostfr", ];\nvar eps1 = ["lien:1"];\nvar epsJeton = "1.2.abc";</script>');
  assert.equal(noLangs.valid, true);
  assert.equal(noLangs.langs, null);
  assert.equal(noLangs.episodeCount, 1);
});

// Planning (/planning/), semaine du 9 novembre 2026.
const planningCard = ({ classes, slug, name, lien, releaseTs, flag, info, time }) => [
  `<div class="as-carte ${classes}" data-url="/catalogue/${slug}/" data-cat="oeuvre" data-nom="${name}" data-img="https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu/${slug}.jpg" data-title="${name.toLowerCase()}"${releaseTs ? ` data-release-ts="${releaseTs}"` : ''} data-lien="/catalogue/${slug}/${lien}/" data-debut="1794157200" data-etat-db="">`,
  `<a class="as-carte-lien" href="/catalogue/${slug}/${lien}/" draggable="false"><div class="as-carte-badges">`,
  flag ? `<span class="as-drapeau"><img src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/autres/flag.png" alt="${flag}" title="${flag}" loading="lazy"></span>` : '',
  `</div><div class="as-carte-texte"><h3 class="as-carte-titre" title="${name}">${name}</h3>`,
  `<div class="as-carte-info"><svg></svg><span>${info}</span><span class="as-carte-temps">${time}</span></div></div></a></div>`,
].join('');

const planningDay = (label, date, cards) => [
  '<div id="0" class="selectedRow px-1 py-4 rounded ">',
  `  <h2 class="titreJours text-white" style="font-size: 1.3rem;">\n    ${label}                </h2>`,
  `  <p class="text-white text-center opacity-75" style="font-size: 1.1rem;">${date}</p>`,
  '  <div class="categorieHome flex flex-col gap-2">',
  ...cards,
  '  </div>',
  '</div>',
].join('\n');

test('planning : sorties d’animes avec jour, heure, langue et état ; les scans restent dehors', () => {
  const html = [
    planningDay('Lundi', '09/11', [
      planningCard({ classes: 'as-carte-anime planning-card Anime VOSTFR  pl-sorti', slug: 'psyren', name: 'Psyren', lien: 'saison1/vostfr', releaseTs: 1794239400, flag: 'VOSTFR', info: 'Saison 1 · Épisode 6', time: '16h50' }),
      planningCard({ classes: 'as-carte-scan as-carte-couleur planning-card Scan VF', slug: 'the-gamer', name: 'The Gamer', lien: 'scan/vf', flag: 'VF', info: 'Chapitre 500', time: '?' }),
      planningCard({ classes: 'as-carte-anime planning-card Anime VF  pl-retard', slug: 'psyren', name: 'Psyren', lien: 'saison1/vf', releaseTs: 1794243000, flag: 'VF', info: 'Saison 1 · Épisode 4', time: '17h50' }),
    ]),
    planningDay('Mercredi', '11/11', [
      // Sans heure connue (« ? ») : pas de `data-release-ts`, la langue n'est
      // que sur le drapeau.
      planningCard({ classes: 'as-carte-anime planning-card Anime pl-sorti', slug: 'helluva-boss', name: 'Helluva Boss', lien: 'saison3/vostfr', flag: 'VA', info: 'Saison 3 · Épisode 7', time: '?' }),
      planningCard({ classes: 'as-carte-anime planning-card Anime VOSTFR', slug: 'one-piece', name: 'One Piece', lien: 'saison12/vostfr', releaseTs: 1794412800, flag: 'VOSTFR', info: 'Saga 12 · Épisode 1160', time: '17h00' }),
    ]),
  ].join('\n');

  const planning = parsePlanningPage(html, { now: Date.UTC(2026, 10, 15) });
  assert.deepEqual(planning.days, ['2026-11-09', '2026-11-11']);
  assert.deepEqual(planning.entries, [
    { slug: 'psyren', name: 'Psyren', seasonPath: 'saison1', lang: 'vostfr', day: '2026-11-09', releaseAt: 1794239400, label: 'Saison 1 · Épisode 6', state: 'released' },
    { slug: 'psyren', name: 'Psyren', seasonPath: 'saison1', lang: 'vf', day: '2026-11-09', releaseAt: 1794243000, label: 'Saison 1 · Épisode 4', state: 'delayed' },
    { slug: 'helluva-boss', name: 'Helluva Boss', seasonPath: 'saison3', lang: 'va', day: '2026-11-11', releaseAt: null, label: 'Saison 3 · Épisode 7', state: 'released' },
    { slug: 'one-piece', name: 'One Piece', seasonPath: 'saison12', lang: 'vostfr', day: '2026-11-11', releaseAt: 1794412800, label: 'Saga 12 · Épisode 1160', state: 'scheduled' },
  ]);
});

test('planning : la semaine à cheval sur deux années garde la bonne année de chaque jour', () => {
  const card = planningCard({ classes: 'as-carte-anime planning-card Anime VOSTFR', slug: 'x', name: 'X', lien: 'saison1/vostfr', flag: 'VOSTFR', info: 'Saison 1 · Épisode 1', time: '?' });
  const html = [planningDay('Mercredi', '30/12', [card]), planningDay('Samedi', '02/01', [card])].join('\n');
  assert.deepEqual(parsePlanningPage(html, { now: Date.UTC(2026, 11, 31) }).days, ['2026-12-30', '2027-01-02']);
  assert.deepEqual(parsePlanningPage(html, { now: Date.UTC(2027, 0, 1) }).days, ['2026-12-30', '2027-01-02']);
});

test('planning : une page sans jour ni carte ne donne rien', () => {
  for (const page of ['<html><body>Just a moment...</body></html>', '', null]) {
    assert.deepEqual(parsePlanningPage(page, { now: Date.UTC(2026, 10, 15) }), { days: [], entries: [] });
  }
});

test('sitemap : seules les fiches d’œuvres, une fois chacune', () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url><loc>https://anime-sama.to/</loc></url>',
    '  <url><loc>https://anime-sama.to/catalogue/</loc></url>',
    '  <url><loc>https://anime-sama.to/catalogue/07-ghost/</loc></url>',
    '  <url><loc>https://anime-sama.to/catalogue/2.43-seiin-koukou-danshi-volley-bu/</loc></url>',
    '  <url><loc>https://anime-sama.to/catalogue/07-ghost/saison1/vostfr/</loc></url>',
    '  <url><loc>https://anime-sama.to/catalogue/07-ghost/</loc></url>',
    '  <url><loc>https://anime-sama.to/catalogue/100-meters</loc></url>',
    '  <url><loc>https://anime-sama.to/planning/</loc></url>',
    '</urlset>',
  ].join('\n');
  assert.deepEqual(parseSitemap(xml), ['07-ghost', '2.43-seiin-koukou-danshi-volley-bu', '100-meters']);
  assert.deepEqual(parseSitemap('<html>Erreur</html>'), []);
  assert.deepEqual(parseSitemap(null), []);
});
