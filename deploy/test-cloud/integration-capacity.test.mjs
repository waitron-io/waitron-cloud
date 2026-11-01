import assert from 'node:assert/strict';
import {test} from 'node:test';

const load = () => import('./test-fixtures/integration-capacity.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const row = (elapsedMs, phase = 'settled') => ({elapsedMs, phase, availableMiB: 4096,
  cloudMiB: 900, verifierMiB: phase === 'verification' ? 300 : 0,
  scratchMiB: phase === 'verification' ? 128 : 0, verifierCount: phase === 'verification' ? 1 : 0,
  fixtureBytes: 10000000, oom: false, protectedUnchanged: true});
const samples = () => [...Array.from({length: 31}, (_, i) => row(i * 2000)), row(62000, 'verification')];

test('capacity requires sixty settled seconds and a measured active verifier', async () => {
  const {checkCapacitySamples} = await load();
  assert.equal(typeof checkCapacitySamples, 'function', 'Capacity evidence is missing');
  assert.equal(checkCapacitySamples(samples()), true);
  for (const changed of [samples().slice(1), samples().slice(0, -1), samples().map(value => ({...value, verifierCount: 0, verifierMiB: 0, scratchMiB: 0}))]) {
    assert.throws(() => checkCapacitySamples(changed));
  }
});
for (const [name, change] of Object.entries({
  'cloud memory': {cloudMiB: 2049}, 'verifier memory': {verifierMiB: 1025}, 'scratch memory': {scratchMiB: 257},
  'fixture data': {fixtureBytes: 1073741825}, 'multiple verifiers': {verifierCount: 2},
  'oom': {oom: true}, 'protected venue': {protectedUnchanged: false}, 'nonfinite memory': {cloudMiB: NaN},
  'missing verifier memory': {verifierCount: 1, verifierMiB: 0}, 'scratch without verifier': {verifierCount: 0, scratchMiB: 1},
})) test('capacity refuses ' + name, async () => {
  const {checkCapacitySamples} = await load();
  assert.equal(typeof checkCapacitySamples, 'function', 'Capacity evidence is missing');
  const values = samples(); Object.assign(values.at(-1), change);
  assert.throws(() => checkCapacitySamples(values));
});

test('capacity refuses a missed sample, reversed time or a detached settled window', async () => {
  const {checkCapacitySamples} = await load();
  assert.equal(typeof checkCapacitySamples, 'function', 'Capacity evidence is missing');
  for (const values of [samples().filter((_, i) => i < 2 || i > 5), samples().reverse(), samples().map((value, i) => i === 15 ? {...value, phase: 'verification'} : value)]) {
    assert.throws(() => checkCapacitySamples(values));
  }
});

test('capacity reads cgroup memory including tmpfs and refuses a path outside the host hierarchy', async () => {
  const {readContainerMemory} = await load();
  assert.equal(typeof readContainerMemory, 'function', 'Cgroup measurement is missing');
  const {mkdtemp, mkdir, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'cloud-capacity-cgroup-'));
  try {
    await mkdir(join(root, 'proc/123'), {recursive: true}); await mkdir(join(root, 'cgroup/docker-owned'), {recursive: true});
    await writeFile(join(root, 'proc/123/cgroup'), '0::/docker-owned\n');
    await writeFile(join(root, 'cgroup/docker-owned/memory.current'), '314572800\n');
    await writeFile(join(root, 'cgroup/docker-owned/memory.stat'), 'anon 180355072\nshmem 134217728\n');
    assert.deepEqual(await readContainerMemory(123, {procRoot: join(root, 'proc'), cgroupRoot: join(root, 'cgroup')}), {memoryMiB: 300, shmemMiB: 128});
    for (const path of ['../outside', '/../../outside', '/docker-owned\n0::/other']) {
      await writeFile(join(root, 'proc/123/cgroup'), '0::' + path + '\n');
      await assert.rejects(readContainerMemory(123, {procRoot: join(root, 'proc'), cgroupRoot: join(root, 'cgroup')}));
    }
  } finally {await rm(root, {recursive: true, force: true});}
});

test('capacity observes the entire settled minute and drains the verification operation on measurement failure', async () => {
  const {measureCapacityWindow} = await load();
  assert.equal(typeof measureCapacityWindow, 'function', 'Capacity observation is missing');
  let time = 0, verifying = false, drained = false, stopped = false, fail = false, finish;
  const options = {
    now: () => time,
    wait: async ms => {time += ms; if (verifying && time >= 65000) finish(); await Promise.resolve();},
    observe: async phase => {if (fail && phase === 'verification') throw Error('measurement refused'); return {...row(time, phase), verifierCount: verifying ? 1 : 0, verifierMiB: verifying ? 300 : 0, scratchMiB: verifying ? 128 : 0};},
    verify: async () => {assert.ok(time >= 60000); verifying = true; await new Promise(resolve => {finish = resolve;}); drained = true; return 'admitted';},
    stop: async () => {stopped = true; finish?.();},
  };
  const result = await measureCapacityWindow(options);
  assert.equal(result.value, 'admitted'); assert.equal(checkCapacity(result.samples), true);
  assert.equal(drained, true); assert.equal(stopped, false);
  fail = true; time = 0; verifying = false; drained = false;
  const fallback = setTimeout(() => finish?.(), 50);
  try {await assert.rejects(measureCapacityWindow(options), /measurement refused/);} finally {clearTimeout(fallback);}
  assert.equal(stopped, true); assert.equal(drained, true);
  function checkCapacity(values) {return values[0].elapsedMs === 0 && values.filter(v => v.phase === 'settled').at(-1).elapsedMs >= 60000 && values.some(v => v.phase === 'verification' && v.verifierCount === 1);}
});

