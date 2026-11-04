import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const preload=fileURLToPath(new URL('./fixtures/traffic-wrapper-docker-standin.mjs',import.meta.url));
for(const wrapper of ['traffic-rendered-gateway','traffic-gateway'])for(const fault of ['sibling-churn','witness-restarted','witness-stopped','foreign-running-removed','foreign-stopped-removed','lost-create','owned-leak']){
 test(`${wrapper} protects foreign containers through ${fault}`,()=>{
  const directory=mkdtempSync(join(tmpdir(),'cloud-traffic-wrapper-control-')),state=join(directory,'state.json');
  try{
   const env:NodeJS.ProcessEnv={...process.env,TRAFFIC_WRAPPER_FAULT:fault,TRAFFIC_WRAPPER_STATE:state};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
   const result=spawnSync(process.execPath,['--import',preload,'--test','--test-reporter=tap',fileURLToPath(new URL('./'+wrapper+'.test.ts',import.meta.url))],
    {encoding:'utf8',timeout:10000,env});
   assert.equal(result.error,undefined);assert.equal(result.signal,null);
   const output=result.stdout+result.stderr;
   if(fault==='sibling-churn')assert.equal(result.status,0,output);
   else{
    assert.notEqual(result.status,0,output);
    assert.match(output,fault==='lost-create'?/controlled lost create response/:fault==='owned-leak'?/Expected values to be strictly equal/:/foreign container identities and start times must survive/);
   }
   const remaining=JSON.parse(readFileSync(state,'utf8')) as {containers:Array<{name:string}>;images:string[];volumes:string[]};
   const owned=remaining.containers.filter(row=>row.name.startsWith('cloud-traffic-'));
   if(fault==='owned-leak'){assert.equal(owned.length,1);assert.ok(owned[0]!.name.endsWith('-unexpected'),'the injected unrecorded leak remains detected');}
   else assert.deepEqual(owned,[],'every wrapper-owned container is removed');
   assert.deepEqual(remaining.images,[]);assert.deepEqual(remaining.volumes,[]);
  }finally{rmSync(directory,{recursive:true,force:true});}
 });
}
