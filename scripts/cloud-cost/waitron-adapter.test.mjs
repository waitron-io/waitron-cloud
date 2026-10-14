import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as adapter from './waitron-adapter.mjs';

const config = () => ({
  localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/fixture',
    smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:443' },
  senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' },
});
// An external host, inherited sender, or an unexpected setting must fail before loading Waitron.
test('externalEndpointAndSenderRefused', () => {
  assert.equal(typeof adapter.validateReplayConfig, 'function');
  assert.doesNotThrow(() => adapter.validateReplayConfig(config()));
  for (const key of Object.keys(config().localEndpoints)) for (const host of ['example.com', 'host.docker.internal', '169.254.169.254', '127.0.0.2', 's3.example.com']) {
    const c = config(); const url = new URL(c.localEndpoints[key]); url.hostname = host; c.localEndpoints[key] = url.href;
    assert.throws(() => adapter.validateReplayConfig(c), { message: 'Invalid cloud cost replay configuration' });
  }
  for (const key of Object.keys(config().senders)) {
    const c = config(); c.senders[key] = 'production';
    assert.throws(() => adapter.validateReplayConfig(c), /Invalid cloud cost replay configuration/);
  }
  for (const value of [null, {}, { ...config(), credentials: 'RAW_CANARY' }])
    assert.throws(() => adapter.validateReplayConfig(value), /Invalid cloud cost replay configuration/);
});
test('endpointQueryFragmentAndWrongProtocolRefused', () => {
  assert.equal(typeof adapter.validateReplayConfig, 'function');
  for (const value of ['https://s3:8333', 'http://s3:8333/?redirect=https://example.com', 'http://s3:8333/#RAW_CANARY', 'http://user:secret@s3:8333', 'http://127.1:8333']) {
    const c = config(); c.localEndpoints.s3 = value;
    assert.throws(() => adapter.validateReplayConfig(c), /Invalid cloud cost replay configuration/);
  }
});
test('missingPrivateConfigRefused', () => {
  assert.equal(typeof adapter.validateReplayConfig, 'function');
  for (const key of Object.keys(config().localEndpoints)) {
    const c = config(); delete c.localEndpoints[key];
    assert.throws(() => adapter.validateReplayConfig(c), /Invalid cloud cost replay configuration/);
  }
  for (const key of Object.keys(config().senders)) {
    const c = config(); delete c.senders[key];
    assert.throws(() => adapter.validateReplayConfig(c), /Invalid cloud cost replay configuration/);
  }
  const c = config(); Object.defineProperty(c.localEndpoints, 's3', { get() { throw Error('RAW_CANARY'); } });
  assert.throws(() => adapter.validateReplayConfig(c), e => e.message === 'Invalid cloud cost replay configuration' && !e.stack.includes('RAW_CANARY'));
});
