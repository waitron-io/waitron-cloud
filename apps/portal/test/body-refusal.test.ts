import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bodyRefusal} from '../src/body-refusal.ts';

for (const [status, code, expected] of [
  [408, 'invalid_input', 'Interrupted'],
  [413, 'invalid_input', 'Size'],
  [415, 'invalid_input', 'Format'],
  [400, 'invalid_input', undefined],
  [429, 'invalid_input', undefined],
  [503, 'invalid_input', undefined],
  [0, 'network_error', undefined],
  [408, 'unavailable', undefined],
] as const) test(`${status} ${code} keeps its own refusal cause`, () => {
  assert.equal(bodyRefusal({ok: false, status, code, retryAfterMs: 0}), expected);
});
