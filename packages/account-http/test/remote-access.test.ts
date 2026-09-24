import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {SignupStore,RegistrationStore} from '@waitron-cloud/registration';
import {RemoteAccessStore} from '../../remote-access/src/placement.ts';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';
const origin='https://cloud.example.test',password='A sufficiently long test password';
const bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings;
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,store:RemoteAccessStore,cookie:string,csrf:string;
let owner:{accountId:string;organisationId:string;legalBusinessId:string},venue:{venueId:string;installationId:string},assigned:string;
let resolve:(name:string)=>Promise<string[]>;
const options=()=>({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},remoteResolve:(name:string)=>resolve(name)});
const request=(action:string,extra:Record<string,string>={},headers:Record<string,string>={})=>app.request(origin+'/api/account/remote-access/'+action,{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-csrf-token':csrf,...headers},body:JSON.stringify({installationId:venue.installationId,...extra})},bindings);
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await db.pool.query('TRUNCATE account_rate_limits,signup_requests,email_outbox,organisations,cloud_accounts,remote_cells CASCADE');
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('owner@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 owner=await signup.complete(mail.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const r=new RegistrationStore(db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());venue=await r.complete(b);
 store=new RemoteAccessStore(db.pool);const cell={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'cell.example.test',subnet:7,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'};await store.createCell(cell);const p=await store.provision(venue.installationId,cell.id,randomBytes(32).toString('base64'));assigned=p.staffHostname;
 resolve=async name=>[name.startsWith('_acme-challenge.')?'_acme-challenge.'+assigned:assigned];app=createAccountApp(options());
 const login=await app.request(origin+'/api/account/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'owner@example.test',password})},bindings);assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');csrf=/__Host-cloud_csrf=([^;]+)/.exec(cookie)![1]!;
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
 const instructions=await request('dns',input);assert.equal(instructions.status,200);const dns=await instructions.json();assert.equal(dns.records.length,2);assert.equal(dns.records[0].value,assigned);
 resolve=async()=>['wrong.example'];assert.equal((await request('apply',{...input,expectedRevision:'1'})).status,400);
 resolve=async name=>[name.startsWith('_acme-challenge.')?'_acme-challenge.'+assigned:assigned];
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
test('revocation and session expiry during DNS verification are rechecked',async()=>{
 resolve=async name=>{await db.secondPool.query('UPDATE installations SET revoked_at=clock_timestamp()');return [name.startsWith('_acme')?'_acme-challenge.'+assigned:assigned];};
 assert.equal((await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'})).status,403);
 await db.pool.query('UPDATE installations SET revoked_at=NULL');
 resolve=async name=>{await db.secondPool.query("UPDATE cloud_sessions SET last_seen_at=clock_timestamp()-interval '31 minutes'");return [name.startsWith('_acme')?'_acme-challenge.'+assigned:assigned];};
 assert.equal((await request('apply',{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'})).status,401);
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
 const other=await signup.complete(mail.token,{password,organisationName:'Luna',legalBusinessName:'Luna SL',countryCode:'ES'}),r=new RegistrationStore(db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:other.organisationId,legalBusinessId:other.legalBusinessId};await r.start(b);await r.approveCloud(b,other.accountId);await r.approveLocal(b,randomUUID());const foreign=await r.complete(b);
 let lookups=0;resolve=async()=>{lookups++;return [];};
 for(const action of ['status','dns','apply']){
  const extra=action==='status'?{}:action==='dns'?{kind:'staff',hostname:'staff.cafe.example'}:{kind:'staff',hostname:'staff.cafe.example',expectedRevision:'1'};
  assert.equal((await request(action,{installationId:foreign.installationId,...extra} as Record<string,string>)).status,403);
 }
 assert.equal(lookups,0);
});
