import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {RegistrationStore,type ConnectionBinding} from '../src/index.ts';
import {PairingStore} from '../src/pairing.ts';
import type {PairingClaims} from '../src/pairing-proof.ts';
import {venueServiceFixture,event,read,set,rows,type Fixture} from './fixtures/venue-service.ts';

async function approved(f:Fixture,kind:'registration'|'pairing',replay:boolean){
 const account=randomUUID(),venueId=f.venues[0]!;
 await f.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[account]);
 await f.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues) VALUES($1,$2,true)',[account,f.scope.organisationId]);
 await f.pool.query("UPDATE organisations SET name='Test organisation' WHERE id=$1",[f.scope.organisationId]);
 await f.pool.query("UPDATE legal_businesses SET name='Test business' WHERE id=$1",[f.scope.legalBusinessId]);
 const key=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url');
 await f.pool.query('UPDATE installations SET public_key=$2 WHERE venue_id=$1 AND superseded_by IS NULL',[venueId,key]);
 if(kind==='registration'){
  const binding:ConnectionBinding={...f.scope,operationId:randomUUID(),installationKey:key,localVenueId:venueId,environment:'test'};
  const writer=new RegistrationStore(f.pool),reader=new RegistrationStore(f.peer);
  await writer.start(binding);await writer.approveLocal(binding,randomUUID());await writer.approveCloud(binding,account);
  const first=replay?await writer.complete(binding):undefined;
  return {run:()=>reader.complete(binding),first,venueId};
 }
 const c:PairingClaims={origin:'https://cloud.example',action:'start',requestId:randomUUID(),publicKey:key,localVenueId:venueId,environment:'test',code:'12345678',organisationId:'',legalBusinessId:'',issuedAt:Date.now()};
 const writer=new PairingStore(f.pool),reader=new PairingStore(f.peer);
 await writer.start(c);
 // Supply the stored browser approval; completion still runs its real membership and binding checks.
 await f.pool.query('UPDATE pairing_requests SET cloud_account_id=$2,organisation_id=$3,legal_business_id=$4 WHERE id=$1',[c.requestId,account,f.scope.organisationId,f.scope.legalBusinessId]);
 const complete:PairingClaims={...c,action:'complete',code:'',...f.scope};
 const initial=replay?await writer.complete(complete):undefined;
 return {run:async()=>{const result=await reader.complete(complete);assert.ok(result.registration);return result.registration;},first:initial?.registration,venueId};
}
async function waitForBlock(f:Fixture,blocker:number|number[],settled:()=>boolean=()=>false,application=f.schema+'_peer'){
 for(let i=0;i<300;i++){
  const waiters=await f.admin.query('SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND pg_blocking_pids(pid) && $2::int[]',[application,Array.isArray(blocker)?blocker:[blocker]]);
  if(waiters.rowCount)return Number(waiters.rows[0].pid);
  if(settled())break;
  await delay(10);
 }
 assert.fail('completion must wait for the policy lock before installation access');
}

// Removing the organisation or replay venue lock lets completion return behind a policy change.
for(const kind of ['registration','pairing'] as const)for(const replay of [false,true]){
 test(`${kind} ${replay?'replay':'completion'} locks organisation before venue and installations`,async()=>{
  const f=await venueServiceFixture(),holder=await f.pool.connect(),observer=await f.pool.connect();
  let pending:Promise<unknown>|undefined;
  try{
   await set(f);const action=await approved(f,kind,replay),before=await rows(f);
   await holder.query('BEGIN');await holder.query('SELECT id FROM organisations WHERE id=$1 FOR NO KEY UPDATE',[f.scope.organisationId]);
   const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   let settled=false;pending=action.run().finally(()=>{settled=true;});void pending.catch(()=>{});
   await waitForBlock(f,pid,()=>settled);
   await observer.query('BEGIN');
   await observer.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE NOWAIT',[action.venueId]);
   await observer.query('SELECT id FROM installations WHERE venue_id=$1 FOR UPDATE NOWAIT',[action.venueId]);
   await observer.query('ROLLBACK');await holder.query('COMMIT');
   const result=await pending;if(action.first)assert.deepEqual(result,action.first);
   assert.deepEqual(await rows(f),before);
  }finally{await observer.query('ROLLBACK');await holder.query('ROLLBACK');await pending?.catch(()=>{});observer.release();holder.release();await f.close();}
 });
 test(`${kind} ${replay?'replay':'completion'} waits for a venue transition without holding installations`,async()=>{
  const f=await venueServiceFixture(),holder=await f.pool.connect(),observer=await f.pool.connect();
  let pending:Promise<unknown>|undefined,transition:Promise<unknown>|undefined;
  try{
   await set(f);const action=await approved(f,kind,replay);
   await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[action.venueId]);
   const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const before=await f.store.venue(f.scope,action.venueId);
   transition=Promise.resolve(f.store.execute(f.scope,event(),{type:'set_venue',venueId:action.venueId,expectedRevision:before.revision,value:{level:'registered',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}}));void transition.catch(()=>{});
   const writer=await waitForBlock(f,pid,()=>false,f.schema);
   let settled=false;pending=action.run().finally(()=>{settled=true;});void pending.catch(()=>{});
   await waitForBlock(f,[pid,writer],()=>settled);
   await observer.query('BEGIN');await observer.query('SELECT id FROM installations WHERE venue_id=$1 FOR UPDATE NOWAIT',[action.venueId]);await observer.query('ROLLBACK');
   await holder.query('COMMIT');await transition;const result=await pending;if(action.first)assert.deepEqual(result,action.first);
   assert.equal((await read(f)).level,'registered');
   for(const service of (await rows(f)).services)if(service.service!=='content_translation'){assert.equal(service.state,'unconfigured');assert.deepEqual(service.configuration,{});}
  }finally{await observer.query('ROLLBACK');await holder.query('ROLLBACK');await transition?.catch(()=>{});await pending?.catch(()=>{});observer.release();holder.release();await f.close();}
 });
}

// Unenrolled venues keep the legacy ability to finish linking while an organisation setter waits.
for(const kind of ['registration','pairing'] as const)test(`unenrolled ${kind} completion preserves the legacy organisation wait boundary`,async()=>{
 const f=await venueServiceFixture(),holder=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  const action=await approved(f,kind,false),before=await rows(f);
  await holder.query('BEGIN');await holder.query('SELECT id FROM organisations WHERE id=$1 FOR NO KEY UPDATE',[f.scope.organisationId]);
  let settled=false;pending=action.run().finally(()=>{settled=true;});void pending.catch(()=>{});
  for(let i=0;i<300&&!settled;i++)await delay(10);
  assert.equal(settled,true,'unenrolled completion must retain its legacy path during an organisation change');
  const result=await pending;assert.ok(result&&typeof result==='object'&&'venueId' in result);assert.equal(result.venueId,action.venueId);
  assert.deepEqual(await rows(f),before);
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});
