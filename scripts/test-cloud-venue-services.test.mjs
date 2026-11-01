import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as api from './test-cloud-free-services.mjs';

const ids=['rules','installations','backups','recovery','remote','translation','relay','runtime','storage'];

test('matrix timing diagnostics identify real cases and files without printing paths or names',()=>{
 const root=mkdtempSync(join(tmpdir(),'service-timings-'));
 try{
  const file=new URL('../packages/registration/test/venue-service-rules.test.ts',import.meta.url).pathname;
  const program=join(root,'probe.mjs');
  writeFileSync(program,`import {run} from 'node:test';import {summariseServiceMatrix} from ${JSON.stringify(new URL('./test-cloud-free-services.mjs',import.meta.url).href)};const suites=[{id:'rules',files:[${JSON.stringify(file)}]}];console.log(JSON.stringify(await summariseServiceMatrix(run({files:suites[0].files,execArgv:[]}),suites)));`);
  const env={...process.env,CLOUD_SERVICE_PROOF_TIMINGS:'1'};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
  const result=spawnSync(process.execPath,[program],{env,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),[{id:'rules',tests:14,passed:14,failed:0,cancelled:0,skipped:0,todo:0}]);
  const rows=result.stderr.trim().split('\n').filter(Boolean).map(line=>{assert.ok(line.startsWith('SERVICE_PROOF_TIMING '));return JSON.parse(line.slice('SERVICE_PROOF_TIMING '.length));});
  assert.equal(rows.filter(row=>row.kind==='case').length,14);
  assert.equal(rows.filter(row=>row.kind==='file').length,1);
  for(const row of rows){
   assert.equal(row.suite,'rules');assert.equal(row.fileIndex,0);
   assert.ok(Number.isFinite(row.durationMs)&&row.durationMs>=0);
   assert.ok(Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0);
   assert.deepEqual(Object.keys(row).sort(),['durationMs','elapsedMs','fileIndex','kind','suite',...(row.kind==='file'?['tests']:['line','testNumber','nesting','caseType'])].sort());
   if(row.kind==='case'){assert.equal(row.nesting,0);assert.equal(row.caseType,'test');}
  }
  assert.equal(rows.find(row=>row.kind==='file').tests,14);
  delete env.CLOUD_SERVICE_PROOF_TIMINGS;
  const quiet=spawnSync(process.execPath,[program],{env,encoding:'utf8',timeout:30000});
  assert.equal(quiet.status,0,quiet.stderr);assert.equal(quiet.stderr,'');assert.equal(quiet.stdout,result.stdout);
 }finally{rmSync(root,{recursive:true,force:true});}
});
function receipt(){return {version:2,kind:'test-cloud-venue-services',cloudHead:'a'.repeat(40),cloudTree:'b'.repeat(40),scope:'local-fixtures',mode:'test-venue-levels',productionEnforcement:'off',suites:ids.map(id=>({id,tests:2,passed:2,failed:0,cancelled:0,skipped:0,todo:0}))};}
test('venue service receipt qualifies the complete local matrix separately from legacy evidence',()=>{
 assert.equal(typeof api.validateVenueServiceReceipt,'function','venue service proof validator is required');
 assert.equal(api.validateVenueServiceReceipt(receipt()),true);
 assert.throws(()=>api.validateFreeServiceReceipt(receipt()));
});
test('venue service receipt refuses omitted, extra or malformed authority and candidate fields',()=>{
 assert.equal(typeof api.validateVenueServiceReceipt,'function');
 for(const field of ['version','kind','cloudHead','cloudTree','scope','mode','productionEnforcement','suites']){
  for(const value of [undefined,null,false,true,'',{},[]]){
   const r=receipt();if(value===undefined)delete r[field];else r[field]=value;
   assert.throws(()=>api.validateVenueServiceReceipt(r),`${field}: ${JSON.stringify(value)}`);
  }
 }
 for(const [field,value] of [['version',1],['kind','test-cloud-free-services'],['scope','production'],['mode','test-free-paid'],['productionEnforcement','on'],['cloudHead','main'],['cloudTree','a'.repeat(39)],['token','private']]){
  const r=receipt();r[field]=value;assert.throws(()=>api.validateVenueServiceReceipt(r),field);
 }
});
test('venue service receipt refuses partial suites, nonpassing cases and hidden suite fields',()=>{
 assert.equal(typeof api.validateVenueServiceReceipt,'function');
 for(const mutate of [r=>r.suites.pop(),r=>r.suites.push(r.suites[0]),r=>r.suites[0].id='foreign',r=>r.suites[0].private='value']){
  const r=receipt();mutate(r);assert.throws(()=>api.validateVenueServiceReceipt(r));
 }
 for(const field of ['id','tests','passed','failed','cancelled','skipped','todo']){
  const r=receipt();delete r.suites[0][field];assert.throws(()=>api.validateVenueServiceReceipt(r),field);
 }
 for(const [field,values] of Object.entries({tests:[0,-1,1.5,'2',Number.MAX_SAFE_INTEGER+1],passed:[0,1,'2'],failed:[1,'0'],cancelled:[1,'0'],skipped:[1,'0'],todo:[1,'0']})){
  for(const value of values){const r=receipt();r.suites[0][field]=value;assert.throws(()=>api.validateVenueServiceReceipt(r),field);}
 }
});

test('proof refuses concurrency beyond two without certifying any case',()=>{
 const env={...process.env,CLOUD_SERVICE_PROOF_CONCURRENCY:'3'};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 const result=spawnSync(process.execPath,['scripts/test-cloud-free-services.mjs','--venue-levels','--suite','runtime'],{env,encoding:'utf8',timeout:30000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'Free-service proof failed\n');
});

test('one file queue attributes every direct case to its original service suite',async()=>{
 assert.equal(typeof api.summariseServiceMatrix,'function','the matrix must share one bounded file queue');
 const suites=[{id:'backups',files:['/backup-one.test.mjs','/backup-two.test.mjs']},{id:'remote',files:['/remote.test.mjs']}];
 const summary=(file,tests)=>({type:'test:summary',data:{success:true,...(file?{file}:{}),counts:{tests,passed:tests,failed:0,cancelled:0,skipped:0,todo:0}}});
 const events=[summary('/remote.test.mjs',3),summary('/backup-one.test.mjs',2),summary('/backup-two.test.mjs',4),summary(undefined,9)];
 async function* stream(values){yield* values;}
 assert.deepEqual(await api.summariseServiceMatrix(stream(events),suites),[
  {id:'backups',tests:6,passed:6,failed:0,cancelled:0,skipped:0,todo:0},
  {id:'remote',tests:3,passed:3,failed:0,cancelled:0,skipped:0,todo:0},
 ]);
 for(const changed of [events.slice(1),[...events.slice(0,-1),events[0],events.at(-1)],[{type:'test:stdout',data:{message:'private'}},...events],events.map((e,i)=>i===0?summary('/unexpected.test.mjs',3):e),events.map((e,i)=>i===3?summary(undefined,10):e),events.map((e,i)=>i===0?{...e,data:{...e.data,counts:{...e.data.counts,skipped:1}}}:e)])await assert.rejects(api.summariseServiceMatrix(stream(changed),suites));
 await assert.rejects(api.summariseServiceMatrix(stream(events),[...suites,{id:'duplicate',files:['/remote.test.mjs']}]));
});
