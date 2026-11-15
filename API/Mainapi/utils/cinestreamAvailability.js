'use strict';

const { randomUUID } = require('node:crypto');

// Un seul état pour les six workers. Seule une recherche complète peut rétablir
// la source : /search peut répondre 200 pendant que toutes les fiches font 502.
// Trois échecs en 30 s ouvrent une pause de 1, puis 2, 4 et au plus 5 minutes.
// La reprise réserve un seul scraping, avec un bail de 2 minutes en cas de crash.
const TRANSITION = `
local now = tonumber(ARGV[2])
local raw = redis.call('GET', KEYS[1])
local state = raw and cjson.decode(raw) or {
  epoch = ARGV[3], failures = 0, windowStart = now,
  delay = 0, retryAt = 0, probeUntil = 0
}
local action = ARGV[1]
if action == 'enter' then
  if state.retryAt > now then return {0, state.retryAt, ''} end
  if state.probeUntil > now then return {0, now + 1000, ''} end
  if state.retryAt > 0 then
    state.epoch = ARGV[3]
    state.probeUntil = now + 120000
  end
else
  -- Les réponses d'avant la pause ne doivent ni la lever ni la prolonger.
  if state.epoch ~= ARGV[4] then return {0, state.retryAt, ''} end
  if action == 'success' then
    if state.probeUntil > 0 then state.epoch = ARGV[3] end
    state.failures = 0
    state.windowStart = now
    state.delay = 0
    state.retryAt = 0
    state.probeUntil = 0
  elseif action == 'failure' then
    if now - state.windowStart >= 30000 then
      state.failures = 0
      state.windowStart = now
    end
    state.failures = state.failures + 1
    if state.failures >= 3 or state.probeUntil > 0 then
      state.delay = math.min(300000, math.max(60000, state.delay * 2))
      state.retryAt = now + state.delay
      state.probeUntil = 0
      state.epoch = ARGV[3]
    end
  elseif state.probeUntil > 0 then
    state.retryAt = now + 60000
    state.probeUntil = 0
    state.epoch = ARGV[3]
  end
end
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', 3600000)
return {1, state.retryAt, state.epoch}
`;

function unavailable() {
  return Object.assign(new Error('CineStream temporairement indisponible'), {
    code: 'CINESTREAM_COOLDOWN', httpStatus: 503,
  });
}

function createCinestreamAvailability({ redis, now = Date.now } = {}) {
  let blockedUntil = 0;
  let active = 0;
  let commands = 0;

  async function transition(action, epoch = '') {
    if (!redis || redis.status !== 'ready' || commands >= 16) throw unavailable();
    commands++;
    let timer;
    const pending = Promise.resolve().then(() => redis.eval(
      TRANSITION, 1, 'cinestream:availability:v1', action, now(), randomUUID(), epoch,
    ));
    pending.then(() => commands--, () => commands--);
    try {
      const result = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => reject(unavailable()), 500);
      })]);
      if (!Array.isArray(result) || result.length !== 3) throw unavailable();
      // Une pause connue est rejetée localement, sans nouvel appel Redis.
      blockedUntil = Math.max(blockedUntil, Number(result[1]) || 0);
      return result;
    } catch {
      blockedUntil = Math.max(blockedUntil, now() + 1000);
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(task) {
    if (blockedUntil > now() || active >= 8) throw unavailable();
    active++;
    try {
      const [allowed, , epoch] = await transition('enter');
      if (!allowed) throw unavailable();
      let result;
      try {
        result = await task();
      } catch (error) {
        const action = error?.code === 'CINESTREAM_UPSTREAM_UNAVAILABLE' ? 'failure' : 'release';
        await transition(action, epoch).catch(() => {});
        throw error;
      }
      // Une recherche vide ne prouve pas que les fiches et lecteurs refonctionnent.
      await transition(result?.success === true ? 'success' : 'release', epoch).catch(() => {});
      return result;
    } finally {
      active--;
    }
  }

  return { run };
}

module.exports = { createCinestreamAvailability };
