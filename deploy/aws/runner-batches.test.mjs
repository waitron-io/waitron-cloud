import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, access } from 'node:fs/promises';
import { runSuite } from './check.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

const image = `sha256:${'a'.repeat(64)}`;
const roots = ['roots/global', 'roots/country'];
const filters = ['integration', 'composition', 'edge', 'evidence', 'handoff'];

async function observe(failAt) {
  const batches = [], cleaned = [];
  let copy;
  const output = await runSuite('integration', { execute: async (file, args, options) => {
    assert.equal(file, 'docker');
    if (args[0] === 'image') return { stdout: JSON.stringify([{ Id: image }]) };
    if (args[0] === 'container') {
      cleaned.push(args[2]);
      throw Object.assign(new Error('absent'), { stderr: `No such container: ${args[2]}` });
    }
    assert.equal(args[0], 'run');
    const name = args[args.indexOf('--name') + 1];
    copy = args[args.indexOf('--mount') + 1].match(/source=([^,]+),/)[1];
    if (args.at(-1) !== '/candidate/run.py') return { stdout: 'inspected' };
    const plan = JSON.parse(await readFile(`${copy}/suite.json`, 'utf8'));
    const batch = await readFile(`${copy}/batch.json`, 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    batches.push({ name, batch, plan, timeout: options.timeout });
    if (batches.length === failAt) throw new Error('root assertion failed');
    await writeFile(`${copy}/suite.json`, '[]');
    return { stdout: `root-${batches.length}\n` };
  } }).then(value => ({ value }), error => ({ error }));
  await assert.rejects(access(copy), { code: 'ENOENT' });
  return { ...output, batches, cleaned };
}

// Combining both roots makes independent plans compete for one driver deadline.
test('integration executes both complete roots in separate bounded containers', async () => {
  const result = await observe();
  assert.ifError(result.error);
  assert.deepEqual(result.batches.map(batch => batch.batch), roots);
  assert.equal(new Set(result.batches.map(batch => batch.name)).size, 2);
  for (const batch of result.batches) {
    assert.equal(batch.timeout, 300_000);
    assert.deepEqual(batch.plan, filters.flatMap(name => roots.map(directory => ({ directory, filter: `tests/${name}.tftest.hcl` }))));
    assert.ok(result.cleaned.includes(batch.name), 'each submitted container is collected');
  }
  assert.equal(result.value, 'root-1\nroot-2\n');
});

test('a failed first root is collected and prevents the second root from starting', async () => {
  const result = await observe(1);
  assert.match(result.error?.message ?? '', /root assertion failed/);
  assert.deepEqual(result.batches.map(batch => batch.batch), ['roots/global']);
  assert.ok(result.cleaned.includes(result.batches[0].name));
});

test('a failed second root is collected and cannot report partial success', async () => {
  const result = await observe(2);
  assert.match(result.error?.message ?? '', /root assertion failed/);
  assert.deepEqual(result.batches.map(batch => batch.batch), roots);
  assert.equal(result.value, undefined);
  for (const batch of result.batches) assert.ok(result.cleaned.includes(batch.name));
});

test('the real offline Python driver runs only its assigned root and every fixed filter', async () => {
  const seen = [];
  await runSuite('integration', { execute: async (file, args, options) => {
    if (args.at(-1) === '/candidate/run.py') {
      const copy = args[args.indexOf('--mount') + 1].match(/source=([^,]+),/)[1];
      const root = JSON.parse(await readFile(`${copy}/batch.json`, 'utf8'));
      const probe = `import subprocess,runpy,json,hcl2
from pathlib import Path
def observe(command, **options):
 root=Path(options['cwd'])
 print('BATCH_COMMAND '+json.dumps([root.name,command]),flush=True)
 count=0
 if command[1]=='test':
  path=root / command[2].split('=',1)[1]
  count=len(hcl2.loads(path.read_text()).get('run',[]))
 return subprocess.CompletedProcess(command,0,stdout=f'Success! {count} passed, 0 failed.\\n',stderr='')
subprocess.run=observe
runpy.run_path('/candidate/run.py',run_name='__main__')
`;
      const result = await execute(file, [...args.slice(0, -3), 'python', '-I', '-c', probe], options);
      const calls = result.stdout.split('\n').filter(line => line.startsWith('BATCH_COMMAND ')).map(line => JSON.parse(line.slice(14)));
      assert.deepEqual([...new Set(calls.map(([directory]) => directory))], [root.split('/').at(-1)]);
      assert.deepEqual([...new Set(calls.filter(([, command]) => command[1] === 'test').map(([, command]) => command[2]))], filters.map(name => `-filter=tests/${name}.tftest.hcl`));
      seen.push(root);
      return result;
    }
    return execute(file, args, options);
  } });
  assert.deepEqual(seen, roots);
});

test('the real offline Python driver refuses an unknown batch root instead of empty success', async () => {
  await assert.rejects(runSuite('integration', { execute: async (file, args, options) => {
    if (args.at(-1) === '/candidate/run.py') {
      const copy = args[args.indexOf('--mount') + 1].match(/source=([^,]+),/)[1];
      await writeFile(`${copy}/batch.json`, JSON.stringify('roots/missing'));
    }
    return execute(file, args, options);
  } }), /No infrastructure entries for batch root/);
});
