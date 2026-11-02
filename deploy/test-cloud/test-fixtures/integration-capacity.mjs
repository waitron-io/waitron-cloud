import assert from 'node:assert/strict';
import {readFile, statfs} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';

export async function readHostCapacity({meminfo = '/proc/meminfo', diskPath = '/'} = {}) {
  assert.ok(isAbsolute(diskPath), 'integration.capacity_disk_path');
  const [mem, disk] = await Promise.all([readFile(meminfo, 'utf8'), statfs(diskPath, {bigint: true})]);
  const matches = [...mem.matchAll(/^MemAvailable:\s+(\d+) kB$/gm)];
  const availableKiB = matches.length === 1 ? Number(matches[0][1]) : NaN;
  assert.ok(Number.isSafeInteger(availableKiB) && availableKiB >= 0, 'integration.capacity_host_memory');
  assert.ok(disk.bavail >= 0n && disk.bsize > 0n, 'integration.capacity_host_disk');
  const freeGiB = Number(disk.bavail * disk.bsize) / 1073741824;
  assert.ok(Number.isFinite(freeGiB), 'integration.capacity_host_disk');
  return {availableMiB: availableKiB / 1024, freeGiB};
}

function checkCapacitySample(value) {
    for (const [key, max] of [['availableMiB', Number.MAX_SAFE_INTEGER], ['cloudMiB', 2048], ['verifierMiB', 1024], ['scratchMiB', 256], ['fixtureBytes', 1073741824]]) {
      assert.ok(Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= max, 'integration.capacity_' + key);
    }
    assert.ok(value.verifierCount === 0 || value.verifierCount === 1);
    if (value.verifierCount === 0) {assert.equal(value.verifierMiB, 0); assert.equal(value.scratchMiB, 0);}
    else assert.ok(value.verifierMiB > 0);
    assert.ok(value.scratchMiB <= value.verifierMiB);
    assert.equal(value.oom, false); assert.equal(value.protectedUnchanged, true);
}

export function createCapacityChronology({now = () => performance.now()} = {}) {
  const began = now(), samples = [];
  assert.ok(Number.isFinite(began), 'integration.chronology_clock');
  let tail = Promise.resolve(), pending = 0, failure;
  return {
    observe(phase, read) {
      pending++;
      const operation = tail.then(async () => {
        if (failure) throw failure;
        assert.ok(['startup', 'settled', 'verification', 'integration'].includes(phase), 'integration.chronology_phase');
        const startedMs = now() - began;
        assert.ok(Number.isFinite(startedMs) && startedMs >= (samples.at(-1)?.finishedMs ?? 0), 'integration.chronology_clock');
        const value = await read();
        const finishedMs = now() - began;
        assert.ok(Number.isFinite(finishedMs) && finishedMs >= startedMs, 'integration.chronology_clock');
        assert.deepEqual(Object.keys(value).sort(), ['availableMiB', 'freeGiB', 'cloudMiB', 'verifierMiB',
          'verifierCount', 'scratchMiB', 'fixtureBytes', 'oom', 'protectedUnchanged', 'verifierIds'].sort());
        checkCapacitySample(value);
        assert.ok(Number.isFinite(value.freeGiB) && value.freeGiB >= 0, 'integration.chronology_disk');
        assert.ok(Array.isArray(value.verifierIds) && value.verifierIds.length === value.verifierCount);
        for (const id of value.verifierIds) assert.match(id, /^[a-f0-9]{64}$/);
        samples.push({startedMs, finishedMs, phase, reading: structuredClone(value)});
        return value;
      }).finally(() => {pending--;});
      // One observation owns Docker/cgroup reads at a time; a refusal stays terminal.
      tail = operation.catch(error => {failure = error;});
      return operation;
    },
    snapshot() {
      assert.equal(pending, 0, 'integration.chronology_pending');
      if (failure) throw failure;
      return {clock: 'shared-monotonic', samples: structuredClone(samples)};
    },
  };
}

