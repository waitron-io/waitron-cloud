import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createSession} from '@waitron-cloud/identity';
import {InstallationStore,type InstallationView} from '../src/installations.ts';
import {createLeaseIssuer,createLeaseTrust,encodeMachine,verifyLease,type MachineAction,type SignedEnvelope} from '../src/installation-proof.ts';
import {transaction} from '../src/transaction.ts';
import {venueServiceFixture,set,rows,trial,dayOffset,event} from './fixtures/venue-service.ts';

const origin='https://venue.example.test';
async function fixture(){
 const f=await venueServiceFixture();
 try{
  // The expired venue precedes its neighbour in the account's captured installation order.
  const current=await f.pool.query('SELECT venue_id FROM installations WHERE venue_id=ANY($1::uuid[]) AND superseded_by IS NULL ORDER BY id',[f.venues]);
  const order=current.rows.map(r=>r.venue_id as string);
  f.venues.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const installation=(await f.pool.query('UPDATE installations SET public_key=$2 WHERE venue_id=$1 AND superseded_by IS NULL RETURNING id',[f.venues[0],publicKey])).rows[0].id;
  const issuedAt=Date.now(),lease=issuer.issue({origin,leaseId:randomUUID(),installationId:installation,venueId:f.venues[0]!,environment:'test',publicKey,issuedAt,expiresAt:issuedAt+3600000});
  const account=randomUUID();await f.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[account]);
  await f.pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[account,account+'@example.test']);
  // This account owns test venues; production refusal is qualified independently.
  await f.pool.query('UPDATE venues SET organisation_id=$2,legal_business_id=$3 WHERE id=$1',[f.production,f.foreign.organisationId,f.foreign.legalBusinessId]);
  await f.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[account,f.scope.organisationId]);
  const session=await transaction(f.pool,c=>createSession(c,account));
  const store=new InstallationStore(f.pool,issuer,origin,undefined,'test-venue-levels'),legacy=new InstallationStore(f.pool,issuer,origin);
  function proof(action:MachineAction,body:unknown={},operationId=randomUUID(),suppliedLease:SignedEnvelope=lease){
   const payload=encodeMachine({origin,action,installationId:installation,operationId,issuedAt:Date.now(),lease:action==='renew'||action==='revoke'?'':JSON.stringify(suppliedLease),body:JSON.stringify(body)});
   return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};
  }
  return {...f,key,issuer,installation,lease,session,machines:store,legacy,proof};
 }catch(e){await f.close();throw e;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
function masked(view:InstallationView,translation=false){
 assert.deepEqual(view.services.map(s=>s.service).sort(),translation?['content_translation','continuous_backup','remote_access','retained_snapshots']:['continuous_backup','remote_access','retained_snapshots']);
 for(const s of view.services)assert.deepEqual({state:s.state,configuration:s.configuration,health:s.health,failure:s.failure,observedAt:s.observedAt},
  {state:'unconfigured',configuration:{},health:'unknown',failure:null,observedAt:null},s.service);
}
async function revision(f:Fixture){return (await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.installation])).rows[0].configuration_revision as number;}
async function observe(f:Fixture){
 for(const service of ['continuous_backup','remote_access','retained_snapshots','content_translation'])await f.pool.query(`INSERT INTO installation_observations(installation_id,service,revision,health,failure,observed_at)
  VALUES($1,$2,$3,'healthy',NULL,clock_timestamp()) ON CONFLICT(installation_id,service) DO UPDATE SET revision=excluded.revision,health=excluded.health,observed_at=excluded.observed_at,received_at=clock_timestamp()`,[f.installation,service,await revision(f)]);
}

