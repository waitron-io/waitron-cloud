import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const module = new URL('./kernel-lock.mjs', import.meta.url);
async function locking(t) {
  const root = mkdtempSync(join(tmpdir(), 'disposable-kernel-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  let api;
  try { api = await import(module); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  assert.equal(typeof api?.withKernelLock, 'function', 'Node must own the kernel lock across the complete turn');
  return {root, state: join(root, 'state'), withKernelLock: api.withKernelLock};
}

// Closing the parent's descriptor with the helper would allow concurrent work.
test('Node retains the real flock after its helper exits and excludes a competing process', async t => {
  const {state, withKernelLock} = await locking(t);
  const probe = `import {withKernelLock} from ${JSON.stringify(module.href)};
    const r=await withKernelLock(process.argv[1],async()=>({code:0}));process.exitCode=r.code;`;
  assert.equal((await withKernelLock(state, async () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe, state], {encoding:'utf8', timeout:5000});
    assert.equal(result.status, 75, result.stderr);
    return {code:3};
  }, {bootstrap:true})).code, 3);
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', probe, state], {encoding:'utf8', timeout:5000}).status, 0);
});

test('ordinary locking refuses missing state and never recreates a deleted lock', async t => {
  const {state, withKernelLock} = await locking(t);
  await assert.rejects(withKernelLock(state, async () => assert.fail('Missing state admitted')), /ENOENT|missing/i);
  assert.equal(existsSync(state), false);
  await withKernelLock(state, async () => ({code:0}), {bootstrap:true});
  rmSync(join(state, 'mac-controller.lock'));
  await assert.rejects(withKernelLock(state, async () => assert.fail('Missing lock admitted')), /ENOENT|missing/i);
  assert.equal(existsSync(join(state, 'mac-controller.lock')), false);
});

test('bootstrap refuses an existing state even when its lock has gone', async t => {
  const {state, withKernelLock} = await locking(t);
  await withKernelLock(state, async () => ({code:0}), {bootstrap:true});
  rmSync(join(state, 'mac-controller.lock'));
  await assert.rejects(withKernelLock(state, async () => assert.fail('Retired state reopened'), {bootstrap:true}), /EEXIST|existing/i);
  assert.equal(existsSync(join(state, 'mac-controller.lock')), false);
});
