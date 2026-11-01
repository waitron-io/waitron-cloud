import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
const exec=promisify(execFile);

const name='fixture refuses a denied service';
async function harness(){
 const api=await import('./venue-service-guard-probes.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
 });
 assert.equal(typeof api.qualifyVenueGuard,'function','venue guard qualification must execute real tests');
 return api.qualifyVenueGuard;
}
async function fixture(t,body='assert.equal(permitted(),false);'){
 const candidate=await mkdtemp(join(tmpdir(),'venue-guard-control-'));
 t.after(()=>rm(candidate,{recursive:true,force:true}));
 const original='export function permitted(){return false;}\n';
 await writeFile(join(candidate,'gate.mjs'),original);
 await writeFile(join(candidate,'gate.test.mjs'),`import assert from 'node:assert/strict';import {test} from 'node:test';import {permitted} from './gate.mjs';test('${name}',async()=>{${body}});`);
 return {candidate,original,guard:{name:'synthetic admission',file:'gate.mjs',needle:'return false;',replacement:'return true;',test:'gate.test.mjs',pattern:name,expected:'true !== false',timeoutMs:5000}};
}

test('venue guard harness requires distinct passing baseline assertion failure and passing restoration',async t=>{
 const qualify=await harness(),f=await fixture(t);
 assert.deepEqual(await qualify(f.candidate,f.guard),{guard:'synthetic admission',baseline:1,detected:1,restored:1});
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
for(const [label,needle] of [['missing','no such guard'],['ambiguous','return']])test(`venue guard harness rejects ${label} mutation targets before execution`,async t=>{
 const qualify=await harness(),f=await fixture(t);
 if(label==='ambiguous')await writeFile(join(f.candidate,'gate.mjs'),f.original+'// return\n');
 const before=await readFile(join(f.candidate,'gate.mjs'),'utf8');
 await assert.rejects(qualify(f.candidate,{...f.guard,needle}),/mutation_target/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),before);
});
test('venue guard harness rejects an undetected negative control',async t=>{
 const qualify=await harness(),f=await fixture(t);
 await assert.rejects(qualify(f.candidate,{...f.guard,replacement:'return !true;'}),/omission_not_detected/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
for(const [label,replacement] of [['runtime error','return missingName;'],['syntax error','return ];']])test(`venue guard harness rejects ${label} instead of counting it as detection`,async t=>{
 const qualify=await harness(),f=await fixture(t);
 await assert.rejects(qualify(f.candidate,{...f.guard,replacement}),/assertion_required/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
test('venue guard harness requires the expected wrong value',async t=>{
 const qualify=await harness(),f=await fixture(t);
 await assert.rejects(qualify(f.candidate,{...f.guard,expected:'a different wrong value'}),/assertion_required/);
});
for(const [label,source] of [
 ['zero cases',`import {test} from 'node:test';`],
 ['skipped case',`import {test} from 'node:test';test.skip('${name}',()=>{});`],
 ['todo case',`import {test} from 'node:test';test.todo('${name}');`],
 ['unexpected name',`import {test} from 'node:test';test('different service',()=>{});`],
 ['multiple cases',`import {test} from 'node:test';test('${name}',()=>{});test('another service',()=>{});`],
 ['import failure',`import './missing.mjs';`],
 ])test(`venue guard harness refuses baseline ${label}`,async t=>{
 const qualify=await harness(),f=await fixture(t);
 await writeFile(join(f.candidate,'gate.test.mjs'),source);
 await assert.rejects(qualify(f.candidate,{...f.guard,pattern:label==='multiple cases'?'.*':f.guard.pattern}),/baseline_not_green/);
});
test('venue guard harness refuses a failed baseline without mutating source',async t=>{
 const qualify=await harness(),f=await fixture(t,'assert.equal(permitted(),true);');
 await assert.rejects(qualify(f.candidate,f.guard),/baseline_not_green/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
});
test('venue guard harness kills its owned timed out process and refuses qualification',async t=>{
 const qualify=await harness(),f=await fixture(t,`(await import('node:fs')).writeFileSync('child.pid',String(process.pid));await new Promise(resolve=>setTimeout(resolve,10000));`);
 await assert.rejects(qualify(f.candidate,{...f.guard,timeoutMs:500}),/timed_out/);
 const pid=Number(await readFile(join(f.candidate,'child.pid'),'utf8'));
 assert.ok(pid>0);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
test('venue guard harness observes restoration independently',async t=>{
 const qualify=await harness(),f=await fixture(t,`const fs=await import('node:fs');const n=Number(fs.existsSync('runs')?fs.readFileSync('runs','utf8'):0)+1;fs.writeFileSync('runs',String(n));assert.ok(n<3,'third run refuses');assert.equal(permitted(),false);`);
 await assert.rejects(qualify(f.candidate,f.guard),/restore_not_green/);
 assert.equal(await readFile(join(f.candidate,'gate.mjs'),'utf8'),f.original);
 assert.equal(await readFile(join(f.candidate,'runs'),'utf8'),'3');
});
test('venue guard CLI proves both pure omissions in an installed owned copy',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),file=join(root,'packages/registration/src/venue-service-rules.ts'),before=await readFile(file);
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;delete env.TEST_DATABASE_URL;
 const result=await exec(process.execPath,['scripts/venue-service-guard-probes.mjs','--pure'],{cwd:root,env,timeout:60000});
 assert.deepEqual(JSON.parse(result.stdout),{mode:'pure',results:[
  {guard:'translation level floor',baseline:1,detected:1,restored:1},
  {guard:'exclusive trial end',baseline:1,detected:1,restored:1},
 ]});
 assert.deepEqual(await readFile(file),before);
});
for(const args of [[],['--unknown'],['--pure','extra'],['--database']])test('venue guard CLI refuses unsupported arguments or missing database '+args.join(' '),async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),env={...process.env};delete env.TEST_DATABASE_URL;delete env.NODE_TEST_CONTEXT;
 await assert.rejects(exec(process.execPath,['scripts/venue-service-guard-probes.mjs',...args],{cwd:root,env}),error=>{
  assert.equal(error.code,1);assert.equal(error.stdout,'');assert.match(error.stderr,/^venue_service_guard\.(invalid_mode|database_required)\n$/);return true;
 });
});