// Ignoring current venue authority or returning saved replies would expose paid setup after downgrade.
for(const action of ['renew','configuration-v1','configuration-v2','report'] as const)for(const cached of [false,true])test(`venue ${action} ${cached?'cached':'fresh'} reply masks every unavailable service`,async()=>{
 const f=await fixture();try{
  await set(f);const machineAction=action==='renew'||action==='report'?action:'configuration';
  const body=action==='configuration-v2'?{servicesVersion:2}:action==='report'?{revision:await revision(f),observedAt:Date.now(),services:[{service:'remote_access',health:'healthy',failure:null}]}:{};
  let proof=f.proof(machineAction,body);if(cached)await f.legacy.execute(machineAction,proof);
  await set(f,'registered');await observe(f);
  if(action==='report'&&!cached)proof=f.proof('report',{...body,revision:await revision(f)});
  const result=await f.machines.execute(machineAction,proof);masked(result,action==='configuration-v2');
  if(action==='renew'){
   assert.ok(result.lease);const lease=verifyLease(result.lease,createLeaseTrust(f.issuer),origin);
   assert.equal(lease.expiresAt-lease.issuedAt,3600000);
  }
  const translation=(await rows(f)).services.filter(s=>s.service==='content_translation');
  for(const s of translation){assert.equal(s.state,'ready');assert.deepEqual(s.configuration,{synthetic:'content_translation'});}
 }finally{await f.close();}
});
test('venue level one denies trusted setup without changing its stored services',async()=>{
 const f=await fixture();try{
  await set(f,'registered');const before=await rows(f);
  await assert.rejects(f.machines.configure(f.installation,await revision(f),[{service:'remote_access',state:'ready',configuration:{hostname:'test.invalid'}}]),{code:'permission_denied'});
  assert.deepEqual(await rows(f),before);
 }finally{await f.close();}
});
for(const level of ['connected','hosted'] as const)test(`venue level ${level==='connected'?'two':'three'} allows explicit setup and upgrade never restores it by itself`,async()=>{
 const f=await fixture();try{
  await set(f,level);await set(f,'registered');await set(f,level);
  const before=await rows(f),rev=await revision(f);
  for(const s of before.services)if(s.service!=='content_translation'){assert.equal(s.state,'unconfigured');assert.deepEqual(s.configuration,{});}
  const result=await f.machines.configure(f.installation,rev,[{service:'remote_access',state:'ready',configuration:{hostname:'test.invalid'}}]);
  assert.equal(result.revision,rev+1);assert.deepEqual(result.services.find(s=>s.service==='remote_access')?.configuration,{hostname:'test.invalid'});
  const reply=await f.machines.execute('configuration',f.proof('configuration',{servicesVersion:2}));
  assert.equal(reply.services.find(s=>s.service==='content_translation')?.state,'ready');
 }finally{await f.close();}
});
test('venue account list masks level one but preserves its connected neighbour',async()=>{
 const f=await fixture();try{
  await set(f,'registered');await set(f,'connected',f.venues[1]);await observe(f);
  const result=await f.machines.listWithSession(f.session.token),own=result.find(i=>i.installationId===f.installation);
  assert.ok(own);masked(own);assert.equal(own.canRevoke,true);
  const neighbour=result.find(i=>i.venueId===f.venues[1]);assert.ok(neighbour);
  assert.equal(neighbour.services.find(s=>s.service==='remote_access')?.state,'ready');
  for(const v of result)for(const s of v.services)assert.deepEqual(s.configuration,{});
 }finally{await f.close();}
});
test('venue old report revision still conflicts after a downgrade',async()=>{
 const f=await fixture();try{
  await set(f);const old=await revision(f);await set(f,'registered');
  await assert.rejects(f.machines.execute('report',f.proof('report',{revision:old,observedAt:Date.now(),services:[{service:'remote_access',health:'healthy',failure:null}]})),{code:'conflict'});
  assert.equal((await f.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count,'0');
 }finally{await f.close();}
});
test('venue signature verification precedes unavailable authority',async()=>{
 const f=await fixture();try{
  const proof=f.proof('renew');proof.signature=Buffer.alloc(64).toString('base64url');await f.pool.query('DROP TABLE billing_service_authority');
  await assert.rejects(f.machines.execute('renew',proof),{code:'invalid_proof'});
  await assert.rejects(f.machines.execute('renew',f.proof('renew')),{code:'42P01'});
 }finally{await f.close();}
});
test('venue level one keeps machine and owner revocation available',async()=>{
 const f=await fixture();try{
  await set(f,'registered');const proof=f.proof('revoke'),first=await f.machines.execute('revoke',proof);assert.ok(first.revokedAt);
  assert.deepEqual(await f.machines.execute('revoke',proof),first);
  for(const s of first.services)assert.deepEqual(s.configuration,{});
  await assert.rejects(f.machines.execute('renew',f.proof('renew')),{code:'revoked'});
  const other=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND superseded_by IS NULL',[f.venues[1]])).rows[0].id;
  assert.ok((await f.machines.revokeWithSession(f.session.token,f.session.csrfToken,other)).revokedAt);
 }finally{await f.close();}
});

// A policy waiter must leave installation locks available to the transition ahead of it.
for(const boundary of ['machine','setup'] as const)test(`venue ${boundary} waits for policy before locking installations`,async()=>{
 const f=await fixture(),holder=await f.pool.connect(),observer=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await set(f);const reader=new InstallationStore(f.peer,f.issuer,origin,undefined,'test-venue-levels');
  const rev=await revision(f);await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venues[0]]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let settled=false;
  pending=(boundary==='machine'?reader.execute('configuration',f.proof('configuration')):reader.configure(f.installation,rev,[])).finally(()=>{settled=true;});void pending.catch(()=>{});
  let waiting=false;for(let i=0;i<300&&!settled;i++){
   waiting=!!(await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema+'_peer',pid])).rowCount;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'service admission must wait on current venue policy');
  await observer.query('BEGIN');await assert.doesNotReject(observer.query('SELECT id FROM installations WHERE venue_id=$1 FOR UPDATE NOWAIT',[f.venues[0]]),'policy wait must leave installations unlocked');await observer.query('ROLLBACK');
  await holder.query('COMMIT');await pending;
 }finally{await observer.query('ROLLBACK');await holder.query('ROLLBACK');await pending?.catch(()=>{});observer.release();holder.release();await f.close();}
});
test('venue account list locks every venue before expiring earlier setup',async()=>{
 const f=await fixture(),holder=await f.pool.connect(),observer=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await trial(f,'connected',dayOffset(f.today,-30));
  await f.pool.query('UPDATE billing_service_authority SET setup_grant_active=true,setup_grant_until=$1',[f.today]);
  await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venues[1]]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,reader=new InstallationStore(f.peer,f.issuer,origin,undefined,'test-venue-levels');
  let settled=false;pending=reader.listWithSession(f.session.token).finally(()=>{settled=true;});void pending.catch(()=>{});
  let waiting=false;for(let i=0;i<300&&!settled;i++){
   waiting=!!(await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema+'_peer',pid])).rowCount;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'the account batch must lock its complete captured venue set');
  await observer.query('BEGIN');await assert.doesNotReject(observer.query('SELECT id FROM installations WHERE venue_id=$1 FOR UPDATE NOWAIT',[f.venues[0]]),'batch policy wait must leave earlier installations unlocked');await observer.query('ROLLBACK');
  await holder.query('COMMIT');const result=await pending as InstallationView[];const own=result.find(i=>i.installationId===f.installation);assert.ok(own);masked(own);
 }finally{await observer.query('ROLLBACK');await holder.query('ROLLBACK');await pending?.catch(()=>{});observer.release();holder.release();await f.close();}
});
test('venue account list rechecks installation scope after its policy wait',async()=>{
 const f=await fixture(),holder=await f.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await set(f);const foreignVenue=randomUUID();
  await f.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,'test')",[foreignVenue,f.foreign.organisationId,f.foreign.legalBusinessId]);
  await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venues[1]]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,reader=new InstallationStore(f.peer,f.issuer,origin,undefined,'test-venue-levels');
  let settled=false;pending=reader.listWithSession(f.session.token).finally(()=>{settled=true;});void pending.catch(()=>{});
  let waiting=false;for(let i=0;i<300&&!settled;i++){
   waiting=!!(await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema+'_peer',pid])).rowCount;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'the account batch must reach its policy wait before a scope change');
  await holder.query('UPDATE installations SET venue_id=$2 WHERE id=$1',[f.installation,foreignVenue]);
  await holder.query('COMMIT');await assert.rejects(pending,{code:'permission_denied'});
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});

