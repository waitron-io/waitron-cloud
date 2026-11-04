import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const runner = new URL('../../scripts/test-cloud-integration.mjs', import.meta.url).href;
const capacity = new URL('./test-fixtures/integration-capacity.mjs', import.meta.url).href;

// Without runner wiring, the owned preparation container is removed without any cleanup measurement.
for (const fault of ['healthy', 'refused']) test('runner measures ' + fault + ' cleanup and drains every owned removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-cleanup-monitoring-'));
  try {
    const bin = join(root, 'bin'), scratch = join(root, 'scratch'), calls = join(root, 'calls');
    await mkdir(bin); await mkdir(scratch); await mkdir(join(scratch, 'foreign'));
    await writeFile(join(scratch, 'foreign', 'keep'), 'another session owns this');
    await writeFile(join(bin, 'docker'), String.raw`#!${process.execPath}
const args=process.argv.slice(2),fs=require('node:fs');
fs.appendFileSync(process.env.MONITORING_CALLS,JSON.stringify(args)+'\n');
if(args[0]==='ps'&&args[1]==='-aq') {}
else if(args[0]==='info') process.stdout.write('/');
else if(args[0]==='image'&&args[1]==='inspect') {
 const prior=fs.readFileSync(process.env.MONITORING_CALLS,'utf8').trim().split('\n').map(JSON.parse);
 const build=prior.find(a=>a[0]==='build'),owner=build?.find(a=>a.startsWith('cloud.integration.owner='))?.split('=')[1];
 process.stdout.write(JSON.stringify([{Config:{Labels:{'cloud.waitron-revision':'ec91a9e34d2daba146f4ee61850ea4136ad5cfb7','cloud.integration.owner':owner}},RepoTags:['pin:local'],Id:'sha256:'+'c'.repeat(64)}]));
}
else if(args[0]==='build') {}
else if(args[0]==='compose'&&args.includes('config')) process.stdout.write(JSON.stringify({services:{account:{}},networks:{},volumes:{}}));
else if(args[0]==='compose') process.exitCode=31;
else if(args[0]==='rm') {}
else if(args[0]==='image'&&args[1]==='rm') setTimeout(()=>{},1100);
else if((args[0]==='network'||args[0]==='volume')&&args[1]==='ls') {}
else {process.exitCode=32;}
`, {mode: 0o700});
    const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', `
import assert from 'node:assert/strict';
import {mock} from 'node:test';
const actual=await import(${JSON.stringify(capacity)});
let cleanup=false,reads=0,clock=0;
mock.module(${JSON.stringify(capacity)}, {namedExports:{...actual,
 readHostCapacity:async()=>({availableMiB:5000,freeGiB:24}),
 observeCapacity:async()=>({availableMiB:5000,freeGiB:24,cloudMiB:cleanup&&${fault === 'refused'}?2049:100,
  verifierMiB:0,verifierCount:0,scratchMiB:0,fixtureBytes:0,oom:false,protectedUnchanged:true,verifierIds:[]}),
 measureStartupCapacity:options=>actual.measureStartupCapacity({...options,now:()=>clock,wait:async ms=>{clock+=ms;await new Promise(resolve=>setImmediate(resolve));}}),
 measureCleanupCapacity:async options=>{
  cleanup=true;
  try {return await actual.measureCleanupCapacity({...options,
   wait:async ms=>{clock+=ms;},observe:async()=>{reads++;return options.observe();}});}
  finally {assert.ok(reads>=${fault === 'refused' ? 1 : 3},'Cleanup must read resources');}
 }}});
const {runTestCloudClients}=await import(${JSON.stringify(runner)});
await assert.rejects(runTestCloudClients({image:'sha256:'+'b'.repeat(64),waitronImage:'sha256:'+'c'.repeat(64),measureCapacity:true}),
 ${fault === 'refused' ? '/integration.capacity_cloudMiB/' : '/integration.command_failed:compose-up/'});
assert.equal(cleanup,true,'Runner must monitor actual cleanup');
`], {encoding: 'utf8', timeout: 10000, env: {...process.env, NODE_NO_WARNINGS: '1',
      PATH: bin + ':' + process.env.PATH, TMPDIR: scratch, TMP: scratch, TEMP: scratch, MONITORING_CALLS: calls}});
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, ''); assert.equal(child.stderr, '');
    const observed = (await readFile(calls, 'utf8')).trim().split('\n').map(value => JSON.parse(value));
    assert.ok(observed.some(args => args[0] === 'image' && args[1] === 'rm'), 'Image cleanup must survive a measurement refusal');
    assert.deepEqual(await readdir(scratch), ['foreign']);
    assert.equal(await readFile(join(scratch, 'foreign', 'keep'), 'utf8'), 'another session owns this');
  } finally {await rm(root, {recursive: true, force: true});}
});
