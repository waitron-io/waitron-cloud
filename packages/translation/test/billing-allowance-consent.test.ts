import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {BillingStore,createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {connectedVenue,database,giveConsent} from './fixtures.ts';

type Actor={accountId:string;consentId:string};
type ReadActor=(client:PoolClient,venueId:string)=>Promise<Actor>;
async function fixture(){
 const module=await import(new URL('../src/consent.ts',import.meta.url).href);
 assert.equal(typeof module.readAllowanceConsentActor,'function','allowance admission must resolve the exact current consent actor');
 const read=module.readAllowanceConsentActor as ReadActor,db=await database();
 try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const v=await connectedVenue(db,issuer,'https://cloud.example.test');
  await new BillingStore(db.pool).execute({organisationId:v.organisationId,legalBusinessId:v.legalBusinessId},
   {key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},{type:'ensure_business'});
  const other=randomUUID();
  await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[other]);
  await db.pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[other,other+'@consent.invalid']);
  await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[other,v.organisationId]);
  await giveConsent(db,v);
  const consentId=(await db.pool.query('SELECT id FROM translation_consents WHERE venue_id=$1',[v.venueId])).rows[0].id as string;
  return {db,v,other,consentId,read,run:()=>transaction(db.secondPool,client=>read(client,v.venueId))};
 }catch(error){await db.close();throw error;}
}
async function blocked(f:Awaited<ReturnType<typeof fixture>>,pid:number,settled:()=>boolean){
 const until=performance.now()+5000;
 while(performance.now()<until&&!settled()){
  if((await f.db.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.db.schema,pid])).rowCount)return;
  await setImmediate();
 }
 assert.fail('consent admission must reach the captured database lock');
}

// Choosing a different owner or accepting a replaced consent must break these results.
test('allowance consent selects the exact consenting owner among two owners',async()=>{
 const f=await fixture();try{
  assert.deepEqual(await f.run(),{accountId:f.v.accountId,consentId:f.consentId});
  assert.equal((await f.db.pool.query('SELECT count(*) FROM billing_allowance_reservations')).rows[0].count,'0');
 }finally{await f.db.close();}
});

for(const change of ['absent','withdrawn','version','disabled','unverified','removed owner','not owner','foreign owner'] as const)
 test('allowance consent refuses '+change,async()=>{
  const f=await fixture();try{
   if(change==='absent')await f.db.pool.query('DELETE FROM translation_consents');
   if(change==='withdrawn')await f.db.pool.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp()');
   if(change==='version')await f.db.pool.query("UPDATE translation_consents SET consent_version='old'");
   if(change==='disabled')await f.db.pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[f.v.accountId]);
   if(change==='unverified')await f.db.pool.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[f.v.accountId]);
   if(change==='removed owner')await f.db.pool.query('DELETE FROM organisation_memberships WHERE account_id=$1',[f.v.accountId]);
   if(change==='not owner')await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.v.accountId]);
   if(change==='foreign owner'){
    const organisationId=randomUUID();await f.db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);
    await f.db.pool.query('DELETE FROM organisation_memberships WHERE account_id=$1',[f.other]);
    await f.db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[f.other,organisationId]);
    await f.db.pool.query('UPDATE translation_consents SET account_id=$1',[f.other]);
   }
   await assert.rejects(f.run(),{code:'consent_required'});
  }finally{await f.db.close();}
 });

for(const boundary of ['account','credential','membership','organisation','business','billing business','venue','consent'] as const)
 test('allowance consent waits in authority order at '+boundary,async()=>{
  const f=await fixture(),holder=await f.db.pool.connect(),observer=await f.db.pool.connect();let pending:Promise<Actor>|undefined;
  try{
   await holder.query('BEGIN');
   const locks={account:['cloud_accounts','id',f.v.accountId],credential:['cloud_credentials','account_id',f.v.accountId],
    membership:['organisation_memberships','account_id',f.v.accountId],organisation:['organisations','id',f.v.organisationId],
    business:['legal_businesses','id',f.v.legalBusinessId],'billing business':['billing_businesses','legal_business_id',f.v.legalBusinessId],venue:['venues','id',f.v.venueId]} as const;
   if(boundary==='consent')await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0))",[f.v.venueId]);
   else{const [table,column,id]=locks[boundary];await holder.query(`SELECT 1 FROM ${table} WHERE ${column}=$1 FOR UPDATE`,[id]);}
   const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
   let settled=false;pending=f.run().finally(()=>{settled=true;});void pending.catch(()=>{});await blocked(f,pid,()=>settled);
   await observer.query('BEGIN');
   // Earlier waits cannot hold later parent or machine locks, avoiding reverse-order deadlocks.
   if(['account','credential','membership','organisation'].includes(boundary))await observer.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE NOWAIT',[f.v.venueId]);
   await observer.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE NOWAIT',[f.v.installationId]);
   await observer.query('ROLLBACK');
   if(boundary==='account')await holder.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[f.v.accountId]);
   if(boundary==='credential')await holder.query('UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1',[f.v.accountId]);
   if(boundary==='membership')await holder.query('DELETE FROM organisation_memberships WHERE account_id=$1',[f.v.accountId]);
   if(['organisation','business','billing business','venue','consent'].includes(boundary))await holder.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE id=$1',[f.consentId]);
   await holder.query('COMMIT');await assert.rejects(pending,{code:'consent_required'});
   assert.equal((await f.db.pool.query('SELECT count(*) FROM billing_allowance_reservations')).rows[0].count,'0');
  }finally{await observer.query('ROLLBACK');await holder.query('ROLLBACK');await pending?.catch(()=>{});observer.release();holder.release();await f.db.close();}
 });

