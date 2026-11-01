import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function fixture(t) {
  const api = await import('./test-fixtures/integration-volume-backup.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof api.captureVolumeSet, 'function', 'Matching volume backup is missing');
  assert.equal(typeof api.restoreVolumeSet, 'function', 'Matching volume restore is missing');
  const root = await mkdtemp(join(tmpdir(), 'cloud-volume-backup-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const roots = Object.fromEntries(['config', 'postgres', 'storage', 'gateway'].map(role => [role, join(root, role)]));
  for (const [role, path] of Object.entries(roots)) {
    await mkdir(join(path, 'nested'), {recursive: true, mode: 0o700});
    await writeFile(join(path, 'nested', 'data'), role + ' original', {mode: 0o600});
  }
  return {...api, roots, backupRoot: join(root, 'backup')};
}

test('a cold backup restores every volume together, including file modes and removal of new files', async t => {
  const f = await fixture(t);
  const before = await f.captureVolumeSet(f);
  assert.deepEqual(before.volumes.map(value => value.role), ['config', 'postgres', 'storage', 'gateway']);
  assert.equal((await stat(f.backupRoot)).mode & 0o777, 0o700);
  for (const value of before.volumes) {
    assert.match(value.archiveSha256, /^[a-f0-9]{64}$/);
    assert.match(value.contentSha256, /^[a-f0-9]{64}$/);
    assert.ok(value.bytes > 0);
  }
  for (const path of Object.values(f.roots)) {
    await writeFile(join(path, 'nested', 'data'), 'changed');
    await writeFile(join(path, 'new-schema'), 'must disappear');
  }
  assert.deepEqual(await f.restoreVolumeSet(f), before);
  for (const [role, path] of Object.entries(f.roots)) {
    assert.equal(await readFile(join(path, 'nested', 'data'), 'utf8'), role + ' original');
    assert.equal((await stat(join(path, 'nested', 'data'))).mode & 0o777, 0o600);
    await assert.rejects(stat(join(path, 'new-schema')), {code: 'ENOENT'});
  }
});

for (const fault of ['corrupt-last-archive', 'missing-storage', 'changed-content-digest', 'changed-archive-digest', 'changed-archive-size']) {
  test('restore refuses ' + fault + ' before deleting any live volume data', async t => {
    const f = await fixture(t); await f.captureVolumeSet(f);
    for (const path of Object.values(f.roots)) await writeFile(join(path, 'nested', 'data'), 'newer live data');
    if (fault === 'corrupt-last-archive') await writeFile(join(f.backupRoot, 'gateway.tar'), 'corrupt');
    else {
      const path = join(f.backupRoot, 'manifest.json'), manifest = JSON.parse(await readFile(path, 'utf8'));
      if (fault === 'missing-storage') manifest.volumes = manifest.volumes.filter(value => value.role !== 'storage');
      else if (fault === 'changed-content-digest') manifest.volumes[0].contentSha256 = '0'.repeat(64);
      else if (fault === 'changed-archive-digest') manifest.volumes[0].archiveSha256 = '0'.repeat(64);
      else manifest.volumes[0].bytes += 1;
      await writeFile(path, JSON.stringify(manifest));
    }
    await assert.rejects(f.restoreVolumeSet(f));
    for (const path of Object.values(f.roots)) assert.equal(await readFile(join(path, 'nested', 'data'), 'utf8'), 'newer live data');
  });
}
