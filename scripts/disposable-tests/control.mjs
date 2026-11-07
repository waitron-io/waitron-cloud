import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {GithubApp} from './github-app.mjs';
import {LocalLeases} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import {refuseLegacy,withTemporaryState} from './manual.mjs';
import {CITransport,protectOutputStreams} from './transport.mjs';
import {validateCIConfig,routingMode,setRoutingMode,findOrdinary,executeOrdinary} from './ci-canary.mjs';

export async function withOrdinaryController({state,hostGeneration,api,policy,approvedHead,runId,lane,transport,signal,wait=delay}){
 const end=Date.now()+900000;
 while(true){
  assert.equal(await routingMode({api,policy,signal}),'server','Server routing is disabled');
  const ci=await findOrdinary({api,policy,approvedHead,runId,signal});
  if(ci)return withKernelLock(state,async()=>{
   refuseLegacy(state);return withTemporaryState(state,async()=>{
    const leases=new LocalLeases(state+'/ledger',{hostGeneration,slots:1});
    if(leases.inspect().ciInvocation || leases.inspect().slots.some(slot=>slot.state!=='free'))return {code:75,reason:'capacity-busy'};
    return executeOrdinary({api,policy,leases,ci,lane,transport,signal});
   });
  },{deadline:Date.now()+7500,signal});
  assert.ok(Date.now()<end,'Ordinary CI queue deadline exceeded');await wait(15000,undefined,{signal});
 }
}

export async function main(args){
 const [configuration,command,...values]=args;
 assert.ok(configuration?.startsWith('/') && ['status','mode','run'].includes(command),
  'Usage: control.mjs CONFIG status | mode hosted|server --reason REASON | run LANE APPROVED_HEAD RUN_ID');
 const config=JSON.parse(readFileSync(configuration,'utf8'));validateCIConfig(config);
 assert.equal(config.ci.workflowPath,'.github/workflows/ci.yml','Ordinary CI needs its reviewed workflow configuration');
 const api=new GithubApp(config.ci),policy=config.ci;
 if(command==='status'){
  assert.equal(values.length,0);return {code:0,mode:await routingMode({api,policy}),state:new LocalLeases(config.state+'/ledger',
   {hostGeneration:config.hostGeneration,slots:1}).inspect()};
 }
 if(command==='mode'){
  assert.ok(values.length===3 && values[1]==='--reason' && /^[a-z0-9-]{1,80}$/.test(values[2]),'A short mode reason is required');
  return withKernelLock(config.state,async()=>({code:0,mode:await setRoutingMode({api,policy,mode:values[0]}),reason:values[2]}));
 }
 assert.ok(values.length===3 && /^[A-K]$/.test(values[0]) && /^[a-f0-9]{40}$/.test(values[1]) && /^[1-9][0-9]*$/.test(values[2]),
  'Ordinary CI needs lane, approved immutable PR head and numeric run ID');
 const [lane,approvedHead,run]=values,runId=Number(run);assert.ok(Number.isSafeInteger(runId));
 const cancellation=new AbortController(),cancel=()=>cancellation.abort();
 for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.on(name,cancel);
 protectOutputStreams();
 try{return await withOrdinaryController({state:config.state,hostGeneration:config.hostGeneration,api,policy,approvedHead,runId,lane,
  transport:new CITransport(config),signal:cancellation.signal});}
 finally{for(const name of ['SIGTERM','SIGINT','SIGHUP'])process.off(name,cancel);}
}
if(process.argv[1] && import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 try{const result=await main(process.argv.slice(2));console.log(JSON.stringify(result));process.exitCode=result.code;}
 catch(error){console.error(error.message);process.exitCode=125;}
}
