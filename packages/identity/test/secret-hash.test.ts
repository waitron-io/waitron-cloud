import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scryptSync } from 'node:crypto';
import { hashSecret, verifySecret } from '../src/secret-hash.ts';

// Adapted from Waitron pre-sqlite-migration; see SOURCE.md for the source and changes.
test('accepts the correct secret and rejects the wrong secret', async () => {
  const hash = await hashSecret('venue-owner-password');
  assert.equal(await verifySecret('venue-owner-password', hash), true);
  assert.equal(await verifySecret('wrong-password', hash), false);
});
test('salts each hash and tags the algorithm', async () => {
  const first = await hashSecret('venue-owner-password');
  assert.notEqual(first, await hashSecret('venue-owner-password'));
  assert.ok(first.startsWith('scrypt$'));
});
test('rejects malformed hashes, unknown algorithms and wrong-length keys', async () => {
  for (const value of ['not-a-valid-hash', 'bcrypt$abcd$ef01', 'scrypt$abcd$ef01']) {
    assert.equal(await verifySecret('password', value), false);
  }
});
test('reads the source hash format and rejects partially valid hexadecimal', async () => {
  const salt = Buffer.alloc(16, 7);
  const key = scryptSync('source-password', salt, 32).toString('hex');
  const hash = `scrypt$${salt.toString('hex')}$${key}`;
  assert.equal(await verifySecret('source-password', hash), true);
  assert.equal(await verifySecret('source-password', `${hash}junk`), false);
  assert.equal(await verifySecret('source-password', `scrypt$${salt.toString('hex')}junk$${key}`), false);
});
