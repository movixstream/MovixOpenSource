// Jour, mois et année d'une date selon un Intl.DateTimeFormat numérique.
//
// `formatToParts` n'existe qu'à partir de Chrome 57 : les télés Samsung
// Tizen 4.0 (2018, Chromium 56) chargent le bundle legacy et plantaient au
// démarrage sur `aprilFools.ts` (« formatToParts is not a function »).
// Core-js ne polyfille pas Intl. Sans formatToParts, on formate une date de
// référence connue (22/11/2033) pour savoir dans quel ordre la locale écrit
// les nombres, puis on lit les nombres de `format()` dans cet ordre.

export type NumericDatePart = 'year' | 'month' | 'day';
export type NumericDateParts = Partial<Record<NumericDatePart, string>>;

// Midi UTC : le 22 partout sauf de UTC+12 à UTC+14, où c'est déjà le 23.
const REFERENCE_DATE = Date.UTC(2033, 10, 22, 12);

const fieldForReferenceNumber = (value: string): NumericDatePart | null => {
  if (value === '2033' || value === '33') return 'year';
  if (value === '11') return 'month';
  if (value === '22' || value === '23') return 'day';
  return null;
};

const readWithFormat = (formatter: Intl.DateTimeFormat, date: Date | number): NumericDateParts => {
  const order = (formatter.format(REFERENCE_DATE).match(/\d+/g) || []).map(fieldForReferenceNumber);
  const values = formatter.format(date).match(/\d+/g) || [];
  const parts: NumericDateParts = {};
  order.forEach((field, index) => {
    if (field && values[index] !== undefined) parts[field] = values[index];
  });
  return parts;
};

export const getNumericDateParts = (
  formatter: Intl.DateTimeFormat,
  date: Date | number,
): NumericDateParts => {
  if (typeof formatter.formatToParts !== 'function') {
    return readWithFormat(formatter, date);
  }
  const parts: NumericDateParts = {};
  formatter.formatToParts(date).forEach((part) => {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      parts[part.type] = part.value;
    }
  });
  return parts;
};
