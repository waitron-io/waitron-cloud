import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);

test('download fixture retains the process and last reached step when a child fails', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-download-events-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const helper = join(root, 'ci_download_events.py');
  await writeFile(helper, await readFile('scripts/fixtures/ci_download_events.py'));
  const code = `import importlib.util, os, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('events', sys.argv[1])
events = importlib.util.module_from_spec(spec); spec.loader.exec_module(events)
events.record(Path(sys.argv[2]), 'installer entered', attempt=2)
events.record(Path(sys.argv[2]), 'waiting for lock', attempt=2)
raise SystemExit(7)
`;
  await assert.rejects(execute('python3', ['-B', '-c', code, helper, root]), error => {
    assert.equal(error.code, 7);
    return true;
  });
  const records = (await readFile(join(root, 'progress.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(({stage, attempt}) => ({stage, attempt})), [
    {stage: 'installer entered', attempt: 2}, {stage: 'waiting for lock', attempt: 2},
  ]);
  assert.ok(records.every(record => Number.isInteger(record.pid) && record.pid > 0));
  assert.equal(records[0].pid, records[1].pid);
  assert.ok(records[1].time >= records[0].time);
  await assert.rejects(access(join(root, '__pycache__')), {code: 'ENOENT'});
});

test('Linux diagnostic shell retains failure logs and fails when the probe fails', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-download-shell-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const workflow = await readFile('.github/workflows/download-supervision-diagnostic.yml', 'utf8');
  const shell = workflow.match(/        run: \|\n([\s\S]*?)(?=      - uses:)/)[1]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
  await writeFile(join(root, 'python3'), '#!/bin/sh\nprintf \'%s\\n\' \'{"cases":32,"failures":1}\'\nexit 7\n', {mode: 0o700});
  let code = 0;
  try { await execute('bash', ['-e', '-c', shell], {cwd: root, env: {...process.env, PATH: `${root}:${process.env.PATH}`}}); }
  catch (error) { code = error.code; }
  assert.equal(code, 7);
  assert.match(await readFile(join(root, 'diagnostics/native-linux.log'), 'utf8'), /"failures":1/);
});

test('Linux diagnostic retains a timed-out case output and reports every case', async () => {
  const workflow = await readFile('.github/workflows/download-supervision-diagnostic.yml', 'utf8');
  const program = workflow.match(/python3 -u - <<'PY' \| tee[^\n]+\n([\s\S]*?)          PY/)[1]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const probe = `import itertools, os, subprocess, sys
os.sched_getaffinity = lambda pid: {0}
os.sched_setaffinity = lambda *args: None
cases = itertools.count()
def run(command, **options):
    assert command[1:] == ['scripts/fixtures/ci-download-linux.py', 'scripts/ci-download.py', 'stale']
    if next(cases) == 0:
        raise subprocess.TimeoutExpired(command, 15, output=b'partial standard output\\n', stderr='last setup step\\n')
    return subprocess.CompletedProcess(command, 0, stdout='completed fixture\\n', stderr='')
subprocess.run = run
exec(compile(sys.argv[1], 'workflow', 'exec'))
`;
  let result;
  try { await execute('python3', ['-c', probe, program]); }
  catch (error) { result = error; }
  assert.equal(result?.code, 1);
  assert.match(result.stdout, /partial standard output/);
  assert.match(result.stdout, /last setup step/);
  assert.equal(result.stdout.split('\n').filter(line => line.startsWith('{"case":')).length, 32);
  assert.match(result.stdout, /"cases": 32, "failures": 1/);
});

test('fixture timeout diagnostics retain captured streams and the last child step', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-download-timeout-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const program = `import importlib.util, subprocess, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('events', sys.argv[1])
events = importlib.util.module_from_spec(spec); spec.loader.exec_module(events)
root = Path(sys.argv[2])
events.record(root, 'holder setup waiting', child=123)
error = subprocess.TimeoutExpired(['fixture'], 5, output=b'before timeout\\n', stderr='supervisor waiting\\n')
print(events.failure_details(root, error))
`;
  const result = await execute('python3', ['-B', '-c', program, 'scripts/fixtures/ci_download_events.py', root]);
  assert.match(result.stdout, /before timeout/);
  assert.match(result.stdout, /supervisor waiting/);
  assert.match(result.stdout, /holder setup waiting/);
  assert.match(result.stdout, /"child": 123/);
});
