import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import {test} from 'node:test';
import {runTestEmailQueues} from './email-worker.mjs';

test('signing listing failures let one-shot email delivery finish',async t=>{
 const logged=t.mock.method(console,'error',()=>{});
 const signing=async()=>{throw Error('listing failed');};
 for(const worked of [true,false])assert.equal(await runTestEmailQueues({account:{runOnce:async()=>worked},signing,once:true}),worked);
 assert.equal(logged.mock.callCount(),2);
 assert.ok(logged.mock.calls.every(call=>String(call.arguments[0]).includes('signing pass')));
});

test('a signing listing failure leaves continuous email delivery running',async t=>{
 const logged=t.mock.method(console,'error',()=>{});
 const stop=new AbortController();
 const signal=AbortSignal.any([stop.signal,AbortSignal.timeout(5_000)]);
 let accountCalls=0;
 const account={async runOnce(){
  if(++accountCalls===5)stop.abort();
  return false;
 }};
 const signing=async()=>{throw Error('listing failed');};
 await runTestEmailQueues({account,signing,signal});
 assert.ok(accountCalls>=5,'the account queue starts another batch after signing fails');
 assert.equal(logged.mock.callCount(),1);
});

test('signing waits a minute between passes and drains the active pass on shutdown',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 // The worker imports the timer as a named built-in export.
 syncBuiltinESMExports();
 const stop=new AbortController(),held=Promise.withResolvers();
 const turn=()=>new Promise(resolve=>setImmediate(resolve));
 let calls=0,finished=false;
 const running=runTestEmailQueues({account:{runOnce:async()=>false},signal:stop.signal,
  signing:async()=>{if(++calls===2)await held.promise;}}).then(()=>{finished=true;});
 try{
  await turn();assert.equal(calls,1);
  t.mock.timers.tick(59_999);await turn();assert.equal(calls,1);
  t.mock.timers.tick(1);await turn();assert.equal(calls,2);
  stop.abort();await turn();assert.equal(finished,false);
  held.resolve();await running;
  assert.equal(calls,2);
 }finally{
  stop.abort();held.resolve();
  try{await running;}finally{t.mock.timers.reset();syncBuiltinESMExports();}
 }
});

for(const withRelay of [false,true])test(`email loops bound active handoffs and drain on account failure, relay ${withRelay?'on':'off'}`,async()=>{
 const stop=new AbortController(),held=[];let reached;
 const ready=new Promise(resolve=>{reached=resolve;});
 const calls={account:0,relay:0};let active=0;
 const queue=kind=>({runOnce(){
  calls[kind]++;active++;
  // A broken stop propagation must finish the probe, then fail the call-count assertion.
  if(kind==='relay'&&calls.relay>1){stop.abort();active--;return Promise.resolve(false);}
  return new Promise((resolve,reject)=>{
   held.push({kind,resolve,reject});if(held.length>=4)reached();
  }).finally(()=>active--);
 }});
 const running=runTestEmailQueues({account:queue('account'),relay:withRelay?queue('relay'):undefined,signal:stop.signal});
 let settled=false;void running.then(()=>{settled=true;},()=>{settled=true;});
 try{
  await ready;
  assert.deepEqual(calls,{account:withRelay?3:4,relay:withRelay?1:0});
  const account=held.find(entry=>entry.kind==='account');account.reject(Error('account queue refused'));
  for(const entry of held)if(entry!==account&&entry.kind==='account')entry.resolve(true);
  // Let the account loop observe its complete failed batch before releasing the relay handoff.
  await new Promise(resolve=>setImmediate(resolve));
  if(withRelay)assert.equal(settled,false,'worker completion must wait for the held relay handoff');
  for(const entry of held)if(entry.kind==='relay')entry.resolve(true);
  await assert.rejects(running,/account queue refused/);
  assert.equal(active,0,'worker completion must wait for every started handoff');
  assert.equal(calls.relay,withRelay?1:0,'an account failure must stop further relay handoffs');
 }finally{stop.abort();for(const entry of held)entry.resolve(false);await running.catch(()=>{});}
});
