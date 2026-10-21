import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureRemoteJourneys } from './remote-journey.mjs';

// Refuse credentials and unexpected configuration before opening a measurement listener.
test('remoteJourneysRefuseMalformedOrAdditionalInputsWithoutLeakingTheirValues', async () => {
  const good = { staffHostname: 'staff.generated.example.test', publicHostname: 'generated.example.test',
    staffCa: Buffer.from('local trust'), publicCa: Buffer.from('local trust'), email: 'owner@example.test', password: 'private canary' };
  const bad = [undefined, null, [], { ...good, unknown: 'raw canary' },
    { ...good, staffHostname: 'https://outside.example' }, { ...good, staffHostname: good.publicHostname },
    { ...good, publicHostname: 'private\ncanary' }, { ...good, email: '' }, { ...good, password: '' },
    { ...good, password: 'x'.repeat(1025) }, { ...good, staffCa: '' }, { ...good, publicCa: Buffer.alloc(0) },
    { ...good, publicCa: Buffer.alloc(65537) }];
  for (const key of Reflect.ownKeys(good)) {
    const missing = { ...good }; delete missing[key]; bad.push(missing);
    const accessor = { ...good }; Object.defineProperty(accessor, key, { get() { throw Error('raw canary'); } }); bad.push(accessor);
  }
  const hidden = { ...good }; Object.defineProperty(hidden, 'raw', { value: 'raw canary' }); bad.push(hidden);
  const symbolic = { ...good, [Symbol('raw canary')]: true }; bad.push(symbolic);
  for (const value of bad) await assert.rejects(measureRemoteJourneys(value), { message: 'Invalid cloud cost remote journey' });
});
