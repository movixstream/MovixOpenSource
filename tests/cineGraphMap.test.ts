// CinéGraph « carte en zones » : chaque élément doit porter la raison de son
// lien avec le centre. Ces tests figent l'ordre des zones, la priorité de
// dédoublonnage, les exclusions (talk-shows, « Self ») et les liens croisés,
// sur de petites fixtures et sans réseau.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPersonMap,
  buildWorkMap,
  isNotARole,
  pickMoodCandidates,
  pickPersonSources,
  pickWorkTeam,
  toSearchHits,
} from '../src/services/cineGraph/build.ts';
import type {
  RawCastCredit,
  RawCastMember,
  RawCrewCredit,
  RawPersonDetails,
  RawWork,
  RawWorkDetails,
  WorkMapInput,
} from '../src/services/cineGraph/build.ts';
import { isMetaKeyword, keywordLabel } from '../src/services/cineGraph/keywords.ts';
import type { CineMap, Reason } from '../src/services/cineGraph/types.ts';

const options = { lang: 'fr-FR', imageBase: 'https://img.test' };

type Credit = RawCastCredit & RawCrewCredit;

function film(id: number, extra: Partial<Credit> = {}): Credit {
  return {
    id,
    media_type: 'movie',
    title: `Film ${id}`,
    release_date: '2010-05-01',
    vote_count: 1000,
    vote_average: 7,
    genre_ids: [28],
    ...extra,
  };
}

function serie(id: number, extra: Partial<Credit> = {}): Credit {
  return {
    id,
    media_type: 'tv',
    name: `Série ${id}`,
    first_air_date: '2015-01-01',
    vote_count: 1000,
    genre_ids: [18],
    episode_count: 10,
    ...extra,
  };
}

/** Clés de chaque zone, dans l'ordre d'affichage. */
function zoneItems(map: CineMap): Record<string, string[]> {
  return Object.fromEntries(map.zones.map((zone) => [zone.kind, zone.items]));
}

function reasonTypes(map: CineMap, key: string): Reason['type'][] {
  return map.items[key].reasons.map((reason) => reason.type);
}

function names(reason: Reason): string[] {
  if (reason.type === 'sameDirector' || reason.type === 'sharedCast') return reason.people.map((person) => person.name);
  if (reason.type === 'together') return reason.works.map((work) => work.title);
  return [];
}

// ─── Carte d'un film ─────────────────────────────────────────────────────────

const DIRECTOR = { id: 100, name: 'Réa Lisatrice', profile_path: '/rea.jpg', job: 'Director' };
// Volontairement dans le désordre : l'équipe suit `order`, pas le tableau.
const CAST: RawCastMember[] = [
  { id: 202, name: 'Acteur Deux', character: 'Rival', order: 1 },
  { id: 201, name: 'Actrice Une', character: 'Héroïne', order: 0 },
  { id: 203, name: 'Acteur Trois', character: 'Narrator (voice)', order: 2 },
  { id: 204, name: 'Acteur Quatre', character: 'Mentor', order: 3 },
  { id: 205, name: 'Acteur Cinq', character: 'Pilote', order: 4 },
  { id: 206, name: 'Acteur Six', character: 'Garde', order: 5 },
  { id: 207, name: 'Acteur Sept', character: 'Passant', order: 6 },
];

