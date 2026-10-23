import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);

test('download fixture retains the process and last reached step when a child fails', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-download-events-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const code = `import importlib.util, os, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('events', sys.argv[1])
events = importlib.util.module_from_spec(spec); spec.loader.exec_module(events)
events.record(Path(sys.argv[2]), 'installer entered', attempt=2)
events.record(Path(sys.argv[2]), 'waiting for lock', attempt=2)
raise SystemExit(7)
`;
  await assert.rejects(execute('python3', ['-c', code, 'scripts/fixtures/ci_download_events.py', root]), error => {
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
