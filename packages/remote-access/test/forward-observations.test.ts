import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {transaction,OrganisationPlanStore} from '@waitron-cloud/registration';
import {ForwardObservationStore,registerForwardReporter,revokeForwardReporter} from '../src/forward-observations.ts';
import {signForwardReport,routeBinding} from '../src/forward-report.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';
import {verifyManifest} from '../src/manifest.ts';
import {forwardFixture} from './fixtures/forward-observations.ts';

test('signed current report records a private latest view; success clears failure; replay cannot refresh it',async()=>{
 const f=await forwardFixture();try{
  const report=f.report();assert.equal(await f.send(report),'accepted');assert.deepEqual(await f.read(),{category:'upstream_transport',observedAt:new Date(report.observations[0]!.observedAt).toISOString(),expiresAt:new Date(report.observations[0]!.expiresAt).toISOString()});
  assert.equal(await f.send(report),'ignored');await f.budget();assert.equal(await f.send(report),'ignored');
  const next=f.report(2,null);assert.equal(await f.send(next),'accepted');assert.equal((await f.read())!.category,null);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM remote_forward_observations')).rows[0].count,'1');
  assert.equal((await f.db.pool.query('SELECT count(*) FROM usage_events')).rows[0].count,'0');
 }finally{await f.db.close();}
});
for(const field of ['country','environment','cell','generation','installation','venue','revision','binding','manifest-low','manifest-high','signature','unknown-key'] as const)test(`wrong_${field}_refuses_without_causes`,async()=>{
 const f=await forwardFixture();try{
  const r=f.report(),o=r.observations[0]!,mapping={...f.mapping};
  if(field==='country')Object.assign(mapping,{country:'FR'});
  if(field==='environment')mapping.environment='production' as 'test';
  if(field==='cell')mapping.cellId=randomUUID();
  if(field==='generation'){r.generation++;o.generation++;}
  if(field==='installation')o.installationId=randomUUID();if(field==='venue')o.venueId=randomUUID();if(field==='revision')o.revision++;if(field==='binding')o.routeBinding='0'.repeat(64);
  if(field==='manifest-low')await f.db.pool.query('UPDATE remote_forward_reporters SET minimum_manifest_sequence=$1',[f.manifest.sequence+1]);
  if(field==='manifest-high')o.manifestSequence=f.manifest.sequence+10;
  const envelope=signForwardReport(r,field==='unknown-key'?generateKeyPairSync('ed25519').privateKey:f.keys.privateKey);
  if(field==='signature')envelope.signature='A'.repeat(86);
  const staleBinding=['installation','venue','revision','binding','manifest-low','manifest-high'].includes(field);
  assert.equal(await f.store.record(mapping,envelope),staleBinding?'accepted':'ignored');assert.equal(await f.read(),null);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM remote_forward_observations')).rows[0].count,'0');
  assert.equal((await f.db.pool.query('SELECT last_sequence FROM remote_forward_reporters')).rows[0].last_sequence,field==='installation'||field==='venue'||field==='revision'||field==='binding'||field.startsWith('manifest-')?'1':'0');
 }finally{await f.db.close();}
});
test('simultaneous_new_old_and_duplicate_reports and restart preserve persistent batch budget',async()=>{
 const f=await forwardFixture();try{
  const r=f.report(2,null),old=f.report(1),second=new ForwardObservationStore(f.db.secondPool,'test-free-paid');
  const values=await Promise.all([f.send(r),second.record(f.mapping,signForwardReport(r,f.keys.privateKey)),f.send(old)]);
  assert.equal(values.filter(v=>v==='accepted').length,1);const first=await f.read();assert(first);
  assert.equal(await second.record(f.mapping,signForwardReport(f.report(3),f.keys.privateKey)),'ignored');assert.deepEqual(await f.read(),first);
  await f.budget();assert.equal(await f.send(f.report(3,null)),'accepted');
  const cursor=(await f.db.pool.query('SELECT last_sequence FROM remote_forward_reporters')).rows[0].last_sequence;
  assert.equal(cursor,'3');
 }finally{await f.db.close();}
});
test('rollback_allows_identical_retry and older observation never replaces newer success',async()=>{
 const f=await forwardFixture();try{
  const r=f.report();await f.db.pool.query("ALTER TABLE remote_forward_observations ADD CONSTRAINT fixture_reject CHECK(category IS NULL)");
  await assert.rejects(f.send(r),/fixture_reject/);assert.equal((await f.db.pool.query('SELECT last_sequence FROM remote_forward_reporters')).rows[0].last_sequence,'0');
  await f.db.pool.query('ALTER TABLE remote_forward_observations DROP CONSTRAINT fixture_reject');assert.equal(await f.send(r),'accepted');
  await f.budget();const stale=f.report(2);stale.observations[0]!.observedAt=r.observations[0]!.observedAt-1;stale.observations[0]!.expiresAt=Math.min(stale.observations[0]!.observedAt+300000,stale.observations[0]!.manifestExpiresAt);
  assert.equal(await f.send(stale),'accepted');assert.equal((await f.read())!.observedAt,new Date(r.observations[0]!.observedAt).toISOString());
  await f.budget();const replay=f.report(3,null);replay.observations[0]!.observationSequence=1;
  assert.equal(await f.send(replay),'accepted');assert.equal((await f.read())!.category,'upstream_transport');
 }finally{await f.db.close();}
});
for(const change of ['revision','hostname','revocation','superseded','rotation','reporter-revocation','downgrade','unconfigured'] as const)test(`current read and later collection reject ${change}`,async()=>{
 const f=await forwardFixture();try{
  assert.equal(await f.send(),'accepted');assert(await f.read());
  if(change==='revision')await f.db.pool.query('UPDATE installations SET configuration_revision=2');
  if(change==='hostname')await f.db.pool.query("UPDATE remote_hostnames SET hostname='changed.example.test' WHERE kind='public'");
  if(change==='revocation')await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp()');
  if(change==='superseded')await transaction(f.db.pool,async c=>{const id=randomUUID();await c.query('UPDATE installations SET revoked_at=clock_timestamp(),superseded_by=$1 WHERE id=$2',[id,f.installed.installationId]);await c.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[id,f.installed.venueId,randomUUID()]);});
  if(change==='rotation')await transaction(f.db.pool,c=>registerForwardReporter(c,{cellId:f.cellId,gatewayId:randomUUID(),generation:2,publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString()}));
  if(change==='reporter-revocation')await transaction(f.db.pool,c=>revokeForwardReporter(c,f.cellId,1));
  if(change==='downgrade')await new OrganisationPlanStore(f.db.pool).set(f.owner.organisationId,'free');
  if(change==='unconfigured')await f.db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE service='remote_access'");
  assert.equal(await f.read(),null);await f.budget();await f.send(f.report(2));assert.equal(await f.read(),null);
 }finally{await f.db.close();}
});
test('collection waits for locked revocation, revision, replacement, rotation and downgrade, then rejects stale authority',async()=>{
 for(const change of ['revoke','revision','replacement','rotation','downgrade'] as const){const f=await forwardFixture();let pending:Promise<unknown>|undefined;const lock=await f.db.secondPool.connect();try{
  await lock.query('BEGIN');
  if(change==='revoke')await lock.query('UPDATE installations SET revoked_at=clock_timestamp()');
  if(change==='revision')await lock.query('UPDATE installations SET configuration_revision=2');
  if(change==='downgrade')await lock.query("UPDATE organisations SET service_plan='free'");
  if(change==='rotation')await registerForwardReporter(lock,{cellId:f.cellId,gatewayId:randomUUID(),generation:2,publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString()});
  if(change==='replacement'){const id=randomUUID();await lock.query('UPDATE installations SET revoked_at=clock_timestamp(),superseded_by=$1 WHERE id=$2',[id,f.installed.installationId]);await lock.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[id,f.installed.venueId,randomUUID()]);await lock.query('UPDATE remote_placements SET installation_id=$1 WHERE venue_id=$2',[id,f.installed.venueId]);}
  let settled=false;pending=f.send().then(v=>{settled=true;return v;});await delay(50);assert.equal(settled,false);await lock.query('COMMIT');await pending;assert.equal(await f.read(),null);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM remote_forward_observations')).rows[0].count,'0');
 }finally{await lock.query('ROLLBACK');lock.release();await pending;await f.db.close();}}
});
test('staged_move_not_current and old source after completion never count as active observations',async()=>{
 const f=await forwardFixture();try{
  const target=randomUUID(),gatewayId=randomUUID(),keys=generateKeyPairSync('ed25519');
  await f.remote.createCell({id:target,country:'ES',provider:'aws',environment:'test',suffix:'target.example.test',subnet:20,publicKey:randomBytes(32).toString('base64'),endpoint:'target.example.test:51820'});
  await transaction(f.db.pool,c=>registerForwardReporter(c,{cellId:target,gatewayId,generation:1,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()}));
  const moveId=randomUUID();await f.remote.stageMove({operationId:moveId,installationId:f.installed.installationId,targetCellId:target,targetPeerPublicKey:randomBytes(32).toString('base64'),expectedRevision:1});
  const staged=await f.remote.reportingManifest(target);assert.equal(staged.version,2);assert.equal(staged.routes.length,1);
  const r=f.report();r.cellId=target;r.gatewayId=gatewayId;Object.assign(r.observations[0]!,{cellId:target,gatewayId,manifestSequence:staged.sequence,routeBinding:routeBinding(staged.routes[0]!)});
  assert.equal(await f.store.record({...f.mapping,cellId:target},signForwardReport(r,keys.privateKey)),'accepted');assert.equal(await f.read(),null);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM remote_forward_observations')).rows[0].count,'0');
  assert.equal(await f.send(),'accepted');await f.remote.markMoveReady(moveId,1,staged.sequence);await f.remote.completeMove(moveId,1);assert.equal(await f.read(),null);
  await f.budget();await f.send(f.report(2));assert.equal(await f.read(),null);
 }finally{await f.db.close();}
});
test('publication remains v1 by default; opt-in includes revisions and authority in reconciler digests',async()=>{
 const f=await forwardFixture();try{
  assert.equal((await f.remote.manifest(f.cellId)).version,1);
  const worker=new RemoteConfigurationReconciler(f.db.pool,{forwardReports:true,planMode:'test-free-paid'});await worker.schedule();
  const digest=async()=>(await f.db.pool.query("SELECT desired_digest FROM remote_configuration_jobs WHERE kind='route'")).rows[0].desired_digest;
  const first=await digest();await f.db.pool.query('UPDATE installations SET configuration_revision=2');await worker.schedule();assert.notEqual(await digest(),first);
  const second=await digest();await transaction(f.db.pool,c=>revokeForwardReporter(c,f.cellId,1));assert.equal((await f.remote.reportingManifest(f.cellId)).version,1);await worker.schedule();assert.notEqual(await digest(),second);
 }finally{await f.db.close();}
});
test('opted-in reconciler publishes verifiable v2 authority and defaults still publish v1',async()=>{
 for(const enabled of [false,true]){const f=await forwardFixture();try{
  const issuer=generateKeyPairSync('ed25519');let published='';
  const worker=new RemoteConfigurationReconciler(f.db.pool,{forwardReports:enabled,planMode:'test-free-paid',signingKeyForCell:async()=>issuer.privateKey,
   artifacts:{readCsr:async()=>{throw new Error('unused');},readCertificate:async()=>undefined,publishCertificate:async()=>{throw new Error('unused');},publishManifest:async(cell,envelope)=>{assert.equal(cell,f.cellId);published=envelope;}}});
  await worker.schedule();await f.db.pool.query("DELETE FROM remote_configuration_jobs WHERE kind<>'route'");assert.equal(await worker.runOnce(),true);
  assert(published,'route digest must match the actual published manifest');const manifest=verifyManifest(JSON.parse(published),issuer.publicKey,f.cellId);
  assert.equal(manifest.version,enabled?2:1);if(manifest.version===2){assert.deepEqual(manifest.reporter,{gatewayId:f.gatewayId,generation:1});assert.equal(manifest.routes[0]!.revision,1);}else assert.equal('revision'in manifest.routes[0]!,false);
 }finally{await f.db.close();}}
});

