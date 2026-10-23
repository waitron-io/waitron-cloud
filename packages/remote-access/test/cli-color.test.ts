import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {cliEnvironment} from './fixtures/cli-environment.ts';

const cwd=new URL('..',import.meta.url);
const colors=[{NO_COLOR:'1',FORCE_COLOR:'1'},{NO_COLOR:'1',FORCE_COLOR:'0'},{NO_COLOR:'',FORCE_COLOR:'3'}];

test('reconciler refusal keeps its exact diagnostic when the parent requests conflicting colors',()=>{
 for(const color of colors){
  const env=cliEnvironment({...color,CLOUD_TEST_SERVICE_PLANS:'0'});
  const result=spawnSync(process.execPath,['src/reconciler-cli.ts'],{cwd,env,encoding:'utf8',timeout:10000});
  assert.equal(result.status,1,result.stderr);assert.equal(result.stdout,'');
  assert.equal(result.stderr,'Remote configuration reconciler failed; check its trusted configuration and database migrations\n');
 }
});

test('operator refusal keeps its exact diagnostic without a database under conflicting colors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-cli-color-'));
 try{
  const input=join(root,'input.json');await writeFile(input,'{}',{mode:0o600});
  for(const color of colors){
   const env=cliEnvironment({...color,DATABASE_URL:'postgresql://unused@127.0.0.1:1/unused',CLOUD_TEST_SERVICE_PLANS:'invalid'});
   const result=spawnSync(process.execPath,['src/operator-cli.ts','provision',input],{cwd,env,encoding:'utf8',timeout:10000});
   assert.equal(result.status,1,result.stderr);assert.equal(result.stdout,'');assert.equal(result.stderr,'remote.command_failed\n');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('CLI child color normalization preserves configuration, parent settings and runtime warnings',()=>{
 const before={...process.env};
 const env=cliEnvironment({NO_COLOR:'',FORCE_COLOR:'2',DATABASE_URL:'postgresql://unused@127.0.0.1:1/unused',CLOUD_TEST_SERVICE_PLANS:'0'});
 const result=spawnSync(process.execPath,['--input-type=module','-e',"console.log(JSON.stringify({database:process.env.DATABASE_URL,plans:process.env.CLOUD_TEST_SERVICE_PLANS,path:process.env.PATH}));process.emitWarning('cli-fixture-warning-kept');"],{env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),{database:'postgresql://unused@127.0.0.1:1/unused',plans:'0',path:process.env.PATH});
 assert.match(result.stderr,/Warning: cli-fixture-warning-kept/);
 assert.doesNotMatch(result.stderr,/NO_COLOR|FORCE_COLOR/);
 assert.equal(JSON.stringify({...process.env})===JSON.stringify(before),true,'parent environment remains unchanged');
});
