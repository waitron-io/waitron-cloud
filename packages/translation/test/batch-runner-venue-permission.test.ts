import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseJob,translateBatch,ProviderError,type BatchHooks,type ModelClient} from '../src/index.ts';

const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'Cafe',existing:{},missing:['ca','es']}],houseStyle:[]}));
const first=JSON.stringify({products:[{id:'p01',ca:'Cafe [ca]',es:'Cafe [es]'}]});
const done={kind:'done',results:[{ref:'product:1',names:{ca:'Cafe [ca]',es:'Cafe [es]'},placeholder:false,corrections:[]}],reviewApplied:0,reviewDropped:0,reviewFailed:false};
function fixture(){
 let permitted=true;
 const events:string[]=[],usage:{inputTokens:number;outputTokens:number}[]=[],calls:string[]=[],waits:number[]=[];
 const controller=new AbortController();
 const hooks:BatchHooks&{stillPermitted():Promise<boolean>}={
  async stillPermitted(){events.push('permission');return permitted;},
  async mayCall(){events.push('cap');return true;},
  async spent(value){usage.push(value);events.push('spent');},
  async attempted(){events.push('renew');},
  async wait(ms){waits.push(ms);events.push('wait');},
 };
 const client:ModelClient={provider:'openai',model:'gpt-5.4-mini',async respond(call){
  calls.push(call.effort);events.push('provider');
  return {text:call.effort==='low'?first:'{"changes":[]}',inputTokens:11,outputTokens:5};
 }};
 return {events,usage,calls,waits,hooks,client,controller,deny(){permitted=false;},run(){return translateBatch(job,job.items,client,hooks,controller.signal);}};
}

