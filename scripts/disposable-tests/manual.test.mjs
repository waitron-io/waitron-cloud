import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function controller(t) {
  const {withKernelLock}=await import('./kernel-lock.mjs');
  const {LocalLeases}=await import('./leases.mjs');
  const root=mkdtempSync(join(tmpdir(),'disposable-manual-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const directory=join(root,'state');
  await withKernelLock(directory,async()=>{new LocalLeases(join(directory,'ledger'),{hostGeneration:'test',slots:1,bootstrap:true});return {code:0};},{bootstrap:true});
  return {withKernelLock,directory,root};
}

// Without admission before packaging, a busy lane downloads dependencies and waits.
test('one manual invocation owns preparation and work while a competing lane returns75', async t => {
  const {withKernelLock, directory} = await controller(t);
  let finish, entered = false;
  const first = withKernelLock(directory, async () => {entered = true; return await new Promise(resolve => {finish = resolve;});});
  assert.equal(entered, true);
  const busy = await withKernelLock(directory, async () => assert.fail('Busy lane began packaging'));
  assert.equal(busy.code, 75);
  finish({code: 3});
  assert.equal((await first).code, 3);
  assert.equal((await withKernelLock(directory, async () => ({code: 0}))).code, 0);
});

test('an unsafe manual state directory cannot create a lock in another directory', async t => {
  const {withKernelLock, directory} = await controller(t);
  const outside = join(directory, 'outside');
  mkdirSync(outside);
  const link = join(directory, 'linked');
  symlinkSync(outside, link);
  await assert.rejects(withKernelLock(link, async () => assert.fail('Unsafe state admitted work')), /private|directory/i);
  assert.equal(existsSync(join(outside, 'manual.lock')), false);
});

test('the manual CLI refuses another repository before source preparation or ledger mutation', async t => {
  const {directory} = await controller(t);
  const {execFileSync, spawnSync} = await import('node:child_process');
  const {writeFileSync,readFileSync} = await import('node:fs');
  const approved = join(directory, 'approved');
  const foreign = join(directory, 'foreign');
  execFileSync('git', ['init', '-q', approved]);
  execFileSync('git', ['init', '-q', foreign]);
  const config = join(directory, 'config.json');
  const state = directory;
  const before=readFileSync(join(state,'ledger/state.json'),'utf8');
  writeFileSync(config, JSON.stringify({version: 2, mode: 'manual-one-slot', host: 'unreachable.invalid',
    hostGeneration: 'test', recipe: '/opt/waitron-disposable-test', repository: join(approved, '.git'), state}));
  const result = spawnSync(process.execPath, [new URL('./manual.mjs', import.meta.url).pathname, config, 'I', foreign, '--', 'node', '-e', 'process.exit(99)'], {encoding: 'utf8', timeout: 5000});
  assert.equal(result.status, 125);
  assert.match(result.stderr, /only the configured Cloud repository/);
  assert.equal(readFileSync(join(state,'ledger/state.json'),'utf8'),before);
});

test('a symlink CLI path cannot silently pass without invoking the manual controller', async t => {
  const {directory} = await controller(t);
  const {spawnSync} = await import('node:child_process');
  const alias = join(directory, 'manual-alias.mjs');
  symlinkSync(new URL('./manual.mjs', import.meta.url).pathname, alias);
  const result = spawnSync(process.execPath, [alias], {encoding: 'utf8', timeout: 5000});
  assert.equal(result.status, 125, 'The CLI must execute and refuse missing arguments through a symlink too');
  assert.match(result.stderr, /Usage: manual/);
});

test('importing the manual API from standard input does not invoke or reject the CLI', async t => {
  const {spawnSync}=await import('node:child_process');
  const result=spawnSync(process.execPath,['--input-type=module','-'],{
    input:`await import(${JSON.stringify(new URL('./manual.mjs',import.meta.url).href)});`,encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
});
