import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeCapacity} from './test-fixtures/integration-capacity.mjs';

// Cold rollback must measure every unique retained volume without one container start per volume.
test('one capacity reader measures all unique cold volumes and refuses incomplete or substituted results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-capacity-batch-'));
  const project = 'owned-project', id = 'a'.repeat(64); let calls = 0, fault;
  const names = ['owned-config', 'owned-database', 'owned-storage', 'owned-gateway'];
  const docker = async args => {
    if (args[0] === 'ps') return args.includes('label=com.docker.compose.project=' + project) ? id : '';
    if (args[0] === 'inspect') return JSON.stringify([{Id: id, State: {Running: false, OOMKilled: false},
      Config: {Labels: {'com.docker.compose.project': project}}, Mounts: names.flatMap((Name, i) =>
        [{Type: 'volume', Name, Destination: '/data/' + i}, {Type: 'volume', Name, Destination: '/duplicate/' + i}])}]);
    assert.equal(args[0], 'volume'); assert.equal(args[1], 'inspect'); assert.ok(names.includes(args[2]));
    return JSON.stringify([{Name: args[2], Labels: {'com.docker.compose.project': project}}]);
  };
  const measureVolumes = async values => {
    calls++; assert.deepEqual(values, names);
    const rows = [{name: names[0], bytes: 1024}, {name: names[1], bytes: 2048},
      {name: names[2], bytes: 4096}, {name: names[3], bytes: 8192}];
    if (fault === 'missing') rows.pop();
    if (fault === 'duplicate') rows[3].name = names[0];
    if (fault === 'foreign') rows[3].name = 'foreign';
    if (fault === 'nonfinite') rows[3].bytes = NaN;
    if (fault === 'negative') rows[3].bytes = -1;
    if (fault === 'extra-field') rows[0].extra = true;
    if (fault === 'shape') return {};
    return rows;
  };
  try {
    await writeFile(join(root, 'meminfo'), 'MemAvailable: 4194304 kB\n');
    const options = {docker, project, runId: 'owned-run', protectedUnchanged: async () => true,
      meminfo: join(root, 'meminfo'), diskPath: root, measureVolumes};
    const result = await observeCapacity(options);
    assert.equal(result.fixtureBytes, 15360); assert.equal(calls, 1);
    for (fault of ['missing', 'duplicate', 'foreign', 'nonfinite', 'negative', 'extra-field', 'shape']) await assert.rejects(observeCapacity(options));
  } finally {await rm(root, {recursive: true, force: true});}
});
