import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as capacity from './test-fixtures/integration-capacity.mjs';

const container = 'a'.repeat(64), name = 'owned-data';
const volume = {container, path: '/state', running: true};

test('integration observation includes volumes retained by stopped project containers', async () => {
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'cloud-capacity-stopped-volume-'));
  const project = 'owned-project';
  const docker = async args => {
    if (args[0] === 'ps') return args.includes('label=com.docker.compose.project=' + project) ? container : '';
    if (args[0] === 'inspect') return JSON.stringify([{Id: container, State: {Running: false, OOMKilled: false},
      Config: {Labels: {'com.docker.compose.project': project}}, Mounts: [{Type: 'volume', Name: name, Destination: '/state'}]}]);
    assert.deepEqual(args, ['volume', 'inspect', name]);
    return JSON.stringify([{Name: name, Labels: {'com.docker.compose.project': project}}]);
  };
  try {
    await writeFile(join(root, 'meminfo'), 'MemAvailable: 4194304 kB\n');
    const value = await capacity.observeCapacity({docker, project, runId: 'owned-run',
      protectedUnchanged: async () => true, meminfo: join(root, 'meminfo'), diskPath: root,
      measureStoppedVolume: async id => {assert.equal(id, name); return '1024\t/capacity';}});
    assert.equal(value.fixtureBytes, 1048576); assert.equal(value.cloudMiB, 0);
  } finally {await rm(root, {recursive: true, force: true});}
});

// A source legitimately stops during recovery; its retained volume still contributes to fixture storage.
test('volume sampling measures retained bytes when a container stops before du starts', async () => {
  assert.equal(typeof capacity.readCapacityVolume, 'function', 'Stopped-volume measurement is missing');
  const failure = Error('container stopped'); let reads = 0;
  const docker = async args => {
    if (args[0] === 'exec') {assert.deepEqual(args, ['exec', container, 'du', '-sk', '--', '/state']); throw failure;}
    assert.deepEqual(args, ['inspect', container]);
    return JSON.stringify([{Id: container, State: {Running: false, OOMKilled: false},
      Mounts: [{Type: 'volume', Name: name, Destination: '/state'}]}]);
  };
  const measureStoppedVolume = async value => {assert.equal(value, name); reads++; return '2048\t/capacity';};
  assert.equal(await capacity.readCapacityVolume({docker, name, volume, measureStoppedVolume}), 2097152);
  assert.equal(reads, 1);
  await assert.rejects(capacity.readCapacityVolume({docker, name, volume}), error => error === failure);
});

test('an already stopped volume is measured without starting its original container', async () => {
  assert.equal(typeof capacity.readCapacityVolume, 'function', 'Stopped-volume measurement is missing');
  assert.equal(await capacity.readCapacityVolume({name, volume: {...volume, running: false},
    docker: async () => assert.fail('The stopped original must stay stopped'),
    measureStoppedVolume: async value => {assert.equal(value, name); return '1024\t/capacity';}}), 1048576);
});

test('volume sampling preserves running-container errors and refuses OOM, substituted mounts and malformed output', async () => {
  assert.equal(typeof capacity.readCapacityVolume, 'function', 'Stopped-volume measurement is missing');
  const failure = Error('exec refused');
  for (const fault of ['running', 'oom', 'identity', 'mount', 'unavailable', 'malformed']) {
    let fallbacks = 0;
    const docker = async args => {
      if (args[0] === 'exec') throw failure;
      if (fault === 'unavailable') throw Error('Docker unavailable');
      if (fault === 'malformed') return '{}';
      return JSON.stringify([{Id: fault === 'identity' ? 'b'.repeat(64) : container,
        State: {Running: fault === 'running', OOMKilled: fault === 'oom'},
        Mounts: [{Type: 'volume', Name: fault === 'mount' ? 'foreign' : name, Destination: '/state'}]}]);
    };
    await assert.rejects(capacity.readCapacityVolume({docker, name, volume,
      measureStoppedVolume: async () => {fallbacks++; return '1024\t/capacity';}}));
    assert.equal(fallbacks, 0, 'No fallback for ' + fault);
  }
  let fallbacks = 0;
  await assert.rejects(capacity.readCapacityVolume({docker: async () => 'not a size', name, volume,
    measureStoppedVolume: async () => {fallbacks++; return '1024\t/capacity';}}));
  assert.equal(fallbacks, 0, 'Malformed live output must refuse');
  await assert.rejects(capacity.readCapacityVolume({docker: async () => assert.fail('Already stopped'), name,
    volume: {...volume, running: false}, measureStoppedVolume: async () => 'not a size'}));
});
