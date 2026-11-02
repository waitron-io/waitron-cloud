import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {LifecycleStore} from '../src/data-lifecycle.ts';
import {lifecycleFixture} from './fixtures/data-lifecycle.ts';

const f=lifecycleFixture('lifecycle_restart');
for(const stage of ['claimed','intent','called','observed'])test(`process death after ${stage} preserves uncertainty and never repeats the call`,async t=>{
 const store=new LifecycleStore(f.pool),operationId=randomUUID(),effectId=randomUUID();
 const ref=await store.request({venueId:f.venueId,operationId,expectedRevision:0,kind:'cancel',fingerprint:'a'.repeat(64)});
 await f.pool.query('CREATE TABLE lifecycle_external_calls(operation_id uuid PRIMARY KEY)');
 const child=spawn(process.execPath,[new URL('./fixtures/data-lifecycle-child.ts',import.meta.url).pathname,JSON.stringify({ref,operationId,effectId,stage})],
  {env:{...process.env,TEST_DATABASE_URL:f.connectionString,LIFECYCLE_TEST_OPTIONS:f.options},stdio:['ignore','ignore','pipe','ipc']});
 assert.ok(child.stderr);
 let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes.toString();});
 const closed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>resolve());});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;});
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('child did not reach committed boundary: '+stderr)),8000);
  child.once('message',message=>{clearTimeout(timer);try{assert.equal(message,stage);resolve();}catch(error){reject(error);}});
  child.once('exit',()=>{clearTimeout(timer);reject(new Error('child exited before boundary: '+stderr));});
 });
 child.kill('SIGKILL');await closed;assert.equal(child.signalCode,'SIGKILL');
 await f.pool.query("UPDATE data_lifecycle_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE venue_id=$1",[f.venueId]);
 const restarted=new LifecycleStore(f.pool),claim=await restarted.claim(ref,operationId);assert.ok(claim);assert.equal(claim.claimRevision,2);
 const view=await restarted.read(f.venueId);
 const expectedCount=stage==='called'||stage==='observed'?1:0;
 assert.equal((await f.pool.query('SELECT count(*) FROM lifecycle_external_calls')).rows[0].count,String(expectedCount));
 const effect={effectId,requestFingerprint:'b'.repeat(64),phase:'intent' as const};
 if(stage==='claimed')assert.equal(view.effects.length,0);
 else if(stage==='observed')assert.equal(view.effects[0]!.phase,'confirmed');
 else {
  assert.equal(view.effects[0]!.phase,'uncertain');
  await assert.rejects(restarted.recordEffect(ref,operationId,claim.claimRevision,effect),{message:'effect_uncertain'});
  // This independent lookup observes the durable fixture service, not the journal's cached phase.
  const exists=Boolean((await f.pool.query('SELECT 1 FROM lifecycle_external_calls WHERE operation_id=$1',[operationId])).rowCount);
  await restarted.recordEffect(ref,operationId,claim.claimRevision,{...effect,phase:exists?'confirmed':'refused'});
  assert.equal((await restarted.read(f.venueId)).effects[0]!.phase,exists?'confirmed':'refused');
 }
 assert.equal((await f.pool.query('SELECT count(*) FROM lifecycle_external_calls')).rows[0].count,String(expectedCount));
});
