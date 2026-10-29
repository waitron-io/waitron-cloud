import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const name='fixture detects a removed gate';
async function harness(){
 const module=await import('./'+'billing-display-guard-probes.mjs').catch(()=>({}));
 assert.equal(typeof module.qualifyGuard,'function','billing display guard qualification harness must exist');
 return module;
}
async function fixture(t,body=`assert.equal(permitted(),false);`){
 const candidate=await mkdtemp(join(tmpdir(),'billing-display-harness-'));t.after(()=>rm(candidate,{recursive:true,force:true}));
 const original='export function permitted(){return false;}\n';
 await writeFile(join(candidate,'gate.mjs'),original);
 await writeFile(join(candidate,'gate.test.mjs'),`import assert from 'node:assert/strict';import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);import {permitted} from './gate.mjs';test('${name}',async()=>{${body}});`);
 return {candidate,original,guard:{name:'harness fixture',file:'gate.mjs',needle:'return false;',replacement:'return true;',test:'gate.test.mjs',pattern:name,timeoutMs:5000}};
}
// Each control runs an actual child test. An unchanged passing mutant must never qualify.
test('guard harness qualifies an actual assertion failure and restores the source',async t=>{
 const {qualifyGuard}=await harness(),f=await fixture(t);
 assert.deepEqual(await qualifyGuard(f.candidate,f.guard),{guard:'harness fixture',baseline:1,detected:1,restored:1});
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
for(const [label,needle] of [['missing','absent guard'],['ambiguous','return']] )test('guard harness refuses '+label+' mutation targets',async t=>{
 const {qualifyGuard}=await harness(),f=await fixture(t);
 if(label==='ambiguous')await writeFile(join(f.candidate,'gate.mjs'),f.original+'// return\n');
 const before=await readFile(join(f.candidate,'gate.mjs'),'utf8');
 await assert.rejects(qualifyGuard(f.candidate,{...f.guard,needle}),/mutation_target/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),before);
});
test('guard harness rejects the behavioral negative control whose omitted gate goes undetected',async t=>{
 const {qualifyGuard}=await harness(),f=await fixture(t);
 await assert.rejects(qualifyGuard(f.candidate,{...f.guard,replacement:'return !true;'}),/omission_not_detected/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
test('guard harness does not count a mutation setup error as detection',async t=>{
 const {qualifyGuard}=await harness(),f=await fixture(t);
 await assert.rejects(qualifyGuard(f.candidate,{...f.guard,replacement:'return missingValue;'}),/assertion_required/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
test('guard harness refuses a failed baseline',async t=>{
 const {qualifyGuard}=await harness(),f=await fixture(t,'assert.equal(permitted(),true);');
 await assert.rejects(qualifyGuard(f.candidate,f.guard),/baseline_not_green/);
});
test('guard harness refuses skipped cases',async t=>{
 const {qualifyGuard}=await harness(),f=await fixture(t);
 await writeFile(join(f.candidate,'gate.test.mjs'),`import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);test.skip('${name}',()=>{});`);
 await assert.rejects(qualifyGuard(f.candidate,f.guard),/baseline_not_green/);
});
test('guard harness refuses a zero-case name selection',async t=>{
 const {qualifyGuard}=await harness(),f=await fixture(t);
 await assert.rejects(qualifyGuard(f.candidate,{...f.guard,pattern:'no matching case'}),/baseline_not_green/);
});
test('guard harness refuses a child timeout and closes its owned process',async t=>{
 const {qualifyGuard}=await harness(),f=await fixture(t,"(await import('node:fs')).writeFileSync('child.pid',String(process.pid));await new Promise(resolve=>setTimeout(resolve,10000));");
 await assert.rejects(qualifyGuard(f.candidate,{...f.guard,timeoutMs:500}),/timed_out/);
 const pid=Number(await readFile(join(f.candidate,'child.pid'),'utf8'));assert.ok(pid>0);
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
test('guard harness requires the exact named assertion rather than a different failing test',async t=>{
 const {qualifyGuard}=await harness(),f=await fixture(t);
 // The wildcard selects two tests, which must be rejected before any omission is credited.
 await writeFile(join(f.candidate,'gate.test.mjs'),`import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);test('${name}',()=>{});test('different failure',()=>{});`);
 await assert.rejects(qualifyGuard(f.candidate,{...f.guard,pattern:'.*'}),/baseline_not_green/);
});

test('guard harness can exclude the database environment from pure child runs',async t=>{
 const {qualifyGuard}=await harness(),before=process.env.TEST_DATABASE_URL;
 process.env.TEST_DATABASE_URL='synthetic-database-environment';t.after(()=>{if(before===undefined)delete process.env.TEST_DATABASE_URL;else process.env.TEST_DATABASE_URL=before;});
 const f=await fixture(t,'assert.equal(process.env.TEST_DATABASE_URL,undefined);assert.equal(permitted(),false);');
 assert.deepEqual(await qualifyGuard(f.candidate,f.guard,{...process.env,TEST_DATABASE_URL:undefined}),{guard:'harness fixture',baseline:1,detected:1,restored:1});
});

test('guard CLI qualifies both real pure omissions in copies and preserves the feature sources',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),file=join(root,'packages/registration/src/billing-display.ts'),before=await readFile(file);
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.TEST_DATABASE_URL;
 let result;try{result=await exec(process.execPath,['scripts/billing-display-guard-probes.mjs','--pure'],{cwd:root,env,timeout:60000});}
 catch(error){assert.fail('pure guard CLI must qualify its actual child cases: exit '+error.code);}
 assert.deepEqual(JSON.parse(result.stdout),{mode:'pure',results:[{guard:'remaining accepted success',baseline:1,detected:1,restored:1},{guard:'exact hosted day gaps',baseline:1,detected:1,restored:1}]});
 assert.deepEqual(await readFile(file),before);
});
