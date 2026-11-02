import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {verifyAllowanceTrafficReceipt} from './verify-allowance-traffic-receipt.mjs';

const head='1'.repeat(40),tree='2'.repeat(40),candidate={cloudHead:head,cloudTree:tree};
const verify=(receipt,expected=candidate)=>verifyAllowanceTrafficReceipt(receipt,expected);
function fixture(){return {
 version:1,kind:'cloud-allowance-traffic',cloudHead:head,cloudTree:tree,scope:'local-fixtures',productionEnforcement:'off',
 checks:{backendDeltasMatch:true,operationalDaysZero:true,userDaysThree:true,restartReplayStable:true,crashGapIncomplete:true,foreignScopeRefused:true},
 suites:[{id:'counters',tests:4,passed:4,failed:0,cancelled:0,skipped:0,todo:0},
  {id:'collector',tests:6,passed:6,failed:0,cancelled:0,skipped:0,todo:0},
  {id:'gateway',tests:1,passed:1,failed:0,cancelled:0,skipped:0,todo:0}],
 cleanup:{containers:0,volumes:0,processes:0},
 limitations:['Local TLS, disposable PostgreSQL and an injected accounting clock; no live deployment or payment provider.']
};}

// Accepting any missing fact, skipped suite or other candidate could turn incomplete trial evidence into approval.
test('accepts the complete receipt only against its independently supplied candidate',()=>{
 const receipt=fixture(),before=structuredClone(receipt);
 assert.equal(verify(receipt),receipt);assert.deepEqual(receipt,before);
 receipt.suites.reverse();assert.equal(verify(receipt),receipt);
});

for(const field of Object.keys(fixture())){
 test('refuses missing receipt field '+field,()=>{const receipt=fixture();delete receipt[field];assert.throws(()=>verify(receipt));});
}
for(const [name,change] of [
 ['receipt null',()=>null],['receipt array',()=>[]],['receipt scalar',()=>true],
 ['another version',r=>({...r,version:2})],['string version',r=>({...r,version:'1'})],
 ['another proof',r=>({...r,kind:'cloud-scheduled-usage'})],['live scope',r=>({...r,scope:'production'})],
 ['enabled enforcement',r=>({...r,productionEnforcement:'on'})],['boolean enforcement',r=>({...r,productionEnforcement:false})],
 ['unrecognised top field',r=>({...r,cloudDirty:false})],
 ['extra check',r=>({...r,checks:{...r.checks,unproved:true}})],
 ['missing checks',r=>({...r,checks:null})],['array checks',r=>({...r,checks:[]})],
 ['unknown suite',r=>({...r,suites:[...r.suites,{...r.suites[0],id:'health'}]})],
 ['duplicate suite',r=>({...r,suites:[r.suites[0],r.suites[0],r.suites[2]]})],
 ['missing suite',r=>({...r,suites:r.suites.slice(1)})],['suite object',r=>({...r,suites:{0:r.suites[0]}})],
 ['null suite',r=>({...r,suites:[null,...r.suites.slice(1)]})],
 ['extra suite field',r=>({...r,suites:[{...r.suites[0],optional:true},...r.suites.slice(1)]})],
 ['missing suite count',r=>{delete r.suites[0].todo;return r;}],
 ['empty suite',r=>{r.suites[0].tests=0;r.suites[0].passed=0;return r;}],
 ['not all tests passed',r=>{r.suites[0].passed=3;return r;}],
 ['extra passed test',r=>{r.suites[0].passed=5;return r;}],
 ['cleanup null',r=>({...r,cleanup:null})],['cleanup array',r=>({...r,cleanup:[]})],
 ['missing cleanup count',r=>{delete r.cleanup.processes;return r;}],
 ['extra cleanup count',r=>({...r,cleanup:{...r.cleanup,networks:0}})],
 ['no limitations',r=>({...r,limitations:[]})],['limitations scalar',r=>({...r,limitations:'local only'})],
 ['empty limitation',r=>({...r,limitations:['']})],['blank limitation',r=>({...r,limitations:[' \n']})],
 ['nontext limitation',r=>({...r,limitations:[42]})],['partial limitation',r=>({...r,limitations:['Local only',null]})]
])test('refuses '+name,()=>assert.throws(()=>verify(change(fixture()))));