function movieInput(details: Partial<RawWorkDetails> = {}, extra: Partial<WorkMapInput> = {}): WorkMapInput {
  return {
    type: 'movie',
    details: {
      id: 1,
      title: 'Centre',
      release_date: '2012-03-04',
      vote_count: 5000,
      vote_average: 8.1,
      poster_path: '/centre.jpg',
      backdrop_path: '/fond.jpg',
      overview: 'Résumé du centre',
      genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Science-Fiction' }, { id: 80, name: 'Crime' }],
      belongs_to_collection: { id: 900, name: 'Saga Test' },
      credits: { cast: CAST, crew: [DIRECTOR, { id: 300, name: 'Monteur', job: 'Editor' }] },
      keywords: { keywords: [{ id: 1, name: 'dream' }, { id: 2, name: 'heist' }, { id: 3, name: 'duringcreditsstinger' }] },
      recommendations: {
        results: [
          film(2), // saga, réalisé, joué : reste en saga
          film(5), // réalisé : zone réalisateur, pas ambiance
          film(8), // joué : zone acteurs, pas ambiance
          film(20, { genre_ids: [28] }), // « dream » + 1 genre
          film(21, { genre_ids: [28] }), // seulement un mot-clé méta + 1 genre : écarté
          film(22, { genre_ids: [28, 878] }), // aucun mot-clé, 2 genres : gardé
          film(23, { vote_count: 10 }), // trop confidentiel
          film(24, { genre_ids: [28, 878] }), // « dream » + « heist » + 2 genres
        ],
      },
      // `similar` n'a pas de media_type : c'est le type du centre.
      similar: { results: [{ id: 25, title: 'Film 25', vote_count: 100, genre_ids: [18] }] },
      ...details,
    },
    collection: {
      id: 900,
      name: 'Saga Test',
      parts: [
        film(3, { release_date: '2016-01-01' }),
        film(1, { release_date: '2012-03-04' }),
        film(2, { release_date: '2008-01-01' }),
      ],
    },
    personCredits: {
      100: {
        crew: [
          film(1, { job: 'Director' }),
          film(2, { job: 'Director' }),
          film(4, { job: 'Director', vote_count: 3000 }),
          film(5, { job: 'Director', vote_count: 9000 }),
          film(7, { job: 'Producer', vote_count: 99999 }),
          // Un épisode réalisé ne fait pas de la série une œuvre de la cinéaste.
          serie(60, { job: 'Director', episode_count: 3, vote_count: 50000 }),
        ],
      },
      201: {
        cast: [
          film(1, { character: 'Héroïne' }),
          film(2, { character: 'Héroïne jeune' }),
          film(4, { character: 'Cliente' }),
          film(8, { character: 'Espionne', vote_count: 5000 }),
          film(12, { character: 'Sœur', vote_count: 500 }),
          serie(70, { character: 'Self - Guest', genre_ids: [10767, 35] }),
          serie(72, { character: 'Juge', genre_ids: [10764] }),
          film(9, { character: 'Herself', vote_count: 8000 }),
          film(10, { character: 'Pilote (uncredited)', vote_count: 9000 }),
          film(14, { character: 'Actrice Une (voice)', vote_count: 9000 }),
          serie(71, { character: 'Invitée', episode_count: 1 }),
          serie(73, { character: 'Woody (voice)', genre_ids: [], episode_count: 3 }),
          film(11, { character: 'Figurante', vote_count: 10 }),
        ],
      },
      202: {
        cast: [
          film(12, { character: 'Frère', vote_count: 500 }),
          film(13, { character: 'Pilote', vote_count: 7000 }),
          film(99, { character: 'Narrateur', genre_ids: [99], vote_count: 9000 }),
        ],
      },
    },
    candidateKeywords: {
      'movie-2': [{ id: 1, name: 'dream' }],
      'movie-5': [{ id: 1, name: 'dream' }],
      'movie-8': [{ id: 2, name: 'heist' }],
      'movie-20': [{ id: 1, name: 'dream' }],
      'movie-21': [{ id: 3, name: 'duringcreditsstinger' }],
      'movie-22': [],
      'movie-24': [{ id: 2, name: 'heist' }, { id: 1, name: 'dream' }, { id: 50, name: 'robot' }],
      'movie-25': [{ id: 1, name: 'dream' }],
    },
    ...extra,
  };
}

