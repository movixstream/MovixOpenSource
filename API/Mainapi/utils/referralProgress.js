'use strict';

// Avancée d'un filleul et récompenses du parrainage.
//
// Le temps de visionnage vient du Wrapped : POST /api/wrapped/track appelle
// creditRefereeWatch avec les secondes qu'il vient d'accepter, déjà plafonnées
// au temps réel (utils/wrappedTimeBudget.js). Un membre qui a coupé la
// collecte de données n'envoie rien au Wrapped, donc rien au parrainage.

const { loadReferralSettings } = require('./referralSettings');
const rules = require('./referralRules');

// Le Wrapped envoie toutes les 30 s pour chaque spectateur : on retient par
// worker qui n'est pas un filleul en cours, pour ne pas lire MySQL à chaque
// envoi. Un code saisi sur un autre worker est vu au bout de 2 minutes au plus.
const NOT_PENDING_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50000;
const notPending = new Map();

function cacheKey(account) {
  return `${account.userType}:${account.userId}`;
}

function isKnownNotPending(account, nowMs) {
  const until = notPending.get(cacheKey(account));
  if (until === undefined) return false;
  if (until > nowMs) return true;
  notPending.delete(cacheKey(account));
  return false;
}

function rememberNotPending(account, nowMs) {
  if (notPending.size >= CACHE_MAX_ENTRIES) notPending.clear();
  notPending.set(cacheKey(account), nowMs + NOT_PENDING_TTL_MS);
}

/** À appeler quand un compte devient filleul (saisie d'un code). */
function forgetReferralCache(account) {
  notPending.delete(cacheKey(account));
}

function resetReferralProgressCache() {
  notPending.clear();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Passe le parrainage en « récompensé » et crée les jours des deux côtés,
// une seule fois même si deux envois arrivent ensemble. Le parrain ne gagne
// rien au-delà de `maxRewardsPerMonth` filleuls sur 30 jours glissants.
async function grantRewards(pool, referralId, settings) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [update] = await connection.execute(
      "UPDATE referrals SET status = 'rewarded', rewarded_at = NOW() WHERE id = ? AND status = 'pending'",
      [referralId]
    );
    if (update.affectedRows !== 1) {
      await connection.rollback();
      return false;
    }
    const [rows] = await connection.execute(
      `SELECT referrer_user_type, referrer_user_id, referee_user_type, referee_user_id
        FROM referrals WHERE id = ? LIMIT 1`,
      [referralId]
    );
    const referral = rows[0];
    await connection.execute(
      `INSERT INTO referral_rewards (referral_id, role, user_type, user_id, days, created_at)
        VALUES (?, 'referee', ?, ?, ?, NOW())`,
      [referralId, referral.referee_user_type, referral.referee_user_id, settings.rewardDays]
    );
    const [capRows] = await connection.execute(
      `SELECT COUNT(*) AS total FROM referral_rewards
        WHERE role = 'referrer' AND user_type = ? AND user_id = ?
          AND created_at > (NOW() - INTERVAL 30 DAY)`,
      [referral.referrer_user_type, referral.referrer_user_id]
    );
    if (toNumber(capRows?.[0]?.total) < settings.maxRewardsPerMonth) {
      await connection.execute(
        `INSERT INTO referral_rewards (referral_id, role, user_type, user_id, days, created_at)
          VALUES (?, 'referrer', ?, ?, ?, NOW())`,
        [referralId, referral.referrer_user_type, referral.referrer_user_id, settings.rewardDays]
      );
    }
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Ajoute du temps de visionnage à un filleul en cours et donne les jours VIP
 * quand l'objectif est atteint.
 * @param {{ userType: string, userId: string }} account
 * @param {{ capSeconds?: (seconds: number) => Promise<number> }} [options]
 *   `capSeconds` rogne le temps au temps réel du compte. Le plafond du Wrapped
 *   est par profil : sans celui-ci, plusieurs profils ouverts en même temps
 *   comptaient chacun le temps réel. Appelé seulement pour un filleul en cours.
 * @returns {Promise<'ignored'|'counted'|'rewarded'>}
 */
async function creditRefereeWatch(pool, account, seconds, now = new Date(), { capSeconds } = {}) {
  const credited = Math.floor(toNumber(seconds));
  if (!pool || credited <= 0 || !['oauth', 'bip39'].includes(account?.userType) || !account.userId) return 'ignored';
  const nowMs = now.getTime();
  if (isKnownNotPending(account, nowMs)) return 'ignored';

  const { settings } = await loadReferralSettings(pool);
  if (!settings.enabled) return 'ignored';

  const [rows] = await pool.execute(
    `SELECT id, status FROM referrals
      WHERE referee_user_type = ? AND referee_user_id = ? LIMIT 1`,
    [account.userType, String(account.userId)]
  );
  const referral = rows?.[0];
  if (!referral || referral.status !== 'pending') {
    rememberNotPending(account, nowMs);
    return 'ignored';
  }

  let counted = credited;
  if (capSeconds) {
    counted = Math.min(credited, Math.max(0, Math.floor(toNumber(await capSeconds(credited)))));
    if (counted <= 0) return 'ignored';
  }

  // Ajout relatif en une requête : deux envois simultanés s'additionnent.
  // Un jour de visionnage pas encore vu compte un jour de plus (watch_days
  // est calculé avant que last_watch_day prenne la nouvelle valeur). Ce jour
  // commence à 5 h, heure de Paris : regarder avant et après minuit ne donne
  // pas deux jours.
  const today = rules.viewingDayKey(now);
  await pool.execute(
    `UPDATE referrals
      SET watch_seconds = watch_seconds + ?,
          watch_days = watch_days + IF(last_watch_day <=> ?, 0, 1),
          last_watch_day = ?
      WHERE id = ? AND status = 'pending'`,
    [counted, today, today, referral.id]
  );

  const [after] = await pool.execute(
    'SELECT status, watch_seconds, watch_days FROM referrals WHERE id = ? LIMIT 1',
    [referral.id]
  );
  const row = after?.[0];
  if (row?.status === 'pending' && rules.isGoalReached({
    watchSeconds: toNumber(row.watch_seconds),
    watchDays: toNumber(row.watch_days)
  }, settings)) {
    if (await grantRewards(pool, referral.id, settings)) {
      rememberNotPending(account, nowMs);
      return 'rewarded';
    }
  }
  return 'counted';
}

module.exports = {
  grantRewards,
  creditRefereeWatch,
  forgetReferralCache,
  resetReferralProgressCache
};
