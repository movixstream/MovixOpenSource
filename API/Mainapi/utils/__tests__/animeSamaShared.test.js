/**
 * Ce que les workers partagent pour anime-sama : un verrou par œuvre en cours
 * d'actualisation et un débit commun pour `/api/lien.php`.
 *
 * Modes de défaillance, invisibles pour un scénario de bout en bout (un seul
 * processus, Redis toujours là) :
 *
 *  1. Redis en panne bloque toutes les actualisations (verrou jamais donné) ou
 *     toutes les demandes de liens (attente sans fin).
 *  2. Un worker libère le verrou d'un autre, qui continue en double.
 *  3. Douze workers cumulent leurs demandes : le débit vers anime-sama n'a
 *     plus de plafond.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createRefreshLock, createLinkBudget } = require('../animeSamaShared');

// Redis minimal : SET NX EX, INCR, EXPIRE et les deux scripts du verrou.
function fakeRedis() {
  const values = new Map();
  const redis = {
    values,
    down: false,
    calls: [],
    async set(key, value, ...flags) {
      redis.calls.push(['set', key]);
      if (redis.down) throw new Error('ECONNREFUSED');
      if (flags.includes('NX') && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async eval(script, _count, key, value) {
      redis.calls.push(['eval', key]);
      if (redis.down) throw new Error('ECONNREFUSED');
      if (values.get(key) !== value) return 0;
      if (/\bdel\b/.test(script)) values.delete(key);
      return 1;
    },
    async incr(key) {
      if (redis.down) throw new Error('ECONNREFUSED');
      const next = (values.get(key) || 0) + 1;
      values.set(key, next);
      return next;
    },
    async expire() { return 1; },
  };
  return redis;
}

test('verrou : un seul worker par œuvre ; le verrou rendu, un autre peut le prendre', async () => {
  const redis = fakeRedis();
  const lockA = createRefreshLock({ redis });
  const lockB = createRefreshLock({ redis });

  const held = await lockA('animesama:actualisation:one-piece');
  assert(held, 'le premier worker obtient le verrou');
  assert.equal(await lockB('animesama:actualisation:one-piece'), null, 'le second ne l’obtient pas');
  assert(await lockB('animesama:actualisation:naruto'), 'une autre œuvre n’est pas bloquée');

  assert.equal(await held.renew(), true);
  await held.release();
  const taken = await lockB('animesama:actualisation:one-piece');
  assert(taken);

  // Le premier worker, en retard, ne libère pas le verrou du second.
  await held.release();
  assert.equal(await held.renew(), false);
  assert.equal(await lockA('animesama:actualisation:one-piece'), null);
});

test('verrou : Redis en panne, l’actualisation part quand même', async () => {
  const redis = fakeRedis();
  redis.down = true;
  const lock = createRefreshLock({ redis });
  const handle = await lock('animesama:actualisation:one-piece');
  assert(handle, 'sans Redis, chaque worker travaille seul comme avant');
  await handle.renew();
  await handle.release();
});

test('débit : au-delà du plafond de la seconde, la demande attend la seconde suivante', async () => {
  const redis = fakeRedis();
  let now = 1_000_000_000_000;
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); now += ms; };
  // Deux workers, un seul compteur.
  const budgetA = createLinkBudget({ redis, perSecond: 3, now: () => now, sleep });
  const budgetB = createLinkBudget({ redis, perSecond: 3, now: () => now, sleep });

  await budgetA.take(); await budgetB.take(); await budgetA.take();
  assert.deepEqual(sleeps, [], 'les trois premières passent tout de suite');
  await budgetB.take();
  assert.equal(sleeps.length, 1, 'la quatrième attend');
  assert(sleeps[0] > 0 && sleeps[0] <= 1100);
  assert.equal(Math.floor(now / 1000), 1_000_000_001, 'elle part dans la seconde suivante');
});

test('débit : Redis en panne ou plafond jamais libre, la demande finit toujours par partir', async () => {
  const down = fakeRedis();
  down.down = true;
  const sleeps = [];
  await createLinkBudget({ redis: down, perSecond: 1, sleep: async ms => { sleeps.push(ms); } }).take();
  assert.deepEqual(sleeps, [], 'sans Redis, aucun délai : le plafond par worker reste seul');

  // Horloge figée : le compteur de la seconde reste plein.
  const stuck = fakeRedis();
  let waits = 0;
  const budget = createLinkBudget({ redis: stuck, perSecond: 1, now: () => 5000, sleep: async () => { waits += 1; } });
  await budget.take();
  await budget.take();
  assert(waits > 0 && waits <= 60, 'attente bornée');
});
