import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const name='an exhausted allowance refuses another operation';
async function harness(){
 const api=await import('./allowance-traffic-guard-probes.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
 assert.equal(typeof api.qualifyAllowanceGuard,'function','allowance qualification must execute its baseline fault and restored behavior');
 return api.qualifyAllowanceGuard;
}
async function fixture(t,body='assert.equal(admitted(),false);'){
 const candidate=await mkdtemp(join(tmpdir(),'allowance-guard-control-'));
 t.after(()=>rm(candidate,{recursive:true,force:true}));
 const original='export function admitted(){return false;}\n';
 await writeFile(join(candidate,'gate.mjs'),original);
 await writeFile(join(candidate,'gate.test.mjs'),`import assert from 'node:assert/strict';import {test} from 'node:test';import {admitted} from './gate.mjs';test('${name}',async()=>{${body}});`);
 return {candidate,original,guard:{name:'synthetic allowance admission',file:'gate.mjs',needle:'return false;',replacement:'return true;',test:'gate.test.mjs',pattern:name,expected:'true !== false',timeoutMs:5000}};
}
test('allowance harness requires a passing baseline detected wrong value and passing restored case',async t=>{
 const qualify=await harness(),f=await fixture(t);
 assert.deepEqual(await qualify(f.candidate,f.guard),{guard:'synthetic allowance admission',baseline:1,detected:1,restored:1});
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
for(const [label,needle] of [['missing','absent guard'],['ambiguous','return']])test(`allowance harness rejects ${label} mutation targets`,async t=>{
 const qualify=await harness(),f=await fixture(t);
 if(label==='ambiguous')await writeFile(join(f.candidate,'gate.mjs'),f.original+'// return\n');
 const before=await readFile(join(f.candidate,'gate.mjs'),'utf8');
 await assert.rejects(qualify(f.candidate,{...f.guard,needle}),/mutation_target/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),before);
});
test('allowance harness rejects an undetected negative control and restores original bytes',async t=>{
 const qualify=await harness(),f=await fixture(t);
 await assert.rejects(qualify(f.candidate,{...f.guard,replacement:'return !true;'}),/omission_not_detected/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
for(const [label,replacement,expected] of [['runtime failure','return missingName;','missingName is not defined'],['syntax failure','return ];','Unexpected token'],['wrong value','return true;','a different wrong value']])test(`allowance harness rejects ${label} as guard evidence`,async t=>{
 const qualify=await harness(),f=await fixture(t);
 await assert.rejects(qualify(f.candidate,{...f.guard,replacement,expected}),/assertion_required/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
for(const [label,source] of [
 ['zero cases',`import {test} from 'node:test';`],
 ['skipped case',`import {test} from 'node:test';test.skip('${name}',()=>{});`],
 ['todo case',`import {test} from 'node:test';test.todo('${name}');`],
 ['unexpected name',`import {test} from 'node:test';test('different operation',()=>{});`],
 ['multiple cases',`import {test} from 'node:test';test('${name}',()=>{});test('${name}',()=>{});`],
 ['import failure',`import './missing.mjs';`],
 ])test(`allowance harness refuses baseline ${label}`,async t=>{
 const qualify=await harness(),f=await fixture(t);
 await writeFile(join(f.candidate,'gate.test.mjs'),source);
 await assert.rejects(qualify(f.candidate,f.guard),/baseline_not_green/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
test('allowance harness refuses a failed baseline without mutation',async t=>{
 const qualify=await harness(),f=await fixture(t,'assert.equal(admitted(),true);');
 await assert.rejects(qualify(f.candidate,f.guard),/baseline_not_green/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
test('allowance harness stops its own timed out child and refuses evidence',async t=>{
 const qualify=await harness(),f=await fixture(t,`(await import('node:fs')).writeFileSync('child.pid',String(process.pid));await new Promise(resolve=>setTimeout(resolve,10000));`);
 await assert.rejects(qualify(f.candidate,{...f.guard,timeoutMs:500}),/timed_out/);
 const pid=Number(await readFile(join(f.candidate,'child.pid'),'utf8'));
 assert.ok(pid>0);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
test('allowance harness actually executes the restored case',async t=>{
 const qualify=await harness(),f=await fixture(t,`const fs=await import('node:fs');const n=Number(fs.existsSync('runs')?fs.readFileSync('runs','utf8'):0)+1;fs.writeFileSync('runs',String(n));assert.ok(n<3,'third run refuses');assert.equal(admitted(),false);`);
 await assert.rejects(qualify(f.candidate,f.guard),/restore_not_green/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
 assert.equal(await readFile(join(f.candidate,'runs'),'utf8'),'3');
});
test('allowance guard CLI proves the independent trial interval and method omissions',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),file=join(root,'packages/registration/src/billing-allowance-rules.ts'),before=await readFile(file);
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;delete env.TEST_DATABASE_URL;
 const result=await exec(process.execPath,['scripts/allowance-traffic-guard-probes.mjs','--pure'],{cwd:root,env,timeout:60000});
 assert.deepEqual(JSON.parse(result.stdout),{mode:'pure',results:[
  {guard:'active trial interval',baseline:1,detected:1,restored:1},
  {guard:'payment method trial tier',baseline:1,detected:1,restored:1},
 ]});
 assert.deepEqual(await readFile(file),before);
});
for(const args of [[],['--unknown'],['--pure','extra'],['--database']])test('allowance guard CLI refuses invalid arguments or a missing database '+args.join(' '),async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),env={...process.env};delete env.TEST_DATABASE_URL;delete env.NODE_TEST_CONTEXT;
 await assert.rejects(exec(process.execPath,['scripts/allowance-traffic-guard-probes.mjs',...args],{cwd:root,env}),error=>{
  assert.equal(error.code,1);assert.equal(error.stdout,'');assert.match(error.stderr,/^allowance_traffic_guard\.(invalid_mode|database_required)\n$/);return true;
 });
});

test('allowance harness runs all three cases through the selected executable',async t=>{
 const qualify=await harness(),f=await fixture(t);
 await writeFile(join(f.candidate,'runtime.mjs'),`import {spawnSync} from 'node:child_process';import {appendFileSync} from 'node:fs';appendFileSync('runtime-runs','run\\n');const child=spawnSync(process.execPath,process.argv.slice(2),{stdio:'inherit'});process.exitCode=child.status??1;`);
 assert.deepEqual(await qualify(f.candidate,f.guard,process.env,{command:process.execPath,prefix:['runtime.mjs']}),{guard:'synthetic allowance admission',baseline:1,detected:1,restored:1});
 const runs=await readFile(join(f.candidate,'runtime-runs'),'utf8').catch(()=> '');
 assert.equal(runs,'run\nrun\nrun\n','baseline, omission and restored tests must all execute inside the selected runtime');
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});

async function batchHarness(){const module=await import('./allowance-traffic-guard-probes.mjs');assert.equal(typeof module.qualifyAllowanceBatches,'function');return module.qualifyAllowanceBatches;}
test('allowance batches require every original guard exactly once before running work',async()=>{
 const qualify=await batchHarness(),a={name:'a'},b={name:'b'};
 for(const batches of [[],[[a]],[[a],[a,b]],[[a],[]],[[a],[{name:'b'}]],[[a],[b],[a]]])
  await assert.rejects(qualify([a,b],batches,async()=>{assert.fail('invalid work must never begin');}),/batch_guard_set/);
});
test('allowance batches reject missing duplicate foreign or incomplete result receipts',async()=>{
 const qualify=await batchHarness(),a={name:'a'},b={name:'b'},ok={guard:'a',baseline:1,detected:1,restored:1};
 for(const results of [[],[ok],[ok,ok],[ok,{...ok,guard:'foreign'}],[ok,{...ok,guard:'b',restored:0}],[ok,{...ok,guard:'b',extra:true}]])
  await assert.rejects(qualify([a,b],[[a,b]],async()=>results),/batch_results/);
});
test('allowance batches collect both failures before returning an error',async()=>{
 const qualify=await batchHarness(),a={name:'a'},b={name:'b'},errors=[Error('first batch'),Error('second batch')];
 let release;const blocked=new Promise(resolve=>{release=resolve;});let finished=false;
 const pending=qualify([a,b],[[a],[b]],async(_batch,index)=>{if(index)await blocked;throw errors[index];});
 void pending.then(()=>{finished=true;},()=>{finished=true;});
 try{
  await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'the second batch must finish before any failure is reported');
  release();await assert.rejects(pending,error=>{assert.ok(error instanceof AggregateError);assert.deepEqual(error.errors,errors);return true;});
 }finally{release();await pending.catch(()=>{});}
});
test('allowance batches retain the original guard order after independent completion',async()=>{
 const qualify=await batchHarness(),a={name:'a'},b={name:'b'};
 assert.deepEqual(await qualify([a,b],[[b],[a]],async batch=>batch.map(g=>({guard:g.name,baseline:1,detected:1,restored:1}))),[
  {guard:'a',baseline:1,detected:1,restored:1},{guard:'b',baseline:1,detected:1,restored:1},
 ]);
});
