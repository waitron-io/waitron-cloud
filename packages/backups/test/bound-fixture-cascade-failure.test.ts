import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

test('cascade control preserves its first assertion when its independent rescue also fails',()=>{
 const directory=mkdtempSync(join(tmpdir(),'bound-control-failure-')),preload=join(directory,'fault.mjs'),suite=fileURLToPath(new URL('./bound-fixture-cascade.test.ts',import.meta.url));
 const copies=join(directory,'copies');
 try{
  writeFileSync(preload,`import cp from 'node:child_process';import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFileSync;fs.readFileSync=(path,...args)=>String(path).endsWith('/owned.json')?JSON.stringify({id:'1'.repeat(64),image:'sha256:'+'2'.repeat(64),tag:'private-control',labels:{}}):read(path,...args);
const write=fs.writeFileSync;fs.writeFileSync=(path,...args)=>{if(String(path).includes('/.bound-cascade-'))fs.appendFileSync(${JSON.stringify(copies)},String(path)+'\\n');return write(path,...args);};
cp.spawnSync=()=>({status:0,stdout:'controlled unexpected success',stderr:''});
cp.execFileSync=()=>{throw Error('controlled rescue refusal');};syncBuiltinESMExports();
`);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--import',preload,'--test','--test-reporter=spec',suite],{env,encoding:'utf8',timeout:10000});
  assert.equal(child.error,undefined);assert.equal(child.status,1,child.stdout+child.stderr);
  assert.match(child.stdout,/bound_fixture.control_cleanup/);assert.match(child.stdout,/0 !== 1/);assert.match(child.stdout,/controlled rescue refusal/);
  const paths=readFileSync(copies,'utf8').trim().split('\n');assert.equal(paths.length,1);
  for(const path of paths)assert.throws(()=>readFileSync(new URL(path)),{code:'ENOENT'});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
