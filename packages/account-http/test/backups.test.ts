import {setRecoveryScope} from '../../registration/test/fixtures/recovery-scope.ts';
import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import {Pool} from 'pg';
import {BackupCatalogue} from '../../backups/src/catalogue.ts';
import {bufferObject,receipt,type StageOptions} from '../../backups/src/object-transfer.ts';
import {recoveryFixture} from '../../backups/test/fixtures/recovery-v2.ts';
import {verifyPointFixture} from '../../backups/test/fixtures/verification.ts';
import {BackupKeyVault} from '../../backups/src/keys.ts';
import type {HttpBindings} from '@hono/node-server';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test,type TestContext} from 'node:test';
import {createLeaseIssuer,LifecycleStore,SignupStore,RegistrationStore,type PlanMode} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {database,completeEmailProof,emailLoginPolicy} from './fixtures.ts';
const bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings;
const origin='https://cloud.example.test',password='A sufficiently long test password';
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,cookie:string,csrf:string;
let venues:{venueId:string;installationId:string}[];
function request(body:unknown,headers:Record<string,string>={},path='/api/account/backups/list',method='POST'){
 return app.request(origin+path,{method,headers:{'content-type':'application/json',origin,cookie,'x-csrf-token':csrf,...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})},bindings);
}
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 app=createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('owner@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),registration=new RegistrationStore(db.pool);venues=[];
 for(let i=0;i<2;i++){
  const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());const v=await registration.complete(binding);venues.push(v);
  await db.pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://secret-store.test',$3,'local')",[v.venueId,v.installationId,'private-'+i]);
  await db.pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'private-sealed-key')",[v.venueId]);
 }
 const login=await completeEmailProof(db,await app.request(origin+'/api/account/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'owner@example.test',password})},bindings),body=>app.request(origin+'/api/account/login/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)},bindings));assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');csrf=/__Host-cloud_csrf=([^;]+)/.exec(cookie)![1]!;
});
async function point(venue=venues[0]!,capturedAt='2026-01-31T12:00:00.000Z',verification='pending',retention='daily'){
 const id=randomUUID();await db.pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)',[id,venue.venueId,venue.installationId]);
 await db.pool.query("INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification) VALUES($1,$2,$3,1,'snapshot',$4,$5,100,$6,$7,$8,'{}',$9)",[id,venue.venueId,venue.installationId,'snapshots/'+id,'a'.repeat(64),capturedAt,retention,randomUUID(),verification]);return id;
}
test('catalogue uses live owner authority and exact browser proof without renewing the session',async()=>{
 const body={venueId:venues[0]!.venueId};
 for(const headers of [{cookie:''},{origin:'https://wrong.test'},{'x-csrf-token':'wrong'}] as Record<string,string>[])assert.ok([401,403].includes((await request(body,headers)).status));
 assert.equal((await request(body,{},undefined,'GET')).status,405);
 assert.equal((await request({...body,extra:'x'})).status,400);assert.equal((await request({venueId:'bad'})).status,400);
 assert.equal((await request({venueId:randomUUID()})).status,403);
 const before=(await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows;
 const response=await request(body);assert.equal(response.status,200);assert.deepEqual((await response.json()).points,[]);
 assert.deepEqual((await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows,before);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false');assert.equal((await request(body)).status,403);
 await db.pool.query('DELETE FROM organisation_memberships');assert.equal((await request(body)).status,403);
});
test('bounded cursor pages preserve equal timestamp ordering and never return another venue',async()=>{
 const ids=[];for(let n=0;n<52;n++)ids.push(await point());const foreign=await point(venues[1]!);
 const response=await request({venueId:venues[0]!.venueId});assert.equal(response.status,200);const page=await response.json();assert.equal(page.points.length,50);assert.ok(page.nextCursor);
 await db.pool.query('UPDATE backup_points SET deleting=true,deleted_at=clock_timestamp() WHERE id=$1',[page.points.at(-1).id]);
 const second=await (await request({venueId:venues[0]!.venueId,cursor:page.nextCursor})).json();assert.equal(second.points.length,2);assert.equal(second.nextCursor,null);
 assert.deepEqual([...page.points,...second.points].map(p=>p.id),ids.sort().reverse());assert(!JSON.stringify(page).includes(foreign));
 const forged=Buffer.from(JSON.stringify([venues[0]!.venueId,foreign])).toString('base64url');assert.equal((await request({venueId:venues[0]!.venueId,cursor:forged})).status,400);
 assert.equal((await request({venueId:venues[1]!.venueId,cursor:page.nextCursor})).status,400);
 assert.equal((await request({venueId:venues[0]!.venueId,cursor:'broken'})).status,400);
 assert.deepEqual(Object.keys(page.points[0]).sort(),['id','capturedAt','verification','retention','expiresAt','protection'].sort());
 assert(!JSON.stringify(page).includes('snapshots/'));assert(!JSON.stringify(page).includes('private-'));
});
test('retention protection is distinct from current verification and active recovery',async()=>{
 const old=await point(undefined,'2025-01-01T12:00:00.000Z','failed'),latest=await point(undefined,'2026-01-31T12:00:00.000Z','verified','monthly'),recovering=await point(undefined,'2026-01-01T12:00:00.000Z');
 await db.pool.query("INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome) VALUES($1,$2,$3,'fixture','verified')",[randomUUID(),old,'a'.repeat(64)]);
 await db.pool.query("UPDATE backup_points SET modules='{\"core\":1}' WHERE id=$1",[old]);
 const {admitPointFixture}=await import('../../backups/test/fixtures/verification.ts');await admitPointFixture(db.pool,old,'invalid','archive_invalid');
 const account=(await db.pool.query('SELECT id FROM cloud_accounts')).rows[0].id;
 await db.pool.query("INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode) VALUES($1,$2,$3,$4,'fixture-key','failure')",[randomUUID(),venues[0]!.venueId,recovering,account]);
 for(const state of ['deleting','deleted_at']){const id=await point();await db.pool.query(`UPDATE backup_points SET ${state}=${state==='deleting'?'true':'clock_timestamp()'} WHERE id=$1`,[id]);}
 const continuous=await point();await db.pool.query("UPDATE backup_points SET kind='continuous' WHERE id=$1",[continuous]);
 const r=await request({venueId:venues[0]!.venueId});assert.equal(r.status,200);const page=await r.json();assert.equal(page.points.length,3);assert.equal(page.defaultPointId,null);assert.equal(page.continuousRecovery,null);
 assert.equal(page.points.find((p:{id:string})=>p.id===old).protection,'fallback');assert.equal(page.points.find((p:{id:string})=>p.id===old).verification,'failed');assert.equal(page.points.find((p:{id:string})=>p.id===recovering).protection,'recovery');assert.equal(page.points.find((p:{id:string})=>p.id===latest).expiresAt,'2027-01-31T12:00:00.000Z');
 await db.pool.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()-interval '1 second'");
 assert.equal((await (await request({venueId:venues[0]!.venueId})).json()).points.find((p:{id:string})=>p.id===recovering).protection,null);
});

test('another organisation is refused even with a valid session and a known venue identifier',async()=>{
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('other@example.test');const row=(await db.pool.query("SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1")).rows[0],mail=db.outbox.open(row);assert('token' in mail);
 const other=await signup.complete(mail.token,{password,organisationName:'Luna',legalBusinessName:'Luna SL',countryCode:'ES'});
 const r=new RegistrationStore(db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',organisationId:other.organisationId,legalBusinessId:other.legalBusinessId};await r.start(b);await r.approveCloud(b,other.accountId);await r.approveLocal(b,randomUUID());const foreign=await r.complete(b);
 assert.equal((await request({venueId:foreign.venueId})).status,403);
});
test('catalogue limits persist across API processes',async()=>{
 for(let n=0;n<30;n++){
  assert.equal((await request({venueId:venues[0]!.venueId})).status,200);
  app=createAccountApp({factor:{keys:null,policy:emailLoginPolicy},pool:db.secondPool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
 }
 const limited=await request({venueId:venues[0]!.venueId});assert.equal(limited.status,429);assert(Number(limited.headers.get('retry-after'))>0);
});

test('published retention dates match cleanup across database time zones and daylight-saving changes',async()=>{
 const anchor=await point(undefined,'2020-01-01T12:00:00.000Z','verified');
 await db.pool.query("INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome) VALUES($1,$2,$3,'fixture','verified')",[randomUUID(),anchor,'a'.repeat(64)]);
 const madrid=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${db.schema} -c timezone=Europe/Madrid`});
 const cleanup=new BackupCatalogue(madrid,new BackupKeyVault(Buffer.alloc(32)),()=>({async read(){throw Error('not used');},async put(){throw Error('not used');},async remove(){}}));
 try{
  for(const [retention,date] of [['daily','2026-03-01T12:00:00.000Z'],['monthly','2026-03-29T00:30:00.000Z']]){
   const id=await point(undefined,date,'pending',retention),response=await request({venueId:venues[0]!.venueId});assert.equal(response.status,200);
   const shown=(await response.json()).points.find((p:{id:string})=>p.id===id).expiresAt;
   assert.equal(await cleanup.cleanupOne(venues[0]!.venueId,new Date(Date.parse(shown)-1)),null,retention+' must not delete before the displayed expiry');
   assert.equal(await cleanup.cleanupOne(venues[0]!.venueId,new Date(shown)),id);
  }
 }finally{await madrid.end();}
});

test('default snapshot selection requires current target evidence rather than the retained legacy flag',async()=>{
 const id=await point(undefined,'2026-01-31T12:00:00.000Z','verified');
 const response=await request({venueId:venues[0]!.venueId});assert.equal(response.status,200);
 const body=await response.json();assert(body.points.some((p:{id:string})=>p.id===id));assert.equal(body.defaultPointId,null);
});
test('default snapshot selection loses eligibility immediately when release readiness is withdrawn',async()=>{
 const f=await recoveryFixture(db);
 const headers={cookie:'__Host-cloud_session='+f.session.token,'x-csrf-token':f.session.csrfToken};
 assert.equal((await (await request({venueId:f.installed.venueId},headers)).json()).defaultPointId,f.point.id);
 await db.pool.query('UPDATE backup_verification_policy SET release_ready=false');
 assert.equal((await (await request({venueId:f.installed.venueId},headers)).json()).defaultPointId,null);
});

test('legacy_rows_never_drive_default_or_healthy: bounded public pages use current qualification',async()=>{
 const id=await point(undefined,undefined,'verified');
 const page=await (await request({venueId:venues[0]!.venueId})).json();
 assert.equal(page.points.find((p:{id:string})=>p.id===id).verification,'pending');
 await db.pool.query("UPDATE backup_points SET modules='{\"core\":1}' WHERE id=$1",[id]);
 const {admitPointFixture}=await import('../../backups/test/fixtures/verification.ts');
 await admitPointFixture(db.pool,id);
 assert.equal((await (await request({venueId:venues[0]!.venueId})).json()).points[0].verification,'verified');
 await db.pool.query('UPDATE backup_verification_policy SET release_ready=false');
 const stale=await (await request({venueId:venues[0]!.venueId})).json();
 assert.equal(stale.points[0].verification,'pending');assert.equal(stale.defaultPointId,null);
});

test('recovered scope: backup HTTP metadata refuses a retained outside membership',async()=>{
 const a=(await db.pool.query('SELECT id FROM cloud_accounts')).rows[0].id,org=(await db.pool.query('SELECT organisation_id FROM venues WHERE id=$1',[venues[0]!.venueId])).rows[0].organisation_id;
 await setRecoveryScope(db.pool,a);assert.equal((await request({venueId:venues[0]!.venueId})).status,403);
 await setRecoveryScope(db.pool,a,org);assert.equal((await request({venueId:venues[0]!.venueId})).status,200);
});

type ExitFixture=Awaited<ReturnType<typeof recoveryFixture>>;
function exitClockPool(t:TestContext){
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${db.schema},pg_catalog`});
 t.after(()=>pool.end());return pool;
}
function exitDownload(f:ExitFixture,planMode:PlanMode,stage:(key:string,options:StageOptions|undefined)=>Promise<ReturnType<typeof bufferObject>>,pool=db.pool){
 const server=createAccountApp({pool,outbox:db.outbox,planMode,
  config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},
  leaseIssuer:createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),
  captures:{vault:f.vault,objects:()=>({stage:(key,_streamKey,options)=>stage(key,options),
  async putStaged(){throw Error('unexpected write');},async remove(){throw Error('unexpected delete');}}),
  async grant(){throw Error('unexpected grant');}}});
 return (path:string,pointId=f.point.id)=>server.request(origin+'/api/account/backups/'+path,{method:'POST',headers:{origin,'content-type':'application/json',
  cookie:'__Host-cloud_session='+f.session.token,'x-csrf-token':f.session.csrfToken},body:JSON.stringify({venueId:f.installed.venueId,...(path==='list'?{}:{pointId})})},bindings);
}
test('exit download returns the verified archive and its matching key while the installation stays active',async()=>{
 const f=await recoveryFixture(db),bytes=f.objects.get(f.point.objectKey)!;
 let disposals=0;
 const send=exitDownload(f,'test-free-paid',async(key,options)=>{
  assert.equal(key,f.point.objectKey);
  assert.equal(options?.maxBytes,16*1024*1024);
  return {...bufferObject(bytes),async dispose(){disposals++;}};
 });
 const archive=await send('download');
 assert.equal(archive.status,200);
 assert.match(archive.headers.get('cache-control')??'',/\bno-store\b/);
 assert.equal(archive.headers.get('content-type'),'application/octet-stream');
 assert.deepEqual(Buffer.from(await archive.arrayBuffer()),bytes);
 assert.equal(disposals,1);
 assert.equal(await f.catalogue.rotate(f.installed.installationId),2);
 const key=await send('download-key');
 assert.equal(key.status,200);
 assert.match(key.headers.get('cache-control')??'',/\bno-store\b/);
 assert.equal((await key.text()).trim(),f.capture.keys.recoveryKey);
 assert.equal((await db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].revoked_at,null);
});

test('exit download refuses unavailable copies and stale or non-owner authority before reading storage',async()=>{
 const f=await recoveryFixture(db);
 let reads=0;
 const stage=async()=>{reads++;throw Error('unexpected read');};
 assert.equal((await exitDownload(f,'existing',stage)('download')).status,404);
 const send=exitDownload(f,'test-venue-levels',stage);
 const foreign=await point(),unchecked=await point(f.installed);
 assert.equal((await send('download',foreign)).status,410);
 assert.equal((await send('download-key',foreign)).status,410);
 assert.equal((await send('download',unchecked)).status,400);
 assert.equal((await send('download-key',unchecked)).status,400);
 const large=Buffer.alloc(16*1024*1024+1),capture=await f.catalogue.reserveCapture(f.installed.installationId,randomUUID());
 f.objects.set(capture.incomingKey,large);
 const oversized=await f.catalogue.publish(f.installed.installationId,capture.id,{...receipt(large),capturedAt:new Date().toISOString(),
  retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}});
 await verifyPointFixture(db.pool,f.catalogue,oversized.id);
 assert.equal((await send('download',oversized.id)).status,413);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.owner.accountId]);
 assert.equal((await send('download')).status,403);
 assert.equal((await send('download-key')).status,403);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1',[f.owner.accountId]);
 await db.pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '11 minutes' WHERE account_id=$1",[f.owner.accountId]);
 assert.deepEqual(await (await send('download')).json(),{error:'proof_required'});
 assert.deepEqual(await (await send('download-key')).json(),{error:'proof_required'});
 assert.equal(reads,0);
});

