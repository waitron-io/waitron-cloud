import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {HttpBindings} from '@hono/node-server';
import {createSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';

let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>;
const origin='https://cloud.example.test',id=()=>randomUUID();
let owner:string,member:string,organisation:string,venue:string,installation:string,foreignInstallation:string;
let ownerSession:{token:string;csrfToken:string},memberSession:{token:string;csrfToken:string};
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 owner=id();member=id();organisation=id();venue=id();installation=id();foreignInstallation=id();
 const business=id(),foreignOrganisation=id(),foreignBusiness=id(),foreignVenue=id();
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[owner,member]);
 await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Private Sol'),($2,'Private Foreign')",[organisation,foreignOrganisation]);
 await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Private Sol SL','ES'),($3,$4,'Private Foreign SL','ES')",[business,organisation,foreignBusiness,foreignOrganisation]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test'),($5,$6,$7,$8,'test')",[venue,organisation,business,id(),foreignVenue,foreignOrganisation,foreignBusiness,id()]);
 await db.pool.query("INSERT INTO installations(id,venue_id,public_key,last_contact_at,lease_expires_at) VALUES($1,$2,'private-owner-key','2026-09-26T20:00:00Z','2026-09-26T22:00:00Z'),($3,$4,'private-foreign-key',NULL,NULL)",[installation,venue,foreignInstallation,foreignVenue]);
 await db.pool.query("INSERT INTO installation_services(installation_id,service,state) VALUES($1,'continuous_backup','ready'),($1,'remote_access','ready'),($1,'retained_snapshots','ready'),($2,'continuous_backup','ready'),($2,'remote_access','ready'),($2,'retained_snapshots','ready')",[installation,foreignInstallation]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true),($3,$2,true,false)',[owner,organisation,member]);
 ownerSession=await transaction(db.pool,client=>createSession(client,owner));memberSession=await transaction(db.pool,client=>createSession(client,member));
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
});
function call(body:unknown,credentials=ownerSession,options:{method?:string;origin?:string;csrf?:string}={}){
 return app.request(origin+'/api/account/diagnostics/read',{method:options.method??'POST',headers:{origin:options.origin??origin,'content-type':'application/json',cookie:'__Host-cloud_session='+credentials.token,'x-csrf-token':options.csrf??credentials.csrfToken},...(options.method==='GET'?{}:{body:JSON.stringify(body)})},{incoming:{socket:{remoteAddress:'192.0.2.88'}}} as HttpBindings);
}

test('owner receives one redacted diagnostic whose stale evidence is unknown',async()=>{
 await db.pool.query("INSERT INTO installation_observations(installation_id,service,revision,health,failure,observed_at,received_at) VALUES($1,'remote_access',0,'healthy',NULL,clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '10 minutes'),($1,'continuous_backup',0,'degraded','storage',clock_timestamp(),clock_timestamp())",[installation]);
 await db.pool.query("INSERT INTO venue_monitors(venue_id,next_check_at,checked_at) VALUES($1,clock_timestamp(),clock_timestamp()-interval '10 minutes')",[venue]);
 await db.pool.query("INSERT INTO venue_incidents(venue_id,kind,status,revision,opened_at,changed_at) VALUES($1,'disconnected','open',2,'2026-09-26T19:00:00Z','2026-09-26T19:05:00Z')",[venue]);
 const cell=id();await db.pool.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,'ES','aws','test','private.example.test',91,'private-cell-key','private-gateway:51820')",[cell]);
 await db.pool.query("INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port) VALUES($1,$2,$3,'10.60.91.2','private-peer-key',51820)",[venue,installation,cell]);
 await db.pool.query("INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES('private-public.example.test',$1,'public'),('private-staff.example.test',$1,'staff')",[venue]);
 await db.pool.query(`INSERT INTO remote_probe_observations(installation_id,venue_id,service,configuration_revision,hostname,status,checked_at,elapsed_ms,failure,certificate_not_before,certificate_not_after,certificate_fingerprint256)
  VALUES($1,$2,'public',0,'private-public.example.test','healthy',clock_timestamp()-interval '10 minutes',5,NULL,'2026-01-01','2027-01-01',$3),
   ($1,$2,'staff',0,'private-staff.example.test','failed',clock_timestamp(),6,'tls',NULL,NULL,NULL)`,[installation,venue,'a'.repeat(64)]);
 const response=await call({installationId:installation});assert.equal(response.status,200,await response.clone().text());
 const body=await response.json() as Record<string,any>;assert.equal(body.version,1);assert.ok(Number.isFinite(Date.parse(body.generatedAt)));
 delete body.generatedAt;
 assert.deepEqual(body,{version:1,installation:{installationId:installation,venueId:venue,environment:'test',revision:0,
  access:{status:'active',lastContactAt:'2026-09-26T20:00:00.000Z',leaseExpiresAt:'2026-09-26T22:00:00.000Z'},
  services:[
   {service:'continuous_backup',state:'ready',health:'degraded',observedAt:body.installation.services[0].observedAt},
   {service:'remote_access',state:'ready',health:'unknown',observedAt:body.installation.services[1].observedAt},
   {service:'retained_snapshots',state:'ready',health:'unknown',observedAt:null},
  ],backups:{latestSnapshotAt:null,verifiedSnapshotAt:null},monitoring:{enabled:true,fresh:false,checkedAt:body.installation.monitoring.checkedAt,
   incidents:[{kind:'disconnected',openedAt:'2026-09-26T19:00:00.000Z',changedAt:'2026-09-26T19:05:00.000Z'}],remoteChecks:{
    public:{status:'unknown',checkedAt:body.installation.monitoring.remoteChecks.public.checkedAt,certificateNotAfter:'2027-01-01T00:00:00.000Z'},
    staff:{status:'failed',checkedAt:body.installation.monitoring.remoteChecks.staff.checkedAt,certificateNotAfter:null},
   }}}});
 const encoded=JSON.stringify(body);
 for(const secret of [owner,member,organisation,foreignInstallation,'Private Sol','Private Foreign','private-owner-key','private-foreign-key','private.example.test','private-cell-key','private-gateway','private-peer-key','private-public.example.test','private-staff.example.test','a'.repeat(64),'storage','tls'])assert.equal(encoded.includes(secret),false,secret);
});

