'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WIFLIX_SESSION_IDLE_MS, createWiflixSessionCookies } = require('../wiflixProxyAffinity');

const P1 = 'http://198.51.100.1:8080';
const P2 = 'http://198.51.100.2:8080';
const P3 = 'http://198.51.100.3:8080';

test('un cookie de session reste 10 min après son dernier usage réussi, 1 h au plus', () => {
  let now = 0;
  const sessions = createWiflixSessionCookies({ now: () => now });
  sessions.remember(P1, 'PHPSESSID=a; h_check=25');
  now += WIFLIX_SESSION_IDLE_MS - 1;
  assert.equal(sessions.get(P1), 'PHPSESSID=a; h_check=25');
  // Chaque reprise réussie repousse l'échéance d'inactivité.
  for (let i = 0; i < 6; i++) {
    sessions.confirm(P1);
    now += WIFLIX_SESSION_IDLE_MS - 1;
  }
  assert.equal(sessions.get(P1), null); // Plus d'une heure après sa création.
  sessions.remember(P2, 'PHPSESSID=b; h_check=25');
  now += WIFLIX_SESSION_IDLE_MS;
  assert.equal(sessions.get(P2), null);
  assert.equal(sessions.size, 0);
});

test('les proxys au cookie valable sont rendus du plus récent au plus ancien', () => {
  let now = 0;
  const sessions = createWiflixSessionCookies({ now: () => now, maxEntries: 2 });
  sessions.remember(P1, 'a');
  sessions.remember(P2, 'b');
  sessions.confirm(P1);
  assert.deepEqual(sessions.warm(2), [P1, P2]);
  sessions.remember(P3, 'c'); // Capacité de 2 : le plus ancien usage sort.
  assert.deepEqual(sessions.warm(5), [P3, P1]);
  sessions.forget(P3);
  assert.deepEqual(sessions.warm(5), [P1]);
});

test('des cookies refusés d’affilée suspendent la reprise 30 min', () => {
  let now = 0;
  const sessions = createWiflixSessionCookies({ now: () => now });
  for (let i = 0; i < 4; i++) sessions.remember(P1, `s${i}`, { replaced: true });
  sessions.confirm(P1); // Une reprise réussie remet le compte à zéro.
  for (let i = 0; i < 4; i++) sessions.remember(P1, `t${i}`, { replaced: true });
  assert.equal(sessions.get(P1), 't3');
  sessions.remember(P2, 'u', { replaced: true });
  assert.equal(sessions.get(P2), null);
  assert.deepEqual(sessions.warm(2), []);
  now += 30 * 60 * 1000;
  sessions.remember(P2, 'v');
  assert.equal(sessions.get(P2), 'v');
});
