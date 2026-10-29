import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,parseJob,translateBatch,type BatchHooks} from '../src/index.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';

const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:null,staffName:'CAFE',existing:{},missing:['es']}],houseStyle:[]}));

// Cancellation cannot erase a storage failure after provider usage has been billed.
for(const phase of ['first pass','review'] as const)for(const failing of ['spending','renewal','both'] as const){
 test(`${phase} cancellation during delayed ${failing} failure retains storage errors and stops provider work`,async()=>{
  let enter!:()=>void,finish!:()=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;}),release=new Promise<void>(resolve=>{finish=resolve;});
  const controller=new AbortController(),spendError=new Error('spending unavailable'),renewError=new Error('lease unavailable');
  const events:string[]=[],usage:{inputTokens:number;outputTokens:number}[]=[];
  const target=phase==='first pass'?1:2;
  let spends=0,renewals=0,settled=false;
  const fake=await startFakeOpenAi(request=>isReview(request)?emptyReview({input_tokens:7,output_tokens:3}):echoFirstPass(request,{input_tokens:11,output_tokens:5}));
  const hooks:BatchHooks={
   async mayCall(){events.push('allow');return true;},
   async spent(tokens){
    events.push('spent:start');usage.push(tokens);spends++;
    if(spends===target&&failing!=='renewal'){
     enter();await release;events.push('spent:failed');throw spendError;
    }
    events.push('spent:end');
   },
   async attempted(){
    events.push('renew:start');renewals++;
    if(renewals===target&&failing!=='spending'){
     if(failing==='renewal'){enter();await release;}
     events.push('renew:failed');throw renewError;
    }
    events.push('renew:end');
   },
   async wait(){events.push('wait');},
  };
  const client=createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl:fake.baseUrl,timeoutMs:5000});
  const pending=translateBatch(job,job.items,client,hooks,controller.signal).then(
   value=>{settled=true;return {value};},
   (error:unknown)=>{settled=true;return {error};},
  );
  const completedCall=['allow','spent:start','spent:end','renew:start','renew:end'];
  try{
   await entered;
   controller.abort();
   await setImmediate();await setImmediate();
   assert.equal(settled,false,'cancellation returned before storage work settled');
   assert.deepEqual(events,[...(target===2?completedCall:[]),'allow','spent:start',...(failing==='renewal'?['spent:end','renew:start']:[])]);
   assert.equal(fake.requests.length,target,'another provider call began while storage work was pending');
   finish();
   const result=await pending;
   assert.ok('error' in result,'cancellation hid a storage failure');
   if(failing==='both'){
    assert.ok(result.error instanceof AggregateError);
    assert.equal(result.error.errors.length,2);
    assert.equal(result.error.errors[0],spendError);
    assert.equal(result.error.errors[1],renewError);
   }else assert.equal(result.error,failing==='spending'?spendError:renewError);
   assert.deepEqual(events,[...(target===2?completedCall:[]),'allow','spent:start',failing==='renewal'?'spent:end':'spent:failed','renew:start',failing==='spending'?'renew:end':'renew:failed']);
   assert.deepEqual(usage,target===1?[{inputTokens:11,outputTokens:5}]:[{inputTokens:11,outputTokens:5},{inputTokens:7,outputTokens:3}]);
   assert.deepEqual([spends,renewals],[target,target]);
   assert.deepEqual(fake.requests.map(request=>request.body.reasoning.effort),target===1?['low']:['low','medium']);
  }finally{finish();await pending;await fake.close();}
 });
}
