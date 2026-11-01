import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

export function checkColdRollbackProject(rows, {project, image, account, expectedIds}) {
  assert.match(project, /^waitron-cloud-test-integration-[a-f0-9]{8}$/);
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  assert.ok(expectedIds.length > 0 && expectedIds.includes(account));
  assert.equal(new Set(expectedIds).size, expectedIds.length);
  assert.deepEqual(rows.map(row => row.Id).sort(), [...expectedIds].sort());
  for (const row of rows) {
    assert.match(row.Id, /^[a-f0-9]{64}$/);
    assert.equal(row.Config.Labels['com.docker.compose.project'], project);
    assert.equal(row.State.Running, false, 'integration.restore_requires_stopped_project');
  }
  assert.equal(rows.find(row => row.Id === account).Image, image);
  return true;
}

export async function proveIntegrationSchemaRollback({docker, compose, readIdentity, probe, project, image, account, own}) {
  const list = text => text.split(/\s+/).filter(Boolean);
  const ids = list(await docker(['ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project]));
  const rows = JSON.parse(await docker(['inspect', ...ids]));
  for (const row of rows) assert.equal(row.Config.Labels['com.docker.compose.project'], project);
  assert.equal(rows.find(row => row.Id === account)?.Image, image);
  const running = rows.filter(row => row.State.Running);
  assert.ok(running.some(row => row.Id === account));
  const postgres = running.find(row => row.Config.Labels['com.docker.compose.service'] === 'postgres');
  assert.ok(postgres);
  const services = running.map(row => row.Config.Labels['com.docker.compose.service']);
  assert.equal(new Set(services).size, services.length);
  for (const service of services) assert.match(service, /^[a-z][a-z0-9-]*$/);
  const volumes = Object.fromEntries(['config', 'postgres', 'storage', 'gateway'].map(role => [role, project + '_local-stack-' + role]));
  for (const name of Object.values(volumes)) {
    const [volume] = JSON.parse(await docker(['volume', 'inspect', name]));
    assert.equal(volume.Name, name); assert.equal(volume.Labels['com.docker.compose.project'], project);
    assert.ok(rows.some(row => row.Mounts.some(mount => mount.Type === 'volume' && mount.Name === name)));
  }
  const tools = [];
  const tool = async (script, action, {backup, change = false} = {}) => {
    const args = ['create', '--pull=never', '--label', 'com.docker.compose.project=' + project,
      '--network', script === 'integration-schema-change' ? project + '_default' : 'none',
      '--read-only', '--user', '0:0', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER',
      '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '256m', '--memory-swap', '256m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=16m,mode=1777'];
    for (const [role, name] of Object.entries(volumes)) args.push('--mount', 'type=volume,src=' + name + ',dst=/volumes/' + role + (change ? '' : ',readonly'));
    if (backup) args.push('--mount', 'type=volume,src=' + backup + ',dst=/backup');
    args.push('--entrypoint', 'node', image, 'deploy/test-cloud/test-fixtures/' + script + '.mjs', action);
    const id = await docker(args); assert.match(id, /^[a-f0-9]{64}$/); tools.push(id); own(id);
    return JSON.parse(await docker(['start', '--attach', id], '', 'matching-' + action));
  };
  const bindings = rows.map(row => ({id: row.Id, image: row.Image, mounts: row.Mounts.filter(mount => mount.Type === 'volume')
    .map(mount => ({name: mount.Name, destination: mount.Destination})).sort((a, b) => a.name.localeCompare(b.name))})).sort((a, b) => a.id.localeCompare(b.id));
  const identity = await readIdentity(), schema = await tool('integration-schema-change', 'inspect');
  assert.equal(schema.probe, false);
  const before = {project, image, identity, schema, bindings};
  const cold = async () => {
    const expectedIds = [...ids, ...tools];
    assert.deepEqual(list(await docker(['ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project])).sort(), [...expectedIds].sort());
    checkColdRollbackProject(JSON.parse(await docker(['inspect', ...expectedIds])), {project, image, account, expectedIds});
  };
  await docker(['stop', '--time', '15', ...running.map(row => row.Id)]);
  await cold();
  const backupVolume = await docker(['volume', 'create', '--label', 'com.docker.compose.project=' + project, project + '-rollback-backup']);
  assert.equal(backupVolume, project + '-rollback-backup');
  const backup = await tool('integration-volume-backup', 'capture', {backup: backupVolume});
  await cold();
  const startDatabase = async () => {
    await compose(['start', 'postgres']);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {await docker(['exec', postgres.Id, 'pg_isready', '-U', 'cloud', '-d', 'cloud']); ready = true; break;} catch {}
      await delay(100);
    }
    assert.equal(ready, true, 'integration.rollback_database_unavailable');
  };
  await startDatabase();
  const changed = await tool('integration-schema-change', 'change', {change: true});
  assert.deepEqual(changed.before, schema); assert.equal(changed.consumerRefused, true); assert.equal(changed.privateFilesChanged, true);
  await docker(['stop', '--time', '15', postgres.Id]);
  await cold();
  const restored = await tool('integration-volume-backup', 'restore', {backup: backupVolume, change: true});
  assert.deepEqual(restored, backup);
  await cold();
  await startDatabase();
  const restoredSchema = await tool('integration-schema-change', 'inspect');
  assert.deepEqual(restoredSchema, schema, 'integration.rollback_schema_changed');
  await compose(['start', ...services.filter(service => service !== 'postgres')]);
  await probe();
  const current = JSON.parse(await docker(['inspect', ...ids]));
  assert.ok(current.filter(row => running.some(value => value.Id === row.Id)).every(row => row.State.Running));
  const afterBindings = current.map(row => ({id: row.Id, image: row.Image, mounts: row.Mounts.filter(mount => mount.Type === 'volume')
    .map(mount => ({name: mount.Name, destination: mount.Destination})).sort((a, b) => a.name.localeCompare(b.name))})).sort((a, b) => a.id.localeCompare(b.id));
  const after = {project, image, identity: await readIdentity(), schema: restoredSchema, bindings: afterBindings};
  assert.deepEqual(after, before);
  return {kind: 'controlled-schema-change', shippingQualification: false, before, after, backup,
    changedSchema: changed.changed, consumerRefusedChangedSchema: true, privateFilesChanged: true,
    oldBinaryOnNewSchema: false, ready: true};
}