test('exit download disposes the staged archive if ownership is lost during the read',async()=>{
 const f=await recoveryFixture(db);
 let disposals=0;
 const send=exitDownload(f,'test-free-paid',async()=>{
  await db.secondPool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.owner.accountId]);
  return {...bufferObject(f.objects.get(f.point.objectKey)!),async dispose(){disposals++;}};
 });
 const response=await send('download');
 assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:'permission_denied'});
 assert.equal(disposals,1);
});

test('exit download rejects different stored bytes and disposes the staged copy',async()=>{
 const f=await recoveryFixture(db),bytes=Buffer.from(f.objects.get(f.point.objectKey)!);
 bytes[0]=bytes[0]!^1;
 let disposals=0;
 const send=exitDownload(f,'test-free-paid',async()=>({...bufferObject(bytes),async dispose(){disposals++;}}));
 const response=await send('download');
 assert.equal(response.status,410);
 assert.equal(disposals,1);
});

test('exit download lists the fixed dates and refuses both files once the window has ended',async()=>{
 const f=await recoveryFixture(db),venueId=f.installed.venueId;
 const send=exitDownload(f,'test-free-paid',async()=>bufferObject(f.objects.get(f.point.objectKey)!));
 const disabled=exitDownload(f,'existing',async()=>{throw Error('unexpected read');});
 const effectiveEndAt='2026-01-01T12:00:00.000Z',deadlineAt='2026-04-01T12:00:00.000Z';
 await new LifecycleStore(db.pool).request({venueId,operationId:randomUUID(),kind:'cancel',expectedRevision:0,
  fingerprint:'a'.repeat(64),effectiveEndAt});
 const closed=await (await send('list')).json();
 assert.deepEqual(closed.exitRecovery,{effectiveEndAt,deadlineAt,expired:true});
 assert.equal(closed.exitDownloadAvailable,undefined);
 assert.equal((await (await disabled('list')).json()).exitRecovery,undefined);
 for(const path of ['download','download-key']){
  const response=await send(path);
  assert.equal(response.status,410,path);
  assert.deepEqual(await response.json(),{error:'unavailable'});
 }
});

