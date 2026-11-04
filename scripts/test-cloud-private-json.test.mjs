import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

// Replacing the private parser with JSON.parse exposes malformed child output in the thrown error.
test('malformed image output yields a fixed error and removes scratch without echoing private bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-private-json-'));
  try {
    const bin = join(root, 'bin'), scratch = join(root, 'scratch');
    await mkdir(bin); await mkdir(scratch);
    await writeFile(join(bin, 'docker'), `#!${process.execPath}\nconst a=process.argv.slice(2);if(a[0]==='image'&&a[1]==='inspect')process.stdout.write('PRIVATE_CANARY_VALUE');else if(a[0]!=='ps')process.exitCode=39;\n`, {mode: 0o700});
    const runner = new URL('./test-cloud-integration.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';import {runTestCloudClients} from ${JSON.stringify(runner)};
await assert.rejects(runTestCloudClients({image:'sha256:'+'b'.repeat(64),waitronImage:'sha256:'+'c'.repeat(64)}),{message:'integration.invalid_json'});
`], {encoding: 'utf8', timeout: 10000, env: {...process.env, PATH: bin + ':' + process.env.PATH, TMPDIR: scratch}});
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout + result.stderr, '');
    assert.deepEqual(await readdir(scratch), []);
  } finally {await rm(root, {recursive: true, force: true});}
});
