import assert from 'node:assert/strict';

export function checkRollbackClient(before, after, previous, current) {
  assert.deepEqual(after.registration, before.registration);
  assert.equal(after.identitySha256, before.identitySha256);
  assert.equal(after.localVenueId, before.localVenueId);
  for (const key of ['renewals', 'configurations']) assert.ok(current[key] > previous[key], 'integration.rollback_exchange_missing:' + key);
  return true;
}

// Same-image rollback preserves the private volumes; schema upgrades need a separate matching-set restore.
export async function proveIntegrationRollback({docker, compose, readIdentity, probe, project, image, account}) {
  assert.match(project, /^waitron-cloud-test-integration-[a-f0-9]{8}$/);
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const ids = (await docker(['ps', '-q', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project])).split(/\s+/).filter(Boolean);
  assert.ok(ids.length > 0 && ids.includes(account));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-f0-9]{64}$/);
  const inspect = async () => {
    const rows = JSON.parse(await docker(['inspect', ...ids]));
    assert.deepEqual(rows.map(row => row.Id).sort(), [...ids].sort());
    for (const row of rows) assert.equal(row.Config.Labels['com.docker.compose.project'], project);
    return rows.sort((a, b) => a.Id.localeCompare(b.Id));
  };
  const rows = await inspect();
  assert.equal(rows.find(row => row.Id === account).Image, image);
  assert.ok(rows.every(row => row.State.Running));
  const services = rows.map(row => row.Config.Labels['com.docker.compose.service']);
  assert.equal(new Set(services).size, services.length);
  for (const service of services) assert.match(service, /^[a-z][a-z0-9-]*$/);
  const observe = async current => {
    const identity = await readIdentity();
    assert.deepEqual(Object.keys(identity).sort(), ['caSha256', 'runtimeSha256', 'schemaSha256']);
    for (const value of Object.values(identity)) assert.match(value, /^[a-f0-9]{64}$/);
    const volumes = (await docker(['volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project])).split(/\s+/).filter(Boolean).sort();
    assert.ok(volumes.length >= 2);
    return {project, image, identity, volumes, containers: current.map(row => ({id: row.Id, image: row.Image,
      mounts: row.Mounts.filter(value => value.Type === 'volume').map(value => ({name: value.Name, destination: value.Destination ?? ''})).sort((a, b) => a.name.localeCompare(b.name))}))};
  };
  const before = await observe(rows);
  await docker(['stop', '--time', '15', ...ids]);
  assert.ok((await inspect()).every(row => !row.State.Running), 'integration.rollback_not_stopped');
  assert.deepEqual((await docker(['volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project])).split(/\s+/).filter(Boolean).sort(), before.volumes);
  await compose(['start', ...services]);
  const restarted = await inspect();
  assert.ok(restarted.every((row, i) => row.State.Running && Date.parse(row.State.StartedAt) > Date.parse(rows[i].State.StartedAt)), 'integration.rollback_not_restarted');
  await probe();
  const after = await observe(restarted);
  assert.deepEqual(after, before, 'integration.rollback_identity_changed');
  return {before, after, stoppedContainers: ids.length, restartedContainers: ids.length, ready: true, oldBinaryOnNewSchema: false};
}