test('exit download disposes the staged archive if the deadline passes during staging',async t=>{
 const f=await recoveryFixture(db),venueId=f.installed.venueId;
 const pool=exitClockPool(t);
 const {rows:[{effective_end_at}]}=await db.pool.query("SELECT clock_timestamp()-interval '2160 hours'+interval '2 minutes' AS effective_end_at");
 await new LifecycleStore(db.pool).request({venueId,operationId:randomUUID(),kind:'cancel',expectedRevision:0,
  fingerprint:'a'.repeat(64),effectiveEndAt:effective_end_at.toISOString()});
 const open=await (await exitDownload(f,'test-free-paid',async()=>{throw Error('unexpected read');})('list')).json();
 assert.equal(open.exitDownloadAvailable,true);
 assert.equal(open.exitRecovery?.expired,false);
 let disposals=0;
 const send=exitDownload(f,'test-free-paid',async()=>{
  await db.pool.query("CREATE FUNCTION clock_timestamp() RETURNS timestamptz LANGUAGE sql AS $$SELECT pg_catalog.clock_timestamp()+interval '3 minutes'$$");
  return {...bufferObject(f.objects.get(f.point.objectKey)!),async dispose(){disposals++;}};
 },pool);
 const key=await send('download-key');assert.equal(key.status,200);
 assert.ok((await key.text()).trim()===f.capture.keys.recoveryKey,'the key is still available before the deadline');
 const response=await send('download');
 if(response.ok)await response.arrayBuffer();
 assert.equal(response.status,410);
 assert.equal(disposals,1);
});