test('reporting cell jobs do not lock installations in an unrelated cell',async()=>{
 const f=await forwardFixture();await f.remote.createCell({id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'unrelated.example.test',subnet:21,publicKey:randomBytes(32).toString('base64'),endpoint:'unrelated.example.test:51820'});
 const cell=(await f.db.pool.query("SELECT id FROM remote_cells WHERE subnet=21")).rows[0].id;
 const issuer=generateKeyPairSync('ed25519');let published='';
 const worker=new RemoteConfigurationReconciler(f.db.pool,{forwardReports:true,planMode:'test-free-paid',signingKeyForCell:async()=>issuer.privateKey,
  artifacts:{readCsr:async()=>{throw Error('unused');},readCertificate:async()=>undefined,publishCertificate:async()=>{throw Error('unused');},publishManifest:async(id,envelope)=>{assert.equal(id,cell);published=envelope;}}});
 const held=await f.db.secondPool.connect();let running:Promise<unknown>|undefined;
 try{
  await worker.schedule();await f.db.pool.query("DELETE FROM remote_configuration_jobs WHERE kind<>'route' OR target_id<>$1",[cell]);
  await held.query('BEGIN');await held.query('SELECT 1 FROM installations WHERE id=$1 FOR UPDATE',[f.installed.installationId]);
  running=worker.runOnce();let settled=false;running.then(()=>settled=true);
  for(let attempt=0;attempt<300&&!settled;attempt++)await delay(10);
  assert.equal(settled,true,'an unrelated installation must not block this empty cell');assert(published);
  const manifest=verifyManifest(JSON.parse(published),issuer.publicKey,cell);assert.deepEqual(manifest.routes,[]);
 }finally{await held.query('ROLLBACK');held.release();await running;await f.db.close();}
});

test('signature is rechecked against reporter authority after waiting for its lock',async()=>{
 const f=await forwardFixture(),held=await f.db.secondPool.connect();let running:Promise<unknown>|undefined;
 try{
  await held.query('BEGIN');await held.query('UPDATE remote_forward_reporters SET public_key=$1 WHERE cell_id=$2',[generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString(),f.cellId]);
  running=f.send();let waiting=false;
  for(let attempt=0;attempt<300;attempt++){
   waiting=(await f.db.secondPool.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM remote_forward_reporters%'",[f.db.schema])).rows[0].n>0;
   if(waiting)break;await delay(10);
  }
  assert.equal(waiting,true,'collection must verify the old committed key and wait for the new locked key');await held.query('COMMIT');
  assert.equal(await running,'ignored');assert.equal(await f.read(),null);
  assert.equal((await f.db.pool.query('SELECT last_sequence FROM remote_forward_reporters')).rows[0].last_sequence,'0');assert.equal((await f.db.pool.query('SELECT count(*) FROM remote_forward_observations')).rows[0].count,'0');
 }finally{await held.query('ROLLBACK');held.release();await running;await f.db.close();}
});