test('les zones suivent l\'ordre équipe, saga, réalisateur, acteurs, ambiance', () => {
  const map = buildWorkMap(movieInput(), options);
  assert.deepEqual(map.zones.map((zone) => zone.kind), ['team', 'saga', 'director', 'cast', 'mood']);
  assert.equal(map.root.key, 'movie-1');
  assert.equal(map.root.img, 'https://img.test/w342/centre.jpg');
  assert.equal(map.root.backdrop, 'https://img.test/w780/fond.jpg');
  assert.deepEqual(map.root.genres, ['Action', 'Science-Fiction', 'Crime']);
  // Chaque clé de zone existe, et chaque élément n'est rangé qu'une fois.
  const all = map.zones.flatMap((zone) => zone.items);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(new Set(all), new Set(Object.keys(map.items)));
  for (const zone of map.zones) {
    for (const key of zone.items) assert.equal(map.items[key].zone, zone.kind);
  }
});

test('une zone vide est absente de la carte', () => {
  const map = buildWorkMap(movieInput(
    { belongs_to_collection: null, recommendations: { results: [] }, similar: { results: [] } },
    { collection: undefined, personCredits: {} },
  ), options);
  assert.deepEqual(map.zones.map((zone) => zone.kind), ['team']);
});

test('équipe : réalisatrice puis six têtes d\'affiche dans l\'ordre d\'affiche', () => {
  const map = buildWorkMap(movieInput(), options);
  assert.deepEqual(zoneItems(map).team, [
    'person-100', 'person-201', 'person-202', 'person-203', 'person-204', 'person-205', 'person-206',
  ]);
  assert.deepEqual(map.items['person-100'].reasons, [{ type: 'crew', job: 'director' }]);
  assert.deepEqual(map.items['person-201'].reasons, [{ type: 'plays', character: 'Héroïne' }]);
  assert.equal(map.items['person-201'].img, undefined);
  assert.equal(map.items['person-100'].img, 'https://img.test/w185/rea.jpg');
  // Un narrateur hors champ n'a pas de personnage à afficher.
  assert.deepEqual(map.items['person-203'].reasons, [{ type: 'plays' }]);
});

test('une réalisatrice qui joue aussi garde une seule fiche avec deux raisons', () => {
  const cast = [{ id: 100, name: 'Réa Lisatrice', character: 'Caméo assumé', order: 0 }, ...CAST];
  const map = buildWorkMap(movieInput({ credits: { cast, crew: [DIRECTOR] } }), options);
  assert.deepEqual(reasonTypes(map, 'person-100'), ['crew', 'plays']);
  assert.equal(zoneItems(map).team.filter((key) => key === 'person-100').length, 1);
});

test('saga : volets triés par date, rang et nombre de volets', () => {
  const map = buildWorkMap(movieInput(), options);
  const zone = map.zones.find((entry) => entry.kind === 'saga');
  assert.equal(zone?.saga, 'Saga Test');
  assert.deepEqual(zone?.items, ['movie-2', 'movie-3']);
  assert.deepEqual(map.items['movie-2'].reasons[0], { type: 'saga', name: 'Saga Test', part: 1, parts: 3 });
  assert.deepEqual(map.items['movie-3'].reasons[0], { type: 'saga', name: 'Saga Test', part: 3, parts: 3 });
});

test('priorité saga > réalisateur > acteurs > ambiance, sans doublon', () => {
  const map = buildWorkMap(movieInput(), options);
  const zones = zoneItems(map);
  // Volet 2 : saga, réalisé par la même personne, joué, recommandé.
  assert.equal(map.items['movie-2'].zone, 'saga');
  // Film 4 : réalisé et joué → réalisateur. Film 8 : joué et recommandé → acteurs.
  assert.equal(map.items['movie-4'].zone, 'director');
  assert.equal(map.items['movie-8'].zone, 'cast');
  assert.ok(!zones.mood.includes('movie-2'));
  assert.ok(!zones.mood.includes('movie-5'));
  assert.ok(!zones.mood.includes('movie-8'));
});

