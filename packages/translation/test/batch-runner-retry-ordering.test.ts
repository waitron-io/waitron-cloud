import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,parseJob,translateBatch,type BatchHooks} from '../src/index.ts';
import {echoFirstPass,emptyReview,isReview,responsesBody,startFakeOpenAi} from './fake-openai.ts';

const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:null,staffName:'CAFE',existing:{},missing:['es']}],houseStyle:[]}));

// Retry scheduling must finish before another call can spend tokens.
for(const phase of ['first pass','review'] as const)for(const ending of ['resolve','abort then resolve','abort then reject','reject'] as const){
 test(`${phase} retry waits for a delayed pause to ${ending}`,async()=>{
  let enter!:()=>void,release!:()=>void,reject!:(error:Error)=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;});
  const pause=new Promise<void>((resolve,fail)=>{release=resolve;reject=fail;});
  const controller=new AbortController(),failure=new Error('retry scheduler unavailable');
  const usage:{inputTokens:number;outputTokens:number}[]=[],waits:number[]=[],waitSignals:AbortSignal[]=[];
  let allowed=0,renewed=0,failedOnce=false,settled=false;
  const target=phase==='first pass'?1:2;
  const fake=await startFakeOpenAi(request=>{
   if(isReview(request)===(phase==='review')&&!failedOnce){
    failedOnce=true;return {json:responsesBody('invalid reply',{input_tokens:13,output_tokens:2})};
   }
   return isReview(request)?emptyReview({input_tokens:7,output_tokens:3}):echoFirstPass(request,{input_tokens:11,output_tokens:5});
  });
  const hooks:BatchHooks={
   async mayCall(){allowed++;return true;},
   async spent(tokens){usage.push(tokens);},
   async attempted(){renewed++;},
   async wait(ms,signal){waits.push(ms);waitSignals.push(signal);enter();await pause;},
  };
  const client=createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl:fake.baseUrl,timeoutMs:5000});
  const pending=translateBatch(job,job.items,client,hooks,controller.signal)
   .then(value=>({value}),(error:unknown)=>({error})).finally(()=>{settled=true;});
  const priorUsage=phase==='first pass'?[]:[{inputTokens:11,outputTokens:5}];
  try{
   await entered;
   if(ending.startsWith('abort'))controller.abort();
   // Give an omitted await a turn to reach admission, even before HTTP arrives.
   await setImmediate();await setImmediate();
   assert.equal(settled,false,'batch settled before its retry pause finished');
   assert.equal(allowed,target,'next call was admitted while the retry pause was pending');
   assert.equal(fake.requests.length,target,'next HTTP call started while the retry pause was pending');
   assert.equal(renewed,target);
   assert.deepEqual(waits,[2000]);assert.deepEqual(waitSignals,[controller.signal]);
   assert.deepEqual(usage,[...priorUsage,{inputTokens:13,outputTokens:2}]);
   if(ending.endsWith('reject'))reject(failure);else release();
   const outcome=await pending;
   if(ending==='reject'){assert.ok('error' in outcome);assert.equal(outcome.error,failure);}
   else if(ending.startsWith('abort'))assert.deepEqual(outcome,{value:{kind:'aborted'}});
   else assert.deepEqual(outcome,{value:{kind:'done',results:[{ref:'product:1',placeholder:false,names:{es:'CAFE [es]'},corrections:[]}],reviewApplied:0,reviewDropped:0,reviewFailed:false}});
   if(ending==='resolve'){
    assert.deepEqual(fake.requests.map(request=>request.body.reasoning.effort),phase==='first pass'?['low','low','medium']:['low','medium','medium']);
    assert.deepEqual(usage,phase==='first pass'?[{inputTokens:13,outputTokens:2},{inputTokens:11,outputTokens:5},{inputTokens:7,outputTokens:3}]:[{inputTokens:11,outputTokens:5},{inputTokens:13,outputTokens:2},{inputTokens:7,outputTokens:3}]);
    assert.equal(allowed,3);assert.equal(renewed,3);
   }else{
    assert.deepEqual(fake.requests.map(request=>request.body.reasoning.effort),phase==='first pass'?['low']:['low','medium']);
    assert.deepEqual(usage,[...priorUsage,{inputTokens:13,outputTokens:2}]);
    assert.equal(allowed,target);assert.equal(renewed,target);
   }
   assert.deepEqual(waits,[2000]);
  }finally{controller.abort();release();await pending;await fake.close();}
 });
}