export function checkCapacitySamples(samples) {
  assert.ok(Array.isArray(samples) && samples.length > 1);
  let previous = -1, settledStart, settledEnd, settledClosed = false, active = false;
  for (const value of samples) {
    assert.ok(Number.isSafeInteger(value.elapsedMs) && value.elapsedMs >= 0 && value.elapsedMs > previous);
    assert.ok(value.elapsedMs - Math.max(0, previous) <= 5000, 'integration.capacity_sample_gap');
    previous = value.elapsedMs;
    assert.ok(['settled', 'verification'].includes(value.phase));
    if (value.phase === 'settled') {
      assert.equal(settledClosed, false);
      settledStart ??= value.elapsedMs; settledEnd = value.elapsedMs;
      assert.equal(value.verifierCount, 0);
    } else settledClosed = true;
    checkCapacitySample(value);
    if (value.verifierCount === 1) active = true;
  }
  assert.ok(settledEnd - settledStart >= 60000, 'integration.capacity_settled_window');
  assert.equal(active, true, 'integration.capacity_active_verifier_missing');
  return true;
}

// memory.current includes tmpfs; Docker's displayed working set subtracts cached pages.
export async function readContainerMemory(pid, {procRoot = '/proc', cgroupRoot = '/sys/fs/cgroup'} = {}) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const value = (await readFile(join(procRoot, String(pid), 'cgroup'), 'utf8')).trim();
  const match = /^0::(\/[A-Za-z0-9_.@/-]+)$/.exec(value);
  assert.ok(match && !match[1].split('/').includes('..'), 'integration.capacity_cgroup');
  const path = join(cgroupRoot, match[1]);
  const [current, stat] = await Promise.all([readFile(join(path, 'memory.current'), 'utf8'), readFile(join(path, 'memory.stat'), 'utf8')]);
  const memoryMiB = Number(current.trim()) / 1048576;
  const shmemMiB = Number(/^shmem (\d+)$/m.exec(stat)?.[1]) / 1048576;
  assert.ok(Number.isFinite(memoryMiB) && memoryMiB > 0 && Number.isFinite(shmemMiB) && shmemMiB >= 0 && shmemMiB <= memoryMiB);
  return {memoryMiB, shmemMiB};
}

