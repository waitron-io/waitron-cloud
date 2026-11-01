import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as capacity from './test-fixtures/integration-capacity.mjs';

const snapshot = () => ({Id: 'a'.repeat(64), Image: 'sha256:' + 'f'.repeat(64),
  Config: {Labels: {'com.docker.compose.project': 'owned-project'}},
  State: {Running: true, OOMKilled: false, Pid: 100}});

// Rollback stops and restarts owned services; a vanished PID must be resolved against Docker's actual state.
test('capacity confirms an owned container stopped without OOM before accounting zero process memory', async () => {
  assert.equal(typeof capacity.readCapacityContainerMemory, 'function', 'Lifecycle observation is missing');
  const root = await mkdtemp(join(tmpdir(), 'cloud-capacity-lifecycle-'));
  try {
    const row = snapshot(), current = {...row, State: {Running: false, OOMKilled: false, Pid: 0}};
    const docker = async args => {assert.deepEqual(args, ['inspect', row.Id]); return JSON.stringify([current]);};
    const options = {docker, procRoot: root, cgroupRoot: root};
    await assert.rejects(capacity.readCapacityContainerMemory(row, options), {code: 'ENOENT'});
    assert.equal(await capacity.readCapacityContainerMemory(row, {...options, lifecycle: true}), undefined);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('capacity measures the new real cgroup after a confirmed same-container restart', async () => {
  assert.equal(typeof capacity.readCapacityContainerMemory, 'function', 'Lifecycle observation is missing');
  const root = await mkdtemp(join(tmpdir(), 'cloud-capacity-restart-'));
  try {
    await mkdir(join(root, 'proc/101'), {recursive: true}); await mkdir(join(root, 'cgroup/new-owned'), {recursive: true});
    await writeFile(join(root, 'proc/101/cgroup'), '0::/new-owned\n');
    await writeFile(join(root, 'cgroup/new-owned/memory.current'), '104857600\n');
    await writeFile(join(root, 'cgroup/new-owned/memory.stat'), 'shmem 1048576\n');
    const row = snapshot(), current = {...row, State: {...row.State, Pid: 101}};
    const options = {procRoot: join(root, 'proc'), cgroupRoot: join(root, 'cgroup'), lifecycle: true,
      docker: async args => {assert.deepEqual(args, ['inspect', row.Id]); return JSON.stringify([current]);}};
    assert.deepEqual(await capacity.readCapacityContainerMemory(row, options), {memoryMiB: 100, shmemMiB: 1});
    for (const fault of ['identity', 'image', 'owner', 'oom', 'same-pid', 'unavailable', 'malformed']) {
      const changed = structuredClone(current);
      if (fault === 'identity') changed.Id = 'b'.repeat(64);
      if (fault === 'image') changed.Image = 'sha256:' + '0'.repeat(64);
      if (fault === 'owner') changed.Config.Labels['com.docker.compose.project'] = 'foreign';
      if (fault === 'oom') changed.State = {Running: false, OOMKilled: true, Pid: 0};
      if (fault === 'same-pid') changed.State.Pid = 100;
      await assert.rejects(capacity.readCapacityContainerMemory(row, {...options, docker: async () => {
        if (fault === 'unavailable') throw Error('Docker unavailable');
        if (fault === 'same-pid') {
          await mkdir(join(root, 'proc/100'));
          await writeFile(join(root, 'proc/100/cgroup'), '0::/new-owned\n');
        }
        return JSON.stringify(fault === 'malformed' ? {} : [changed]);
      }}));
      await rm(join(root, 'proc/100'), {recursive: true, force: true});
    }
  } finally {await rm(root, {recursive: true, force: true});}
});

test('capacity keeps malformed existing cgroups refused even when lifecycle observation is enabled', async () => {
  assert.equal(typeof capacity.readCapacityContainerMemory, 'function', 'Lifecycle observation is missing');
  const root = await mkdtemp(join(tmpdir(), 'cloud-capacity-invalid-live-'));
  try {
    await mkdir(join(root, '100')); await writeFile(join(root, '100/cgroup'), 'not a cgroup\n');
    let inspected = 0;
    await assert.rejects(capacity.readCapacityContainerMemory(snapshot(), {lifecycle: true, procRoot: root,
      docker: async () => {inspected++; return JSON.stringify([{...snapshot(), State: {Running: false, OOMKilled: false, Pid: 0}}]);}}));
    assert.equal(inspected, 0, 'A malformed live cgroup cannot become a stopped-container reading');
  } finally {await rm(root, {recursive: true, force: true});}
});
