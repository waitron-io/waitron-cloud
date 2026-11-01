import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {login} from '@waitron-cloud/identity';
import {BillingStore,RegistrationStore,SignupStore,transaction,type BillingLevel} from '@waitron-cloud/registration';
import {event} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../../remote-access/src/placement.ts';
import {database} from './fixtures.ts';
import {createAccountApp} from '../src/app.ts';

const origin='https://cloud.example.test',mode='test-venue-levels' as const;
async function fixture(){
 const db=await database();try{
  const email=randomUUID()+'@example.test',password='A long enough remote test password',signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
  const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
  const session=await transaction(db.pool,c=>login(c,{email,password}));
  const registration=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());const installed=await registration.complete(binding);
  const billing=new BillingStore(db.pool),scope={organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await billing.execute(scope,event(),{type:'ensure_business'});
  async function level(value:BillingLevel){const old=await billing.venue(scope,installed.venueId);return billing.transition(scope,event(),{type:'set_venue',venueId:installed.venueId,expectedRevision:old.revision,value:{level:value,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});}
  await level('connected');const store=new RemoteAccessStore(db.pool,mode),cellId=randomUUID(),peer=randomBytes(32).toString('base64');
  await store.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'remote-boundary.example.test',subnet:83,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
  const placement=await store.provision(installed.installationId,cellId,peer);
  let resolve=async(name:string)=>[name.startsWith('_acme-challenge.')?'_acme-challenge.'+placement.staffHostname:placement.staffHostname];
  const app=createAccountApp({pool:db.pool,outbox:db.outbox,planMode:mode,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},remoteResolve:name=>resolve(name)});
  const headers={origin,cookie:'__Host-cloud_session='+session.token,'content-type':'application/json','x-csrf-token':session.csrfToken};
  function request(action:string,extra:Record<string,string>={},override:Record<string,string>={}){return app.request(origin+'/api/account/remote-access/'+action,{method:'POST',headers:{...headers,...override},body:JSON.stringify({installationId:installed.installationId,...extra})},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as never);}
  const revision=async()=>Number((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[installed.installationId])).rows[0].configuration_revision);
  async function healthy(){const rev=await revision();await db.pool.query("UPDATE installations SET lease_expires_at=clock_timestamp()+interval '2 minutes' WHERE id=$1",[installed.installationId]);await db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[installed.installationId]);await db.pool.query("INSERT INTO installation_observations(installation_id,service,revision,health,observed_at,received_at) VALUES($1,'remote_access',$2,'healthy',clock_timestamp(),clock_timestamp()) ON CONFLICT(installation_id,service) DO UPDATE SET revision=EXCLUDED.revision,observed_at=EXCLUDED.observed_at,received_at=EXCLUDED.received_at",[installed.installationId,rev]);}
  return {db,owner,installed,store,cellId,peer,placement,level,request,revision,healthy,resolver(value:typeof resolve){resolve=value;},close:()=>db.close()};
 }catch(error){await db.close();throw error;}
}

// Status must use the venue reader and never turn retained setup or observations into a new grant.
test('venue remote HTTP status masks downgraded setup and needs explicit reprovision after upgrade',async()=>{
 const f=await fixture();try{
  await f.healthy();const response=await f.request('status');assert.equal(response.status,200,await response.clone().text());const initial=await response.json();assert.equal(initial.service.health,'healthy');assert.equal(initial.service.state,'ready');assert(initial.service.validUntil);
  await f.level('registered');await f.healthy();
  const denied=await f.request('status');assert.equal(denied.status,200,await denied.clone().text());const hidden=await denied.json();assert.equal(hidden.service.state,'unconfigured');assert.equal(hidden.service.health,'unknown');assert.equal(hidden.service.validUntil,null);assert.equal(hidden.publicForward,null);
  // Restore the real downgrade's unconfigured state after probing a retained stale row.
  await f.db.pool.query("UPDATE installation_services SET state='unconfigured',configuration='{}' WHERE installation_id=$1 AND service='remote_access'",[f.installed.installationId]);
  await f.level('connected');const upgraded=await f.request('status');assert.equal(upgraded.status,200,await upgraded.clone().text());assert.equal((await upgraded.json()).service.state,'unconfigured');
  await f.store.provision(f.installed.installationId,f.cellId,f.peer);await f.healthy();assert.equal((await(await f.request('status')).json()).service.health,'healthy');
  for(const secret of ['peerPublicKey','gatewayPublicKey','10.77.','configuration'])assert(!JSON.stringify(initial).includes(secret));
 }finally{await f.close();}
});

