import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formatDateTime} from '../src/dates.ts';

for (const [locale, expected] of [
 ['en', /^November 10, 2026(?: at|,) 10:05:09 AM$/],
 ['es', /^10 de noviembre de 2026(?: a las|,) 10:05:09$/],
] as const) test(`${locale}: dates spell out the month and keep the local time to the second`, () => {
 const instant = new Date(2026, 10, 10, 10, 5, 9).toISOString();
 assert.match(formatDateTime(instant, locale), expected);
});
