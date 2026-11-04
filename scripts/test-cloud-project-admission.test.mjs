import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const admission = new URL('../deploy/test-cloud/test-fixtures/integration-fixed-project.mjs', import.meta.url).href;
const deploy = new URL('./test-cloud-deploy.mjs', import.meta.url).pathname;
const runner = new URL('./test-cloud-integration.mjs', import.meta.url).href;

// A TMPDIR-specific lock lets another checkout's deploy CLI enter the same Docker project.
for (const contender of ['proof', 'deployment']) test('fixed project lock excludes another ' + contender + ' with a different TMPDIR', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-project-admission-'));
  try {
    for (const name of ['home', 'one', 'two', 'bin']) await mkdir(join(root, name));
    await writeFile(join(root, 'bin/docker'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.ADMISSION_CALLS,'docker\\n');process.exitCode=29;\n`, {mode: 0o700});
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {withFixedIntegrationProject} from ${JSON.stringify(admission)};
await withFixedIntegrationProject({docker:async()=>'',run:async()=>{
 const args=${contender === 'deployment' ? JSON.stringify([deploy, 'preflight', 'sha256:' + 'b'.repeat(64)]) : `['--input-type=module','-e',${JSON.stringify(`import {withFixedIntegrationProject} from ${JSON.stringify(admission)}; try {await withFixedIntegrationProject({docker:async()=>'',run:async()=>{console.log('WRONGLY ADMITTED');}});process.exitCode=42;} catch(e){if(e.code!=='EEXIST')throw e;}`)}]`};
 const result=spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,TMPDIR:${JSON.stringify(join(root, 'two'))}}});
 assert.equal(result.status,${contender === 'deployment' ? 1 : 0},result.stdout+result.stderr);
 assert.equal(result.stdout,'');
}});
// Successful release must admit the next proof rather than leaving a stale lock.
await withFixedIntegrationProject({docker:async()=>'',run:async()=>{}});
`], {encoding: 'utf8', timeout: 10000, env: {...process.env, HOME: join(root, 'home'), TMPDIR: join(root, 'one'),
      PATH: join(root, 'bin') + ':' + process.env.PATH, ADMISSION_CALLS: join(root, 'calls')}});
    assert.equal(child.status, 0, child.stderr);
    await assert.rejects(readFile(join(root, 'calls')), {code: 'ENOENT'}, 'A locked deployment must not inspect Docker');
  } finally {await rm(root, {recursive: true, force: true});}
});

for (const label of ['cloud.backup-verifier.owner', 'cloud.integration.owner']) {
  for (const kind of ['ps', 'network', 'volume']) test('admission refuses orphan ' + kind + ' marked ' + label, async () => {
    const {withFixedIntegrationProject} = await import(admission);
    const root = await mkdtemp(join(tmpdir(), 'cloud-orphan-admission-'));
    try {
      await assert.rejects(withFixedIntegrationProject({lock: join(root, 'lock'),
        docker: async args => args[0] === kind && args.includes('label=' + label) ? 'orphan' : '',
        run: () => assert.fail('The orphan must prevent admission')}), /integration.fixed_project_in_use/);
    } finally {await rm(root, {recursive: true, force: true});}
  });
}

for (const entry of ['runTestCloudFixedProject', 'runTestCloudFixedPairedExpiry']) test(entry + ' checks the Waitron source before admission or Docker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-entry-admission-'));
  try {
    await mkdir(join(root, 'bin')); await mkdir(join(root, 'scratch'));
    await writeFile(join(root, 'bin/docker'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.ADMISSION_CALLS,'docker\\n');\n`, {mode: 0o700});
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import {${entry}} from ${JSON.stringify(runner)};
await assert.rejects(${entry}({image:'sha256:'+'b'.repeat(64),waitronImage:'sha256:'+'c'.repeat(64),waitronCheckout:''}),/integration.waitron_checkout_required/);
`], {encoding: 'utf8', timeout: 10000, env: {...process.env, HOME: root, TMPDIR: join(root, 'scratch'),
      PATH: join(root, 'bin') + ':' + process.env.PATH, ADMISSION_CALLS: join(root, 'calls')}});
    assert.equal(child.status, 0, child.stderr);
    await assert.rejects(readFile(join(root, 'calls')), {code: 'ENOENT'}, 'Source refusal must precede Docker');
  } finally {await rm(root, {recursive: true, force: true});}
});
