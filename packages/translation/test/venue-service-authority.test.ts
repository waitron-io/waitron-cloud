import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {BillingStore,createLeaseIssuer} from '@waitron-cloud/registration';
import {TranslationMachine,jobFingerprint} from '../src/index.ts';
import {connectedVenue,database,giveConsent,readyForTranslation} from './fixtures.ts';
const origin='https://cloud.example.test',mode='test-venue-levels' as const;
const text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'Cafe',existing:{},missing:['ca','es']}],houseStyle:[]});
async function fixture(){
 const db=await database(),issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const v=await connectedVenue(db,issuer,origin),other=await connectedVenue(db,issuer,origin),store=new BillingStore(db.pool),scope={organisationId:v.organisationId,legalBusinessId:v.legalBusinessId};
 const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
 await store.execute(scope,event(),{type:'ensure_business'});
 await store.transition(scope,event(),{type:'set_venue',venueId:v.venueId,expectedRevision:0,value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});
 await readyForTranslation(db,v);await giveConsent(db,v);
 const peer=new Pool({...db.pool.options,application_name:db.schema+'_peer'}),machine=new TranslationMachine(peer,issuer,origin,undefined,undefined,mode);
 const envelope=v.submit(text),run=()=>machine.execute('translation-submit',{payload:envelope.payload,signature:envelope.signature},text);
 return {db,v,other,issuer,peer,machine,envelope,run,async close(){await peer.end();await db.close();}};
}
async function waitForBlock(f:Awaited<ReturnType<typeof fixture>>,pid:number,settled:()=>boolean){
 for(let i=0;i<300&&!settled();i++){
  if((await f.db.pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.db.schema+'_peer',pid])).rowCount)return;
  await delay(10);
 }
 assert.fail('translation must wait for the captured policy before locking its installation');
}
for(const parent of ['organisation','venue'] as const)test(`venue translation ${parent} policy wait leaves installation unlocked`,async()=>{
 const f=await fixture(),holder=await f.db.pool.connect(),observer=await f.db.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await holder.query('BEGIN');await holder.query(parent==='organisation'?'SELECT id FROM organisations WHERE id=$1 FOR NO KEY UPDATE':'SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[parent==='organisation'?f.v.organisationId:f.v.venueId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let settled=false;
  pending=f.run().finally(()=>{settled=true;});void pending.catch(()=>{});await waitForBlock(f,pid,()=>settled);
  await observer.query('BEGIN');
  if(parent==='organisation')await observer.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE NOWAIT',[f.v.venueId]);
  await observer.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE NOWAIT',[f.v.installationId]);await observer.query('ROLLBACK');
  await holder.query('COMMIT');assert.equal((await pending as {state:string}).state,'queued');
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'1');
 }finally{await observer.query('ROLLBACK');await holder.query('ROLLBACK');await pending?.catch(()=>{});observer.release();holder.release();await f.close();}
});
// Removing post-policy authentication would accept stale installation authority.
for(const change of ['revocation','key','venue','lease expiry'] as const)test(`venue translation rechecks ${change} after policy wait`,async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.v.venueId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let envelope=f.envelope;
  if(change==='lease expiry'){
   const now=Date.now(),lease=f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.v.installationId,venueId:f.v.venueId,environment:'test',publicKey:f.v.installationKey,issuedAt:now,expiresAt:now+1000});
   envelope={...f.v.proof('translation-submit',{},randomUUID(),lease,JSON.stringify({version:1,...jobFingerprint(text)})),body:text};
  }
  let settled=false;pending=f.machine.execute('translation-submit',{payload:envelope.payload,signature:envelope.signature},text).finally(()=>{settled=true;});void pending.catch(()=>{});
  await waitForBlock(f,pid,()=>settled);
  if(change==='revocation')await holder.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.v.installationId]);
  if(change==='key')await holder.query('UPDATE installations SET public_key=$2 WHERE id=$1',[f.v.installationId,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url')]);
  if(change==='venue'){
   const unused=randomUUID();
   await holder.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[unused,f.other.organisationId,f.other.legalBusinessId]);
   await holder.query('UPDATE installations SET venue_id=$2 WHERE id=$1',[f.v.installationId,unused]);
  }
  if(change==='lease expiry')await delay(1100);
  await holder.query('COMMIT');await assert.rejects(pending,{code:change==='revocation'?'revoked':'invalid_proof'});
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'0');
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});
test('venue translation policy wait rereads withdrawn consent before job creation',async()=>{
 const f=await fixture(),holder=await f.db.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.v.venueId]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let settled=false;
  pending=f.run().finally(()=>{settled=true;});void pending.catch(()=>{});await waitForBlock(f,pid,()=>settled);
  await holder.query('DELETE FROM translation_consents WHERE venue_id=$1',[f.v.venueId]);await holder.query('COMMIT');
  await assert.rejects(pending,{code:'consent_required'});assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_jobs')).rows[0].count,'0');
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});
