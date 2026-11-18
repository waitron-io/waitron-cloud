import {recordPublicCopy} from '../../remote-access/test/fixtures/public-copy.ts';
import {setRecoveryScope} from '../../registration/test/fixtures/recovery-scope.ts';
import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {SignupStore,RegistrationStore} from '@waitron-cloud/registration';
import {RemoteAccessStore} from '../../remote-access/src/placement.ts';
import {createAccountApp} from '../src/app.ts';
import {database,completeEmailProof,emailLoginPolicy} from './fixtures.ts';
import {prepareConnectionProof} from '../../registration/test/fixtures/action-proof.ts';
const origin='https://cloud.example.test',password='A sufficiently long test password';
const bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings;
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,store:RemoteAccessStore,cookie:string,csrf:string;
let owner:{accountId:string;organisationId:string;legalBusinessId:string},venue:{venueId:string;installationId:string},assigned:string;
let resolve:(name:string)=>Promise<string[]>;
const options=()=>({factor:{keys:null,policy:emailLoginPolicy},pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},remoteResolve:(name:string)=>resolve(name)});
const request=async(action:string,extra:Record<string,string>={},headers:Record<string,string>={})=>app.request(origin+'/api/account/remote-access/'+action,{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-csrf-token':csrf,...headers},body:JSON.stringify({installationId:venue.installationId,...extra})},bindings);
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('owner@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 owner=await signup.complete(mail.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const r=new RegistrationStore(db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());venue=await r.complete(b);
 store=new RemoteAccessStore(db.pool);const cell={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'cell.example.test',subnet:7,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'};await store.createCell(cell);const p=await store.provision(venue.installationId,cell.id,randomBytes(32).toString('base64'));assigned=p.staffHostname;
 resolve=async name=>[name.startsWith('_acme-challenge.')?'_acme-challenge.'+assigned:assigned];app=createAccountApp(options());
 const login=await completeEmailProof(db,await app.request(origin+'/api/account/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'owner@example.test',password})},bindings),body=>app.request(origin+'/api/account/login/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)},bindings));assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');csrf=/__Host-cloud_csrf=([^;]+)/.exec(cookie)![1]!;
 await prepareConnectionProof(db.pool,owner.accountId,/__Host-cloud_session=([^;]+)/.exec(cookie)![1]!);
});
for(const condition of ['unenrolled','unproved','stale'] as const)test(`remote apply refuses ${condition} authority before DNS while status and instructions stay readable`,async()=>{
 if(condition==='unenrolled')await db.pool.query('DELETE FROM cloud_passkeys');
 if(condition==='unproved')await db.pool.query('UPDATE cloud_sessions SET action_proved_at=NULL');
 if(condition==='stale')await db.pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '11 minutes'");
 assert.equal((await request('status')).status,200);
 assert.equal((await request('dns',{kind:'staff',hostname:'staff.cafe.example'})).status,200);
 let lookups=0;resolve=async()=>{lookups++;return [];};
 const reply=await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'});
 assert.equal(reply.status,403);assert.deepEqual(await reply.json(),{error:condition==='unenrolled'?'enrollment_required':'proof_required'});
 assert.equal(lookups,0);assert.equal((await db.pool.query('SELECT count(*) FROM remote_hostname_changes')).rows[0].count,'0');
});
for(const condition of ['unenrolled','security','password'] as const)test(`remote apply rechecks ${condition} after DNS before committing`,async()=>{
 resolve=async name=>{
  if(condition==='unenrolled')await db.secondPool.query('DELETE FROM cloud_passkeys');
  if(condition==='security')await db.secondPool.query('UPDATE cloud_sessions SET action_security_revision=action_security_revision+1');
  if(condition==='password')await db.secondPool.query("UPDATE cloud_credentials SET password_hash=password_hash||'changed'");
  return [name.startsWith('_acme')?'_acme-challenge.'+assigned:assigned];
 };
 const reply=await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'});
 assert.equal(reply.status,403);assert.deepEqual(await reply.json(),{error:condition==='unenrolled'?'enrollment_required':'proof_required'});
 assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE kind='staff'")).rows[0].hostname,assigned);
 assert.equal((await db.pool.query('SELECT configuration_revision FROM installations')).rows[0].configuration_revision,1);
 assert.equal((await db.pool.query('SELECT count(*) FROM remote_hostname_changes')).rows[0].count,'0');
});
test('owner sees only public setup metadata with passive session, exact origin and CSRF',async()=>{
 const before=(await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows;
 const response=await request('status');assert.equal(response.status,200);const view=await response.json();
 assert.equal(view.installationId,venue.installationId);assert.equal(view.names.staff.assigned,assigned);assert.equal(view.names.staff.current,assigned);assert.equal(view.revision,1);assert.equal(view.service.state,'provisioning');
 for(const secret of ['gatewayPublicKey','peerPublicKey','10.77.','51820','configuration'])assert(!JSON.stringify(view).includes(secret));
 assert.deepEqual((await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows,before);
 for(const h of [{cookie:''},{origin:'https://bad.test'},{'x-csrf-token':'wrong'}] as Record<string,string>[])assert([401,403].includes((await request('status',{},h)).status));
 assert.equal((await request('status',{installationId:randomUUID()})).status,403);
 assert.equal((await request('status',{cellId:randomUUID()})).status,400);
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false');assert.equal((await request('status')).status,403);
});
test('custom DNS instructions and revision-bound apply preserve other name and audit actor',async()=>{
 const input={kind:'staff',hostname:'staff.cafe.example'};
 const instructions=await request('dns',input);assert.equal(instructions.status,200);
 assert.deepEqual(await instructions.json(),{installationId:venue.installationId,...input,records:[{type:'CNAME',name:input.hostname,value:assigned}]});
 resolve=async()=>['wrong.example'];assert.equal((await request('apply',{...input,expectedRevision:'1'})).status,400);
 resolve=async name=>name===input.hostname?[assigned]:[];
 const applied=await request('apply',{...input,expectedRevision:'1'});assert.equal(applied.status,200);const view=await applied.json();assert.equal(view.names.staff.current,input.hostname);assert.equal(view.names.public.current,view.names.public.assigned);assert.equal(view.revision,2);assert.equal(view.service.state,'provisioning');
 assert.equal((await request('apply',{...input,expectedRevision:'1'})).status,409);
 const audit=(await db.pool.query('SELECT * FROM remote_hostname_changes')).rows;assert.equal(audit.length,1);assert.equal(audit[0].account_id,owner.accountId);assert.equal(audit[0].hostname,input.hostname);
 const restored=await request('apply',{kind:'staff',hostname:assigned,expectedRevision:'2'});assert.equal(restored.status,200);assert.equal((await restored.json()).names.staff.current,assigned);
});
test('owner loss during DNS verification prevents committing a hostname change',async()=>{
 resolve=async name=>{await db.secondPool.query('UPDATE organisation_memberships SET is_owner=false');return [name.startsWith('_acme')?'_acme-challenge.'+assigned:assigned];};
 assert.equal((await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'})).status,403);
 assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE kind='staff'")).rows[0].hostname,assigned);
});
test('revocation during DNS refuses, while accepted setup outlasts the browser idle and proof windows',async()=>{
 resolve=async name=>{await db.secondPool.query('UPDATE installations SET revoked_at=clock_timestamp()');return [name.startsWith('_acme')?'_acme-challenge.'+assigned:assigned];};
 assert.equal((await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'})).status,403);
 await db.pool.query('UPDATE installations SET revoked_at=NULL');
 resolve=async name=>{await db.secondPool.query("UPDATE cloud_sessions SET last_seen_at=clock_timestamp()-interval '31 minutes',action_proved_at=clock_timestamp()-interval '11 minutes'");return [name.startsWith('_acme')?'_acme-challenge.'+assigned:assigned];};
 assert.equal((await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'})).status,200);
 assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE kind='staff'")).rows[0].hostname,'staff.cafe.example');
 assert.equal((await db.pool.query('SELECT configuration_revision FROM installations')).rows[0].configuration_revision,2);
});
test('reserved names, malformed inputs and DNS failures cannot change configuration',async()=>{
 for(const hostname of ['https://cafe.example','127.0.0.1','cafe','staff-v-'+randomUUID()+'.cell.example.test'])assert.equal((await request('apply',{kind:'staff',hostname,expectedRevision:'1'})).status,400);
 for(const extra of [{kind:'admin',hostname:'staff.cafe.example',expectedRevision:'1'},{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1.5'}])assert.equal((await request('apply',extra)).status,400);
 assert.equal((await request('dns',{kind:'staff',hostname:assigned})).status,400);
 resolve=async()=>{throw Error('resolver offline');};const response=await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'});assert.equal(response.status,400);assert.equal((await response.json()).error,'dns_not_verified');
});
test('status shows missing placement and revoked access without claiming readiness',async()=>{
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp()');const revoked=await request('status');assert.equal(revoked.status,200);assert.equal((await revoked.json()).revoked,true);
 await db.pool.query('DELETE FROM remote_hostnames');await db.pool.query('DELETE FROM remote_placements');const empty=await request('status');assert.equal(empty.status,200);assert.equal((await empty.json()).names,null);
});
test('request rate limits persist across processes',async()=>{
 for(let n=0;n<30;n++){assert.equal((await request('status')).status,200);app=createAccountApp({...options(),pool:db.secondPool});}
 const limited=await request('status');assert.equal(limited.status,429);assert(Number(limited.headers.get('retry-after'))>0);
});
test('stale received observations and old revisions never advertise working remote access',async()=>{
 await db.pool.query("UPDATE installations SET lease_expires_at=clock_timestamp()+interval '2 minutes'");
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE service='remote_access'");
 await db.pool.query("INSERT INTO installation_observations(installation_id,service,revision,health,observed_at,received_at) VALUES($1,'remote_access',1,'healthy',clock_timestamp(),clock_timestamp()-interval '6 minutes')",[venue.installationId]);
 assert.equal((await (await request('status')).json()).service.health,'unknown');
 await db.pool.query('UPDATE installation_observations SET received_at=clock_timestamp()');const fresh=(await (await request('status')).json()).service;assert.equal(fresh.health,'healthy');assert(Date.parse(fresh.validUntil)<=Date.now()+120000);
 await db.pool.query('UPDATE installation_observations SET revision=0');assert.equal((await (await request('status')).json()).service.health,'unknown');
});
test('DNS timeout returns a bounded refusal without changing the hostname',async()=>{
 resolve=()=>new Promise(()=>{});const start=Date.now();const response=await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'});
 assert.equal(response.status,400);assert.equal((await response.json()).error,'dns_not_verified');assert(Date.now()-start<5000);
 assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE kind='staff'")).rows[0].hostname,assigned);
});
test('a known installation in another organisation is refused before DNS queries',async()=>{
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('other@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]);assert('token' in mail);
 const other=await signup.complete(mail.token,{password,organisationName:'Luna',legalBusinessName:'Luna SL',countryCode:'ES'}),r=new RegistrationStore(db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',organisationId:other.organisationId,legalBusinessId:other.legalBusinessId};await r.start(b);await r.approveCloud(b,other.accountId);await r.approveLocal(b,randomUUID());const foreign=await r.complete(b);
 let lookups=0;resolve=async()=>{lookups++;return [];};
 for(const action of ['status','dns','apply','recheck']){
  const extra=action==='status'?{}:action==='recheck'?{kind:'staff'}:action==='dns'?{kind:'staff',hostname:'staff.cafe.example'}:{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'};
  assert.equal((await request(action,{installationId:foreign.installationId,...extra} as Record<string,string>)).status,403);
 }
 assert.equal(lookups,0);
});
async function untilLock(fragment:string){
 const end=Date.now()+2000;while(Date.now()<end){const waiting=await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[db.schema,'%'+fragment+'%']);if(waiting.rowCount)return;await new Promise(r=>setTimeout(r,10));}assert.fail('request did not reach the expected lock');
}
test('ownership read waits for an in-flight membership revocation before committing',async()=>{
 const blocker=await db.secondPool.connect();let response:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('UPDATE organisation_memberships SET is_owner=false');
  let settled=false;response=request('apply',{kind:'staff',hostname:'race.cafe.example',expectedRevision:'1'});void response.then(()=>{settled=true;});
  await new Promise(r=>setTimeout(r,100));assert.equal(settled,false,'owner check must wait for the membership writer');
  await blocker.query('COMMIT');assert.equal((await response).status,403);
  assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE kind='staff'")).rows[0].hostname,assigned);
  assert.equal((await db.pool.query('SELECT count(*) FROM remote_hostname_changes')).rows[0].count,'0');
 }finally{await blocker.query('ROLLBACK');blocker.release();await response;}
});
for(const action of ['apply','status'])test(`session expiry while ${action} waits for installation lock is refused before commit`,async()=>{
 const blocker=await db.secondPool.connect();let response:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[venue.installationId]);
  await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '1 second'");
  response=request(action,action==='apply'?{kind:'staff',hostname:'late.cafe.example',expectedRevision:'1'}:{});
  await untilLock(action==='apply'?'SELECT * FROM installations WHERE id':'SELECT configuration_revision,revoked_at');
  await new Promise(r=>setTimeout(r,1100));await blocker.query('COMMIT');assert.equal((await response).status,401);
  assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE kind='staff'")).rows[0].hostname,assigned);
  assert.equal((await db.pool.query('SELECT count(*) FROM remote_hostname_changes')).rows[0].count,'0');
 }finally{await blocker.query('ROLLBACK');blocker.release();await response;}
});
test('DNS instructions recheck ownership after a blocked metadata lookup',async()=>{
 const blocker=await db.secondPool.connect();let response:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK remote_hostnames IN ACCESS EXCLUSIVE MODE');
  response=request('dns',{kind:'staff',hostname:'staff.cafe.example'});await untilLock('SELECT p.venue_id,h.assigned_hostname,i.revoked_at');
  await db.pool.query('UPDATE organisation_memberships SET is_owner=false');await blocker.query('COMMIT');assert.equal((await response).status,403);
 }finally{await blocker.query('ROLLBACK');blocker.release();await response;}
});

for(const [condition,code] of [['free','remote_plan_required'],['unconfigured','remote_setup_required'],['production','remote_test_only'],['revoked','revoked']] as const)
 test(`real database: ${condition} explains the remote refusal without changing setup`,async()=>{
  app=createAccountApp({...options(),planMode:'test-free-paid'});
  await db.pool.query("UPDATE organisations SET service_plan=$1",[condition==='free'?'free':'paid']);
  if(condition==='unconfigured')await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE service='remote_access'");
  if(condition==='production')await db.pool.query("UPDATE venues SET environment='production'");
  if(condition==='revoked')await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp()');
  const before=(await db.pool.query('SELECT * FROM installations')).rows;
  for(const action of ['dns','apply']){
   const response=await request(action,{kind:'staff',hostname:'staff.cafe.example',...(action==='apply'?{expectedRevision:'1'}:{})});
   assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:code});
  }
  assert.deepEqual((await db.pool.query('SELECT * FROM installations')).rows,before);
  assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE kind='staff'")).rows[0].hostname,assigned);
  assert.equal((await db.pool.query('SELECT count(*) FROM remote_hostname_changes')).rows[0].count,'0');
 });

for(const condition of ['free','unconfigured','revoked'] as const)test(`real database: ${condition} during DNS is refused with its current cause`,async()=>{
 app=createAccountApp({...options(),planMode:'test-free-paid'});
 await db.pool.query("UPDATE organisations SET service_plan='paid'");
 resolve=async name=>{
  if(condition==='free')await db.secondPool.query("UPDATE organisations SET service_plan='free'");
  if(condition==='unconfigured')await db.secondPool.query("UPDATE installation_services SET state='unconfigured' WHERE service='remote_access'");
  if(condition==='revoked')await db.secondPool.query('UPDATE installations SET revoked_at=clock_timestamp()');
  return [name.startsWith('_acme')?'_acme-challenge.'+assigned:assigned];
 };
 const response=await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'});
 assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:condition==='free'?'remote_plan_required':condition==='unconfigured'?'remote_setup_required':'revoked'});
 assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE kind='staff'")).rows[0].hostname,assigned);
 assert.equal((await db.pool.query('SELECT count(*) FROM remote_hostname_changes')).rows[0].count,'0');
});

for(const condition of ['free','revoked'] as const)test(`real database: late owner loss hides ${condition} remote metadata`,async()=>{
 app=createAccountApp({...options(),planMode:'test-free-paid'});
 await db.pool.query("UPDATE organisations SET service_plan='paid'");
 if(condition==='revoked')await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp()');
 const blocker=await db.secondPool.connect();let response:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');
  if(condition==='free')await blocker.query("UPDATE organisations SET service_plan='free'");
  else await blocker.query('LOCK remote_hostnames IN ACCESS EXCLUSIVE MODE');
  response=request('dns',{kind:'staff',hostname:'staff.cafe.example'});
  await untilLock(condition==='free'?'SELECT id,service_plan,service_plan_revision FROM organisations':'SELECT p.venue_id,h.assigned_hostname,i.revoked_at');
  await db.secondPool.query('UPDATE organisation_memberships SET is_owner=false');
  await blocker.query('COMMIT');const reply=await response;
  assert.equal(reply.status,403);assert.deepEqual(await reply.json(),{error:'permission_denied'});
  assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE kind='staff'")).rows[0].hostname,assigned);
  assert.equal((await db.pool.query('SELECT count(*) FROM remote_hostname_changes')).rows[0].count,'0');
 }finally{await blocker.query('ROLLBACK');blocker.release();await response;}
});

for(const withdrawal of ['sign-out','deletion'] as const)test(`remote ${withdrawal} during DNS asks for sign-in again without a write`,async()=>{
 resolve=async name=>{
  await db.secondPool.query(withdrawal==='sign-out'?'UPDATE cloud_sessions SET ended_at=clock_timestamp()':'DELETE FROM cloud_sessions');
  return [name.startsWith('_acme')?'_acme-challenge.'+assigned:assigned];
 };
 const reply=await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'});
 assert.equal(reply.status,401);assert.deepEqual(await reply.json(),{error:'unauthenticated'});
 assert.equal((await db.pool.query("SELECT hostname FROM remote_hostnames WHERE kind='staff'")).rows[0].hostname,assigned);
 assert.equal((await db.pool.query('SELECT count(*) FROM remote_hostname_changes')).rows[0].count,'0');
});

test('remote status retains assigned names after a move to a different cell suffix',async()=>{
 const before=await (await request('status')).json(),target=randomUUID();
 await store.createCell({id:target,country:'ES',provider:'aws',environment:'test',suffix:'destination.example.test',subnet:8,publicKey:randomBytes(32).toString('base64'),endpoint:'destination.example.test:51820'});
 const operationId=randomUUID();await store.stageMove({operationId,installationId:venue.installationId,targetCellId:target,targetPeerPublicKey:randomBytes(32).toString('base64'),expectedRevision:1});
 const manifest=await store.manifest(target);await store.markMoveReady(operationId,1,manifest.sequence);await recordPublicCopy(db.pool,operationId);await store.completeMove(operationId,1);
 const response=await request('status');assert.equal(response.status,200);assert.deepEqual((await response.json()).names,before.names);
});

test('recovered scope: remote status refuses another retained business',async()=>{
 await setRecoveryScope(db.pool,owner.accountId);assert.equal((await request('status')).status,403);
 await setRecoveryScope(db.pool,owner.accountId,owner.organisationId);assert.equal((await request('status')).status,200);
});

async function movedStaffRecord() {
 const hostname='staff.cafe.example';
 await db.pool.query("UPDATE remote_hostnames SET hostname=$1,record_moved_at=clock_timestamp() WHERE kind='staff'",[hostname]);
 await db.pool.query(`INSERT INTO remote_configuration_jobs(kind,target_id,desired_digest,status,attempts,last_error,available_at)
  VALUES('certificate_staff',$1,repeat('a',64),'failed',8,'dns_not_verified',clock_timestamp()+interval '1 day')`,[venue.installationId]);
 return hostname;
}

test('only the affected custom name reports its moved record and leaves probe dates out',async()=>{
 const hostname=await movedStaffRecord(),expiry='2026-12-01T12:00:00.000Z';
 await db.pool.query(`INSERT INTO remote_probe_observations
  (installation_id,venue_id,service,configuration_revision,hostname,status,checked_at,elapsed_ms,certificate_not_before,certificate_not_after,certificate_fingerprint256)
  VALUES($1,$2,'staff',1,$3,'healthy',clock_timestamp(),12,'2026-09-01T12:00:00Z',$4,'AA:BB')`,[venue.installationId,venue.venueId,hostname,expiry]);
 const reply=await request('status');
 assert.equal(reply.status,200);
 const {names}=await reply.json();
 assert.deepEqual(names.staff,{assigned,current:hostname,recordMoved:true});
 assert.equal(names.public.recordMoved,false);
});

test('Check again clears a verified record notice and makes a failed job due',async()=>{
 const hostname=await movedStaffRecord();
 resolve=async name=>name===hostname?[assigned]:[];
 const reply=await request('recheck',{kind:'staff'});
 assert.equal(reply.status,200);
 const view=await reply.json();
 assert.equal(view.names.staff.recordMoved,false);
 assert.equal(view.publicForward,null);
 const {rows}=await db.pool.query(`SELECT status,attempts,last_error,available_at<=clock_timestamp() AS due
  FROM remote_configuration_jobs WHERE kind='certificate_staff'`);
 assert.deepEqual(rows,[{status:'pending',attempts:0,last_error:null,due:true}]);
});

test('Check again preserves existing rows when DNS is still wrong or the session loses ownership',async()=>{
 await movedStaffRecord();
 const state=async()=> (await db.pool.query(`SELECT row_to_json(h) AS name,row_to_json(j) AS job
  FROM remote_hostnames h CROSS JOIN remote_configuration_jobs j WHERE h.kind='staff' AND j.kind='certificate_staff'`)).rows;
 const before=await state();
 resolve=async()=>['elsewhere.example.test'];
 const wrong=await request('recheck',{kind:'staff'});
 assert.equal(wrong.status,400);
 assert.deepEqual(await wrong.json(),{error:'dns_not_verified'});
 assert.deepEqual(await state(),before);

 resolve=async()=>{
  await db.secondPool.query('UPDATE organisation_memberships SET is_owner=false');
  return [assigned];
 };
 assert.equal((await request('recheck',{kind:'staff'})).status,403);
 assert.deepEqual(await state(),before);
 assert.equal((await request('status')).status,403);
});

for(const mode of ['existing','test-free-paid'] as const)test(`Check again leaves a locked running claim intact in ${mode} mode`,async()=>{
 await movedStaffRecord();
 await db.pool.query("UPDATE organisations SET service_plan='paid'");
 app=createAccountApp({...options(),planMode:mode});
 await db.pool.query(`UPDATE remote_configuration_jobs SET status='running',claim_id=$1,lease_until=clock_timestamp()+interval '1 minute'`,[randomUUID()]);
 const before=(await db.pool.query('SELECT * FROM remote_configuration_jobs')).rows;
 const worker=await db.secondPool.connect();
 let reply:Promise<Response>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await worker.query('BEGIN');
  await worker.query('SELECT 1 FROM remote_configuration_jobs FOR UPDATE');
  reply=request('recheck',{kind:'staff'});
  const result=await Promise.race([reply,new Promise<null>(done=>{timer=setTimeout(()=>done(null),1500);})]);
  assert(result,'Check again must complete while the running job is still locked');
  assert.equal(result.status,200);
  assert.equal((await result.json()).names.staff.recordMoved,false);
 }finally{
  clearTimeout(timer);await worker.query('ROLLBACK');worker.release();await reply?.catch(()=>{});
 }
 assert.deepEqual((await db.pool.query('SELECT * FROM remote_configuration_jobs')).rows,before);
});

test('Check again preserves a claim committed while it waits to reset a pending job',async()=>{
 await movedStaffRecord();
 const worker=await db.secondPool.connect(),claim=randomUUID();
 let reply:Promise<Response>|undefined,committed=false;
 try{
  await worker.query('BEGIN');
  await worker.query("UPDATE remote_configuration_jobs SET status='running',claim_id=$1,lease_until=clock_timestamp()+interval '1 minute'",[claim]);
  reply=request('recheck',{kind:'staff'});
  await untilLock("UPDATE remote_configuration_jobs SET status='pending'");
  await worker.query('COMMIT');committed=true;
  assert.equal((await reply).status,200);
 }finally{
  if(!committed)await worker.query('ROLLBACK');
  worker.release();await reply?.catch(()=>{});
 }
 assert.deepEqual((await db.pool.query('SELECT status,claim_id FROM remote_configuration_jobs')).rows,[{status:'running',claim_id:claim}]);
});


test('repeated Check again requests preserve retry timing once the notice clears',async()=>{
 const hostname=await movedStaffRecord();
 let lookups=0;
 resolve=async name=>{lookups++;return name===hostname?[assigned]:[];};
 assert.equal((await request('recheck',{kind:'staff'})).status,200);
 await db.pool.query(`UPDATE remote_configuration_jobs SET attempts=7,last_error='challenge_not_answerable',
  available_at=clock_timestamp()+interval '15 minutes' WHERE kind='certificate_staff'`);
 const before=(await db.pool.query('SELECT * FROM remote_configuration_jobs')).rows;
 for(let press=0;press<2;press++){
  const reply=await request('recheck',{kind:'staff'});
  assert.equal(reply.status,200);
  assert.equal((await reply.json()).names.staff.recordMoved,false);
 }
 assert.equal(lookups,1);
 assert.deepEqual((await db.pool.query('SELECT * FROM remote_configuration_jobs')).rows,before);
});