test('même réalisateur : même métier, films seulement, triés par votes', () => {
  const map = buildWorkMap(movieInput(), options);
  const zone = map.zones.find((entry) => entry.kind === 'director');
  assert.deepEqual(zone?.items, ['movie-5', 'movie-4']);
  assert.equal(zone?.job, 'director');
  assert.deepEqual(zone?.people?.map((person) => person.name), ['Réa Lisatrice']);
  assert.equal(map.items['movie-7'], undefined); // simple production
  assert.equal(map.items['tv-60'], undefined); // épisodes réalisés
  assert.deepEqual(map.items['movie-5'].reasons, [{
    type: 'sameDirector',
    people: [{ id: 100, name: 'Réa Lisatrice', img: 'https://img.test/w185/rea.jpg' }],
    job: 'director',
  }]);
});

test('mêmes acteurs : talk-shows, « Self », passages et cérémonies exclus', () => {
  const map = buildWorkMap(movieInput(), options);
  for (const key of ['tv-70', 'tv-72', 'movie-9', 'movie-10', 'movie-14', 'tv-71', 'tv-73', 'movie-11', 'movie-99']) {
    assert.equal(map.items[key], undefined, key);
  }
});

test('mêmes acteurs : d\'abord le nombre d\'acteurs communs, puis la notoriété', () => {
  const map = buildWorkMap(movieInput(), options);
  assert.deepEqual(zoneItems(map).cast, ['movie-12', 'movie-13', 'movie-8']);
  // Les acteurs sont cités dans l'ordre d'affiche du centre.
  assert.deepEqual(names(map.items['movie-12'].reasons[0]), ['Actrice Une', 'Acteur Deux']);
});

test('ambiance : mots-clés méta ignorés, règle des deux genres, meilleur score d\'abord', () => {
  const map = buildWorkMap(movieInput(), options);
  assert.deepEqual(zoneItems(map).mood, ['movie-24', 'movie-20', 'movie-25', 'movie-22']);
  assert.deepEqual(map.items['movie-24'].reasons[0], {
    type: 'themes',
    keywords: ['rêve', 'braquage'],
    genres: ['Action', 'Science-Fiction'],
  });
  assert.deepEqual(map.items['movie-22'].reasons[0], { type: 'themes', keywords: [], genres: ['Action', 'Science-Fiction'] });
  assert.equal(map.items['movie-21'], undefined); // seul « duringcreditsstinger » en commun
  assert.equal(map.items['movie-23'], undefined); // 10 votes
  // Sans mots-clés récupérés, un candidat n'est pas comparé.
  const partial = buildWorkMap(movieInput({}, { candidateKeywords: { 'movie-20': [{ id: 1, name: 'dream' }] } }), options);
  assert.deepEqual(zoneItems(partial).mood, ['movie-20']);
});

test('ambiance : libellés en anglais hors interface française', () => {
  const map = buildWorkMap(movieInput(), { ...options, lang: 'en-US' });
  assert.deepEqual(map.items['movie-24'].reasons[0], {
    type: 'themes',
    keywords: ['dream', 'heist'],
    genres: ['Action', 'Science-Fiction'],
  });
});

test('raisons en plus : même réalisateur et acteurs communs, quelle que soit la zone', () => {
  const map = buildWorkMap(movieInput(), options);
  assert.deepEqual(reasonTypes(map, 'movie-2'), ['saga', 'sameDirector', 'sharedCast']);
  assert.deepEqual(names(map.items['movie-2'].reasons[2]), ['Actrice Une']);
  assert.deepEqual(reasonTypes(map, 'movie-4'), ['sameDirector', 'sharedCast']);
  assert.deepEqual(reasonTypes(map, 'movie-3'), ['saga']);
  assert.deepEqual(reasonTypes(map, 'movie-12'), ['sharedCast']);
});

test('liens related dans les deux sens entre l\'équipe et les œuvres', () => {
  const map = buildWorkMap(movieInput(), options);
  assert.deepEqual(map.items['person-100'].related, ['movie-2', 'movie-5', 'movie-4']);
  assert.deepEqual(map.items['person-201'].related, ['movie-2', 'movie-4', 'movie-12', 'movie-8']);
  assert.deepEqual(map.items['person-202'].related, ['movie-12', 'movie-13']);
  assert.deepEqual(map.items['movie-12'].related, ['person-201', 'person-202']);
  assert.deepEqual(map.items['movie-2'].related, ['person-100', 'person-201']);
  assert.deepEqual(map.items['movie-24'].related, []);
  // Chaque lien a sa réciproque.
  for (const [key, item] of Object.entries(map.items)) {
    for (const other of item.related) assert.ok(map.items[other].related.includes(key), `${key} ↔ ${other}`);
  }
});

