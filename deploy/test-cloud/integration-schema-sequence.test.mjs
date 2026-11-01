import assert from 'node:assert/strict';
import {test} from 'node:test';
import {proveIntegrationSchemaRollback} from './test-fixtures/integration-schema-rollback.mjs';

function fixture(fault) {
  const project = 'waitron-cloud-test-integration-12345678', image = 'sha256:' + 'a'.repeat(64);
  const account = 'b'.repeat(64), postgres = 'c'.repeat(64);
  const volumes = ['config', 'postgres', 'storage', 'gateway'].map(role => project + '_local-stack-' + role);
  const rows = [account, postgres].map((id, i) => ({Id: id, Image: image,
    State: {Running: true}, Config: {Labels: {'com.docker.compose.project': project, 'com.docker.compose.service': i ? 'postgres' : 'account'}},
    Mounts: volumes.map((name, j) => ({Type: 'volume', Name: name, Destination: '/data/' + j}))}));
  const schema = {ledgerSha256: 'd'.repeat(64), migrations: 45, probe: false};
  const backup = {version: 1, volumes: ['config', 'postgres', 'storage', 'gateway'].map(role =>
    ({role, bytes: 10240, archiveSha256: 'e'.repeat(64), contentSha256: 'f'.repeat(64)}))};
  const events = [], tools = new Map(); let changed = false, restored = false, identities = 0;
  const docker = async args => {
    if (args[0] === 'ps') return rows.map(row => row.Id).join('\n');
    if (args[0] === 'inspect') return JSON.stringify(rows.filter(row => args.slice(1).includes(row.Id)));
    if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify([{Name: args[2], Labels: {'com.docker.compose.project': project}}]);
    if (args[0] === 'volume' && args[1] === 'create') return args.at(-1);
    if (args[0] === 'stop') {for (const row of rows) if (args.includes(row.Id)) row.State.Running = false; events.push('stop'); return '';}
    if (args[0] === 'exec') return '';
    if (args[0] === 'create') {
      const id = (rows.length + 10).toString(16).padStart(64, '0');
      tools.set(id, {script: args.at(-2), action: args.at(-1)});
      rows.push({Id: id, Image: image, State: {Running: false}, Config: {Labels: {'com.docker.compose.project': project}}, Mounts: []});
      return id;
    }
    if (args[0] === 'start') {
      const {script, action} = tools.get(args.at(-1)); events.push(action);
      if (script.endsWith('integration-schema-change.mjs')) {
        if (action === 'change') {
          changed = true;
          return JSON.stringify({before: schema, changed: {...schema, migrations: 46, probe: true},
            consumerRefused: fault !== 'consumer-accepted', privateFilesChanged: fault !== 'files-unchanged'});
        }
        return JSON.stringify((changed && !restored) || (restored && fault === 'wrong-schema') ? {...schema, migrations: 46, probe: true} : schema);
      }
      assert.ok(!rows.filter(row => [account, postgres].includes(row.Id)).some(row => row.State.Running));
      if (action === 'restore') {
        assert.equal(changed, true); restored = true;
        if (fault === 'wrong-backup') return JSON.stringify({...backup, version: 2});
        if (fault === 'changed-mount') rows[0].Mounts[0].Name = 'replacement';
      }
      return JSON.stringify(backup);
    }
    throw Error('Unexpected Docker operation');
  };
  const compose = async args => {
    for (const service of args.slice(1)) {
      events.push('start-' + service);
      const row = rows.find(row => row.Config.Labels['com.docker.compose.service'] === service);
      row.State.Running = fault !== 'account-stopped' || service !== 'account';
    }
  };
  const run = () => proveIntegrationSchemaRollback({docker, compose, project, image, account, own() {},
    readIdentity: async () => ({runtimeSha256: identities++ && fault === 'changed-identity' ? '0'.repeat(64) : '1'.repeat(64), caSha256: '2'.repeat(64), schemaSha256: '3'.repeat(64)}),
    probe: async () => {events.push('probe'); if (fault === 'unavailable') throw Error('unavailable');}});
  return {run, events};
}

test('schema rollback restores and checks its database before starting the account consumer', async () => {
  const f = fixture(), result = await f.run();
  assert.deepEqual(f.events, ['inspect', 'stop', 'capture', 'start-postgres', 'change', 'stop', 'restore', 'start-postgres', 'inspect', 'start-account', 'probe']);
  assert.deepEqual(result.before, result.after);
  assert.equal(result.consumerRefusedChangedSchema, true);
  assert.equal(result.shippingQualification, false);
});

for (const fault of ['consumer-accepted', 'files-unchanged', 'wrong-backup', 'wrong-schema', 'changed-mount', 'changed-identity', 'account-stopped', 'unavailable']) {
  test('matching rollback refuses ' + fault, async () => {
    const f = fixture(fault); await assert.rejects(f.run());
    if (['consumer-accepted', 'files-unchanged', 'wrong-backup', 'wrong-schema'].includes(fault)) assert.equal(f.events.includes('start-account'), false);
  });
}
