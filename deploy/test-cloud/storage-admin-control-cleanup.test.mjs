import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,symlink,readlink,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const helper = await import('./storage-admin-control-cleanup.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'cloud-admin-claims-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  return root;
}

// Omitting exact target ownership must delete a different control's private-fixture claim.
test('control cleanup releases only exact owned targets and preserves other claims and files', async t => {
  assert.equal(typeof helper.releaseStorageControlClaims,'function');
  const root = await fixture(t), directory = join(root,'claims'), owned = join(root,'owned'), peer = owned + '-peer';
  await mkdir(directory); await mkdir(owned); await mkdir(peer);
  await symlink(owned,join(directory,'own')); await symlink(peer,join(directory,'peer'));
  await writeFile(join(directory,'ordinary'),'keep this file');
  await helper.releaseStorageControlClaims(new Set([owned]),directory);
  await assert.rejects(readlink(join(directory,'own')),{code:'ENOENT'});
  assert.equal(await readlink(join(directory,'peer')),peer);
  assert.equal(await readFile(join(directory,'ordinary'),'utf8'),'keep this file');
  await access(owned); await access(peer);
  await helper.releaseStorageControlClaims(new Set([owned]),directory);
  assert.equal(await readlink(join(directory,'peer')),peer);
});

test('known control claims are released even when their scratch target is already absent', async t => {
  assert.equal(typeof helper.releaseStorageControlClaims,'function');
  const directory = await fixture(t), absent = join(directory,'gone');
  await symlink(absent,join(directory,'claim'));
  await helper.releaseStorageControlClaims(new Set([absent]),directory);
  await assert.rejects(readlink(join(directory,'claim')),{code:'ENOENT'});
});

test('a control cancelled before claim-directory creation has nothing to release', async t => {
  assert.equal(typeof helper.releaseStorageControlClaims,'function');
  const root = await fixture(t);
  await helper.releaseStorageControlClaims(new Set([join(root,'own')]),join(root,'absent'));
  await assert.rejects(access(join(root,'absent')),{code:'ENOENT'});
});

test('unexpected claim-directory failures are still reported without deleting the entry', async t => {
  assert.equal(typeof helper.releaseStorageControlClaims,'function');
  const root = await fixture(t), entry = join(root,'not-a-directory');
  await writeFile(entry,'keep this entry');
  await assert.rejects(helper.releaseStorageControlClaims(new Set([root]),entry),{code:'ENOTDIR'});
  assert.equal(await readFile(entry,'utf8'),'keep this entry');
});