// ─── Carte d'une série ───────────────────────────────────────────────────────

test('série : créateurs, rôle principal agrégé et œuvres créées', () => {
  const details: RawWorkDetails = {
    id: 500,
    name: 'Série Centre',
    first_air_date: '2008-01-20',
    genres: [{ id: 18, name: 'Drame' }, { id: 80, name: 'Crime' }],
    created_by: [{ id: 600, name: 'Créa Trice' }],
    aggregate_credits: {
      cast: [
        // Tableau trié par présence : il prime sur `order` (première saison).
        { id: 701, name: 'Acteur Série', order: 9, roles: [{ character: 'Petit rôle', episode_count: 2 }, { character: 'Héros', episode_count: 40 }] },
        { id: 702, name: 'Partie Tôt', order: 0, roles: [{ character: 'Mentor', episode_count: 5 }] },
      ],
    },
    keywords: { results: [{ id: 7, name: 'drug dealer' }] },
    recommendations: { results: [serie(510, { genre_ids: [18] })] },
  };
  const map = buildWorkMap({
    type: 'tv',
    details,
    personCredits: {
      600: {
        crew: [
          serie(500, { job: 'Creator', department: 'Creator' }),
          serie(501, { job: 'Creator', department: 'Creator', vote_count: 800 }),
          serie(502, { job: 'Original Series Creator', department: 'Writing' }),
          film(503, { job: 'Director' }),
          serie(504, { job: 'Executive Producer' }),
        ],
      },
    },
    candidateKeywords: { 'tv-510': [{ id: 7, name: 'drug dealer' }] },
  }, options);
  assert.deepEqual(zoneItems(map).team, ['person-600', 'person-701', 'person-702']);
  assert.deepEqual(map.items['person-600'].reasons, [{ type: 'crew', job: 'creator' }]);
  assert.deepEqual(map.items['person-701'].reasons, [{ type: 'plays', character: 'Héros' }]);
  assert.deepEqual(zoneItems(map).director, ['tv-501']);
  assert.equal(map.zones.find((zone) => zone.kind === 'director')?.job, 'creator');
  assert.deepEqual(map.items['tv-510'].reasons[0], { type: 'themes', keywords: ['trafiquant de drogue'], genres: ['Drame'] });
  assert.equal(map.root.title, 'Série Centre');
  assert.equal(map.root.year, '2008');
});

test('choix préalables : équipe et candidats ambiance', () => {
  const team = pickWorkTeam('movie', movieInput().details);
  assert.deepEqual(team.actors.map((actor) => actor.id), [201, 202, 203, 204, 205, 206]);
  assert.deepEqual(team.directors.map((director) => director.id), [100]);
  const many = (from: number, count: number, mediaType?: string): RawWork[] =>
    Array.from({ length: count }, (_, index) => ({ id: from + index, media_type: mediaType, vote_count: 100 }));
  const candidates = pickMoodCandidates('movie', {
    id: 1,
    recommendations: { results: [...many(100, 12, 'movie'), { id: 1, media_type: 'movie', vote_count: 100 }] },
    similar: { results: [{ id: 100, vote_count: 100 }, { id: 300, vote_count: 3 }, ...many(200, 12)] },
  });
  // Dix de chaque liste, sans doublon, sans le centre ni les œuvres confidentielles.
  assert.equal(candidates.length, 20);
  assert.equal(candidates[0].key, 'movie-100');
  assert.equal(candidates[10].key, 'movie-200');
  assert.ok(!candidates.some((candidate) => candidate.key === 'movie-1' || candidate.key === 'movie-300'));
});