for(const action of ['dns','apply'] as const)test(`venue remote HTTP ${action} refuses level one without resolving`,async()=>{
 const f=await fixture();try{
  await f.level('registered');let calls=0;f.resolver(async()=>{calls++;return [];});
  const response=await f.request(action,{kind:'staff',hostname:'custom.example.test',...(action==='apply'?{expectedRevision:String(await f.revision())}:{})});
  assert.equal(response.status,403,await response.clone().text());assert.equal(calls,0);
  assert.equal((await f.db.pool.query('SELECT count(*) AS n FROM remote_hostname_changes')).rows[0].n,'0');
 }finally{await f.close();}
});

for(const roundTrip of [false,true])test(`venue remote HTTP apply rechecks DNS wait with round trip ${roundTrip}`,async()=>{
 const f=await fixture();try{
  const rev=await f.revision();let calls=0;
  f.resolver(async name=>{if(calls++===0){await f.level('registered');if(roundTrip)await f.level('connected');}return [name.startsWith('_acme-challenge.')?'_acme-challenge.'+f.placement.staffHostname:f.placement.staffHostname];});
  const response=await f.request('apply',{kind:'staff',hostname:'custom.example.test',expectedRevision:String(rev)});assert.equal(response.status,403,await response.clone().text());
  assert.equal((await f.db.pool.query("SELECT hostname FROM remote_hostnames WHERE venue_id=$1 AND kind='staff'",[f.installed.venueId])).rows[0].hostname,f.placement.staffHostname);
  assert.equal((await f.db.pool.query('SELECT count(*) AS n FROM remote_hostname_changes')).rows[0].n,'0');
 }finally{await f.close();}
});

test('venue remote HTTP keeps owner origin CSRF and revision checks',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('status',{}, {origin:'https://foreign.example'})).status,403);assert.equal((await f.request('status',{}, {'x-csrf-token':'wrong'})).status,403);
  assert.equal((await f.request('status',{installationId:randomUUID()})).status,403);
  const response=await f.request('apply',{kind:'staff',hostname:'custom.example.test',expectedRevision:String((await f.revision())+1)});assert.equal(response.status,409);
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.owner.accountId]);assert.equal((await f.request('status')).status,403);
 }finally{await f.close();}
});

// A valid old certificate request remains stored, but current permission controls every new reply.
test('venue staff certificate HTTP authenticates before denial and requires fresh setup after a round trip',async()=>{
 const {staffExchangeFixture}=await import('../../remote-access/test/staff-exchange-fixture.ts');const f=await staffExchangeFixture();
 try{
  const a=await f.venue(),scope=(await f.db.pool.query('SELECT organisation_id AS "organisationId",legal_business_id AS "legalBusinessId" FROM venues WHERE id=$1',[a.venueId])).rows[0];
  const billing=new BillingStore(f.db.pool);await billing.execute(scope,event(),{type:'ensure_business'});
  async function level(value:BillingLevel){const old=await billing.venue(scope,a.venueId);await billing.transition(scope,event(),{type:'set_venue',venueId:a.venueId,expectedRevision:old.revision,value:{level:value,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}});}
  await level('connected');const app=createAccountApp({staffCertificates:true,pool:f.db.pool,outbox:f.db.outbox,leaseIssuer:f.issuer,planMode:mode,config:{portalOrigin:origin,production:true,rateKey:f.db.rateKey,trustedProxyIps:[]}});
  const request=(action:string,envelope:unknown)=>app.request(origin+'/api/installations/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as never);
  const revision=async()=>Number((await f.db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[a.installationId])).rows[0].configuration_revision);
  const submit='staff-certificate-submit',status='staff-certificate-status',requestId=randomUUID();
  const accepted=await request(submit,a.proof(submit,{...a.body,revision:await revision()},requestId,a.lease));assert.equal(accepted.status,200,await accepted.clone().text());assert.equal((await accepted.json()).state,'pending');
  await level('registered');const stored=(await f.db.pool.query('SELECT * FROM staff_certificate_exchange')).rows;
  const proof=a.proof(status,{version:1,requestId},randomUUID(),a.lease);
  const forged=await request(status,{...proof,signature:randomBytes(64).toString('base64url')});assert.equal(forged.status,401);
  assert.equal((await request(status,proof)).status,403);await level('connected');assert.equal((await request(status,a.proof(status,{version:1,requestId},randomUUID(),a.lease))).status,403);
  assert.deepEqual((await f.db.pool.query('SELECT * FROM staff_certificate_exchange')).rows,stored);
  const store=new RemoteAccessStore(f.db.pool,mode);await store.provision(a.installationId,a.placement.cellId,a.placement.peerPublicKey);
  const next=randomUUID(),fresh=await request(submit,a.proof(submit,{...a.body,revision:await revision(),previousRequestId:requestId},next,a.lease));assert.equal(fresh.status,200,await fresh.clone().text());
  assert.equal((await request(status,a.proof(status,{version:1,requestId:next},randomUUID(),a.lease))).status,200);
 }finally{await f.close();}
});
