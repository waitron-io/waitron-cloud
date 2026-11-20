import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { EmailOutbox } from '@waitron-cloud/registration';
import { Pool } from 'pg';
import { createAccountApp } from '../src/app.ts';
import { accountHttpConfig, validateConfig } from '../src/config.ts';

const env = {CLOUD_PORTAL_ORIGIN: 'https://cloud.example.test', CLOUD_HTTP_RATE_KEY: 'ab'.repeat(32)};
const publicKey = generateKeyPairSync('ed25519').publicKey.export({type: 'spki', format: 'der'}).toString('base64url');
const redirectUri = 'https://box.example.test/cloud/pairing/callback';

test('setup pairing keeps a single configured test key and exact HTTPS callback together', () => {
  assert.equal(accountHttpConfig(env).setupPairing, undefined);
  const input = {publicKey, redirectUri};
  const config = accountHttpConfig({...env, CLOUD_SETUP_PAIRING_PUBLIC_KEY: publicKey, CLOUD_SETUP_PAIRING_REDIRECT_URI: redirectUri});
  assert.deepEqual(config.setupPairing, input);
  const saved = validateConfig({...config, setupPairing: input});
  input.redirectUri = 'https://other.example.test/cloud/pairing/callback';
  assert.deepEqual(saved.setupPairing, {publicKey, redirectUri});
});

test('setup pairing refuses partial configuration, noncanonical keys and callbacks outside the exact path', () => {
  assert.throws(() => accountHttpConfig({...env, CLOUD_SETUP_PAIRING_PUBLIC_KEY: publicKey}), /Invalid account HTTP configuration/);
  assert.throws(() => accountHttpConfig({...env, CLOUD_SETUP_PAIRING_REDIRECT_URI: redirectUri}), /Invalid account HTTP configuration/);
  const base = accountHttpConfig(env);
  const otherKey = generateKeyPairSync('x25519').publicKey.export({type: 'spki', format: 'der'}).toString('base64url');
  for (const key of [otherKey, publicKey + '=', 'invalid']) {
    assert.throws(() => validateConfig({...base, setupPairing: {publicKey: key, redirectUri}}), /Invalid account HTTP configuration/);
  }
  for (const callback of [
    redirectUri.replace('https:', 'http:'), redirectUri + '/', redirectUri + '?next=1',
    redirectUri + '#return', redirectUri.replace('box.', 'user@box.'),
    redirectUri.replace('/cloud/', '/other/../cloud/'),
  ]) {
    assert.throws(() => validateConfig({...base, setupPairing: {publicKey, redirectUri: callback}}), /Invalid account HTTP configuration/);
  }
});

test('the account app allows setup pairing configuration only in test venue levels mode', async () => {
  const pool = new Pool();
  try {
    const outbox = new EmailOutbox({activeKeyId: 'test', keys: {test: 'ab'.repeat(32)}});
    const config = {...accountHttpConfig(env), setupPairing: {publicKey, redirectUri}};
    assert.throws(() => createAccountApp({pool, outbox, config}), /setup_pairing.test_mode_required/);
    assert.throws(() => createAccountApp({pool, outbox, config, planMode: 'test-free-paid'}), /setup_pairing.test_mode_required/);
    const app = createAccountApp({pool, outbox, config, planMode: 'test-venue-levels'});
    assert.equal((await app.request(config.portalOrigin + '/api/health/live')).status, 200);
  } finally {
    await pool.end();
  }
});