// ─── Carte d'un artiste ──────────────────────────────────────────────────────

function star(department = 'Acting'): RawPersonDetails {
  return {
    id: 800,
    name: 'Star Test',
    profile_path: '/star.jpg',
    biography: 'Biographie',
    known_for_department: department,
    combined_credits: {
      cast: [
        film(31, { character: 'Héros', vote_count: 9000, backdrop_path: '/a.jpg' }),
        film(32, { character: 'Rôle B', vote_count: 8000 }),
        film(33, { character: 'Rôle C (voice)', vote_count: 7000 }),
        film(33, { character: 'Rôle C bis', vote_count: 7000 }),
        film(34, { character: 'Narrator', order: 0, vote_count: 6500 }), // le héros qui raconte
        film(35, { character: 'Rôle J', vote_count: 6000 }), // aussi réalisé
        serie(36, { character: 'Invité', episode_count: 1 }),
        serie(37, { character: 'Self', genre_ids: [10767] }),
        film(38, { character: 'Himself' }),
        film(39, { character: 'Star Test (voice)' }),
        film(40, { character: 'Narrator (voice)', order: 0 }),
        film(41, { character: 'Projet', release_date: '', vote_count: 0 }), // annoncé
      ],
      crew: [
        film(35, { job: 'Director', vote_count: 6000 }),
        film(42, { job: 'Screenplay', vote_count: 3000 }),
        film(42, { job: 'Director', vote_count: 3000 }),
        film(43, { job: 'Writer', vote_count: 10 }), // trop confidentiel pour un métier secondaire
        serie(44, { job: 'Director', episode_count: 3, vote_count: 2000 }),
        serie(44, { job: 'Creator', vote_count: 2000 }),
        serie(45, { job: 'Director', episode_count: 1, vote_count: 5000 }), // un seul épisode
        film(46, { job: 'Producer', vote_count: 9999 }),
      ],
    },
  };
}

const WORK_CREDITS = {
  'movie-31': {
    cast: [
      { id: 800, name: 'Star Test', character: 'Héros', order: 0 },
      { id: 901, name: 'Partenaire Un', character: 'Amie', order: 1, popularity: 5 },
      { id: 902, name: 'Partenaire Deux', character: 'Voisin', order: 2 },
      { id: 903, name: 'Figurant', character: 'Passant', order: 20 },
      { id: 904, name: 'Célébrité', character: 'Himself', order: 3 },
    ],
    crew: [{ id: 950, name: 'Réa Fidèle', job: 'Director' }],
  },
  'movie-32': {
    cast: [
      { id: 800, name: 'Star Test', character: 'Rôle B', order: 0 },
      { id: 901, name: 'Partenaire Un', character: 'Sœur', order: 3, popularity: 5 },
      { id: 903, name: 'Figurant', character: 'Chauffeur', order: 4 },
      { id: 904, name: 'Célébrité', character: 'Himself', order: 2 },
      { id: 905, name: 'Partenaire Cinq', character: 'Chef', order: 5, popularity: 50 },
    ],
    crew: [{ id: 951, name: 'Réa Unique', job: 'Director' }],
  },
  'movie-33': {
    cast: [
      { id: 901, name: 'Partenaire Un', character: 'Patronne', order: 5, popularity: 5 },
      { id: 905, name: 'Partenaire Cinq', character: 'Chef', order: 1, popularity: 50 },
    ],
    crew: [{ id: 950, name: 'Réa Fidèle', job: 'Director' }, { id: 800, name: 'Star Test', job: 'Director' }],
  },
  'movie-35': {
    cast: [{ id: 800, name: 'Star Test', character: 'Rôle J', order: 0 }],
    crew: [{ id: 800, name: 'Star Test', job: 'Director' }],
  },
};

