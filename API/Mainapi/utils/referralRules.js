'use strict';

const crypto = require('node:crypto');

// Règles du parrainage sans base ni réseau : code, âge du compte, objectif de
// visionnage et durée VIP. Testées dans utils/__tests__/referralRules.test.js.

// Sans 0/O, 1/I/L : un code se dicte et se recopie sans erreur.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

const DAY_MS = 24 * 60 * 60 * 1000;

const parisDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function generateReferralCode(randomBytes = crypto.randomBytes) {
  // 256 n'est pas un multiple de 31 : on rejette les octets du dernier tour
  // incomplet pour que chaque caractère ait la même chance.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

// Accepte le code tapé (minuscules, espaces, tirets) ou le lien de parrainage
// collé en entier (`…?ref=CODE`). Renvoie le code propre ou null.
function normalizeReferralCode(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value || value.length > 300) return null;
  const fromLink = /[?&#]ref=([^&#\s]+)/i.exec(value);
  if (fromLink) {
    try {
      value = decodeURIComponent(fromLink[1]);
    } catch {
      return null;
    }
  }
  const cleaned = value.toUpperCase().replace(/[\s-]+/g, '');
  return CODE_PATTERN.test(cleaned) ? cleaned : null;
}

function parisDateKey(date) {
  return parisDateFormatter.format(date);
}

// Jour de visionnage du parrainage : il commence à 5 h (heure de Paris), pas
// à minuit. Une soirée qui passe minuit reste un seul jour ; pour en compter
// un deuxième, il faut revenir le lendemain.
const VIEWING_DAY_START_HOUR = 5;

function viewingDayKey(date) {
  return parisDateKey(new Date(date.getTime() - VIEWING_DAY_START_HOUR * 60 * 60 * 1000));
}

function toValidDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Date de création retenue : la plus ancienne trace connue du compte (date
// du profil d'origine, première session). Aucune trace → null (pas éligible).
function resolveAccountCreatedAt(...candidates) {
  let earliest = null;
  for (const candidate of candidates) {
    const date = toValidDate(candidate);
    if (date && (!earliest || date < earliest)) earliest = date;
  }
  return earliest;
}

// Un code ne peut être entré que pendant les `windowDays` jours qui suivent
// la création du compte : un ancien membre ne peut pas se faire parrainer.
function getClaimDeadline(createdAt, windowDays) {
  const created = toValidDate(createdAt);
  return created ? new Date(created.getTime() + windowDays * DAY_MS) : null;
}

function isWithinClaimWindow(createdAt, now, windowDays) {
  const deadline = getClaimDeadline(createdAt, windowDays);
  return Boolean(deadline) && now.getTime() <= deadline.getTime();
}

// Un code ne marche que `minDays` jours après la création du compte du
// parrain : pas de compte créé juste pour parrainer. Date inconnue → null.
function getCodeActiveAt(createdAt, minDays) {
  const created = toValidDate(createdAt);
  return created ? new Date(created.getTime() + minDays * DAY_MS) : null;
}

function isGoalReached({ watchSeconds, watchDays }, settings) {
  return watchSeconds >= settings.requiredMinutes * 60 && watchDays >= settings.requiredDays;
}

// Nouvelle fin d'une clé VIP prolongée : on ajoute les jours à la fin actuelle,
// ou à maintenant si la clé a déjà expiré.
function extendExpiry(currentExpiresMs, nowMs, days) {
  const current = Number(currentExpiresMs);
  const base = Number.isFinite(current) && current > nowMs ? current : nowMs;
  return base + days * DAY_MS;
}

function buildDurationLabel(days) {
  return `${days} jour${days > 1 ? 's' : ''} (parrainage)`;
}

module.exports = {
  CODE_ALPHABET,
  CODE_LENGTH,
  DAY_MS,
  generateReferralCode,
  normalizeReferralCode,
  parisDateKey,
  viewingDayKey,
  resolveAccountCreatedAt,
  getClaimDeadline,
  isWithinClaimWindow,
  getCodeActiveAt,
  isGoalReached,
  extendExpiry,
  buildDurationLabel
};
