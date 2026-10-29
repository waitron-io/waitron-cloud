import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLoopbackOpenAiClient,parseJob,translateBatch,type BatchHooks,type ModelClient} from '../src/index.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';

const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'es',enabled:['es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:null,staffName:'CAFE',existing:{},missing:['es']}],houseStyle:[]}));
const done={kind:'done',results:[{ref:'product:1',placeholder:false,names:{es:'CAFE [es]'},corrections:[]}],reviewApplied:0,reviewDropped:0,reviewFailed:false};

for(const phase of ['first pass','review'] as const)for(const answer of ['allow','decline','reject','cancel','cancel with refusal'] as const){
 test(`${phase} waits for a delayed cap check before ${answer}`,{timeout:5000},async t=>{
  let enter!:()=>void,resolve!: (value:boolean)=>void,reject!: (error:Error)=>void;
  const entered=new Promise<void>(ready=>{enter=ready;});
  const decision=new Promise<boolean>((yes,no)=>{resolve=yes;reject=no;});
  const error=new Error('cap storage unavailable'),controller=new AbortController();
  const events:string[]=[],usage:{inputTokens:number;outputTokens:number}[]=[];
  const target=phase==='first pass'?1:2;
  let checks=0,settled=false;
  const fake=await startFakeOpenAi(request=>isReview(request)?emptyReview({input_tokens:7,output_tokens:3}):echoFirstPass(request,{input_tokens:11,output_tokens:5}));
  const transport=createLoopbackOpenAiClient({apiKey:'synthetic',baseUrl:fake.baseUrl,timeoutMs:2000});
  const client:ModelClient={provider:transport.provider,model:transport.model,respond(call,signal){events.push(`http:${call.effort}`);return transport.respond(call,signal);}};
  const hooks:BatchHooks={
   async mayCall(){
    events.push('cap:start');assert.ok(++checks<=2,'unexpected cap retry');
    if(checks===target){enter();const allowed=await decision;events.push('cap:end');return allowed;}
    events.push('cap:end');return true;
   },
   async spent(tokens){usage.push(tokens);events.push(`spent:${tokens.inputTokens}/${tokens.outputTokens}`);},
   async attempted(){events.push('renew');},
   async wait(){assert.fail('admission must not retry');},
  };
  const pending=translateBatch(job,job.items,client,hooks,controller.signal)
   .then(value=>({value}),failure=>({error:failure as unknown})).finally(()=>{settled=true;});
  t.after(async()=>{resolve(true);try{await pending;}finally{await fake.close();}});
  const first=['cap:start','cap:end','http:low','spent:11/5','renew'];
  const review=['cap:start','cap:end','http:medium','spent:7/3','renew'];
  const before=target===2?first:[];
  {
   await Promise.race([entered,pending.then(()=>assert.fail('batch completed without requesting its cap answer'))]);
   assert.equal(settled,false,'batch returned while the cap answer was pending');
   // Observe entry to the real transport, before network scheduling can hide an early call.
   assert.deepEqual(events,[...before,'cap:start']);
   assert.equal(fake.requests.length,target-1);
   assert.deepEqual(usage,target===2?[{inputTokens:11,outputTokens:5}]:[]);
   if(answer==='reject')reject(error);
   else{if(answer==='cancel'||answer==='cancel with refusal')controller.abort();resolve(answer!=='decline'&&answer!=='cancel with refusal');}
   const result=await pending;
   if(answer==='reject'){
    assert.ok('error' in result);assert.equal(result.error,error);
    assert.deepEqual(events,[...before,'cap:start']);
   }else{
    assert.ok('value' in result);
    const expected=answer==='cancel'||answer==='cancel with refusal'?{kind:'aborted'}:answer==='decline'&&target===1?{kind:'failed',reason:'cap_reached'}:done;
    assert.deepEqual(result.value,expected);
    assert.deepEqual(events,answer==='allow'?[...first,...review]:[...before,'cap:start','cap:end']);
   }
   const calls=answer==='allow'?2:target-1;
   assert.deepEqual(fake.requests.map(request=>request.body.reasoning.effort),calls===2?['low','medium']:calls===1?['low']:[]);
   assert.deepEqual(usage,calls===2?[{inputTokens:11,outputTokens:5},{inputTokens:7,outputTokens:3}]:calls===1?[{inputTokens:11,outputTokens:5}]:[]);
  }
 });
}