test('diagnostic boundary requires an owner, exact input, CSRF and a bounded allowance',async()=>{
 assert.equal((await call({installationId:installation},ownerSession,{method:'GET'})).status,405);
 assert.equal((await call({installationId:installation},ownerSession,{origin:'https://wrong.example'})).status,403);
 assert.equal((await call({installationId:installation},ownerSession,{csrf:'wrong'})).status,403);
 for(const body of [{installationId:'bad'},{installationId:installation,extra:true},{}])assert.equal((await call(body)).status,400);
 assert.equal((await call({installationId:installation},memberSession)).status,403);
 assert.equal((await call({installationId:foreignInstallation})).status,403);
 await db.pool.query('TRUNCATE account_rate_limits');
 for(let attempt=0;attempt<30;attempt++)assert.equal((await call({installationId:installation})).status,200);
 const limited=await call({installationId:installation});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>=1);
});

test('owner permission lost while the authority read waits is refused',async()=>{
 const locker=await db.secondPool.connect();try{
  await locker.query('BEGIN');await locker.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2',[owner,organisation]);
  let settled=false;const pending=Promise.resolve(call({installationId:installation})).then(response=>{settled=true;return response;});
  await delay(100);assert.equal(settled,false);await locker.query('COMMIT');
  assert.equal((await pending).status,403);
 }finally{await locker.query('ROLLBACK').catch(()=>{});locker.release();}
});

test('owner permission lost after diagnostic reads begin is refused by the final recheck',async()=>{
 const blocker=await db.secondPool.connect();let pending:Promise<Response>|undefined,revoke:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK TABLE venue_incidents IN ACCESS EXCLUSIVE MODE');
  pending=Promise.resolve(call({installationId:installation}));
  const deadline=Date.now()+5000;let waiting=false;
  while(Date.now()<deadline){
   waiting=(await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT kind,opened_at,changed_at FROM venue_incidents%'",[db.schema])).rowCount!>0;
   if(waiting)break;await delay(20);
  }
  assert.equal(waiting,true);
  let revoked=false;revoke=db.secondPool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2',[owner,organisation]).then(()=>{revoked=true;});
  await delay(100);assert.equal(revoked,true,'the diagnostic retained the membership lock before its final authority check');
  await blocker.query('COMMIT');await revoke;
  assert.equal((await pending).status,403);
 }finally{
  await blocker.query('ROLLBACK').catch(()=>{});blocker.release();
  if(pending)await pending.catch(()=>{});
  if(revoke)await revoke.catch(()=>{});
 }
});

test('legacy_rows_never_drive_default_or_healthy: diagnostic and overview timestamps lose stale qualification',async()=>{
 const {recoveryFixture}=await import('../../backups/test/fixtures/recovery-v2.ts');const f=await recoveryFixture(db);
 let diagnostic=await call({installationId:f.installed.installationId},f.session);assert.equal(diagnostic.status,200);
 assert.equal((await diagnostic.json()).installation.backups.verifiedSnapshotAt,f.point.capturedAt);
 await db.pool.query('UPDATE backup_verification_policy SET release_ready=false');
 diagnostic=await call({installationId:f.installed.installationId},f.session);assert.equal(diagnostic.status,200);
 assert.deepEqual((await diagnostic.json()).installation.backups,{latestSnapshotAt:f.point.capturedAt,verifiedSnapshotAt:null});
 const {createLeaseIssuer}=await import('@waitron-cloud/registration'),{generateKeyPairSync}=await import('node:crypto');
 const leaseIssuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const overviewApp=createAccountApp({pool:db.pool,outbox:db.outbox,leaseIssuer,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
 const overview=await overviewApp.request(origin+'/api/account/installations',{headers:{cookie:'__Host-cloud_session='+f.session.token}}, {incoming:{socket:{remoteAddress:'192.0.2.89'}}} as HttpBindings);
 assert.equal(overview.status,200);const body=await overview.json();
 assert.equal(body.installations.find((i:{installationId:string})=>i.installationId===f.installed.installationId).overview.verifiedSnapshotAt,null);
});
