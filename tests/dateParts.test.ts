// Jour, mois et année sans `formatToParts` (Chromium 56 des télés Samsung
// Tizen 4.0) : le repli doit rendre exactement ce que donne l'API native.
import assert from 'node:assert/strict';
import test from 'node:test';
import { getNumericDateParts } from '../src/utils/dateParts.ts';

const withoutFormatToParts = (formatter: Intl.DateTimeFormat) => ({
  format: (date: Date | number) => formatter.format(date),
}) as unknown as Intl.DateTimeFormat;

const cases: Array<[string, Intl.DateTimeFormatOptions]> = [
  ['en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' }],
  ['en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }],
  ['en-US', { timeZone: 'Pacific/Kiritimati', year: 'numeric', month: '2-digit', day: '2-digit' }],
  ['fr-FR', { timeZone: 'Pacific/Pago_Pago', year: '2-digit', month: 'numeric', day: 'numeric' }],
];

const dates = [Date.UTC(2026, 3, 1, 0, 30), Date.UTC(2026, 2, 31, 22, 30), Date.UTC(2027, 11, 31, 23, 59)];

for (const [locale, options] of cases) {
  test(`le repli lit les mêmes nombres que formatToParts (${locale}, ${options.timeZone})`, () => {
    const formatter = new Intl.DateTimeFormat(locale, options);
    for (const date of dates) {
      assert.deepEqual(
        getNumericDateParts(withoutFormatToParts(formatter), date),
        getNumericDateParts(formatter, date),
      );
    }
  });
}

test('le repli reconnaît le 1er avril à Paris', () => {
  const formatter = withoutFormatToParts(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit',
  }));
  assert.deepEqual(getNumericDateParts(formatter, Date.UTC(2026, 2, 31, 22, 30)), { day: '01', month: '04' });
});