export async function measureCapacityWindow({observe, verify, stop, now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const samples = [], start = now();
  const sample = async phase => {
    const elapsedMs = Math.round(now() - start);
    const value = {...await observe(phase), elapsedMs, phase};
    checkCapacitySample(value);
    if (samples.length) assert.ok(elapsedMs > samples.at(-1).elapsedMs && elapsedMs - samples.at(-1).elapsedMs <= 5000, 'integration.capacity_sample_gap');
    samples.push(value);
  };
  try {
    await sample('settled');
    while (samples.at(-1).elapsedMs < 60000) {await wait(2000); await sample('settled');}
  } catch (error) {await stop(); throw error;}
  let done = false, error, value;
  const operation = Promise.resolve().then(verify).then(result => {value = result;}, failure => {error = failure;}).finally(() => {done = true;});
  try {
    await wait(1);
    while (!done) {await sample('verification'); if (!done) await wait(1000);}
  } catch (failure) {
    try {await stop();} finally {await operation;}
    throw failure;
  }
  await operation;
  if (error) throw error;
  checkCapacitySamples(samples);
  return {samples, value};
}

export async function measureStartupCapacity({observe, start, stop, now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  return measureOperationCapacity({observe, run: start, stop, now, wait, phase: 'startup'});
}

export async function measureIntegrationCapacity(options) {
  return measureOperationCapacity({...options, phase: 'integration'});
}

async function measureOperationCapacity({observe, run, stop, phase, now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const samples = [], began = now();
  const sample = async () => {
    const elapsedMs = Math.round(now() - began);
    const value = {...await observe(), elapsedMs, phase};
    checkCapacitySample(value);
    assert.ok(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0);
    const previous = samples.at(-1)?.elapsedMs ?? -1;
    assert.ok(elapsedMs > previous && elapsedMs - Math.max(0, previous) <= 5000, 'integration.capacity_sample_gap');
    samples.push(value);
  };
  await sample();
  let done = false, error, value;
  const operation = Promise.resolve().then(run).then(result => {value = result;}, failure => {error = failure;}).finally(() => {done = true;});
  try {
    do {await wait(1000); await sample();} while (!done);
    if (!error) {await wait(1); await sample();}
  } catch (failure) {
    try {await stop();} finally {await operation;}
    throw failure;
  }
  await operation;
  if (error) throw error;
  return {samples, value};
}

export async function inspectCapacityVerifier(docker, id) {
  let raw;
  try {raw = await docker(['inspect', id], '', 'capacity-verifier-inspect');}
  catch (error) {
    // The controller removes completed children while the host samples them.
    if (await docker(['ps', '-aq', '--no-trunc', '--filter', 'id=' + id], '', 'capacity-verifier-presence')) throw error;
    return;
  }
  const rows = JSON.parse(raw);
  assert.ok(Array.isArray(rows) && rows.length === 1 && rows[0]?.Id === id, 'integration.capacity_verifier_identity');
  return rows[0];
}

export async function readCapacityVolume({docker, name, volume, measureStoppedVolume}) {
  let size;
  if (measureStoppedVolume && !volume.running) size = await measureStoppedVolume(name);
  else try {size = await docker(['exec', volume.container, 'du', '-sk', '--', volume.path]);}
  catch (error) {
    if (!measureStoppedVolume) throw error;
    const rows = JSON.parse(await docker(['inspect', volume.container]));
    assert.ok(Array.isArray(rows) && rows.length === 1 && rows[0]?.Id === volume.container);
    const [current] = rows;
    if (current.State.Running !== false || current.State.OOMKilled !== false) throw error;
    assert.ok(current.Mounts.some(value => value.Type === 'volume' && value.Name === name && value.Destination === volume.path));
    size = await measureStoppedVolume(name);
  }
  assert.match(size, /^\d+\s+[^\n]+$/);
  return Number(size.split(/\s+/)[0]) * 1024;
}

export async function readCapacityContainerMemory(row, {docker, lifecycle = false, procRoot, cgroupRoot}) {
  try {return await readContainerMemory(row.State.Pid, {procRoot, cgroupRoot});}
  catch (error) {
    if (!lifecycle || error.code !== 'ENOENT') throw error;
    const rows = JSON.parse(await docker(['inspect', row.Id], '', 'capacity-lifecycle-inspect'));
    assert.ok(Array.isArray(rows) && rows.length === 1 && rows[0]?.Id === row.Id);
    const [current] = rows;
    assert.equal(current.Image, row.Image);
    assert.deepEqual(current.Config.Labels, row.Config.Labels);
    assert.equal(current.State.OOMKilled, false);
    if (current.State.Running === false) return;
    assert.equal(current.State.Running, true);
    assert.notEqual(current.State.Pid, row.State.Pid);
    return readContainerMemory(current.State.Pid, {procRoot, cgroupRoot});
  }
}

export function parseCapacityVolumeReadings(names, text) {
  const lines = text.split('\n');
  assert.equal(lines.length, names.length);
  return lines.map((line, i) => {
    const match = /^(\d+)\s+(\/capacity\/\d+)$/.exec(line);
    assert.ok(match && match[2] === '/capacity/' + i);
    const bytes = Number(match[1]) * 1024;
    assert.ok(Number.isSafeInteger(bytes) && bytes >= 0);
    return {name: names[i], bytes};
  });
}

export async function observeCapacity({docker, project, runId, verifierScope, waitronImage, workerId,
  protectedUnchanged, startup = false, measureStoppedVolume, measureVolumes, procRoot = '/proc', cgroupRoot = '/sys/fs/cgroup', meminfo = '/proc/meminfo', diskPath = '/'}) {
  const ids = text => text.split(/\s+/).filter(Boolean);
  const list = filter => docker(['ps', '-aq', '--no-trunc', '--filter', filter]).then(ids);
  const inspect = async (values, phase = 'capacity-cloud-inspect') => values.length ? JSON.parse(await docker(['inspect', ...values], '', phase)) : [];
  const cloud = await inspect(await list('label=com.docker.compose.project=' + project));
  if (!startup) assert.ok(cloud.length > 0);
  for (const row of cloud) assert.equal(row.Config.Labels['com.docker.compose.project'], project);
  const clients = await inspect(await list('label=cloud.integration.owner=' + runId), 'capacity-clients-inspect');
  for (const row of clients) assert.equal(row.Config.Labels['cloud.integration.owner'], runId);
  if (workerId && !cloud.some(row => row.Id === workerId)) {
    const [worker] = await inspect([workerId]);
    assert.equal(worker.Config.Labels['com.docker.compose.project'], project); cloud.push(worker);
  }
  const children = [];
  if (verifierScope) for (const id of await list('label=cloud.backup-verifier.scope=' + verifierScope)) {
    const child = await inspectCapacityVerifier(docker, id);
    if (child) children.push(child);
  }
  for (const row of children) {
    assert.equal(row.Image, waitronImage);
    assert.equal(row.Config.Labels['cloud.backup-verifier.owner'], 'waitron-cloud-test-backup');
    assert.equal(row.Config.Labels['cloud.backup-verifier.scope'], verifierScope);
  }
  let cloudMiB = 0, verifierMiB = 0, scratchMiB = 0;
  const verifierIds = [];
  for (const [rows, verifier] of [[cloud, false], [children, true]]) for (const row of rows.filter(row => row.State.Running)) {
    let memory;
    try {memory = verifier ? await readContainerMemory(row.State.Pid, {procRoot, cgroupRoot}) :
      await readCapacityContainerMemory(row, {docker, procRoot, cgroupRoot, lifecycle: Boolean(measureStoppedVolume || measureVolumes)});}
    catch (error) {
      // A completed child can disappear between its inspect and cgroup read.
      if (verifier && error.code === 'ENOENT' && !(await list('id=' + row.Id)).length) continue;
      throw error;
    }
    if (!memory) continue;
    if (verifier) {verifierMiB += memory.memoryMiB; scratchMiB += memory.shmemMiB; verifierIds.push(row.Id);}
    else cloudMiB += memory.memoryMiB;
  }
  const volumes = new Map();
  for (const row of [...cloud, ...clients].filter(row => row.State.Running || measureStoppedVolume || measureVolumes)) for (const mount of row.Mounts.filter(value => value.Type === 'volume')) {
    if (!volumes.has(mount.Name) || row.State.Running && !volumes.get(mount.Name).running) {
      volumes.set(mount.Name, {container: row.Id, path: mount.Destination, running: row.State.Running});
    }
  }
  let fixtureBytes = 0;
  for (const [name, volume] of volumes) {
    const [info] = JSON.parse(await docker(['volume', 'inspect', name]));
    assert.equal(info.Name, name); assert.equal(info.Labels['com.docker.compose.project'], project);
    if (!measureVolumes) fixtureBytes += await readCapacityVolume({docker, name, volume, measureStoppedVolume});
  }
  if (measureVolumes && volumes.size) {
    const names = [...volumes.keys()], readings = await measureVolumes(names);
    assert.ok(Array.isArray(readings) && readings.length === names.length);
    for (const [i, value] of readings.entries()) {
      assert.deepEqual(Object.keys(value).sort(), ['bytes', 'name']);
      assert.equal(value.name, names[i]);
      assert.ok(Number.isSafeInteger(value.bytes) && value.bytes >= 0);
      fixtureBytes += value.bytes;
    }
  }
  const host = await readHostCapacity({meminfo, diskPath});
  return {cloudMiB, verifierMiB, scratchMiB, fixtureBytes, verifierIds, verifierCount: verifierIds.length,
    ...host,
    oom: [...cloud, ...clients, ...children].some(row => row.State.OOMKilled), protectedUnchanged: await protectedUnchanged()};
}
