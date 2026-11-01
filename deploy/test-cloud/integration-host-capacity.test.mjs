import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import * as capacity from './test-fixtures/integration-capacity.mjs';

// Ignoring the selected filesystem or accepting absent host memory must refuse this proof.
test('host capacity measures the selected data filesystem and rejects unavailable measurements', async () => {
  assert.equal(typeof capacity.readHostCapacity, 'function', 'Host disk measurement is missing');
  const root = await mkdtemp(join(tmpdir(), 'cloud-host-capacity-'));
  const meminfo = join(root, 'meminfo');
  try {
    await writeFile(meminfo, 'MemTotal:       16777216 kB\nMemAvailable:    8388608 kB\n');
    const value = await capacity.readHostCapacity({meminfo, diskPath: root});
    assert.equal(value.availableMiB, 8192);
    assert.ok(Number.isFinite(value.freeGiB) && value.freeGiB > 0);
    await assert.rejects(capacity.readHostCapacity({meminfo, diskPath: join(root, 'absent')}), {code: 'ENOENT'});
    await assert.rejects(capacity.readHostCapacity({meminfo, diskPath: '.'}), /integration.capacity_disk_path/);
    for (const text of ['', 'MemAvailable: -1 kB\n', 'MemAvailable: NaN kB\n',
      'MemAvailable: 9999999999999999999999999999 kB\n', 'MemAvailable: 1 kB\nMemAvailable: 2 kB\n']) {
      await writeFile(meminfo, text);
      await assert.rejects(capacity.readHostCapacity({meminfo, diskPath: root}), /integration.capacity_host_memory/);
    }
    await writeFile(meminfo, 'MemAvailable: 0 kB\n');
    assert.equal((await capacity.readHostCapacity({meminfo, diskPath: root})).availableMiB, 0);
    await rm(meminfo);
    await assert.rejects(capacity.readHostCapacity({meminfo, diskPath: root}), {code: 'ENOENT'});
  } finally {await rm(root, {recursive: true, force: true});}
});
