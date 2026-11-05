import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSuite } from './check.mjs';

const execute = promisify(execFile);

// A quota alone leaves the host's CPU mask visible to Go-based tools, which can
// exhaust the fixed process budget when more than one provider alias starts.
test('OpenTofu children inherit at most two usable CPU slots', async () => {
  const output = await runSuite('canary', { execute: async (file, args, options) => {
    if (args[0] === 'run' && args.at(-1) === '/candidate/run.py') {
      const observe = `import subprocess,runpy
original=subprocess.run
def observe(command,**options):
    original(['/usr/local/bin/python','-I','-c','import os; print("CHILD_CPU_SLOTS="+str(len(os.sched_getaffinity(0))),flush=True)'],**options)
    return original(command,**options)
subprocess.run=observe
runpy.run_path('/candidate/run.py',run_name='__main__')
`;
      args = [...args.slice(0, -3), 'python', '-I', '-c', observe];
    }
    return execute(file, args, options);
  } });
  const counts = output.split('\n').filter(line => line.startsWith('CHILD_CPU_SLOTS=')).map(line => Number(line.split('=')[1]));
  assert.equal(counts.length, 3);
  assert.ok(counts.every(count => Number.isInteger(count) && count > 0 && count <= 2), `child CPU slots: ${counts}`);
});

test('long mocked suites run every case in bounded fresh OpenTofu processes', async (t) => {
  const repo = await mkdtemp(join(tmpdir(), 'cloud-aws-scheduling-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const directory = join(repo, 'deploy/aws');
  await mkdir(join(directory, 'canary/tests'), { recursive: true });
  await execute('git', ['init', '--quiet', repo]);
  await writeFile(join(directory, 'canary/versions.tf'), await readFile(new URL('canary/versions.tf', import.meta.url)));
  await writeFile(join(directory, 'canary/main.tf'), 'data "aws_region" "current" {}\n');
  const cases = Array.from({ length: 9 }, (_, index) => `run "case${index}" {
  command = plan
  assert {
    condition = data.aws_region.current.region == "eu-south-2"
    error_message = "Every original case must execute"
  }
}\n`).join('');
  await writeFile(join(directory, 'canary/tests/canary.tftest.hcl'), `mock_provider "aws" {
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
}\n${cases}`);
  await execute('git', ['-C', repo, 'add', 'deploy/aws']);
  const observed = async (corruptSummary = false) => runSuite('canary', { directory, execute: async (file, args, options) => {
    if (args[0] === 'run' && args.at(-1) === '/candidate/run.py') {
      const observe = `import subprocess,runpy,hcl2,json
from pathlib import Path
original=subprocess.run
def observe(command,**options):
    if command[1]=='test':
        path=Path(options['cwd'])/command[2].split('=',1)[1]
        document=hcl2.loads(path.read_text())
        names=[json.loads(name) for entry in document['run'] for name in entry if name!='__is_block__']
        print('TOFU_RUN_GROUP='+json.dumps(names),flush=True)
    result=original(command,**options)
    if ${corruptSummary ? 'True' : 'False'} and command[1]=='test' and options.get('capture_output'):
        result.stdout='Success! 0 passed, 0 failed.'
    return result
subprocess.run=observe
runpy.run_path('/candidate/run.py',run_name='__main__')
`;
      args = [...args.slice(0, -3), 'python', '-I', '-c', observe];
    }
    return execute(file, args, options);
  } });
  const output = await observed();
  const groups = output.split('\n').filter(line => line.startsWith('TOFU_RUN_GROUP=')).map(line => JSON.parse(line.slice(15)));
  assert.ok(groups.length > 1 && groups.every(group => group.length <= 6), `run groups: ${JSON.stringify(groups)}`);
  assert.deepEqual(groups.flat(), ['case0', 'case1', 'case2', 'case3', 'case4', 'case5', 'case6', 'case7', 'case8']);
  await assert.rejects(observed(true), /did not execute every planned case/);
});
