import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readdir, readFile, writeFile, lstat, readlink, rm, mkdtemp} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const exec = promisify(execFile);
const roles = ['config', 'postgres', 'storage', 'gateway'];
const sha256 = /^[a-f0-9]{64}$/;
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest('hex');
}
async function contentHash(root) {
  const hash = createHash('sha256');
  async function visit(relative) {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const path = join(relative, name), info = await lstat(join(root, path));
      // Unix sockets are process endpoints; cold archives preserve their containing files instead.
      if (info.isSocket()) continue;
      assert.ok(info.isDirectory() || info.isFile() || info.isSymbolicLink(), 'integration.backup_file_type');
      hash.update(JSON.stringify([path, info.mode, info.uid, info.gid,
        info.isFile() ? await fileHash(join(root, path)) : info.isSymbolicLink() ? await readlink(join(root, path)) : null]));
      if (info.isDirectory()) await visit(path);
    }
  }
  await visit(''); return hash.digest('hex');
}
async function tar(args) {await exec('tar', args, {timeout: 60000, maxBuffer: 65536});}
function validateRoots(roots) {assert.deepEqual(Object.keys(roots), roles);}

export async function captureVolumeSet({roots, backupRoot}) {
  validateRoots(roots);
  await mkdir(backupRoot, {mode: 0o700});
  const volumes = [];
  for (const role of roles) {
    const archive = join(backupRoot, role + '.tar');
    await tar(['-cpf', archive, '-C', roots[role], '.']);
    volumes.push({role, archiveSha256: await fileHash(archive), contentSha256: await contentHash(roots[role]), bytes: (await lstat(archive)).size});
  }
  const manifest = {version: 1, volumes};
  await writeFile(join(backupRoot, 'manifest.json'), JSON.stringify(manifest), {mode: 0o600, flag: 'wx'});
  return manifest;
}

export async function restoreVolumeSet({roots, backupRoot}) {
  validateRoots(roots);
  const manifest = JSON.parse(await readFile(join(backupRoot, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['version', 'volumes']);
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.volumes.map(value => value.role), roles);
  const staging = await mkdtemp(join(backupRoot, 'verify-'));
  try {
    // Validate every archive and extracted file set before replacing the first private volume.
    for (const value of manifest.volumes) {
      assert.deepEqual(Object.keys(value).sort(), ['archiveSha256', 'bytes', 'contentSha256', 'role']);
      assert.match(value.archiveSha256, sha256); assert.match(value.contentSha256, sha256);
      const archive = join(backupRoot, value.role + '.tar'), target = join(staging, value.role);
      assert.equal((await lstat(archive)).size, value.bytes);
      assert.equal(await fileHash(archive), value.archiveSha256, 'integration.backup_archive_changed');
      await mkdir(target); await tar(['-xpf', archive, '-C', target]);
      assert.equal(await contentHash(target), value.contentSha256, 'integration.backup_contents_changed');
    }
    for (const value of manifest.volumes) {
      const target = roots[value.role];
      for (const name of await readdir(target)) await rm(join(target, name), {recursive: true, force: true});
      await tar(['-xpf', join(backupRoot, value.role + '.tar'), '-C', target]);
      assert.equal(await contentHash(target), value.contentSha256, 'integration.restore_contents_changed');
    }
    return manifest;
  } finally {await rm(staging, {recursive: true, force: true});}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.ok(['capture', 'restore'].includes(process.argv[2]));
    const options = {roots: Object.fromEntries(roles.map(role => [role, '/volumes/' + role])), backupRoot: '/backup/saved'};
    console.log(JSON.stringify(await (process.argv[2] === 'capture' ? captureVolumeSet(options) : restoreVolumeSet(options))));
  } catch {console.error('integration.matching_volume_backup_failed'); process.exitCode = 1;}
}