// A saved response or a newly active trial cannot revive setup from before an uncovered day.
for(const gap of ['expiry-read','late-extension','end-then-hosted','future-gap'] as const)
 for(const boundary of ['renew','configuration-v1','configuration-v2','report','account-list','configure'] as const)
 test(`venue installation ${boundary} clears setup across ${gap}`,async()=>{
 const f=await fixture();try{
  const oldEnd=gap==='future-gap'?dayOffset(f.today,-1):f.today;
  await trial(f,'connected',dayOffset(oldEnd,-30));
  if(gap==='future-gap')await trial(f,'hosted');
  // Reconstruct setup admitted before expiry, with no venue reader running across the gap.
  await f.legacy.configure(f.installation,await revision(f),['continuous_backup','retained_snapshots','remote_access'].map(service=>({service:service as 'continuous_backup'|'retained_snapshots'|'remote_access',state:'ready',configuration:{admittedBeforeGap:service}})));
  await f.pool.query('UPDATE billing_service_authority SET setup_grant_active=true,setup_grant_until=$1 WHERE venue_id=$2',[oldEnd,f.venues[0]]);
  await observe(f);const before=await revision(f);
  const action=boundary==='renew'||boundary==='report'?boundary:'configuration';
  const oldBody=boundary==='configuration-v2'?{servicesVersion:2}:boundary==='report'?{revision:before,observedAt:Date.now(),services:[{service:'remote_access',health:'healthy',failure:null}]}:{};
  const cached=f.proof(action,oldBody);
  const saved=boundary!=='account-list'&&boundary!=='configure'?await f.legacy.execute(action,cached):undefined;
  if(gap==='late-extension')await f.store.execute(f.scope,event(),{type:'extend_trial',venueId:f.venues[0],level:'connected',expectedEnd:oldEnd});
  else if(gap==='end-then-hosted'){
   await f.store.execute(f.scope,event(),{type:'end_trial',venueId:f.venues[0],level:'connected',expectedEnd:oldEnd,outcome:'lapsed'});await trial(f,'hosted');
  }
  const expectedRevision=before+(gap==='end-then-hosted'?2:1);
  if(boundary==='account-list'){
   const reply=(await f.machines.listWithSession(f.session.token)).find(i=>i.installationId===f.installation);assert.ok(reply);assert.equal(reply.revision,expectedRevision);
   for(const s of reply.services){assert.equal(s.state,'unconfigured',s.service);assert.deepEqual(s.configuration,{});assert.equal(s.health,'unknown');assert.equal(s.failure,null);}
  }else if(boundary==='configure'){
   if(gap==='expiry-read'){
    await assert.rejects(f.machines.configure(f.installation,expectedRevision,[]),{code:'permission_denied'});
    // A successful basic read commits expiry even when the denied setup transaction rolled back.
    await f.machines.execute('renew',f.proof('renew'));
   }else{
    const result=await f.machines.configure(f.installation,expectedRevision,[{service:'remote_access',state:'ready',configuration:{reprovisioned:true}}]);
    assert.equal(result.revision,expectedRevision+1);assert.deepEqual(result.services.find(s=>s.service==='remote_access')?.configuration,{reprovisioned:true});
    for(const s of result.services)if(s.service!=='remote_access'){assert.equal(s.state,'unconfigured');assert.deepEqual(s.configuration,{});}
   }
  }else{
   const replay=await f.machines.execute(action,cached);assert.equal(replay.revision,expectedRevision);
   const freshBody=boundary==='report'?{revision:expectedRevision,observedAt:Date.now(),services:[{service:'remote_access',health:'unknown',failure:null}]}:oldBody;
   const fresh=await f.machines.execute(action,f.proof(action,freshBody));assert.equal(fresh.revision,expectedRevision);
   for(const result of [replay,fresh])for(const s of result.services){
    if(s.service==='content_translation'&&gap!=='expiry-read'){assert.equal(s.state,'ready');assert.deepEqual(s.configuration,{synthetic:'content_translation'});}
    else{assert.equal(s.state,'unconfigured',s.service);assert.deepEqual(s.configuration,{});assert.equal(s.health,'unknown');assert.equal(s.failure,null);}
   }
   if(boundary==='renew')assert.deepEqual(replay.lease,saved?.lease);
  }
  const stored=(await rows(f)).services.filter(s=>s.installation_id===f.installation);
  for(const s of stored)if(s.service==='content_translation'){assert.equal(s.state,'ready');assert.deepEqual(s.configuration,{synthetic:'content_translation'});}else if(boundary!=='configure'||gap==='expiry-read'){assert.equal(s.state,'unconfigured');assert.deepEqual(s.configuration,{});}
  assert.equal(await revision(f),expectedRevision+(boundary==='configure'&&gap!=='expiry-read'?1:0));
 }finally{await f.close();}
});
