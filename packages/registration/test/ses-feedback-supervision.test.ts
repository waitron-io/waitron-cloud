import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {config,keys} from './fixtures/mail-attempt.ts';

async function service() {
 const module=await import('../src/ses-feedback-service.ts').catch(()=>assert.fail('The bounded feedback supervisor is missing'));
 assert.equal(typeof module.runSesFeedbackConsumer,'function');return module.runSesFeedbackConsumer;
}
async function settle(){for(let i=0;i<20;i++)await Promise.resolve();}
function fixture(){
 const pool=new Pool(),stop=new AbortController();let closed=0,receives=0;
 const statuses:Record<string,unknown>[]=[];
 const queue={async receive(signal:AbortSignal):Promise<{body:string;receiptHandle:string}[]>{
  receives++;await new Promise<never>((_resolve,reject)=>{
   if(signal.aborted)reject(Error('private response'));
   else signal.addEventListener('abort',()=>reject(Error('private response')),{once:true});
  });return [];
 },async delete(){assert.fail('empty queue cannot delete');},close(){closed++;}};
 const options={pool,config:config(),recipientKeys:keys,queue,signal:stop.signal,
  onStatus:(status:Record<string,unknown>)=>{statuses.push(status);}};
 return {pool,stop,queue,statuses,options,get closed(){return closed;},get receives(){return receives;}};
}

test('supervision starts two receives and aborts them before draining its owned pool',async()=>{
 const run=await service(),f=fixture();const work=run(f.options);
 await settle();assert.equal(f.receives,2);f.stop.abort();await work;
 assert.equal(f.receives,2);assert.equal(f.closed,1);assert.equal(f.pool.ended,true);
 assert.ok(f.statuses.some(s=>s.state==='stopped'));assert.doesNotMatch(JSON.stringify(f.statuses),/private response/);
});

test('an already stopped supervisor starts no receives but still closes its resources',async()=>{
 const run=await service(),f=fixture();f.stop.abort();await run(f.options);
 assert.equal(f.receives,0);assert.equal(f.closed,1);assert.equal(f.pool.ended,true);
});

test('once mode polls both slots and keeps failed sampling out of public diagnostics',async()=>{
 const run=await service(),f=fixture();f.queue.receive=async()=>[];
 await assert.doesNotReject(run({...f.options,once:true,sample:()=>{throw Error('private sampling token');}}));
 assert.equal(f.closed,1);assert.equal(f.pool.ended,true);
 assert.ok(f.statuses.length>=3);assert.equal(f.statuses.at(-1)!.ready,false);
 assert.ok(f.statuses.some(status=>status.state==='stale'));assert.equal(f.statuses.at(-1)!.state,'stopped');
 assert.doesNotMatch(JSON.stringify(f.statuses),/private|token/);
});

test('once mode waits for the other slot to settle before reporting a fixed failure and closing',async()=>{
 const run=await service(),f=fixture();let calls=0,release:()=>void=()=>{},finished=false;
 f.queue.receive=async()=>{if(++calls===1)throw Error('private provider error');
  await new Promise<void>(resolve=>{release=resolve;});return [];};
 const work=run({...f.options,once:true}).finally(()=>{finished=true;});
 const rejected=assert.rejects(work,/^Error: ses_feedback_consumer_failed$/);
 await settle();assert.equal(calls,2);assert.equal(finished,false);assert.equal(f.closed,0);
 release();await rejected;assert.equal(f.closed,1);assert.equal(f.pool.ended,true);
 assert.doesNotMatch(JSON.stringify(f.statuses),/private provider/);
});

test('shutdown refuses to wait beyond twenty seconds for an uncooperative injected receive',async t=>{
 const run=await service(),f=fixture();t.mock.timers.enable({apis:['setTimeout']});
 f.queue.receive=async()=>new Promise(()=>{});
 let finished=false;const work=run(f.options).finally(()=>{finished=true;});
 const rejected=assert.rejects(work,/^Error: ses_feedback_shutdown_failed$/);
 await settle();f.stop.abort();t.mock.timers.tick(19999);await settle();assert.equal(finished,false);
 t.mock.timers.tick(1);await settle();assert.equal(finished,true,'the shutdown bound must settle the command');
 await rejected;assert.equal(f.closed,1);assert.equal(f.pool.ended,true);
});

