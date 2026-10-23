import assert from 'node:assert/strict';
import {test} from 'node:test';
const api = await import('./remote-readiness.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
test('gateway readiness accepts either boolean availability but refuses bad status and shape', () => {
  assert.equal(typeof api.readinessReply, 'function', 'gateway readiness diagnostics are missing');
  for (const available of [true, false]) assert.deepEqual(api.readinessReply(200, JSON.stringify({available})), {ready: true, phase: 'ready'});
  assert.deepEqual(api.readinessReply(503, 'private response'), {ready: false, phase: 'http_status', status: 503});
  for (const body of ['private', '{}', '{"available":"true"}']) assert.deepEqual(api.readinessReply(200, body), {ready: false, phase: 'response_shape'});
});
test('gateway network diagnostics retain only fixed error codes', () => {
  assert.equal(typeof api.readinessError, 'function');
  assert.deepEqual(api.readinessError({code: 'ECONNREFUSED', message: 'private'}), {ready: false, phase: 'connection_refused'});
  assert.deepEqual(api.readinessError({code: 'ETIMEDOUT'}), {ready: false, phase: 'timeout'});
  assert.deepEqual(api.readinessError({code: 'DEPTH_ZERO_SELF_SIGNED_CERT'}), {ready: false, phase: 'tls_untrusted'});
  assert.deepEqual(api.readinessError({code: 'private', message: 'private'}), {ready: false, phase: 'transport'});
});
test('a readiness deadline reports the last safe phase without accepting a failed probe', async () => {
  assert.equal(typeof api.waitForGatewayReady, 'function');
  let now = 0;
  await assert.rejects(api.waitForGatewayReady(async () => api.readinessReply(503, 'private'), {
    now: () => now, wait: async () => {now += 1000;},
  }), {message: 'Generated local gateway readiness failed (phase=http_status, status=503)'});
  assert.equal(now, 30000);
});
test('command failures and untrusted diagnostic fields never escape the readiness failure', async () => {
  assert.equal(typeof api.waitForGatewayReady, 'function');
  for (const probe of [async () => {throw new Error('private key');}, async () => ({ready: false, phase: 'private key', status: 'private key'})]) {
    let now = 0;
    await assert.rejects(api.waitForGatewayReady(probe, {now: () => now, wait: async () => {now += 10000;}}),
      error => error.message.startsWith('Generated local gateway readiness failed (phase=') && !error.message.includes('private'));
  }
});
test('a transient refusal can become ready within the original deadline', async () => {
  assert.equal(typeof api.waitForGatewayReady, 'function');
  let now = 0;
  await api.waitForGatewayReady(async () => now < 100 ? api.readinessError({code: 'ECONNREFUSED'}) : api.readinessReply(200, '{"available":false}'), {
    now: () => now, wait: async ms => {now += ms;},
  });
  assert.equal(now, 100);
});