test('capacity sums owned cgroups and counts each private data volume once', async () => {
  const {observeCapacity} = await load();
  assert.equal(typeof observeCapacity, 'function', 'Owned capacity measurement is missing');
  const {mkdtemp, mkdir, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'cloud-capacity-observer-'));
  const project = 'waitron-cloud-test-integration-12345678', runId = '12345678-1234-1234-1234-123456789abc';
  const image = 'sha256:' + 'f'.repeat(64), scope = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const cloud = 'a'.repeat(64), client = 'b'.repeat(64), child = 'c'.repeat(64);
  const volume = project + '-data'; let fault;
  const info = (id, pid, labels, mounts = []) => ({Id: id, Image: image, State: {Running: true, OOMKilled: fault === 'oom', Pid: pid}, Config: {Labels: labels}, Mounts: mounts});
  const rows = [info(cloud, 100, {'com.docker.compose.project': project}, [{Type: 'volume', Name: volume, Destination: '/data'}]),
    info(client, 101, {'cloud.integration.owner': runId}, [{Type: 'volume', Name: volume, Destination: '/state'}]),
    info(child, 102, {'cloud.backup-verifier.owner': 'waitron-cloud-test-backup', 'cloud.backup-verifier.scope': scope})];
  const docker = async args => {
    if (args[0] === 'ps') {
      if (args.includes('label=com.docker.compose.project=' + project)) return cloud;
      if (args.includes('label=cloud.integration.owner=' + runId)) return client;
      assert.ok(args.includes('label=cloud.backup-verifier.scope=' + scope)); return child;
    }
    if (args[0] === 'inspect') return JSON.stringify(args.slice(1).map(id => {
      const value = structuredClone(rows.find(row => row.Id === id)); value.State.OOMKilled = fault === 'oom';
      if (fault === 'child-image' && id === child) value.Image = 'sha256:' + '0'.repeat(64);
      if (fault === 'child-scope' && id === child) value.Config.Labels['cloud.backup-verifier.scope'] = 'foreign';
      if (fault === 'child-owner' && id === child) value.Config.Labels['cloud.backup-verifier.owner'] = 'foreign';
      if (fault === 'foreign' && id === cloud) value.Config.Labels['com.docker.compose.project'] = 'foreign';
      return value;
    }));
    if (args[0] === 'volume') {assert.deepEqual(args, ['volume', 'inspect', volume]); return JSON.stringify([{Name: volume, Labels: {'com.docker.compose.project': fault === 'foreign-volume' ? 'foreign' : project}}]);}
    assert.deepEqual(args, ['exec', cloud, 'du', '-sk', '--', '/data']); return '1024\t/data';
  };
  try {
    await writeFile(join(root, 'meminfo'), 'MemAvailable:     4194304 kB\n');
    for (let i = 0; i < 3; i++) {
      await mkdir(join(root, 'proc', String(100 + i)), {recursive: true}); await mkdir(join(root, 'cgroup', 'owned-' + i), {recursive: true});
      await writeFile(join(root, 'proc', String(100 + i), 'cgroup'), '0::/owned-' + i + '\n');
      await writeFile(join(root, 'cgroup', 'owned-' + i, 'memory.current'), String([104857600, 52428800, 314572800][i]));
      await writeFile(join(root, 'cgroup', 'owned-' + i, 'memory.stat'), 'shmem ' + (i === 2 ? 134217728 : 0) + '\n');
    }
    const options = {docker, project, runId, verifierScope: scope, waitronImage: image, protectedUnchanged: async () => true,
      procRoot: join(root, 'proc'), cgroupRoot: join(root, 'cgroup'), meminfo: join(root, 'meminfo')};
    const result = await observeCapacity(options);
    assert.equal(result.cloudMiB, 100); assert.equal(result.verifierMiB, 300); assert.equal(result.scratchMiB, 128);
    assert.equal(result.fixtureBytes, 1048576); assert.equal(result.availableMiB, 4096);
    assert.ok(Number.isFinite(result.freeGiB) && result.freeGiB > 0, 'The sampled Docker data filesystem must report available disk');
    assert.deepEqual(result.verifierIds, [child]); assert.equal(result.verifierCount, 1);
    for (fault of ['foreign', 'foreign-volume', 'child-image', 'child-scope', 'child-owner']) await assert.rejects(observeCapacity(options));
    fault = 'oom'; assert.equal((await observeCapacity(options)).oom, true);
  } finally {await rm(root, {recursive: true, force: true});}
});
