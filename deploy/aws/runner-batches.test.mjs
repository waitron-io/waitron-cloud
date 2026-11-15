import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, access, cp, mkdtemp, mkdir, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSuite } from './check.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

const image = `sha256:${'a'.repeat(64)}`;
const roots = ['roots/global', 'roots/country'];
const filters = ['integration', 'composition', 'edge', 'evidence', 'handoff'];

async function observe(failAt, suite = 'integration') {
  const batches = [], cleaned = [];
  let copy;
  const output = await runSuite(suite, { execute: async (file, args, options) => {
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
  if (copy) await assert.rejects(access(copy), { code: 'ENOENT' });
  return { ...output, batches, cleaned };
}

for (const scope of ['global', 'country']) {
  test(`fixed ${scope} alias executes every filter in only its own bounded root`, async () => {
    const result = await observe(undefined, `integration-${scope}`);
    assert.ifError(result.error);
    assert.equal(result.batches.length, 1);
    const [batch] = result.batches;
    assert.equal(batch.batch, `roots/${scope}`);
    assert.equal(batch.timeout, 300_000);
    assert.deepEqual(batch.plan, filters.map(name => ({ directory: `roots/${scope}`, filter: `tests/${name}.tftest.hcl` })));
    assert.ok(result.cleaned.includes(batch.name));
    assert.equal(result.value, 'root-1\n');
  });

  test(`fixed ${scope} alias collects a failed root without reporting success`, async () => {
    const result = await observe(1, `integration-${scope}`);
    assert.match(result.error?.message ?? '', /root assertion failed/);
    assert.equal(result.batches.length, 1);
    assert.equal(result.batches[0].batch, `roots/${scope}`);
    assert.ok(result.cleaned.includes(result.batches[0].name));
    assert.equal(result.value, undefined);
  });
}

test('all CLI inventory executes the canonical 27 root and filter pairs without aliases', async t => {
  const repo = await mkdtemp(join(tmpdir(), 'cloud-aws-all-inventory-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const directory = join(repo, 'deploy/aws');
  await cp(new URL('.', import.meta.url), directory, {
    recursive: true,
    filter: path => !path.split('/').some(part => ['node_modules', '.terraform', '.aws'].includes(part)),
  });
  await execute('git', ['init', '--quiet', repo]);
  await execute('git', ['-C', repo, 'add', 'deploy/aws']);
  const bin = join(repo, 'bin'), trace = join(repo, 'calls.jsonl');
  await mkdir(bin);
  await writeFile(join(bin, 'docker'), `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'image' && args[1] === 'inspect') {
  console.log(JSON.stringify([{Id: '${image}'}]));
} else if (args[0] === 'container' && args[1] === 'inspect') {
  console.error('No such container: ' + args[2]); process.exitCode = 1;
} else if (args[0] === 'run' && args.includes('/candidate/inspect.py')) {
  console.log('inspected');
} else if (args[0] === 'run' && args.at(-1) === '/candidate/run.py') {
  const copy = args[args.indexOf('--mount') + 1].match(/source=([^,]+),/)[1];
  const plan = JSON.parse(readFileSync(copy + '/suite.json'));
  const batch = JSON.parse(readFileSync(copy + '/batch.json'));
  appendFileSync(${JSON.stringify(trace)}, JSON.stringify({plan, batch}) + '\\n');
  console.log('completed canonical allocation');
} else { throw new Error('Unexpected Docker operation: ' + JSON.stringify(args)); }
`);
  await chmod(join(bin, 'docker'), 0o755);
  await execute(process.execPath, [join(directory, 'check.mjs'), '--all'], {
    timeout: 15_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const calls = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
  const pairs = calls.flatMap(({ plan, batch }) => plan.filter(entry => batch === null || entry.directory === batch)
    .map(entry => `${entry.directory}/${entry.filter}`));
  const expected = [
    'canary/tests/canary.tftest.hcl',
    'modules/accounts/tests/accounts.tftest.hcl', 'roots/accounts/tests/accounts.tftest.hcl',
    'modules/state/tests/state.tftest.hcl', 'roots/state/tests/state.tftest.hcl',
    'modules/network/tests/network.tftest.hcl', 'modules/cell/tests/cell.tftest.hcl',
    'modules/database/tests/database.tftest.hcl', 'modules/storage/tests/storage.tftest.hcl',
    'modules/observability/tests/observability.tftest.hcl', 'modules/ingress/tests/ingress.tftest.hcl',
    'modules/custody/tests/custody.tftest.hcl', 'modules/workload-permissions/tests/custody.tftest.hcl',
    'modules/scope-permissions/tests/custody.tftest.hcl', 'fixtures/custody/tests/custody.tftest.hcl',
    'modules/dns/tests/dns.tftest.hcl', 'roots/delegation/tests/dns.tftest.hcl',
    'roots/global/tests/integration.tftest.hcl', 'roots/country/tests/integration.tftest.hcl',
    'roots/global/tests/composition.tftest.hcl', 'roots/country/tests/composition.tftest.hcl',
    'roots/global/tests/edge.tftest.hcl', 'roots/country/tests/edge.tftest.hcl',
    'roots/global/tests/evidence.tftest.hcl', 'roots/country/tests/evidence.tftest.hcl',
    'roots/global/tests/handoff.tftest.hcl', 'roots/country/tests/handoff.tftest.hcl',
  ];
  assert.deepEqual(pairs.sort(), expected.sort());
});

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