test('venue permission denial starts no provider call or cap admission',async()=>{
 const f=fixture();f.deny();
 assert.deepEqual(await f.run(),{kind:'failed',reason:'provider_unavailable'});
 assert.deepEqual(f.calls,[]);assert.deepEqual(f.usage,[]);assert.deepEqual(f.events,['permission']);
});
test('venue permission lost during cap admission starts no provider call',async()=>{
 const f=fixture();f.hooks.mayCall=async()=>{f.deny();return true;};
 assert.deepEqual(await f.run(),{kind:'failed',reason:'provider_unavailable'});
 assert.deepEqual(f.calls,[]);assert.deepEqual(f.usage,[]);
});
for(const at of ['provider','spent','renew'] as const)test(`venue downgrade during ${at} preserves the valid first pass without review`,async()=>{
 const f=fixture();
 if(at==='provider'){const respond=f.client.respond;f.client.respond=async(...args)=>{const reply=await respond(...args);f.deny();return reply;};}
 else{const original=f.hooks[at==='spent'?'spent':'attempted'];if(at==='spent')f.hooks.spent=async value=>{await (original as BatchHooks['spent'])(value);f.deny();};else f.hooks.attempted=async()=>{await (original as BatchHooks['attempted'])();f.deny();};}
 assert.deepEqual(await f.run(),done);assert.deepEqual(f.calls,['low']);
 assert.deepEqual(f.usage,[{inputTokens:11,outputTokens:5}]);assert.deepEqual(f.waits,[]);
 assert.ok(f.events.lastIndexOf('permission')>f.events.indexOf('renew'));
});
for(const phase of ['first','review'] as const)for(const response of ['invalid','retryable','unbilled'] as const)test(`venue downgrade after ${phase} ${response} reply forbids retries`,async()=>{
 const f=fixture(),respond=f.client.respond;
 f.client.respond=async(...args)=>{
  const reply=await respond(...args);
  if((args[0].effort==='medium')===(phase==='review')){
   f.deny();
   if(response!=='invalid')throw new ProviderError('server',undefined,response==='unbilled'?undefined:{inputTokens:11,outputTokens:5});
   return {...reply,text:'invalid'};
  }
  return reply;
 };
 assert.deepEqual(await f.run(),phase==='first'?{kind:'failed',reason:'provider_unavailable'}:done);
 assert.deepEqual(f.calls,phase==='first'?['low']:['low','medium']);assert.deepEqual(f.waits,[]);
 assert.equal(f.usage.length,(phase==='first'?1:2)-(response==='unbilled'?1:0));
 assert.equal(f.events.filter(e=>e==='renew').length,f.calls.length);
});
for(const phase of ['first','review'] as const)test(`venue downgrade while the ${phase} retry wait is pending stops the next call`,async()=>{
 const f=fixture(),respond=f.client.respond;let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{enter=resolve;}),pause=new Promise<void>(resolve=>{release=resolve;});
 let failed=false;
 f.client.respond=async(...args)=>{const reply=await respond(...args);if(!failed&&(args[0].effort==='medium')===(phase==='review')){failed=true;return {...reply,text:'invalid'};}return reply;};
 f.hooks.wait=async()=>{enter();await pause;};
 const pending=f.run();
 try{
  await entered;f.deny();release();
  assert.deepEqual(await pending,phase==='first'?{kind:'failed',reason:'provider_unavailable'}:done);
  assert.deepEqual(f.calls,phase==='first'?['low']:['low','medium']);assert.equal(f.usage.length,f.calls.length);
 }finally{release();await pending;}
});
for(const check of [1,2,3])test(`venue permission storage failure at check ${check} never retries provider work`,async()=>{
 const f=fixture(),failure=new Error('permission database unavailable');let n=0;
 f.hooks.stillPermitted=async()=>{if(++n===check)throw failure;return true;};
 await assert.rejects(f.run(),error=>error===failure);
 assert.deepEqual(f.calls,check===3?['low']:[]);assert.deepEqual(f.waits,[]);
 assert.equal(f.usage.length,check===3?1:0);
});
for(const check of [1,2,3])for(const answer of [true,false])test(`venue permission cancellation at check ${check} takes priority over ${answer}`,async()=>{
 const f=fixture();let n=0;f.hooks.stillPermitted=async()=>{if(++n===check)f.controller.abort();return answer||n!==check;};
 assert.deepEqual(await f.run(),{kind:'aborted'});
 assert.deepEqual(f.calls,check===3?['low']:[]);assert.equal(f.usage.length,check===3?1:0);assert.deepEqual(f.waits,[]);
});
test('venue permission does not replace the independent spending cap',async()=>{
 const f=fixture();f.hooks.mayCall=async()=>false;
 assert.deepEqual(await f.run(),{kind:'failed',reason:'cap_reached'});assert.deepEqual(f.calls,[]);
});
test('venue permission preserves accounting failures before checking permission again',async()=>{
 const f=fixture(),failure=new Error('spend unavailable');let checks=0;
 f.hooks.stillPermitted=async()=>{checks++;return true;};f.hooks.spent=async()=>{throw failure;};
 await assert.rejects(f.run(),error=>error===failure);
 assert.equal(checks,2);assert.deepEqual(f.calls,['low']);assert.equal(f.events.filter(e=>e==='renew').length,1);
});
test('venue permission allows an already admitted review result after downgrade',async()=>{
 const f=fixture(),respond=f.client.respond;
 f.client.respond=async(...args)=>{const reply=await respond(...args);if(args[0].effort==='medium'){f.deny();return {...reply,text:'{"changes":[{"id":"p01","language":"ca","name":"Cafè"}]}'};}return reply;};
 assert.deepEqual(await f.run(),{...done,results:[{...done.results[0],names:{ca:'Cafè',es:'Cafe [es]'}}],reviewApplied:1});
 assert.deepEqual(f.calls,['low','medium']);assert.equal(f.usage.length,2);assert.deepEqual(f.waits,[]);
});
test('venue permission restoration cannot reopen review after the completed pass was denied',async()=>{
 const f=fixture();let checks=0;
 f.hooks.stillPermitted=async()=>++checks!==3;
 assert.deepEqual(await f.run(),done);assert.deepEqual(f.calls,['low']);assert.equal(f.usage.length,1);
});
