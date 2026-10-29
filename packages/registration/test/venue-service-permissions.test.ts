import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {transaction} from '../src/transaction.ts';
import {venueServiceFixture as fixture,event,read,set,rows,snapshot,assertCleared,trial,dayOffset} from './fixtures/venue-service.ts';

// Catch accidental opt-in, bypassed invalidation, cross-venue grants and setup revival.
test('recording cannot activate an unenrolled venue',async()=>{
 const f=await fixture();try{
  const before=await rows(f);await set(f,'connected',f.venues[0],false);
  assert.equal((await f.store.venue(f.scope,f.venues[0])).revision,1);
  assert.deepEqual(await read(f),{...f.scope,venueId:f.venues[0],level:'registered',revision:0});
  assert.deepEqual(await rows(f),before);
  assert.equal((await f.pool.query('SELECT count(*) FROM billing_service_authority')).rows[0].count,'0');
 }finally{await f.close();}
});
test('transition enrols once and raw setters cannot bypass it',async()=>{
 const f=await fixture();try{
  await set(f,'connected',f.venues[0],false);
  const command={type:'set_venue',venueId:f.venues[0],expectedRevision:1,value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}},e=event();
  assert.equal(typeof f.store.transition,'function');
  const first=await f.store.transition(f.scope,e,command),enrolled=await snapshot(f);
  assert.equal((await read(f)).revision,1);assert.equal((await read(f)).level,'connected');
  for(const i of (await rows(f)).installations)assert.equal(i.row.configuration_revision,1);
  assert.deepEqual(await f.store.transition(f.scope,e,command),first);assert.deepEqual(await snapshot(f),enrolled);
  await set(f,'registered',f.venues[0],false);assert.deepEqual(await read(f),{...f.scope,venueId:f.venues[0],level:'registered',revision:2});assertCleared(await rows(f),2);
  await set(f,'connected',f.venues[0],false);assert.equal((await read(f)).revision,3);assertCleared(await rows(f),3);
  await set(f,'connected');assert.equal((await read(f)).revision,3);assertCleared(await rows(f),3);
 }finally{await f.close();}
});
test('replaying a storage event cannot enrol a venue',async()=>{
 const f=await fixture();try{
  const e=event(),c={type:'set_venue',venueId:f.venues[0],expectedRevision:0,value:{level:'connected',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}};
  const first=await f.store.execute(f.scope,e,c);assert.equal(typeof f.store.transition,'function');
  assert.deepEqual(await f.store.transition(f.scope,e,c),first);assert.equal((await read(f)).revision,0);
 }finally{await f.close();}
});
test('same organisation venues never share permission',async()=>{
 const f=await fixture();try{
  await set(f);await set(f,'registered',f.venues[1]);await set(f,'hosted',f.otherVenue,true,f.other);
  const b=await rows(f,f.venues[1]),c=await rows(f,f.otherVenue);
  await set(f,'registered');assert.equal((await read(f)).level,'registered');assert.equal((await read(f,f.venues[1])).revision,1);
  assert.deepEqual(await read(f,f.otherVenue),{...f.other,venueId:f.otherVenue,level:'hosted',revision:1});
  assert.deepEqual(await rows(f,f.venues[1]),b);assert.deepEqual(await rows(f,f.otherVenue),c);
 }finally{await f.close();}
});
test('trial extension changes generation while keeping connected setup',async()=>{
 const f=await fixture();try{
  const initial=await trial(f),end=initial.value.endsOn;const before=await rows(f);
  await f.store.execute(f.scope,event(),{type:'extend_trial',venueId:f.venues[0],level:'connected',expectedEnd:end});
  assert.deepEqual(await read(f),{...f.scope,venueId:f.venues[0],level:'connected',revision:2});
  const after=await rows(f);assert.deepEqual(after.services,before.services);for(const i of after.installations)assert.equal(i.row.configuration_revision,2);
 }finally{await f.close();}
});
for(const action of ['read','late-extension','end-then-hosted'] as const)test(`expired trial setup never revives across ${action}`,async()=>{
 const f=await fixture();try{
  // Historical events and a persisted prior grant model no reader running across expiry.
  await trial(f,'connected',dayOffset(f.today,-30));
  await f.pool.query('UPDATE billing_service_authority SET setup_grant_active=true,setup_grant_until=$1',[f.today]);
  if(action==='late-extension')await f.store.execute(f.scope,event(),{type:'extend_trial',venueId:f.venues[0],level:'connected',expectedEnd:f.today});
  else if(action==='end-then-hosted'){
   await f.store.execute(f.scope,event(),{type:'end_trial',venueId:f.venues[0],level:'connected',expectedEnd:f.today,outcome:'lapsed'});
   assertCleared(await rows(f),2);await trial(f,'hosted');
  }
  const p=await read(f);assert.equal(p.level,action==='read'?'registered':action==='late-extension'?'connected':'hosted');
  assert.equal(p.revision,action==='end-then-hosted'?3:2);assertCleared(await rows(f),p.revision);
  const stable=await snapshot(f);await read(f);assert.deepEqual(await snapshot(f),stable);
 }finally{await f.close();}
});
for(const touching of [false,true])test(`${touching?'touching':'gapped'} future trials ${touching?'retain':'clear'} old setup`,async()=>{
 const f=await fixture();try{
  const oldEnd=dayOffset(f.today,-1),start=touching?oldEnd:f.today;
  await trial(f,'connected',dayOffset(oldEnd,-30));await trial(f,'hosted',start);
  await f.pool.query('UPDATE billing_service_authority SET setup_grant_active=true,setup_grant_until=$1',[touching?dayOffset(start,30):oldEnd]);
  const before=await rows(f),prior=(await read(f)).revision;
  assert.equal((await read(f)).level,'hosted');
  if(touching)assert.deepEqual(await rows(f),before);else assertCleared(await rows(f),prior);
  const stable=await snapshot(f);await read(f);assert.deepEqual(await snapshot(f),stable);
 }finally{await f.close();}
});
test('legacy organisation changes exclude enrolled venues and cannot authorise them',async()=>{
 const f=await fixture();try{
  await set(f);await set(f,'registered',f.venues[1]);await set(f,'hosted',f.otherVenue,true,f.other);const before=await Promise.all([rows(f),rows(f,f.venues[1]),rows(f,f.otherVenue)]);
  const legacy=new f.api.OrganisationPlanStore(f.pool);await legacy.set(f.scope.organisationId,'paid');await legacy.set(f.scope.organisationId,'free');
  assert.deepEqual(await Promise.all([rows(f),rows(f,f.venues[1]),rows(f,f.otherVenue)]),before);
  await assert.rejects(transaction(f.pool,c=>f.api.readVenuePlan(c,f.venues[0],'test-free-paid')),/permission_denied/);
  for(const name of ['readVenuePlan','requirePlanService'])await assert.rejects(transaction(f.pool,c=>f.api[name](c,name==='readVenuePlan'?f.venues[0]:f.scope.organisationId,...(name==='readVenuePlan'?['test-venue-levels']:['remote_access','test-venue-levels']))),/invalid_plan_mode/);
 }finally{await f.close();}
});
test('permission transaction rollback preserves facts event and setup',async()=>{
 const f=await fixture();try{
  await set(f);const before=await snapshot(f);
  await f.pool.query("CREATE FUNCTION reject_permission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-permission-commit'; END $$");
  await f.pool.query('CREATE CONSTRAINT TRIGGER reject_permission AFTER UPDATE ON installations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_permission()');
  await assert.rejects(set(f,'registered'),/synthetic-permission-commit/);assert.deepEqual(await snapshot(f),before);
  await f.pool.query('DROP TRIGGER reject_permission ON installations');await set(f,'registered');assertCleared(await rows(f),2);
 }finally{await f.close();}
});
test('permission transitions refuse foreign unknown production and nonpermission commands without effects',async()=>{
 const f=await fixture();try{
  assert.equal(typeof f.store.transition,'function');const before=await snapshot(f);
  for(const venueId of [f.otherVenue,f.foreignVenue,randomUUID()])await assert.rejects(set(f,'connected',venueId),{code:'billing_scope_not_found'});
  await assert.rejects(set(f,'connected',f.production),/permission_denied/);
  await assert.rejects(f.store.transition(f.scope,event(),{type:'ensure_business'}),{code:'invalid_billing_input'});
  const provider={...event(),source:{kind:'provider',provider:'stripe',accountId:'synthetic'}};
  await assert.rejects(f.store.transition(f.scope,provider,{type:'start_trial',venueId:f.venues[0],level:'connected',on:f.today}),{code:'invalid_billing_input'});
  await assert.rejects(read(f,f.production),/permission_denied/);await assert.rejects(read(f,randomUUID()),/permission_denied/);
  assert.deepEqual(await snapshot(f),before);
 }finally{await f.close();}
});
for(const enrolled of [false,true])test(`permission locks precede installations with ${enrolled?'present':'absent'} authority`,async()=>{
 const f=await fixture();let pending:Promise<unknown>|undefined;const holder=await f.pool.connect(),observer=await f.peer.connect();
 try{
  assert.equal(typeof f.api.readVenuePermissions,'function');if(enrolled)await set(f);await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venues[0]]);
  const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=transaction(f.peer,client=>f.api.readVenuePermissions(client,f.venues[0],'test-venue-levels'));
  let waiting=false;for(let i=0;i<300;i++){waiting=!!(await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema+'_peer',pid])).rowCount;if(waiting)break;await delay(10);}
  assert.equal(waiting,true,'authority read must wait on the parent venue');
  await observer.query('BEGIN');await observer.query('SELECT id FROM installations WHERE venue_id=$1 FOR UPDATE NOWAIT',[f.venues[0]]);await observer.query('ROLLBACK');
  await holder.query('COMMIT');await pending;
 }finally{await observer.query('ROLLBACK');await holder.query('ROLLBACK');await pending?.catch(()=>{});observer.release();holder.release();await f.close();}
});
test('service admission uses the enrolled level and fails closed in the wrong mode',async()=>{
 const f=await fixture();try{
  assert.equal(typeof f.api.requireVenueService,'function');
  for(const service of ['address_lookup','transactional_email'])await transaction(f.pool,c=>f.api.requireVenueService(c,f.venues[0],service,'test-venue-levels'));
  for(const service of ['content_translation','continuous_backup','retained_snapshots','remote_access','rota_solver','hosting'])await assert.rejects(transaction(f.pool,c=>f.api.requireVenueService(c,f.venues[0],service,'test-venue-levels')),/permission_denied/);
  await set(f);await transaction(f.pool,c=>f.api.requireVenueService(c,f.venues[0],'content_translation','test-venue-levels'));
  await assert.rejects(transaction(f.pool,c=>f.api.requireVenueService(c,f.venues[0],'hosting','test-venue-levels')),/permission_denied/);
  await assert.rejects(transaction(f.pool,c=>f.api.requireVenueService(c,f.venues[0],'continuous_backup','production')),/invalid_plan_mode/);
 }finally{await f.close();}
});