test('artiste : rôles sans talk-show, « Self », passage ni projet annoncé', () => {
  const map = buildPersonMap({ person: star(), workCredits: WORK_CREDITS }, options);
  assert.deepEqual(map.zones.map((zone) => zone.kind), ['roles', 'crew', 'partners', 'directors']);
  assert.deepEqual(zoneItems(map).roles, ['movie-31', 'movie-32', 'movie-33', 'movie-34', 'movie-35']);
  // Plusieurs personnages dans la même œuvre : une seule fiche.
  assert.deepEqual(map.items['movie-33'].reasons[0], { type: 'plays', character: 'Rôle C / Rôle C bis' });
  assert.deepEqual(map.items['movie-34'].reasons[0], { type: 'plays', character: 'Narrator' });
  assert.equal(map.root.title, 'Star Test');
  assert.equal(map.root.img, 'https://img.test/w342/star.jpg');
  assert.equal(map.root.department, 'Acting');
  assert.equal(map.root.overview, 'Biographie');
  assert.equal(map.root.backdrop, 'https://img.test/w780/a.jpg');
});

test('artiste : métiers dédoublonnés au plus fort, rôle et métier sur une seule fiche', () => {
  const map = buildPersonMap({ person: star(), workCredits: WORK_CREDITS }, options);
  // Film 35 joué ET réalisé : rôle d'abord pour une actrice, métier en plus.
  assert.deepEqual(map.items['movie-35'].reasons, [{ type: 'plays', character: 'Rôle J' }, { type: 'crewOn', job: 'director' }]);
  assert.deepEqual(zoneItems(map).crew, ['movie-42', 'tv-44']);
  assert.deepEqual(map.items['movie-42'].reasons, [{ type: 'crewOn', job: 'director' }]);
  // Série : la création compte plus que quelques épisodes réalisés.
  assert.deepEqual(map.items['tv-44'].reasons, [{ type: 'crewOn', job: 'creator' }]);
  assert.equal(map.items['tv-45'], undefined);
  assert.equal(map.items['movie-43'], undefined);

  const director = buildPersonMap({ person: star('Directing'), workCredits: WORK_CREDITS }, options);
  assert.equal(director.items['movie-35'].zone, 'crew');
  assert.deepEqual(director.items['movie-35'].reasons, [{ type: 'crewOn', job: 'director' }, { type: 'plays', character: 'Rôle J' }]);
});

test('artiste : partenaires et réalisateurs fidèles, au moins deux œuvres', () => {
  const map = buildPersonMap({ person: star(), workCredits: WORK_CREDITS }, options);
  // Partenaire Un : 3 œuvres ; Partenaire Cinq : 2 ; Partenaire Deux : 1 seule ;
  // Figurant : hors des 15 premiers sur le film 31 ; Célébrité : joue son propre rôle.
  assert.deepEqual(zoneItems(map).partners, ['person-901', 'person-905']);
  assert.deepEqual(names(map.items['person-901'].reasons[0]), ['Film 31', 'Film 32', 'Film 33']);
  assert.deepEqual(zoneItems(map).directors, ['person-950']);
  assert.deepEqual(names(map.items['person-950'].reasons[0]), ['Film 31', 'Film 33']);
  // Liens dans les deux sens avec les rôles présents sur la carte.
  assert.deepEqual(map.items['person-901'].related, ['movie-31', 'movie-32', 'movie-33']);
  assert.deepEqual(map.items['movie-31'].related, ['person-901', 'person-950']);
  assert.deepEqual(map.items['movie-33'].related, ['person-901', 'person-905', 'person-950']);
});

test('artiste : œuvres sources selon le métier principal', () => {
  assert.deepEqual(pickPersonSources(star()).map((source) => source.key), ['movie-31', 'movie-32', 'movie-33', 'movie-34', 'movie-35']);
  assert.deepEqual(pickPersonSources(star('Directing')).map((source) => source.key), ['movie-35', 'movie-42', 'tv-44', 'movie-43']);
});

// ─── Rôles, mots-clés, recherche ─────────────────────────────────────────────

