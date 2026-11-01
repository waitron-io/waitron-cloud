import assert from 'node:assert/strict';
import {test} from 'node:test';

async function fixture(fault) {
  const {proveIntegrationRollback} = await import('./test-fixtures/integration-rollback.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof proveIntegrationRollback, 'function', 'Owned rollback proof is missing');
  const project = 'waitron-cloud-test-integration-12345678', image = 'sha256:' + 'a'.repeat(64);
  const ids = ['b'.repeat(64), 'c'.repeat(64)];
  const identity = {runtimeSha256: 'd'.repeat(64), caSha256: 'e'.repeat(64), schemaSha256: 'f'.repeat(64)};
  const calls = []; let stopped = false, restarted = false, reads = 0;
  const docker = async args => {
    calls.push(args);
    if (args[0] === 'ps') return ids.join('\n');
    if (args[0] === 'inspect') return JSON.stringify(ids.map((id, i) => ({Id: id,
      Image: fault === 'wrong-image' && i === 0 ? 'sha256:' + '0'.repeat(64) : image,
      Config: {Labels: {'com.docker.compose.project': fault === 'foreign-container' && i === 1 ? 'foreign' : project,
        'com.docker.compose.service': i === 0 ? 'account' : 'proxy'}},
      State: {Running: !stopped || restarted || fault === 'still-running', StartedAt: restarted && fault !== 'no-restart' ? '2026-11-01T01:00:01Z' : '2026-11-01T01:00:00Z'},
      Mounts: [{Type: 'volume', Name: restarted && fault === 'changed-volume' ? 'replacement' : project + '-config'}]})));
    if (args[0] === 'volume') return stopped && !restarted && fault === 'lost-stopped-volume' ? project + '-config' : project + '-config\n' + project + '-postgres';
    if (args[0] === 'stop') {stopped = true; return '';}
    throw Error('Unexpected Docker operation');
  };
  const compose = async args => {calls.push(args); restarted = true; return '';};
  const readIdentity = async () => ({...identity, ...(reads++ && fault?.startsWith('changed-') && ['changed-schema', 'changed-runtime', 'changed-ca'].includes(fault)
    ? {[{'changed-schema': 'schemaSha256', 'changed-runtime': 'runtimeSha256', 'changed-ca': 'caSha256'}[fault]]: '0'.repeat(64)} : {})});
  const probe = async () => {calls.push(['probe']); if (fault === 'unavailable') throw Error('unavailable');};
  return {run: () => proveIntegrationRollback({docker, compose, readIdentity, probe, project, image, account: ids[0]}), calls, ids, identity};
}

test('rollback stops exact owned IDs and preserves image, schema, private identity and volume bindings', async () => {
  const f = await fixture(); const result = await f.run();
  assert.deepEqual(f.calls.find(args => args[0] === 'stop'), ['stop', '--time', '15', ...f.ids]);
  assert.deepEqual(f.calls.find(args => args[0] === 'start'), ['start', 'account', 'proxy']);
  assert.deepEqual(result.before, result.after);
  assert.deepEqual(result.before.identity, f.identity);
  assert.equal(result.stoppedContainers, 2); assert.equal(result.restartedContainers, 2);
  assert.equal(result.ready, true); assert.equal(result.oldBinaryOnNewSchema, false);
});

for (const fault of ['foreign-container', 'wrong-image', 'still-running', 'changed-volume', 'lost-stopped-volume', 'no-restart', 'changed-schema', 'changed-runtime', 'changed-ca', 'unavailable']) {
  test('rollback refuses ' + fault, async () => {
    const f = await fixture(fault); await assert.rejects(f.run());
    if (['foreign-container', 'wrong-image'].includes(fault)) assert.equal(f.calls.some(args => args[0] === 'stop'), false);
  });
}

test('rollback requires new successful exchanges and unchanged local pairing identity', async () => {
  const {checkRollbackClient} = await import('./test-fixtures/integration-rollback.mjs');
  assert.equal(typeof checkRollbackClient, 'function', 'Post-rollback client evidence is missing');
  const before = {registration: {organisationId: 'one', installationId: 'two'}, identitySha256: 'a'.repeat(64), localVenueId: 'three'};
  const counts = {renewals: 3, configurations: 4}, fresh = {renewals: 5, configurations: 6};
  assert.equal(checkRollbackClient(before, structuredClone(before), counts, fresh), true);
  for (const key of ['registration', 'identitySha256', 'localVenueId']) {
    const after = structuredClone(before); after[key] = key === 'registration' ? {...before.registration, installationId: 'replacement'} : 'changed';
    assert.throws(() => checkRollbackClient(before, after, counts, fresh));
  }
  for (const key of ['renewals', 'configurations']) {
    assert.throws(() => checkRollbackClient(before, before, counts, {...fresh, [key]: counts[key]}));
  }
});
