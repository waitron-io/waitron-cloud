import assert from 'node:assert/strict';
import {mkdir, rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// A fixed namespace must be empty before admission; cleanup never adopts an existing resource.
export async function withFixedIntegrationProject({docker, run, lock = join(tmpdir(), 'waitron-cloud-test-integration.lock')}) {
  await mkdir(lock, {mode: 0o700});
  try {
    const project = 'waitron-cloud-test';
    const selectors = [
      ['ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project],
      ['ps', '-aq', '--no-trunc', '--filter', 'name=^waitron-cloud-test[-_]'],
      ...['network', 'volume'].flatMap(kind => [
        [kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project],
        [kind, 'ls', '-q', '--filter', 'name=^waitron-cloud-test[-_]'],
      ]),
      ...['venue', 'recovery'].map(kind => ['image', 'ls', '-q', '--filter', 'reference=' + project + '-' + kind + ':*']),
    ];
    for (const args of selectors) assert.equal((await docker(args)).trim(), '', 'integration.fixed_project_in_use');
    return await run(project);
  } finally {await rmdir(lock);}
}