test('backups list refuses a session that expires while waiting for the exit window',async t=>{
 const f=await recoveryFixture(db),pool=exitClockPool(t),held=await db.secondPool.connect();
 const send=exitDownload(f,'test-free-paid',async()=>{throw Error('unexpected read');},pool);
 let response:Promise<Response>|undefined;
 try{
  await held.query('BEGIN');
  const {rows:[{pid}]}=await held.query('SELECT pg_backend_pid() AS pid');
  await held.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE',[f.installed.venueId]);
  response=Promise.resolve(send('list'));
  await t.waitFor(async()=>{
   const {rows:[{waiting}]}=await db.pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',[pid]);
   assert.equal(waiting,true);
  },{timeout:3000});
  await held.query("CREATE FUNCTION clock_timestamp() RETURNS timestamptz LANGUAGE sql AS $$SELECT pg_catalog.clock_timestamp()+interval '2 days'$$");
  await held.query('COMMIT');
  const refusal=await response;
  assert.equal(refusal.status,401);
  assert.deepEqual(await refusal.json(),{error:'session_expired'});
 }finally{await held.query('ROLLBACK');held.release();await response?.catch(()=>{});}
});

test('exit download releases database locks when its request deadline expires',async()=>{
 const f=await recoveryFixture(db),client=await db.secondPool.connect(),probe=await db.pool.connect();
 const send=exitDownload(f,'test-free-paid',async()=>{throw Error('unexpected read');});
 try{
  await client.query('BEGIN');
  await client.query('SELECT 1 FROM backup_locations WHERE venue_id=$1 FOR UPDATE',[f.installed.venueId]);
  const response=await send('download-key');
  assert.equal(response.status,503);
  await probe.query('BEGIN');
  await probe.query("SET LOCAL lock_timeout='2s'");
  await probe.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[f.owner.accountId]);
 }finally{await probe.query('ROLLBACK');probe.release();await client.query('ROLLBACK');client.release();}
});

test('exit download rechecks key authority if proof expires while waiting on the venue',async()=>{
 const f=await recoveryFixture(db),client=await db.secondPool.connect();
 const send=exitDownload(f,'test-free-paid',async()=>{throw Error('unexpected read');});
 let response:Promise<Response>|undefined;
 try{
  await client.query('BEGIN');
  const {rows:[backend]}=await client.query('SELECT pg_backend_pid() AS pid');
  await client.query('SELECT 1 FROM backup_locations WHERE venue_id=$1 FOR UPDATE',[f.installed.venueId]);
  await db.pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '9 minutes 56 seconds' WHERE account_id=$1",[f.owner.accountId]);
  response=Promise.resolve(send('download-key'));
  await client.query('SELECT pg_sleep(4)');
  const {rows:[blocked]}=await client.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',[backend.pid]);
  assert.equal(blocked.waiting,true,'proof was fresh when the request reached the venue lock');
 }finally{await client.query('ROLLBACK');client.release();}
 const refusal=await response!;
 assert.equal(refusal.status,403);
 assert.deepEqual(await refusal.json(),{error:'proof_required'});
});