test('faux rôles : soi-même, présentation, narration hors champ, caméo', () => {
  assert.equal(isNotARole('Self'), true);
  assert.equal(isNotARole('Himself - Guest'), true);
  assert.equal(isNotARole('Self (archive footage)'), true);
  assert.equal(isNotARole('Host'), true);
  assert.equal(isNotARole('Lui-même'), true);
  assert.equal(isNotARole('Brad Pitt / Self', 'Brad Pitt'), true);
  assert.equal(isNotARole('Tom Hanks (voice)', 'Tom Hanks'), true);
  assert.equal(isNotARole('Eddie Brock / Venom (uncredited)'), true);
  assert.equal(isNotARole('Narrator (voice)', 'X', 0), true);
  assert.equal(isNotARole('Narrator', 'X', 12), true);
  assert.equal(isNotARole('Narrator'), true);
  // Vrais rôles.
  assert.equal(isNotARole('Narrator', 'Edward Norton', 0), false);
  assert.equal(isNotARole('Woody (voice)', 'Tom Hanks'), false);
  assert.equal(isNotARole('The Host'), false);
  assert.equal(isNotARole('Eddie Brock / Venom'), false);
  assert.equal(isNotARole(''), false);
  assert.equal(isNotARole(undefined), false);
});

test('mots-clés méta : production, source, ton et genres répétés', () => {
  for (const name of [
    'duringcreditsstinger', 'aftercreditsstinger', 'based on novel or book', 'based on manga',
    'woman director', 'sequel', 'remake', 'imax', '3d', 'short film', 'anime', 'excited',
    'suspenseful', 'Romance', ' horror ',
  ]) {
    assert.equal(isMetaKeyword(name), true, name);
  }
  for (const name of ['time travel', 'dream', 'heist', 'serial killer', 'dystopia', 'new york city']) {
    assert.equal(isMetaKeyword(name), false, name);
  }
});

test('mots-clés traduits en français seulement', () => {
  assert.equal(keywordLabel('time travel', 'fr-FR'), 'voyage dans le temps');
  assert.equal(keywordLabel('Dream', 'fr-FR'), 'rêve');
  assert.equal(keywordLabel('heist', 'fr-CA'), 'braquage');
  assert.equal(keywordLabel('revenge', 'fr'), 'vengeance');
  assert.equal(keywordLabel('serial killer', 'fr-FR'), 'tueur en série');
  assert.equal(keywordLabel('1980s', 'fr-FR'), 'années 1980');
  assert.equal(keywordLabel('19th century', 'fr-FR'), 'XIXe siècle');
  assert.equal(keywordLabel('dream', 'en-US'), 'dream');
  assert.equal(keywordLabel('xyzzy', 'fr-FR'), 'xyzzy');
  assert.equal(keywordLabel('political intrigue ', 'en-US'), 'political intrigue');
});

test('recherche : œuvres et artistes, sans contenu adulte', () => {
  const hits = toSearchHits([
    {
      id: 6193,
      media_type: 'person',
      name: 'Leonardo DiCaprio',
      profile_path: '/leo.jpg',
      known_for: [{ id: 27205, media_type: 'movie', title: 'Inception' }, { id: 597, media_type: 'movie', title: 'Titanic' }, { id: 1, title: 'Autre' }],
    },
    { id: 27205, media_type: 'movie', title: 'Inception', release_date: '2010-07-15', vote_average: 8.4, poster_path: '/inc.jpg' },
    { id: 1396, media_type: 'tv', name: 'Breaking Bad', first_air_date: '2008-01-20', vote_average: 0 },
    { id: 9, media_type: 'movie', title: 'Adulte', adult: true },
    { id: 10, media_type: 'collection', name: 'Collection' },
  ], options);
  assert.deepEqual(hits, [
    { type: 'person', id: 6193, title: 'Leonardo DiCaprio', img: 'https://img.test/w185/leo.jpg', knownFor: 'Inception, Titanic' },
    { type: 'movie', id: 27205, title: 'Inception', year: '2010', img: 'https://img.test/w185/inc.jpg', rating: 8.4 },
    { type: 'tv', id: 1396, title: 'Breaking Bad', year: '2008', img: undefined, rating: undefined },
  ]);
});
