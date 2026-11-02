import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const runner = new URL('../../scripts/test-cloud-integration.mjs', import.meta.url).href;
const capacity = new URL('./test-fixtures/integration-capacity.mjs', import.meta.url).href;

// Moving preparation outside the sampler exposes the later image refusal instead of the resource refusal.
for (const scenario of ['initial', 'during-preparation']) test('runner refuses ' + scenario + ' measurement without starting Cloud and removes owned scratch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-preparation-monitoring-'));
  try {
    const bin = join(root, 'bin'), scratch = join(root, 'scratch'), calls = join(root, 'calls');
    await mkdir(bin); await mkdir(scratch); await mkdir(join(scratch, 'foreign'));
    await writeFile(join(scratch, 'foreign', 'keep'), 'another session owns this');
    await writeFile(join(bin, 'docker'), String.raw`#!${process.execPath}
const args=process.argv.slice(2),fs=require('node:fs');
if(JSON.stringify(args)===JSON.stringify(['ps','-aq','--no-trunc'])) {}
else if(JSON.stringify(args)===JSON.stringify(['info','--format','{{.DockerRootDir}}'])) process.stdout.write('/');
else if(args[0]==='image'&&args[1]==='inspect') {
 fs.appendFileSync(process.env.MONITORING_CALLS,'image\n');
 setTimeout(()=>process.stdout.write('[{"Config":{"Labels":{}}}]'),1600);
} else {fs.appendFileSync(process.env.MONITORING_CALLS,'unexpected '+args[0]+'\n');process.exitCode=31;}
`, {mode: 0o700});
    const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', `
import assert from 'node:assert/strict';
import {mock} from 'node:test';
const actual=await import(${JSON.stringify(capacity)});
let readings=0;
// Substitute only host/Docker measurement; the real sampler, runner, subprocesses and cleanup execute.
mock.module(${JSON.stringify(capacity)}, {namedExports:{...actual,
 readHostCapacity:async()=>({availableMiB:5000,freeGiB:24}),
 observeCapacity:async()=>({availableMiB:5000,freeGiB:24,cloudMiB:++readings>=${scenario === 'initial' ? 1 : 2}?2049:0,
  verifierMiB:0,verifierCount:0,scratchMiB:0,fixtureBytes:0,oom:false,protectedUnchanged:true,verifierIds:[]})}});
const {runTestCloudClients}=await import(${JSON.stringify(runner)});
await assert.rejects(runTestCloudClients({image:'sha256:'+'b'.repeat(64),waitronImage:'sha256:'+'c'.repeat(64),measureCapacity:true}),
 /integration.capacity_cloudMiB/);
`], {encoding: 'utf8', timeout: 10000, env: {...process.env, NODE_NO_WARNINGS: '1',
      PATH: bin + ':' + process.env.PATH, TMPDIR: scratch, TMP: scratch, TEMP: scratch, MONITORING_CALLS: calls}});
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, ''); assert.equal(child.stderr, '');
    const observed = await readFile(calls, 'utf8').catch(error => {if (error.code === 'ENOENT') return ''; throw error;});
    assert.equal(observed, scenario === 'initial' ? '' : 'image\n', 'Only in-flight preparation may run; Compose must never start');
    assert.deepEqual(await readdir(scratch), ['foreign']);
    assert.equal(await readFile(join(scratch, 'foreign', 'keep'), 'utf8'), 'another session owns this');
  } finally {await rm(root, {recursive: true, force: true});}
});
