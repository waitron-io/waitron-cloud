import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTestEmailQueues} from './email-worker.mjs';

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