test('pool cleanup has its own five-second bound even without an outside signal',async t=>{
 const run=await service(),f=fixture();t.mock.timers.enable({apis:['setTimeout']});
 const end=f.pool.end.bind(f.pool);f.pool.end=async()=>new Promise(()=>{});f.queue.receive=async()=>[];
 let finished=false;const work=run({...f.options,once:true}).finally(()=>{finished=true;});
 const rejected=assert.rejects(work,/^Error: ses_feedback_cleanup_failed$/);
 try{await settle();t.mock.timers.tick(5000);await settle();assert.equal(finished,true,'cleanup must settle within its own bound');
  await rejected;assert.equal(f.closed,1);}finally{await end();}
});

test('an idle pool error stops the service and exposes only a fixed failure',async()=>{
 const run=await service(),f=fixture();const work=run(f.options);
 const rejected=assert.rejects(work,/^Error: ses_feedback_consumer_failed$/);
 await settle();assert.doesNotThrow(()=>f.pool.emit('error',Error('private database URL')));await rejected;
 assert.equal(f.closed,1);assert.equal(f.pool.ended,true);assert.doesNotMatch(JSON.stringify(f.statuses),/private database/);
});

test('hung cleanup cannot add five seconds to an already expired shutdown grace',async t=>{
 const run=await service(),f=fixture();t.mock.timers.enable({apis:['setTimeout']});
 const end=f.pool.end.bind(f.pool);f.pool.end=async()=>new Promise(()=>{});f.queue.receive=async()=>new Promise(()=>{});
 let finished=false;const work=run(f.options).finally(()=>{finished=true;});
 const rejected=assert.rejects(work,/^Error: ses_feedback_shutdown_failed$/);
 try{await settle();f.stop.abort();t.mock.timers.tick(20000);await settle();
  assert.equal(finished,true,'cleanup must share the existing shutdown deadline');await rejected;
 }finally{await end();}
});

test('a failing status sink stops new work and reports no supplied exception text',async()=>{
 const run=await service(),f=fixture();
 const work=run({...f.options,onStatus:()=>{throw Error('private health sink');}});let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await assert.rejects(Promise.race([work,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('status sink was ignored')),500);})]),/^Error: ses_feedback_consumer_failed$/);
  assert.equal(f.receives,0);assert.equal(f.closed,1);assert.equal(f.pool.ended,true);
 }finally{clearTimeout(timer);f.stop.abort();await work.catch(()=>{});}
});

test('shutdown closes a transport that ignores caller abort before waiting for its operations',async()=>{
 const run=await service(),f=fixture();const pending:((reason:Error)=>void)[]=[];
 f.queue.receive=async()=>new Promise((_resolve,reject)=>pending.push(reject));
 const close=f.queue.close;f.queue.close=()=>{close();pending.forEach(reject=>reject(Error('private aborted socket')));};
 const work=run(f.options);await settle();f.stop.abort();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const outcome=await Promise.race([work.then(()=> 'closed'),new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('still waiting'),500);})]);
  assert.equal(outcome,'closed');assert.equal(f.closed,1);assert.equal(f.pool.ended,true);
 }finally{clearTimeout(timer);pending.forEach(reject=>reject(Error('fixture cleanup')));await work.catch(()=>{});}
});

test('a transport close failure still drains the database pool and reports a fixed failure',async()=>{
 const run=await service(),f=fixture();f.queue.receive=async()=>[];f.queue.close=()=>{throw Error('private close response');};
 await assert.rejects(run({...f.options,once:true}),/^Error: ses_feedback_consumer_failed$/);
 assert.equal(f.pool.ended,true);assert.doesNotMatch(JSON.stringify(f.statuses),/private close/);
});
