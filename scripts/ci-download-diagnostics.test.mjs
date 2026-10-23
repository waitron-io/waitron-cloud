import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
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
