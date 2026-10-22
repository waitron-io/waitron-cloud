import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {test,mock} from 'node:test';
import * as trial from './trial.ts';
import {gradeRun,loadSet,type GradedSet} from './scorer.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from '../test/fake-openai.ts';

function command(file:string,args:string[],env:NodeJS.ProcessEnv={}){
 return new Promise<{code:number|null;stdout:string;stderr:string}>(resolve=>{
  const child=spawn(process.execPath,[file,...args],{cwd:tmpdir(),env:{PATH:process.env.PATH,...env}});
  let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
  child.on('close',code=>resolve({code,stdout,stderr}));
 });
}
const cli=fileURLToPath(new URL('./trial.ts',import.meta.url));
test('the trial preserves given names and kind/family, dropping items with all languages',()=>{
 assert.equal(typeof trial.trialJob,'function','trialJob must exist');
 const set:GradedSet={products:[
  {id:'head',internal:'COFFEE',category:'Drinks',existing:{ca:'Cafè',es:'Café',en:'Coffee'}},
  {id:'small',kind:'variant',family:'head',internal:'PETIT',category:'Drinks',existing:{en:'Small'}},
  {id:'section',kind:'section',internal:'POSTRES',category:null},
 ],grades:new Map(),shown:new Set()};
 const job=trial.trialJob(set);
 assert.deepEqual(job,{country:'ES',languages:{default:'ca',enabled:['ca','es','en']},houseStyle:[],items:[
  {ref:'small',kind:'variant',family:'head',staffName:'PETIT',category:'Drinks',existing:{en:'Small'},missing:['ca','es']},
  {ref:'section',kind:'section',family:'section',staffName:'POSTRES',category:null,existing:{},missing:['ca','es','en']},
 ]});
 assert.equal(trial.trialJob(loadSet('tuning')).items.length,32);
});
test('two real production-path trials write scorer inputs and count both passes',async()=>{
 assert.equal(typeof trial.runTrial,'function','runTrial must exist');
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 const dir=mkdtempSync(join(tmpdir(),'translation-trial-'));
 try{
  const files=await trial.runTrial({set:'blind',runs:2,outDir:pathToFileURL(dir+'/'),env:{CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_API_KEY:'test-only-key',CLOUD_OPENAI_BASE_URL:fake.baseUrl}});
  assert.equal(files.length,2);assert.equal(new Set(files.map(String)).size,2);
  for(const [i,file] of files.entries()){
   const r=JSON.parse(readFileSync(file,'utf8'));
   assert.deepEqual([r.set,r.promptVersion,r.model,r.repeat,r.failed],['blind','translate-all-v1','gpt-6-luna',i+1,[]]);
   assert.deepEqual(r.usage,{inputTokens:200,outputTokens:100});assert.equal(r.costUsd,0.00007);
   assert.equal(gradeRun(r.names,loadSet('blind')).ungraded,86);
   assert.equal(JSON.stringify(r).includes('test-only-key'),false);
  }
  assert.equal(fake.requests.length,4);
  assert.deepEqual(fake.requests.map(r=>r.body.reasoning.effort),['low','medium','low','medium']);
  assert.ok(fake.requests.every(r=>r.body.model==='gpt-6-luna'&&r.body.store===false));
  assert.equal(readdirSync(dir).length,2);
 }finally{await fake.close();rmSync(dir,{recursive:true,force:true});}
});
test('namesFrom retains placeholder and corrections without mutating the result',()=>{
 assert.equal(typeof trial.namesFrom,'function','namesFrom must exist');
 assert.deepEqual(trial.namesFrom([{ref:'p01',names:{ca:'Cafè'},placeholder:false,corrections:[{field:'internal',wrong:'CAFE',right:'CAFÈ'}]}]),
  {p01:{ca:'Cafè',placeholder:false,corrections:[{field:'internal',wrong:'CAFE',right:'CAFÈ'}]}});
});
test('invalid trial options fail before any provider request or output',async()=>{
 assert.equal(typeof trial.runTrial,'function','runTrial must exist');
 const fake=await startFakeOpenAi(()=>({status:401})),dir=mkdtempSync(join(tmpdir(),'translation-trial-invalid-'));
 try{
  for(const runs of [0,11,1.5,NaN])await assert.rejects(trial.runTrial({set:'blind',runs,outDir:pathToFileURL(dir+'/'),env:{CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_API_KEY:'test-key',CLOUD_OPENAI_BASE_URL:fake.baseUrl}}),/runs/);
  await assert.rejects(trial.runTrial({set:'blind',runs:1,outDir:pathToFileURL(dir+'/'),env:{CLOUD_OPENAI_BASE_URL:fake.baseUrl}}),/CLOUD_OPENAI_API_KEY/);
  assert.equal(fake.requests.length,0);assert.deepEqual(readdirSync(dir),[]);
 }finally{await fake.close();rmSync(dir,{recursive:true,force:true});}
});
test('a refused first pass records failures; a refused review cannot look fully qualified',async()=>{
 assert.equal(typeof trial.runTrial,'function','runTrial must exist');
 for(const failReview of [false,true]){
  const fake=await startFakeOpenAi(r=>!failReview||isReview(r)?{status:401}:echoFirstPass(r));
  const dir=mkdtempSync(join(tmpdir(),'translation-trial-fail-'));
  try{
   const [file]=await trial.runTrial({set:'blind',runs:1,outDir:pathToFileURL(dir+'/'),env:{CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_API_KEY:'test-key',CLOUD_OPENAI_BASE_URL:fake.baseUrl}});
   const r=JSON.parse(readFileSync(file!,'utf8'));
   assert.equal(r.failed.length,30);assert.equal(Object.keys(r.names).length,failReview?30:0);
   assert.deepEqual(r.usage,failReview?{inputTokens:100,outputTokens:50}:{inputTokens:0,outputTokens:0});
  }finally{await fake.close();rmSync(dir,{recursive:true,force:true});}
 }
});
test('the trial command is strict about options and prints written result paths',async()=>{
 assert.equal(typeof trial.runTrial,'function','runTrial must exist');
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r)),dir=mkdtempSync(join(tmpdir(),'translation-trial-cli-'));
 try{
 for(const args of [[],['--set','blind','--runs','1','--unknown'],['--set','blind','--runs','1','--unknown','value'],['--set','blind','--runs','1','--runs','2'],['--set','blind','--runs','1','--out']]){
  const r=await command(cli,[...args,'--out',dir],{CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_API_KEY:'private-test-value',CLOUD_OPENAI_BASE_URL:fake.baseUrl});
  assert.notEqual(r.code,0);assert.equal(r.stdout,'');assert.match(r.stderr,/usage:/);assert.ok(!r.stderr.includes('private-test-value'));
 }
  const r=await command(cli,['--set','blind','--runs','1','--out',dir],{CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_API_KEY:'private-test-value',CLOUD_OPENAI_BASE_URL:fake.baseUrl});
  assert.equal(r.code,0,r.stderr);assert.equal(r.stderr,'');
  const file=r.stdout.trim();assert.ok(file.startsWith(dir+'/blind-'));assert.ok(file.endsWith('-1.json'));
  assert.equal(JSON.parse(readFileSync(file,'utf8')).failed.length,0);
 }finally{await fake.close();rmSync(dir,{recursive:true,force:true});}
});