test('allowance consent keeps every authority lock until the caller commits service admission',async()=>{
 const f=await fixture(),client=await f.db.pool.connect(),observer=await f.db.pool.connect();
 try{
  await client.query('BEGIN');assert.deepEqual(await f.read(client,f.v.venueId),{accountId:f.v.accountId,consentId:f.consentId});
  await observer.query('BEGIN');
  const locks=[['cloud_accounts','id',f.v.accountId],['cloud_credentials','account_id',f.v.accountId],
   ['organisation_memberships','account_id',f.v.accountId],['organisations','id',f.v.organisationId],
   ['legal_businesses','id',f.v.legalBusinessId],['billing_businesses','legal_business_id',f.v.legalBusinessId],
   ['venues','id',f.v.venueId],['translation_consents','id',f.consentId]];
  for(const [table,column,id] of locks){
   await observer.query('SAVEPOINT authority_lock');
   await assert.rejects(observer.query(`SELECT 1 FROM ${table} WHERE ${column}=$1 FOR UPDATE NOWAIT`,[id]),{code:'55P03'},table+' authority must remain locked');
   await observer.query('ROLLBACK TO SAVEPOINT authority_lock');
  }
  assert.equal((await observer.query("SELECT pg_try_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0)) AS acquired",[f.v.venueId])).rows[0].acquired,false);
  await observer.query('ROLLBACK');await client.query('COMMIT');
  await observer.query('BEGIN');
  for(const [table,column,id] of locks)await observer.query(`SELECT 1 FROM ${table} WHERE ${column}=$1 FOR UPDATE NOWAIT`,[id]);
  assert.equal((await observer.query("SELECT pg_try_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0)) AS acquired",[f.v.venueId])).rows[0].acquired,true);
 }finally{await observer.query('ROLLBACK');await client.query('ROLLBACK');observer.release();client.release();await f.db.close();}
});

for(const replacement of ['same owner','other owner'] as const)test('allowance consent cannot substitute a replacement from '+replacement,async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();let pending:Promise<Actor>|undefined;
 try{
  await holder.query('BEGIN');await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0))",[f.v.venueId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
  let settled=false;pending=f.run().finally(()=>{settled=true;});void pending.catch(()=>{});await blocked(f,pid,()=>settled);
  await holder.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE id=$1',[f.consentId]);
  const consentId=randomUUID(),accountId=replacement==='same owner'?f.v.accountId:f.other;
  await holder.query(`INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers)
   VALUES($1,$2,$3,$4,'providers-2026-10-14',ARRAY['openai','anthropic','google'])`,[consentId,f.v.venueId,f.v.organisationId,accountId]);
  await holder.query('COMMIT');await assert.rejects(pending,{code:'consent_required'});
  assert.deepEqual(await f.run(),{accountId,consentId});
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.db.close();}
});

for(const change of ['actor','version'] as const)test('allowance consent rechecks the captured row '+change+' after a consent wait',async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();let pending:Promise<Actor>|undefined;
 try{
  await holder.query('BEGIN');await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0))",[f.v.venueId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
  let settled=false;pending=f.run().finally(()=>{settled=true;});void pending.catch(()=>{});await blocked(f,pid,()=>settled);
  if(change==='actor')await holder.query('UPDATE translation_consents SET account_id=$2 WHERE id=$1',[f.consentId,f.other]);
  else await holder.query("UPDATE translation_consents SET consent_version='old' WHERE id=$1",[f.consentId]);
  await holder.query('COMMIT');await assert.rejects(pending,{code:'consent_required'});
  if(change==='actor')assert.deepEqual(await f.run(),{accountId:f.other,consentId:f.consentId});
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.db.close();}
});
