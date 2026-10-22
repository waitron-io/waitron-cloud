import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import childProcess from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {test} from 'node:test';

test('the archived experiments, owner grades and saved results retain their complete byte inventory',()=>{
 const root=new URL('./',import.meta.url);
 const list=(directory:string):string[]=>readdirSync(new URL(directory,root),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?list(directory+entry.name+'/'):[directory+entry.name]);
 const files=[...list('original/'),...list('data/'),'grading.template.html'].sort();
 const inventory=files.map(file=>[file,createHash('sha256').update(readFileSync(new URL(file,root))).digest('hex')]);
 assert.equal(files.length,157);
 assert.equal(createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),'278a819b5efb7753f720036d4b78d3dd565cea5dbe3cca3063153e410a1a03b7');
});

test('the maintained scorer works without provider keys, network or provider subprocesses',async t=>{
 const denied=()=>{throw Error('offline scorer attempted an outside action');};
 t.mock.method(globalThis,'fetch',denied);
 for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'] as const)t.mock.method(childProcess,method,denied);
 syncBuiltinESMExports();
 const environment=process.env;
 process.env=new Proxy(environment,{get(target,key){if(typeof key==='string'&&/OPENAI|ANTHROPIC|GEMINI|API_KEY/.test(key))return denied();return Reflect.get(target,key);}});
 try{
  const {loadSet,gradeRun}=await import('./scorer.ts');
  for(const set of ['tuning','blind'] as const){
   const fixture=loadSet(set);
   const file=new URL(`./data/trial-results/${set}/luna-low-v4+luna-medium-1.json`,import.meta.url);
   assert.ok(gradeRun(JSON.parse(readFileSync(file,'utf8')).names,fixture).names>0);
  }
 }finally{process.env=environment;t.mock.restoreAll();syncBuiltinESMExports();}
});
