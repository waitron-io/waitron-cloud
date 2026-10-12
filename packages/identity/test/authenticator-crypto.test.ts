import assert from 'node:assert/strict';
import { test } from 'node:test';

const moduleUrl = new URL('../src/authenticator-crypto.ts', import.meta.url);
async function crypto() {
  try { return await import(moduleUrl.href); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND'
      && (error as Error).message.includes('authenticator-crypto.ts')) {
      assert.fail('Authenticator cryptography is unavailable');
    }
    throw error;
  }
}
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const keys = {activeKeyId: 'current', keys: {current: '07'.repeat(32), previous: '06'.repeat(32)}};
const binding = {accountId: '11111111-1111-4111-8111-111111111111', version: 1, purpose: 'active' as const};
const pending = {...binding, purpose: 'pending' as const, pendingId: '22222222-2222-4222-8222-222222222222'};

// RFC 6238 SHA-1 vectors, truncated to six digits, do not depend on this wrapper.
test('returns exact matched steps and accepts only adjacent periods', async () => {
  const {matchedTotpSteps} = await crypto();
  for (const [code, now, want] of [
    ['287082', 59_000, [1]], ['755224', 30_000, [0]], ['359152', 59_000, [2]],
    ['969429', 59_000, []], ['755224', 60_000, []], ['755224', 0, [0]],
  ] as const) assert.deepEqual(matchedTotpSteps(secret, code, now), want);
});
test('reports every matching step when adjacent periods have the same code', async () => {
  const {matchedTotpSteps} = await crypto();
  // Independently calculated with Python HMAC-SHA1 over the RFC secret.
  assert.deepEqual(matchedTotpSteps(secret, '911617', 910738 * 30_000), [910737, 910738]);
});
test('refuses malformed proof, secret and clock without throwing', async () => {
  const {matchedTotpSteps} = await crypto();
  for (const value of ['12345', '1234567', ' 287082', '２８７０８２', '', null]) {
    assert.deepEqual(matchedTotpSteps(secret, value as string, 59_000), []);
  }
  for (const value of ['', '!!!not-base32!!!', null]) {
    assert.deepEqual(matchedTotpSteps(value as string, '287082', 59_000), []);
  }
  for (const value of [-1, NaN, Infinity, 1.5]) assert.deepEqual(matchedTotpSteps(secret, '287082', value), []);
});
test('encrypts with random nonces and reads the configured previous key', async () => {
  const {encryptFactorSecret, decryptFactorSecret} = await crypto();
  const first = encryptFactorSecret(secret, keys, binding);
  assert.notEqual(first, encryptFactorSecret(secret, keys, binding));
  assert.equal(first.includes(secret), false);
  assert.equal(decryptFactorSecret(first, keys, binding), secret);
  const old = encryptFactorSecret(secret, {...keys, activeKeyId: 'previous'}, binding);
  assert.equal(decryptFactorSecret(old, keys, binding), secret);
  assert.equal(decryptFactorSecret(old, {activeKeyId: 'current', keys: {current: keys.keys.current}}, binding), null);
});
test('binds encrypted secrets to account, version, purpose and pending identity', async () => {
  const {encryptFactorSecret, decryptFactorSecret} = await crypto();
  const stored = encryptFactorSecret(secret, keys, pending);
  assert.equal(decryptFactorSecret(stored, keys, pending), secret);
  for (const changed of [
    {...pending, accountId: '33333333-3333-4333-8333-333333333333'},
    {...pending, version: 2}, binding,
    {...pending, pendingId: '44444444-4444-4444-8444-444444444444'},
  ]) assert.equal(decryptFactorSecret(stored, keys, changed), null);
});
test('refuses plaintext, malformed envelopes and tampered ciphertext or key labels', async () => {
  const {encryptFactorSecret, decryptFactorSecret} = await crypto();
  const stored = encryptFactorSecret(secret, keys, binding);
  for (const value of [secret, '', `${stored}.extra`, stored.slice(0, -1), 'v99.current.a.b.c',
    stored.replace('current', 'previous'), stored.replace(/^v1/, 'v2')]) {
    assert.equal(decryptFactorSecret(value, keys, binding), null);
  }
  const parts = stored.split('.');
  for (const index of [2, 3, 4]) {
    const changed = [...parts]; const bytes = Buffer.from(changed[index]!, 'base64url');
    bytes[0] = bytes[0]! ^ 1; changed[index] = bytes.toString('base64url');
    assert.equal(decryptFactorSecret(changed.join('.'), keys, binding), null);
  }
  assert.equal(decryptFactorSecret(stored, {activeKeyId: 'current', keys: {current: '08'.repeat(32)}}, binding), null);
});
test('rejects absent, wrong-length and partly valid keys before encryption', async () => {
  const {encryptFactorSecret, decryptFactorSecret} = await crypto();
  const stored = encryptFactorSecret(secret, keys, binding);
  for (const invalid of [
    {activeKeyId: 'current', keys: {}}, {activeKeyId: 'current', keys: {current: '07'.repeat(16)}},
    {activeKeyId: 'current', keys: {current: `${'07'.repeat(32)}junk`}},
    {activeKeyId: 'bad.key', keys: {'bad.key': '07'.repeat(32)}},
    {activeKeyId: '0', keys: ['07'.repeat(32)]}, null,
  ]) {
    assert.throws(() => encryptFactorSecret(secret, invalid, binding));
    assert.equal(decryptFactorSecret(stored, invalid, binding), null);
  }
});
test('rejects invalid binding shape and malformed secrets before encryption', async () => {
  const {encryptFactorSecret, decryptFactorSecret} = await crypto();
  const stored = encryptFactorSecret(secret, keys, binding);
  for (const invalid of [null, {...binding, accountId: 'other'}, {...binding, version: 0},
    {...binding, version: 1.5}, {...binding, purpose: 'other'}, {...pending, pendingId: undefined},
    {...binding, pendingId: pending.pendingId}, {...binding, extra: 'hidden'}]) {
    assert.throws(() => encryptFactorSecret(secret, keys, invalid));
    assert.equal(decryptFactorSecret(stored, keys, invalid), null);
  }
  for (const invalid of ['', '!!!', null]) assert.throws(() => encryptFactorSecret(invalid, keys, binding));
});
