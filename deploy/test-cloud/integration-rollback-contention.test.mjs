import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {renewIntegrationAfterRollback} from './test-fixtures/integration-renewal.mjs';

test('rollback waits for native lock contention before draining and completing its renewal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-rollback-contention-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'cloud-connection.json');
  const original = {action: 'configuration', operationId: 'original-operation'};
  const renewal = {action: 'renew', operationId: 'new-operation'};
  const state = {environment: 'test', lifecycle: {revoked: false, pending: original}};
  await writeFile(path, JSON.stringify(state), {mode: 0o600});
  let calls = 0;
  const result = await renewIntegrationAfterRollback(root, () => renewal, async () => {
    const current = JSON.parse(await readFile(path, 'utf8'));
    calls++;
    assert.deepEqual(current.lifecycle.pending, calls <= 3 ? original : renewal);
    if ([1, 2, 4].includes(calls)) throw Object.assign(Error('private native lock'), {code: 'cloud.busy'});
    delete current.lifecycle.pending;
    await writeFile(path, JSON.stringify(current));
  });
  assert.deepEqual(result, {renewed: true});
  assert.equal(calls, 5);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {environment: 'test', lifecycle: {revoked: false}});
});

test('a permanently busy native client refuses within the original control timeout without replacing pending work', {timeout: 10000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-rollback-stuck-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'cloud-connection.json'), saved = '{"lifecycle":{"pending":{"operationId":"keep-this"}}}';
  await writeFile(path, saved, {mode: 0o600});
  let calls = 0, queued = false, diagnostic;
  const started = performance.now();
  await assert.rejects(renewIntegrationAfterRollback(root, () => {queued = true;}, async () => {
    calls++;
    if (performance.now() - started > 4000) throw Error('The fixture exceeded its busy deadline');
    throw Object.assign(Error('private native lock'), {code: 'cloud.busy'});
  }, value => {diagnostic = value;}), {code: 'cloud.busy'});
  assert.ok(calls > 1, 'The native lock was not allowed to clear');
  assert.ok(performance.now() - started >= 2000, 'The bounded wait ended early');
  assert.equal(diagnostic, 'integration.rollback_refused:drain:cloud.busy');
  assert.equal(queued, false);
  assert.equal(await readFile(path, 'utf8'), saved);
});

for (const code of ['cloud.unavailable', 'cloud.binding_conflict', 'unexpected'])
test('rollback immediately preserves a non-busy native refusal: ' + code, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-rollback-native-refusal-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'cloud-connection.json'), saved = '{"lifecycle":{"pending":{"operationId":"keep-this"}}}';
  await writeFile(path, saved, {mode: 0o600});
  const failure = Object.assign(Error('private native refusal'), {code});
  let calls = 0, queued = false;
  await assert.rejects(renewIntegrationAfterRollback(root, () => {queued = true;}, async () => {
    calls++;
    throw failure;
  }), error => error === failure);
  assert.equal(calls, 1);
  assert.equal(queued, false);
  assert.equal(await readFile(path, 'utf8'), saved);
});