test('a refused trial prints its diagnostic path and exits unsuccessfully',async()=>{
 const fake=await startFakeOpenAi(()=>({status:401})),dir=mkdtempSync(join(tmpdir(),'translation-trial-cli-failed-'));
 try{
  const r=await command(cli,['--set','blind','--runs','1','--out',dir],{CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_API_KEY:'private-test-value',CLOUD_OPENAI_BASE_URL:fake.baseUrl});
  assert.equal(r.code,1,r.stderr);assert.equal(r.stderr,'');
  const file=r.stdout.trim();assert.ok(file.startsWith(dir+'/blind-'));
  assert.equal(JSON.parse(readFileSync(file,'utf8')).failed.length,30);
 }finally{await fake.close();rmSync(dir,{recursive:true,force:true});}
});
test('a colliding output filename preserves the earlier trial evidence',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r)),dir=mkdtempSync(join(tmpdir(),'translation-trial-collision-'));
 const file=join(dir,'blind-2026-10-17T12-00-00-000Z-fixed-1.json');
 writeFileSync(file,'Earlier paid trial evidence');
 mock.method(crypto,'randomUUID',()=> 'fixed');mock.method(Date.prototype,'toISOString',()=> '2026-10-17T12:00:00.000Z');syncBuiltinESMExports();
 try{
  await assert.rejects(trial.runTrial({set:'blind',runs:1,outDir:pathToFileURL(dir+'/'),env:{CLOUD_TRANSLATION_LOCAL_PROOF:'1',CLOUD_OPENAI_API_KEY:'test-key',CLOUD_OPENAI_BASE_URL:fake.baseUrl}}),{code:'EEXIST'});
  assert.equal(readFileSync(file,'utf8'),'Earlier paid trial evidence');
 }finally{mock.restoreAll();syncBuiltinESMExports();await fake.close();rmSync(dir,{recursive:true,force:true});}
});

test('maintained trials deny default, global and regional calls and flag-only before output',async t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('must not send');});
 const dir=mkdtempSync(join(tmpdir(),'translation-trial-denied-'));
 try{
  for(const flag of [undefined,'','0','1'])for(const baseUrl of [undefined,'https://api.openai.com/v1','https://eu.api.openai.com/v1']){
   await assert.rejects(trial.runTrial({set:'blind',runs:1,outDir:pathToFileURL(dir+'/'),env:{CLOUD_OPENAI_API_KEY:'synthetic-private',CLOUD_TRANSLATION_LOCAL_PROOF:flag,CLOUD_OPENAI_BASE_URL:baseUrl}}));
   assert.deepEqual(readdirSync(dir),[]);
  }
  const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
  try{await assert.rejects(trial.runTrial({set:'blind',runs:1,outDir:pathToFileURL(dir+'/'),env:{CLOUD_OPENAI_API_KEY:'synthetic-private',CLOUD_OPENAI_BASE_URL:fake.baseUrl}}));assert.equal(fake.requests.length,0);}finally{await fake.close();}
  assert.equal(requests,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
