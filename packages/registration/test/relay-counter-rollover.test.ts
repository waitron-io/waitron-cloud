import assert from 'node:assert/strict';
import test from 'node:test';
import {RelayBoundsError} from '../src/relay-bounds.ts';
import {admitFixtureMessage} from './fixtures/relay-counter-rollover.ts';

function expired(counterEndsAt = 1000, observedAt = 1001) {
  return Object.assign(new RelayBoundsError('relay_unavailable'),
    {cause: {kind: 'relay_counter_expired', counterEndsAt, observedAt}});
}

test('fixture retries a proved rollover and reports only the bounded clock evidence', async () => {
  let attempts = 0;
  const reports: unknown[] = [];
  const error = expired();
  Object.assign(error.cause, {recipient: 'private@example.test', token: 'private-token'});
  assert.equal(await admitFixtureMessage(async () => {
    if (++attempts === 1) throw error;
    return 'admitted';
  }, evidence => reports.push(evidence)), 'admitted');
  assert.equal(attempts, 2);
  assert.deepEqual(reports, [{kind: 'relay_counter_expired', counterEndsAt: 1000, observedAt: 1001}]);
});

test('fixture bounds repeated rollover attempts and preserves the last refusal', async () => {
  let attempts = 0;
  const errors = Array.from({length: 10}, () => expired(1000, 1000)), reports: unknown[] = [];
  await assert.rejects(admitFixtureMessage(async () => {
    const error = errors[attempts++];
    if (!error) return 'unbounded admission';
    throw error;
  }, e => reports.push(e)), e => e === errors[9]);
  assert.equal(attempts, 10);
  assert.equal(reports.length, 10);
});

for (const [name, error] of [
  ['unexplained unavailability', new RelayBoundsError('relay_unavailable')],
  ['rate limit', Object.assign(new RelayBoundsError('rate_limited'), {cause: expired().cause})],
  ['untyped error', Object.assign(new Error('relay_unavailable'), {code: 'relay_unavailable', cause: expired().cause})],
  ['live counter', expired(1002, 1001)],
  ['invalid time', expired(NaN, 1001)],
  ['negative time', expired(-1, 1001)],
  ['out-of-range time', expired(1000, 8640000000000001)],
  ['null evidence', Object.assign(expired(), {cause: null})],
  ['fractional time', expired(1000.5, 1001)],
  ['non-numeric time', expired('1000' as unknown as number, 1001)],
  ['unbounded time', expired(1000, Infinity)],
  ['unknown cause', Object.assign(expired(), {cause: {kind: 'other', counterEndsAt: 1000, observedAt: 1001}})],
  ['database failure', Object.assign(new Error('database refused'), {code: '57014'})],
] as const) test(`fixture never retries ${name}`, async () => {
  let attempts = 0;
  await assert.rejects(admitFixtureMessage(async () => {attempts++; throw error;}, () => assert.fail('must not report a rollover')), e => e === error);
  assert.equal(attempts, 1);
});
