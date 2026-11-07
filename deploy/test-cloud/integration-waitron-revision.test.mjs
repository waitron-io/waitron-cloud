import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';

const runner = new URL('../../scripts/test-cloud-integration.mjs', import.meta.url).href;
const run = (revision, checkout = '') => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import {runTestCloudClients} from ${JSON.stringify(runner)};
  try {await runTestCloudClients({image: 'sha256:'+'a'.repeat(64), waitronImage: 'sha256:'+'b'.repeat(64),
    sourceProvenance: true, waitronCheckout: ${JSON.stringify(checkout)}});}
  catch(error) {console.log(error.message);}
`], {encoding: 'utf8', env: {...process.env, TEST_CLOUD_INTEGRATION_WAITRON_REVISION: revision}});

// Ignoring the supplied revision must fail here before any Docker command can run.
test('uses the requested revision for checkout verification and retains the manifest check', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-waitron-revision-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  try {
    git('init', '-q');
    git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '--allow-empty', '-q', '-s', '-m', 'Empty test source');
    const result = run(git('rev-parse', 'HEAD'), root);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /waitron_source.count/);
    const mismatch = run('a'.repeat(40), root);
    assert.equal(mismatch.status, 0);
    assert.match(mismatch.stdout, /waitron_source.pin/);
  } finally {await rm(root, {recursive: true, force: true});}
});
for (const value of ['', 'main', '3ff92a10a5', '../outside']) test(`refuses invalid requested revision ${JSON.stringify(value)} before Docker`, () => {
  const result = run(value);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /integration.waitron_revision_invalid/);
});