for(const field of ['cloudHead','cloudTree']){
 for(const value of ['',head.slice(1),head+'0','A'.repeat(40),'g'.repeat(40),42,null]){
  test(`refuses malformed ${field} ${JSON.stringify(value)}`,()=>assert.throws(()=>verify({...fixture(),[field]:value})));
  test(`refuses matching malformed ${field} ${JSON.stringify(value)}`,()=>{
   assert.throws(()=>verify({...fixture(),[field]:value},{...candidate,[field]:value}));
  });
 }
 test('refuses other candidate '+field,()=>assert.throws(()=>verify({...fixture(),[field]:'3'.repeat(40)})));
}
for(const [name,expected] of [['missing',undefined],['null',null],['empty',{}],['extra',{...candidate,dirty:false}],
 ['invalid head',{...candidate,cloudHead:'main'}],['invalid tree',{...candidate,cloudTree:'HEAD^{tree}'}]]){
 test('refuses '+name+' independent candidate binding',()=>{
  assert.throws(()=>verifyAllowanceTrafficReceipt(fixture(),expected));
 });
}
for(const field of Object.keys(fixture().checks)){
 for(const value of [false,'true',1,null])test(`refuses ${field}=${JSON.stringify(value)}`,()=>{
  const receipt=fixture();receipt.checks[field]=value;assert.throws(()=>verify(receipt));
 });
 test('refuses absent proof fact '+field,()=>{const receipt=fixture();delete receipt.checks[field];assert.throws(()=>verify(receipt));});
}
for(const id of ['counters','collector','gateway']){
 for(const value of [0.5,'4',Infinity,Number.MAX_SAFE_INTEGER+1])test(`refuses matching invalid ${id} totals ${String(value)}`,()=>{
  const receipt=fixture(),suite=receipt.suites.find(s=>s.id===id);suite.tests=value;suite.passed=value;assert.throws(()=>verify(receipt));
 });
 for(const field of ['tests','passed','failed','cancelled','skipped','todo']){
  for(const value of [-1,0.5,'0',null,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])test(`refuses ${id} ${field}=${String(value)}`,()=>{
   const receipt=fixture();receipt.suites.find(s=>s.id===id)[field]=value;assert.throws(()=>verify(receipt));
  });
 }
 for(const field of ['failed','cancelled','skipped','todo'])test(`refuses nonzero ${id} ${field}`,()=>{
  const receipt=fixture();receipt.suites.find(s=>s.id===id)[field]=1;assert.throws(()=>verify(receipt));
 });
}
for(const field of ['containers','volumes','processes']){
 for(const value of [1,-1,0.5,'0',null])test(`refuses cleanup ${field}=${JSON.stringify(value)}`,()=>{
  const receipt=fixture();receipt.cleanup[field]=value;assert.throws(()=>verify(receipt));
 });
}

test('command verifies supplied source binding and fails without a valid matching candidate',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'traffic-receipt-'));
 try{
  const path=join(directory,'receipt.json'),script=fileURLToPath(new URL('./verify-allowance-traffic-receipt.mjs',import.meta.url));
  await writeFile(path,JSON.stringify(fixture()));
  const run=args=>{
   const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:5000});
   assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.ok(Number.isInteger(result.status));return result;
  };
  const result=run([path,head,tree]);assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/verified allowance traffic/);assert.ok(result.stdout.includes(head)&&result.stdout.includes(tree));
  for(const args of [[],[path],[path,head],[path,'3'.repeat(40),tree],[path,head,'3'.repeat(40)],[path,head,tree,'extra']]){
   const refused=run(args);assert.notEqual(refused.status,0);assert.doesNotMatch(refused.stdout,/verified allowance traffic/);
  }
  const invalid=fixture();invalid.checks.userDaysThree=false;await writeFile(path,JSON.stringify(invalid));
  assert.notEqual(run([path,head,tree]).status,0);
  await writeFile(path,'{');assert.notEqual(run([path,head,tree]).status,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
